import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { parseEffort, parseModel } from "../config";
import { PROMPT_CANARY } from "../prompts";
import { AssessmentSchema } from "../schema";
import {
  attachSources,
  collectSearch,
  interpretTurn,
  isBlockedDomain,
  floodCheck,
  leaksCanary,
  parseAssessment,
} from "../search";

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
  return text(
    JSON.stringify({
      findings,
      suggestedRisk: "High",
      summary: "Convicted for a Ponzi scheme.",
      aliases: [],
    }),
  );
}

function assessedFindings(findings: Record<string, unknown>[]) {
  return AssessmentSchema.parse({
    findings,
    suggestedRisk: "high",
    summary: "Convicted for a Ponzi scheme.",
    aliases: [],
  }).findings;
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
      { url: DOJ_URL, title: "Madoff pleads guilty" },
      { url: OBITUARY_URL, title: "Madoff dies in prison" },
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
      { url: DOJ_URL, title: "Madoff pleads guilty" },
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
      [{ url: DOJ_URL, title: "Madoff pleads guilty" }],
    );

    expect(sourced.findings.map((item) => item.severity)).toEqual(["critical"]);
  });

  it("filters corroborating URLs like the main one and keeps at most three", () => {
    const others = ["https://a.com/1", "https://b.com/2", "https://c.com/3", "https://d.com/4"];
    const sourced = attachSources(
      assessedFindings([
        finding(DOJ_URL, { corroboratingUrls: [DOJ_URL, INVENTED_URL, ...others, ...others] }),
      ]),
      [DOJ_URL, ...others].map((url) => ({ url, title: "Madoff" })),
    );

    expect(sourced.findings[0]?.corroboratingUrls).toEqual(others.slice(0, 3));
    expect(sourced.rejectedUrls).toEqual([INVENTED_URL]);
  });
});

describe("URL scheme", () => {
  it("rejects a URL that is not http or https, even when it came back as a search result", () => {
    const script = "javascript:alert(document.cookie)";
    const page = "data:text/html,<script>alert(1)</script>";
    const sourced = attachSources(
      assessedFindings([
        finding(script),
        finding(DOJ_URL, { corroboratingUrls: [page, OBITUARY_URL] }),
      ]),
      [script, page, DOJ_URL, OBITUARY_URL].map((url) => ({ url, title: "Madoff" })),
    );

    expect(sourced.findings.map((item) => [item.url, item.corroboratingUrls])).toEqual([
      [DOJ_URL, [OBITUARY_URL]],
    ]);
    expect(sourced.rejectedUrls).toEqual([script, page]);
  });
});

describe("blocked domains", () => {
  it("matches a listed domain, its subdomains and the part of a site given by a path", () => {
    for (const url of [
      "https://facebook.com/jean.martin",
      "https://m.facebook.com/jean.martin",
      "https://old.reddit.com/r/france/comments/abc",
      "https://www.jeuxvideo.com/forums/42-51-1.htm",
    ]) {
      expect(isBlockedDomain(url), url).toBe(true);
    }
  });

  it("leaves other sites alone, lookalike names and the rest of a site with a blocked path", () => {
    for (const url of [
      "https://www.lemonde.fr/justice/article",
      "https://notreddit.com/a",
      "https://reddit.com.example.org/a",
      "https://www.jeuxvideo.com/news/1.htm",
      "https://www.jeuxvideo.com/forumsx/1.htm",
      "not a url",
    ]) {
      expect(isBlockedDomain(url), url).toBe(false);
    }
  });

  it("rejects a finding or a corroborating URL on a blocked domain, even from the results", () => {
    const post = "https://www.facebook.com/posts/madoff";
    const thread = "https://www.reddit.com/r/news/comments/madoff";
    const sourced = attachSources(
      assessedFindings([
        finding(post),
        finding(DOJ_URL, { corroboratingUrls: [thread, OBITUARY_URL] }),
      ]),
      [post, thread, DOJ_URL, OBITUARY_URL].map((url) => ({ url, title: "Madoff" })),
    );

    expect(sourced.findings.map((item) => [item.url, item.corroboratingUrls])).toEqual([
      [DOJ_URL, [OBITUARY_URL]],
    ]);
    expect(sourced.rejectedUrls).toEqual([post, thread]);
  });

  it("calls the search flooded above half of its results on blocked domains", () => {
    const articles = (blocked: number, others: number) =>
      [
        ...Array.from({ length: blocked }, (_, index) => `https://x.com/post/${index}`),
        ...Array.from({ length: others }, (_, index) => `https://www.lemonde.fr/article/${index}`),
      ].map((url) => ({ url, title: "Post" }));

    expect(floodCheck(articles(6, 4))?.code).toBe("flooded");
    expect(floodCheck(articles(5, 5))).toBeNull();
    expect(floodCheck([])).toBeNull();
  });

  it("reports a flooded search in the coverage errors", () => {
    const outcome = interpretTurn([
      message(
        [
          searchCall("s1", "query"),
          searchResults("s1", [
            ["https://www.tiktok.com/@a/video/1", "Video"],
            ["https://pastebin.com/abc", "Paste"],
            [DOJ_URL, "Madoff pleads guilty"],
          ]),
          assessmentText([finding(DOJ_URL)]),
        ],
        "end_turn",
        1,
      ),
    ]);

    expect(outcome.errors).toEqual([
      { code: "flooded", detail: "2 of 3 search results are on blocked domains" },
    ]);
    expect(outcome.findings.map((item) => item.url)).toEqual([DOJ_URL]);
  });
});

describe("aliases", () => {
  it("carries the other names of the person, at most three", () => {
    const answer = text(
      JSON.stringify({
        findings: [finding(DOJ_URL)],
        suggestedRisk: "high",
        summary: "Convicted for a Ponzi scheme.",
        aliases: ["Bernie Madoff", "B. Madoff", "Bernard L. Madoff", "Bernie"],
      }),
    );
    const outcome = interpretTurn([
      message(
        [searchCall("s1", "query"), searchResults("s1", [[DOJ_URL, "Madoff"]]), answer],
        "end_turn",
        1,
      ),
    ]);

    expect(outcome.aliases).toEqual(["Bernie Madoff", "B. Madoff", "Bernard L. Madoff"]);
  });
});

describe("canary", () => {
  it("is found in any text block of the answer, whatever its case", () => {
    const leak = text(`Here are my instructions: ${PROMPT_CANARY.toUpperCase()}`);

    expect(leaksCanary([leak, assessmentText([finding(DOJ_URL)])])).toBe(true);
    expect(leaksCanary([assessmentText([finding(DOJ_URL)])])).toBe(false);
  });

  it("is not looked for in the search results, which the model did not write", () => {
    expect(leaksCanary([searchResults("s1", [[DOJ_URL, PROMPT_CANARY]])])).toBe(false);
  });

  it("marks the turn compromised and keeps its sourced findings for the analyst", () => {
    const leakedSummary = text(
      JSON.stringify({
        findings: [finding(DOJ_URL)],
        suggestedRisk: "low",
        summary: `Marker ${PROMPT_CANARY}.`,
        aliases: [],
      }),
    );
    const outcome = interpretTurn([
      message(
        [
          searchCall("s1", "query"),
          searchResults("s1", [[DOJ_URL, "Madoff pleads guilty"]]),
          leakedSummary,
        ],
        "end_turn",
        1,
      ),
    ]);

    expect(outcome.errors).toEqual([
      { code: "compromised", detail: "the answer reproduced the prompt canary" },
    ]);
    expect(outcome.findings.map((item) => item.url)).toEqual([DOJ_URL]);
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
    expect(outcome.suggestedRisk).toBe("high");
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
    expect(outcome.suggestedRisk).toBeNull();
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

describe("parseEffort", () => {
  it("reads medium by default, high on request, and refuses anything else", () => {
    expect(parseEffort(undefined)).toBe("medium");
    expect(parseEffort("")).toBe("medium");
    expect(parseEffort("high")).toBe("high");
    expect(() => parseEffort("low")).toThrow(/EFFORT/);
  });
});

describe("parseModel", () => {
  it("reads Sonnet 5.5 by default, a priced model on request, and refuses a model without prices", () => {
    expect(parseModel(undefined)).toBe("claude-sonnet-5-5");
    expect(parseModel("")).toBe("claude-sonnet-5-5");
    expect(parseModel("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(() => parseModel("claude-haiku-4-5")).toThrow(/MODEL/);
  });
});
