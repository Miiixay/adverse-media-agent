import Anthropic from "@anthropic-ai/sdk";

import type { Effort } from "./config";
import type { PricedModel } from "./cost";
import { BLOCKED_DOMAINS } from "./data/blocked-domains";
import { MAX_SEARCHES } from "./prepare";
import { PROMPT_CANARY, SYSTEM_PROMPT, buildUserMessage } from "./prompts";
import {
  ASSESSMENT_JSON_SCHEMA,
  AssessmentSchema,
  MAX_ALIASES,
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

const MAX_OUTPUT_TOKENS = 8_000;
const MAX_CONTINUATIONS = 3;
// Retrying a request whose answer never arrived would run and bill the searches a second time.
const SEARCH_MAX_RETRIES = 0;
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);
// Above this share of search results on blocked domains, the coverage is reported incomplete.
const MAX_BLOCKED_SHARE = 0.5;
const COMPROMISED: CoverageError = {
  code: "compromised",
  detail: "the answer reproduced the prompt canary",
};

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
  effort: Effort,
  model: PricedModel,
): Promise<SearchOutcome> {
  const request = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    // The cache breakpoint closes the static prefix, tools then system; the user message after it
    // changes on every screening. The tool definition carries user_location, so the prefix is only
    // shared between screenings of one country (D-29).
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [webSearchTool(input.country, plan.countrySupported)],
    output_config: {
      effort,
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
    if (remainingMs <= 0) return timedOut(responses, timeBudgetMs, model);
    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        { ...request, messages },
        { maxRetries: SEARCH_MAX_RETRIES, timeout: remainingMs },
      );
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        return timedOut(responses, timeBudgetMs, model);
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
function timedOut(
  responses: readonly Anthropic.Message[],
  timeBudgetMs: number,
  model: PricedModel,
): SearchOutcome {
  const timeout: CoverageError = {
    code: "timeout",
    detail: `no complete answer within ${timeBudgetMs / 1000} s`,
  };
  if (responses.length === 0) {
    return {
      summary: null,
      suggestedRisk: null,
      findings: [],
      rejectedUrls: [],
      articles: [],
      executedQueries: [],
      aliases: [],
      errors: [timeout],
      usage: NO_USAGE,
      model,
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
  const flood = floodCheck(search.articles);
  const errors = [
    ...search.errors,
    ...(parsed.ok ? [] : [parsed.error]),
    ...(leaksCanary(content) ? [COMPROMISED] : []),
    ...(flood === null ? [] : [flood]),
  ];

  return {
    summary: parsed.ok ? parsed.assessment.summary : null,
    suggestedRisk: parsed.ok ? parsed.assessment.suggestedRisk : null,
    findings: sourced.findings,
    rejectedUrls: sourced.rejectedUrls,
    articles: search.articles,
    executedQueries: search.queries,
    // The grammar cannot bound an array (D-22): the list is cut here.
    aliases: parsed.ok ? parsed.assessment.aliases.slice(0, MAX_ALIASES) : [],
    errors,
    usage: sumUsage(responses),
    model: final.model,
    apiCalls: responses.length,
  };
}

// Every search is a server_tool_use / web_search_tool_result pair. The tool is called directly
// (D-17); with dynamic filtering turned back on, the searches its code runs would come back as the
// same pairs, read here too. Only search results are sources, never the output of that code.
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
          articles.set(result.url, { url: result.url, title: result.title });
        }
      }
    } else {
      const query = queriesById.get(block.tool_use_id) ?? "unknown query";
      errors.push({ code: block.content.error_code, detail: `search failed: ${query}` });
    }
  }
  return { articles: [...articles.values()], queries: [...queriesById.values()], errors };
}

// Every text block counts, not only the JSON: a leak can sit in a sentence written between
// searches. The comparison ignores case, the model may change it.
export function leaksCanary(content: readonly Anthropic.ContentBlock[]): boolean {
  const canary = PROMPT_CANARY.toLowerCase();
  return content.some(
    (block) => block.type === "text" && block.text.toLowerCase().includes(canary),
  );
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
    if (article === undefined || !isAcceptedSource(finding.url)) {
      rejectedUrls.push(finding.url);
      continue;
    }
    // An article listed twice keeps its first assessment, so the score counts it once.
    if (kept.has(finding.url)) continue;

    const otherUrls = [...new Set(finding.corroboratingUrls)].filter((url) => url !== finding.url);
    const sourcedUrls = otherUrls.filter((url) => articlesByUrl.has(url) && isAcceptedSource(url));
    rejectedUrls.push(...otherUrls.filter((url) => !sourcedUrls.includes(url)));
    kept.set(finding.url, {
      ...finding,
      title: article.title,
      corroboratingUrls: sourcedUrls.slice(0, MAX_CORROBORATING_URLS),
    });
  }
  return { findings: [...kept.values()], rejectedUrls };
}

// The interface renders these URLs as links: a javascript: or data: URL would run in the page,
// even one that came back as a search result. A page anyone can write is no evidence (D-37).
function isAcceptedSource(url: string): boolean {
  return URL.canParse(url) && WEB_PROTOCOLS.has(new URL(url).protocol) && !isBlockedDomain(url);
}

// An entry blocks its domain and every subdomain; an entry with a path blocks that part of the
// site only.
export function isBlockedDomain(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { hostname, pathname } = new URL(url);
  return BLOCKED_DOMAINS.some((entry) => {
    const slash = entry.indexOf("/");
    const domain = slash === -1 ? entry : entry.slice(0, slash);
    const path = slash === -1 ? "" : entry.slice(slash);
    const onDomain = hostname === domain || hostname.endsWith(`.${domain}`);
    return onDomain && (path === "" || pathname === path || pathname.startsWith(`${path}/`));
  });
}

// The blocked domains are filtered here rather than on the search tool, whose filter changes the
// whole result set (D-37). If such pages crowd out the rest, the search covered little else.
export function floodCheck(articles: readonly RawArticle[]): CoverageError | null {
  const blocked = articles.filter((article) => isBlockedDomain(article.url)).length;
  if (blocked <= articles.length * MAX_BLOCKED_SHARE) return null;
  return {
    code: "flooded",
    detail: `${blocked} of ${articles.length} search results are on blocked domains`,
  };
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
