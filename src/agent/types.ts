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
// sanctioned: a final administrative or regulatory decision, such as a fine, a ban, an
// ineligibility or a listing on a sanctions list (D-33).
export const STATUSES = [
  "allegation",
  "investigation",
  "indictment",
  "conviction",
  "sanctioned",
  "acquitted",
  "unclear",
] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export const SOURCE_RELIABILITIES = [
  "official",
  "national_press",
  "local_press",
  // Wikipedia and the like: named apart from unknown sources, weighed like them (D-44).
  "encyclopedia",
  "blog",
  "social",
  "unknown",
] as const;
// Who the article is about: the screened person, an organization linked to the person, or an
// associate such as a relative or partner, in which the person is not personally involved.
export const SUBJECTS = ["person", "organization", "associate"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Status = (typeof STATUSES)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type SourceReliability = (typeof SOURCE_RELIABILITIES)[number];
export type Subject = (typeof SUBJECTS)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];

export type RawArticle = {
  url: string;
  title: string;
};

export type Finding = {
  url: string;
  // Other search results reporting the same facts; they feed the corroboration modulator.
  corroboratingUrls: string[];
  title: string;
  date: string | null;
  language: string;
  subject: Subject;
  category: Category;
  severity: Severity;
  status: Status;
  identityConfidence: Confidence;
  identityEvidence: string[];
  sourceReliability: SourceReliability;
  summary: string;
  countedInScore: boolean;
  // The level this finding gives the risk; null when it is not counted.
  riskLevel: RiskLevel | null;
};

export type AssessedFinding = Omit<Finding, "countedInScore" | "riskLevel">;

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
  // The answer reproduced the prompt canary: none of its assessments is trusted (D-36).
  | "compromised"
  // Most search results came from blocked domains: the search returned little else (D-37).
  | "flooded"
  // The summary cites a year no finding is dated in: a warning, the coverage stays complete.
  | "unsourced_summary"
  | "unexpected_stop_reason"
  | "invalid_output";

// What, in a first screening, sends the person to a second screening on another model (D-49).
export type EscalationSignal = "counted_finding" | "alias" | "unsourced_summary" | "incomplete";

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
  // The model's own view of the overall risk, which the score does not read (D-51).
  suggestedRisk: RiskLevel | null;
  findings: AssessedFinding[];
  // Findings dropped because their URL was not among the search results.
  rejectedUrls: string[];
  articles: RawArticle[];
  executedQueries: string[];
  aliases: string[];
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
  // The model's own view of the risk, recorded as an opinion: the grid decides (D-51). null without
  // a usable or trusted assessment.
  modelSuggestedRisk: RiskLevel | null;
  // true when that view differs from the computed risk.
  riskDisagreement: boolean;
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
    // Other names the sources use for the person, at most three: a name the search did not query.
    aliases: string[];
    // The URLs of those results, to tell whether an article was missed by the search or set aside
    // by the model. Kept in the result only, never in the run log: URLs often carry the name.
    urlsReviewed: string[];
    rejectedUrls: string[];
    errors: CoverageError[];
    // The model of a second, complete screening that replaced the first after a signal (D-49).
    escalatedTo: string | null;
    // The signals the first screening showed: those that escalated it, or that would have. They are
    // kept with escalation off too, to measure how many screenings it would send on (D-49).
    escalationSignals: EscalationSignal[];
  };
  // apiCalls counts every turn: a second one under an alias (D-42), those of an escalated screening
  // (D-49).
  usage: TokenUsage & { estimatedCostUsd: number; apiCalls: number };
  model: string;
  promptVersion: string;
  screenedAt: string;
  durationMs: number;
};
