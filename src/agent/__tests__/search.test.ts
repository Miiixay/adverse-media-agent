import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { AssessmentSchema } from "../schema";
import { attachSources, collectSearch, interpretTurn, parseAssessment } from "../search";

type Caller = Anthropic.WebSearchToolResultBlock["caller"];

const DIRECT: Caller = { type: "direct" };

// A search run by the code that filters results, under dynamic filtering.
function fromCode(codeExecutionId: string): Caller {
  return { type: "code_execution_20260120", tool_id: codeExecutionId };
}

// Block shapes follow a real response captured on 2026-10-01. In direct mode the API leaves out
// `caller` on server_tool_use and `citations` on the JSON text block; the fixtures set them only
// because the SDK types declare them.
function searchCall(id: string, query: string, caller = DIRECT): Anthropic.ServerToolUseBlock {
  return { type: "server_tool_use", id, name: "web_search", input: { query }, caller };
}

function codeExecutionCall(id: string): Anthropic.ServerToolUseBlock {
  return {
    type: "server_tool_use",
    id,
    name: "code_execution",
    input: { code: "results = [web_search(query=q) for q in queries]" },
    caller: DIRECT,
  };
}

function codeExecutionResult(toolUseId: string, stdout: string): Anthropic.ContentBlock {
  return {
    type: "code_execution_tool_result",
    tool_use_id: toolUseId,
    content: { type: "code_execution_result", stdout, stderr: "", return_code: 0, content: [] },
  };
}

function searchResults(
  toolUseId: string,
  results: [url: string, title: string][],
  caller = DIRECT,
): Anthropic.WebSearchToolResultBlock {
  return {
    type: "web_search_tool_result",
    tool_use_id: toolUseId,
    caller,
    content: results.map(([url, title]) => ({
      type: "web_search_result",
      url,
      title,
      page_age: "221 days ago",
      encrypted_content: "opaque",
    })),
  };
}

function searchError(
  toolUseId: string,
  code: Anthropic.WebSearchToolResultErrorCode,
): Anthropic.WebSearchToolResultBlock {
  return {
    type: "web_search_tool_result",
    tool_use_id: toolUseId,
    caller: { type: "direct" },
    content: { type: "web_search_tool_result_error", error_code: code },
  };
}

function text(value: string): Anthropic.TextBlock {
  return { type: "text", text: value, citations: null };
}

function message(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.StopReason,
  webSearches = 0,
): Anthropic.Message {
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    container: null,
    diagnostics: null,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      output_tokens_details: { thinking_tokens: 0 },
      server_tool_use: { web_search_requests: webSearches, web_fetch_requests: 0 },
      service_tier: "standard",
      inference_geo: "global",
    },
  };
}

const DOJ_URL = "https://www.justice.gov/madoff-plea";
const OBITUARY_URL = "https://www.cbc.ca/news/madoff-obituary";
const INVENTED_URL = "https://example.com/not-in-results";

function finding(url: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url,
    corroboratingUrls: [],
    language: "en",
    subject: "person",
    date: "2009-03-12",
    category: "fraud",
    severity: "critical",
    status: "conviction",
    identityConfidence: "high",
    identityEvidence: ["same full name, United States"],
    sourceReliability: "official",
    summary: "Pleaded guilty to eleven federal felonies.",
    ...overrides,
  };
}

function assessmentText(findings: Record<string, unknown>[]): Anthropic.TextBlock {
  return text(JSON.stringify({ summary: "Convicted for a Ponzi scheme.", findings }));
}

function assessedFindings(findings: Record<string, unknown>[]) {
  return AssessmentSchema.parse({ summary: "Convicted for a Ponzi scheme.", findings }).findings;
}

describe("collectSearch", () => {
  it("collects each result URL once with its first title, and the queries that ran", () => {
    const collected = collectSearch([
      searchCall("s1", '"Bernard Madoff" fraud'),
      searchCall("s2", '"Bernard Madoff" convicted'),
      searchResults("s1", [
        [DOJ_URL, "Madoff pleads guilty"],
        [OBITUARY_URL, "Madoff dies in prison"],
      ]),
      searchResults("s2", [[DOJ_URL, "Same page, other title"]]),
    ]);

    expect(collected.articles).toEqual([
      { url: DOJ_URL, title: "Madoff pleads guilty", pageAge: "221 days ago" },
      { url: OBITUARY_URL, title: "Madoff dies in prison", pageAge: "221 days ago" },
    ]);
    expect(collected.queries).toEqual(['"Bernard Madoff" fraud', '"Bernard Madoff" convicted']);
    expect(collected.errors).toEqual([]);
  });

  it("reports a tool error with the query that failed", () => {
    const collected = collectSearch([
      searchCall("s1", '"Jean Martin" fraude'),
      searchError("s1", "too_many_requests"),
    ]);

    expect(collected.articles).toEqual([]);
    expect(collected.errors).toEqual([
      { code: "too_many_requests", detail: 'search failed: "Jean Martin" fraude' },
    ]);
  });

  it("treats a search without results as coverage, not as an error", () => {
    const collected = collectSearch([
      searchCall("s1", '"Friederike Wenzlaff-Obermaier" Betrug'),
      searchResults("s1", []),
    ]);

    expect(collected.articles).toEqual([]);
    expect(collected.errors).toEqual([]);
  });

  it("collects the searches run from code execution like the direct ones", () => {
    const collected = collectSearch([
      codeExecutionCall("c1"),
      searchCall("s1", '"Bernard Madoff" fraud', fromCode("c1")),
      searchResults("s1", [[DOJ_URL, "Madoff pleads guilty"]], fromCode("c1")),
      codeExecutionResult("c1", `kept 1 of 9 results: ${OBITUARY_URL}`),
      searchCall("s2", '"Bernard Madoff" convicted'),
      searchResults("s2", [[OBITUARY_URL, "Madoff dies in prison"]]),
    ]);

    expect(collected.articles.map((article) => article.url)).toEqual([DOJ_URL, OBITUARY_URL]);
    expect(collected.queries).toEqual(['"Bernard Madoff" fraud', '"Bernard Madoff" convicted']);
  });

  it("takes no URL from the output of the filtering code", () => {
    const collected = collectSearch([
      codeExecutionCall("c1"),
      codeExecutionResult("c1", `see ${INVENTED_URL}`),
    ]);

    expect(collected.articles).toEqual([]);
    expect(collected.queries).toEqual([]);
  });
});

describe("parseAssessment", () => {
  it("reads the JSON from the last text block, after any narration", () => {
    const parsed = parseAssessment([
      text("I will search for adverse media about this person."),
      searchCall("s1", '"Bernard Madoff" fraud'),
      searchResults("s1", [[DOJ_URL, "Madoff pleads guilty"]]),
      assessmentText([finding(DOJ_URL)]),
    ]);

    expect(parsed.ok && parsed.assessment.findings.map((item) => item.url)).toEqual([DOJ_URL]);
  });

  it("accepts enum values in another casing and lowercases them", () => {
    const parsed = parseAssessment([
      assessmentText([finding(DOJ_URL, { category: "Fraud", identityConfidence: "HIGH" })]),
    ]);

    expect(parsed.ok && parsed.assessment.findings[0]).toMatchObject({
      category: "fraud",
      identityConfidence: "high",
    });
  });

  it("rejects a response without a text block", () => {
    expect(parseAssessment([searchCall("s1", "query")])).toEqual({
      ok: false,
      error: { code: "invalid_output", detail: "the response has no text block" },
    });
  });

  it("rejects a last text block that is not JSON", () => {
    expect(parseAssessment([text("Here are the findings.")])).toEqual({
      ok: false,
      error: { code: "invalid_output", detail: "the last text block is not valid JSON" },
    });
  });

  it("rejects values outside the schema and names the field", () => {
    const parsed = parseAssessment([assessmentText([finding(DOJ_URL, { status: "rumour" })])]);

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error.detail).toContain("findings.0.status");
  });

  it("rejects a date that is not in ISO form", () => {
    const parsed = parseAssessment([assessmentText([finding(DOJ_URL, { date: "March 2009" })])]);

    expect(!parsed.ok && parsed.error.detail).toContain("findings.0.date");
  });
});

describe("attachSources", () => {
  it("drops findings whose URL is not among the search results", () => {
    const sourced = attachSources(assessedFindings([finding(DOJ_URL), finding(INVENTED_URL)]), [
      { url: DOJ_URL, title: "Madoff pleads guilty", pageAge: null },
    ]);

    expect(sourced.findings.map((item) => [item.url, item.title])).toEqual([
      [DOJ_URL, "Madoff pleads guilty"],
    ]);
    expect(sourced.rejectedUrls).toEqual([INVENTED_URL]);
  });

  it("keeps the first assessment of an article listed twice", () => {
    const sourced = attachSources(
      assessedFindings([
        finding(DOJ_URL, { severity: "critical" }),
        finding(DOJ_URL, { severity: "minor" }),
      ]),
      [{ url: DOJ_URL, title: "Madoff pleads guilty", pageAge: null }],
    );

    expect(sourced.findings.map((item) => item.severity)).toEqual(["critical"]);
  });

  it("filters corroborating URLs like the main one and keeps at most three", () => {
    const others = ["https://a.com/1", "https://b.com/2", "https://c.com/3", "https://d.com/4"];
    const sourced = attachSources(
      assessedFindings([
        finding(DOJ_URL, { corroboratingUrls: [DOJ_URL, INVENTED_URL, ...others, ...others] }),
      ]),
      [DOJ_URL, ...others].map((url) => ({ url, title: "Madoff", pageAge: null })),
    );

    expect(sourced.findings[0]?.corroboratingUrls).toEqual(others.slice(0, 3));
    expect(sourced.rejectedUrls).toEqual([INVENTED_URL]);
  });
});

describe("interpretTurn", () => {
  it("sources the findings of a turn that searched from code execution", () => {
    const outcome = interpretTurn([
      message(
        [
          codeExecutionCall("c1"),
          searchCall("s1", '"Bernard Madoff" fraud', fromCode("c1")),
          searchResults("s1", [[DOJ_URL, "Madoff pleads guilty"]], fromCode("c1")),
          codeExecutionResult("c1", "kept 1 of 9 results"),
          assessmentText([finding(DOJ_URL)]),
        ],
        "end_turn",
        1,
      ),
    ]);

    expect(outcome.findings.map((item) => [item.url, item.title])).toEqual([
      [DOJ_URL, "Madoff pleads guilty"],
    ]);
    expect(outcome.rejectedUrls).toEqual([]);
    expect(outcome.errors).toEqual([]);
  });

  it("joins a resumed pause_turn and sums the usage of both calls", () => {
    const outcome = interpretTurn([
      message([searchCall("s1", '"Bernard Madoff" fraud')], "pause_turn"),
      message(
        [
          searchResults("s1", [[DOJ_URL, "Madoff pleads guilty"]]),
          assessmentText([finding(DOJ_URL)]),
        ],
        "end_turn",
        1,
      ),
    ]);

    expect(outcome.findings.map((item) => item.url)).toEqual([DOJ_URL]);
    expect(outcome.errors).toEqual([]);
    expect(outcome.apiCalls).toBe(2);
    expect(outcome.usage).toMatchObject({ inputTokens: 2000, outputTokens: 200, webSearches: 1 });
  });

  it("reports a refusal without findings and keeps what was searched", () => {
    const refused: Anthropic.Message = {
      ...message(
        [searchCall("s1", "query"), searchResults("s1", [[DOJ_URL, "Madoff pleads guilty"]])],
        "refusal",
        1,
      ),
      stop_details: { type: "refusal", category: "general_harms", explanation: null },
    };

    const outcome = interpretTurn([refused]);

    expect(outcome.summary).toBeNull();
    expect(outcome.findings).toEqual([]);
    expect(outcome.articles).toHaveLength(1);
    expect(outcome.errors).toEqual([
      { code: "refusal", detail: "declined by the model, category: general_harms" },
    ]);
  });

  it("reports a truncated output instead of parsing it", () => {
    const outcome = interpretTurn([message([text('{"summary": "Convicted for')], "max_tokens")]);

    expect(outcome.summary).toBeNull();
    expect(outcome.errors.map((error) => error.code)).toEqual(["max_tokens"]);
  });

  it("reports a turn still paused after the last continuation", () => {
    const paused = message([searchCall("s1", "query")], "pause_turn");

    const outcome = interpretTurn([paused, paused, paused, paused]);

    expect(outcome.errors.map((error) => error.code)).toEqual(["turn_paused"]);
  });
});
