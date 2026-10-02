import Anthropic from "@anthropic-ai/sdk";

import type { PricedModel } from "./cost";
import { MAX_SEARCHES } from "./prepare";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts";
import {
  ASSESSMENT_JSON_SCHEMA,
  AssessmentSchema,
  MAX_CORROBORATING_URLS,
  type Assessment,
} from "./schema";
import type {
  AssessedFinding,
  CoverageError,
  RawArticle,
  ScreeningInput,
  SearchOutcome,
  SearchPlan,
  TokenUsage,
} from "./types";

export const MODEL: PricedModel = "claude-sonnet-5-5";
const MAX_OUTPUT_TOKENS = 8_000;
const MAX_CONTINUATIONS = 3;
// Sonnet 5.5 defaults to high. Changing it invalidates the prompt cache, so it is fixed here (v2.4).
const EFFORT = "medium";
// Retrying a request whose answer never arrived would run and bill the searches a second time.
const SEARCH_MAX_RETRIES = 0;

const NO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  webSearches: 0,
};

type ParsedAssessment = { ok: true; assessment: Assessment } | { ok: false; error: CoverageError };

export async function searchAdverseMedia(
  client: Anthropic,
  input: ScreeningInput,
  plan: SearchPlan,
  timeBudgetMs: number,
): Promise<SearchOutcome> {
  const request = {
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    // The cache breakpoint closes the static prefix, tools then system; the user message after it
    // changes on every screening. The tool definition carries user_location, so the prefix is only
    // shared between screenings of one country (v2.3).
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [webSearchTool(input.country, plan.countrySupported)],
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema: ASSESSMENT_JSON_SCHEMA },
    },
  } satisfies Omit<Anthropic.MessageCreateParamsNonStreaming, "messages">;

  const deadline = Date.now() + timeBudgetMs;
  const responses: Anthropic.Message[] = [];
  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserMessage(input, plan) },
  ];
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return timedOut(responses, timeBudgetMs);
    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        { ...request, messages },
        { maxRetries: SEARCH_MAX_RETRIES, timeout: remainingMs },
      );
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        return timedOut(responses, timeBudgetMs);
      }
      throw error;
    }
    responses.push(response);
    if (response.stop_reason !== "pause_turn" || responses.length > MAX_CONTINUATIONS) {
      return interpretTurn(responses);
    }
    // A long search turn can pause; sending the paused content back unchanged resumes it.
    messages = [...messages, { role: "assistant", content: response.content }];
  }
}

// A request cut by the timeout has no usage to report, although the API may still have run and
// billed it; the usage and apiCalls of the outcome cover the answered requests only.
function timedOut(responses: readonly Anthropic.Message[], timeBudgetMs: number): SearchOutcome {
  const timeout: CoverageError = {
    code: "timeout",
    detail: `no complete answer within ${timeBudgetMs / 1000} s`,
  };
  if (responses.length === 0) {
    return {
      summary: null,
      findings: [],
      rejectedUrls: [],
      articles: [],
      executedQueries: [],
      errors: [timeout],
      usage: NO_USAGE,
      model: MODEL,
      apiCalls: 0,
    };
  }
  const outcome = interpretTurn(responses);
  return { ...outcome, errors: [...outcome.errors, timeout] };
}

export function interpretTurn(responses: readonly Anthropic.Message[]): SearchOutcome {
  const final = responses.at(-1);
  if (final === undefined) {
    throw new Error("interpretTurn needs at least one response");
  }
  const content = responses.flatMap((response) => response.content);
  const search = collectSearch(content);
  const stopError = stopReasonError(final);
  const parsed: ParsedAssessment =
    stopError === null ? parseAssessment(content) : { ok: false, error: stopError };
  const sourced = parsed.ok
    ? attachSources(parsed.assessment.findings, search.articles)
    : { findings: [], rejectedUrls: [] };

  return {
    summary: parsed.ok ? parsed.assessment.summary : null,
    findings: sourced.findings,
    rejectedUrls: sourced.rejectedUrls,
    articles: search.articles,
    executedQueries: search.queries,
    errors: parsed.ok ? search.errors : [...search.errors, parsed.error],
    usage: sumUsage(responses),
    model: final.model,
    apiCalls: responses.length,
  };
}

// Every search shows up as a server_tool_use and web_search_tool_result pair in the content,
// whether the model called it directly or from the code that filters results (D-17). The caller
// field tells the two apart and is not needed here. The output of that code is not a source:
// finding URLs are checked against search results only.
export function collectSearch(content: readonly Anthropic.ContentBlock[]): {
  articles: RawArticle[];
  queries: string[];
  errors: CoverageError[];
} {
  const queriesById = new Map<string, string>();
  for (const block of content) {
    if (block.type !== "server_tool_use" || block.name !== "web_search") continue;
    const query = queryOf(block.input);
    if (query !== undefined) queriesById.set(block.id, query);
  }

  const articles = new Map<string, RawArticle>();
  const errors: CoverageError[] = [];
  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    if (Array.isArray(block.content)) {
      for (const result of block.content) {
        if (!articles.has(result.url)) {
          articles.set(result.url, {
            url: result.url,
            title: result.title,
            pageAge: result.page_age,
          });
        }
      }
    } else {
      const query = queriesById.get(block.tool_use_id) ?? "unknown query";
      errors.push({ code: block.content.error_code, detail: `search failed: ${query}` });
    }
  }
  return { articles: [...articles.values()], queries: [...queriesById.values()], errors };
}

// The JSON is read from the last text block: the model may write a sentence before searching.
export function parseAssessment(content: readonly Anthropic.ContentBlock[]): ParsedAssessment {
  const lastText = content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .at(-1);
  if (lastText === undefined) {
    return invalidOutput("the response has no text block");
  }
  let json: unknown;
  try {
    json = JSON.parse(lastText.text);
  } catch {
    return invalidOutput("the last text block is not valid JSON");
  }
  const parsed = AssessmentSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join(".")}: ${issue.message}`,
    );
    return invalidOutput(issues.join("; "));
  }
  return { ok: true, assessment: parsed.data };
}

export function attachSources(
  findings: Assessment["findings"],
  articles: readonly RawArticle[],
): { findings: AssessedFinding[]; rejectedUrls: string[] } {
  const articlesByUrl = new Map(articles.map((article) => [article.url, article]));
  const kept = new Map<string, AssessedFinding>();
  const rejectedUrls: string[] = [];
  for (const finding of findings) {
    const article = articlesByUrl.get(finding.url);
    if (article === undefined) {
      rejectedUrls.push(finding.url);
      continue;
    }
    // An article listed twice keeps its first assessment, so the score counts it once.
    if (kept.has(finding.url)) continue;

    const otherUrls = [...new Set(finding.corroboratingUrls)].filter((url) => url !== finding.url);
    rejectedUrls.push(...otherUrls.filter((url) => !articlesByUrl.has(url)));
    kept.set(finding.url, {
      ...finding,
      title: article.title,
      corroboratingUrls: otherUrls
        .filter((url) => articlesByUrl.has(url))
        .slice(0, MAX_CORROBORATING_URLS),
    });
  }
  return { findings: [...kept.values()], rejectedUrls };
}

function webSearchTool(
  country: string,
  countrySupported: boolean,
): Anthropic.WebSearchTool20260318 {
  return {
    type: "web_search_20260318",
    name: "web_search",
    max_uses: MAX_SEARCHES,
    // Dynamic filtering, the default, cost 14% more on the fixtures and is not ZDR-eligible (D-17).
    allowed_callers: ["direct"],
    // The API rejects country codes it does not support. Only countries of the language table are
    // localized; the others are searched in the international English press.
    user_location: countrySupported ? { type: "approximate", country } : null,
  };
}

function stopReasonError(response: Anthropic.Message): CoverageError | null {
  switch (response.stop_reason) {
    case "end_turn":
      return null;
    case "refusal":
      return {
        code: "refusal",
        detail: `declined by the model, category: ${response.stop_details?.category ?? "unspecified"}`,
      };
    case "max_tokens":
      return { code: "max_tokens", detail: `output cut at ${MAX_OUTPUT_TOKENS} tokens` };
    case "pause_turn":
      return {
        code: "turn_paused",
        detail: "the search turn was still paused when it stopped",
      };
    default:
      return { code: "unexpected_stop_reason", detail: `stop_reason: ${response.stop_reason}` };
  }
}

function queryOf(input: unknown): string | undefined {
  if (typeof input === "object" && input !== null && "query" in input) {
    return typeof input.query === "string" ? input.query : undefined;
  }
  return undefined;
}

function sumUsage(responses: readonly Anthropic.Message[]): TokenUsage {
  return responses.reduce(
    (total, { usage }) => ({
      inputTokens: total.inputTokens + usage.input_tokens,
      outputTokens: total.outputTokens + usage.output_tokens,
      cacheReadTokens: total.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
      cacheWrite5mTokens:
        total.cacheWrite5mTokens + (usage.cache_creation?.ephemeral_5m_input_tokens ?? 0),
      cacheWrite1hTokens:
        total.cacheWrite1hTokens + (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0),
      webSearches: total.webSearches + (usage.server_tool_use?.web_search_requests ?? 0),
    }),
    NO_USAGE,
  );
}

function invalidOutput(detail: string): ParsedAssessment {
  return { ok: false, error: { code: "invalid_output", detail } };
}
