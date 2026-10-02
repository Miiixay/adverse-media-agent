export type ScreeningInput = {
  firstName: string;
  lastName: string;
  // ISO 3166-1 alpha-2, uppercase.
  country: string;
};

export type Language =
  | "cs"
  | "da"
  | "de"
  | "el"
  | "en"
  | "es"
  | "fi"
  | "fr"
  | "it"
  | "nl"
  | "no"
  | "pl"
  | "pt"
  | "ro"
  | "sk"
  | "sv"
  | "tr";

export type SearchQuery = {
  language: Language;
  text: string;
};

export type SearchPlan = {
  languages: Language[];
  // false when the country is missing from the language table: the search runs in English only.
  countrySupported: boolean;
  nameVariants: string[];
  queries: SearchQuery[];
};

export const CATEGORIES = [
  "money_laundering",
  "fraud",
  "corruption",
  "sanctions",
  "terrorism",
  "organized_crime",
  "violence",
  "civil_litigation",
  "regulatory",
  "controversy",
  "other",
] as const;
export const SEVERITIES = ["critical", "moderate", "minor"] as const;
export const STATUSES = [
  "allegation",
  "investigation",
  "indictment",
  "conviction",
  "acquitted",
  "unclear",
] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const SOURCE_RELIABILITIES = [
  "official",
  "national_press",
  "local_press",
  "blog",
  "social",
  "unknown",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Status = (typeof STATUSES)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type SourceReliability = (typeof SOURCE_RELIABILITIES)[number];
export type RiskLevel = "low" | "medium" | "high";

export type RawArticle = {
  url: string;
  title: string;
  // Relative "last updated" text from the search engine, such as "221 days ago"; not a date.
  pageAge: string | null;
};

export type Finding = {
  url: string;
  // Other search results reporting the same facts; they feed the corroboration modulator.
  corroboratingUrls: string[];
  title: string;
  date: string | null;
  language: string;
  category: Category;
  severity: Severity;
  status: Status;
  identityConfidence: Confidence;
  identityEvidence: string[];
  sourceReliability: SourceReliability;
  summary: string;
  countedInScore: boolean;
};

export type AssessedFinding = Omit<Finding, "countedInScore">;

export type CoverageErrorCode =
  // Reported by the web search tool inside a successful response.
  | "too_many_requests"
  | "invalid_tool_input"
  | "max_uses_exceeded"
  | "query_too_long"
  | "request_too_large"
  | "unavailable"
  // The turn ended without a usable assessment.
  | "refusal"
  | "max_tokens"
  | "turn_paused"
  | "timeout"
  | "unexpected_stop_reason"
  | "invalid_output";

export type CoverageError = {
  code: CoverageErrorCode;
  detail: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  webSearches: number;
};

export type SearchOutcome = {
  // null when the turn produced no usable assessment; the reason is in errors.
  summary: string | null;
  findings: AssessedFinding[];
  // Findings dropped because their URL was not among the search results.
  rejectedUrls: string[];
  articles: RawArticle[];
  executedQueries: string[];
  errors: CoverageError[];
  usage: TokenUsage;
  model: string;
  // Requests that returned an answer.
  apiCalls: number;
};

export type ScreeningStatus = "complete" | "incomplete";

export type ScreeningResult = {
  // incomplete when a planned query did not run or something failed: a low risk is then not
  // evidence that nothing exists.
  status: ScreeningStatus;
  risk: RiskLevel;
  confidence: Confidence;
  summary: string | null;
  findings: Finding[];
  coverage: {
    languages: Language[];
    countrySupported: boolean;
    plannedQueries: string[];
    executedQueries: string[];
    searchesUsed: number;
    // Distinct search results the model read: tells "nothing came back" from "nothing negative".
    articlesReviewed: number;
    rejectedUrls: string[];
    errors: CoverageError[];
  };
  usage: TokenUsage & { estimatedCostUsd: number };
  model: string;
  promptVersion: string;
  screenedAt: string;
  durationMs: number;
};
