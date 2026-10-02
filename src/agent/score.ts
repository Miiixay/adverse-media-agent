import type {
  AssessedFinding,
  Category,
  Confidence,
  CoverageError,
  CoverageErrorCode,
  Finding,
  RiskLevel,
  SourceReliability,
} from "./types";

export const RECENT_YEARS = 2;
export const OLD_YEARS = 10;
// A finding moves up one level only when at least this many modulators hold.
export const MODULATORS_TO_RAISE = 2;

const CRITICAL_CATEGORIES: ReadonlySet<Category> = new Set([
  "money_laundering",
  "terrorism",
  "sanctions",
  "corruption",
  "fraud",
  "organized_crime",
]);
const MODERATE_CATEGORIES: ReadonlySet<Category> = new Set([
  "civil_litigation",
  "regulatory",
  "controversy",
  "violence",
]);
const RELIABLE_SOURCES: ReadonlySet<SourceReliability> = new Set(["official", "national_press"]);
// Going over the search budget means the model wanted more searches, not that a planned one failed.
const NON_BLOCKING_ERRORS: ReadonlySet<CoverageErrorCode> = new Set(["max_uses_exceeded"]);
// Second levels under which a two-letter country domain names an organization: "bbc.co.uk".
const GENERIC_SECOND_LEVELS: ReadonlySet<string> = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "net",
  "org",
]);
const PARTIAL_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export type Score = {
  risk: RiskLevel;
  confidence: Confidence;
  // Findings counted in the score first, the most serious first.
  findings: Finding[];
};

export function score(
  findings: readonly AssessedFinding[],
  coverageComplete: boolean,
  screenedAt: Date,
): Score {
  const scored = findings.map((finding) => ({
    finding: { ...finding, countedInScore: isCounted(finding) },
    level: findingLevel(finding, screenedAt),
  }));
  const counted = scored.filter(({ finding }) => finding.countedInScore);

  return {
    risk: counted.map(({ level }) => level).reduce((a, b) => higher(a, b), "low"),
    confidence: overallConfidence(findings, coverageComplete),
    findings: scored
      .toSorted(
        (a, b) =>
          Number(b.finding.countedInScore) - Number(a.finding.countedInScore) ||
          RANK[b.level] - RANK[a.level],
      )
      .map(({ finding }) => finding),
  };
}

export function findingLevel(finding: AssessedFinding, screenedAt: Date): RiskLevel {
  // Acquittals and old minor matters never weigh on the risk, whatever the modulators say.
  if (finding.status === "acquitted") return "low";
  if (finding.severity === "minor" && isOlderThan(finding.date, OLD_YEARS, screenedAt)) {
    return "low";
  }

  const base = baseLevel(finding);
  const raised = modulatorCount(finding, screenedAt) >= MODULATORS_TO_RAISE ? next(base) : base;
  // Modulators make the facts more credible, not the identity: only a high identity reaches high.
  return finding.identityConfidence === "high" ? raised : lower(raised, "medium");
}

export function isCorroborated(
  finding: Pick<AssessedFinding, "url" | "corroboratingUrls">,
): boolean {
  const sources = new Set([finding.url, ...finding.corroboratingUrls].map(sourceDomain));
  return sources.size >= 2;
}

// Complete when every planned query ran and nothing failed: only then does an empty result mean
// that nothing was found.
export function isCoverageComplete(
  plannedQueries: readonly string[],
  executedQueries: readonly string[],
  errors: readonly CoverageError[],
): boolean {
  const executed = new Set(executedQueries);
  return (
    plannedQueries.every((query) => executed.has(query)) &&
    errors.every((error) => NON_BLOCKING_ERRORS.has(error.code))
  );
}

// A finding at low identity confidence is probably about a homonym: shown, never counted.
function isCounted(finding: AssessedFinding): boolean {
  return finding.identityConfidence !== "low";
}

// The least certain identity among the counted findings. Without any, an empty result is only
// trustworthy when the coverage is complete, and a homonym hit in a critical category cannot be
// ruled out with a name and a country alone.
function overallConfidence(
  findings: readonly AssessedFinding[],
  coverageComplete: boolean,
): Confidence {
  const countedIdentities = findings.filter(isCounted).map((finding) => finding.identityConfidence);
  if (countedIdentities.length > 0) return countedIdentities.reduce((a, b) => lower(a, b));
  if (!coverageComplete) return "low";
  return findings.some((finding) => CRITICAL_CATEGORIES.has(finding.category)) ? "medium" : "high";
}

function baseLevel(finding: AssessedFinding): RiskLevel {
  const critical = CRITICAL_CATEGORIES.has(finding.category);
  const conviction = finding.status === "conviction";
  const identityHigh = finding.identityConfidence === "high";
  if (identityHigh && critical) return "high";
  if (identityHigh && conviction && finding.severity !== "minor") return "high";
  if (critical || conviction) return "medium";
  if (identityHigh && MODERATE_CATEGORIES.has(finding.category)) return "medium";
  return "low";
}

function modulatorCount(finding: AssessedFinding, screenedAt: Date): number {
  return [
    isWithinYears(finding.date, RECENT_YEARS, screenedAt),
    RELIABLE_SOURCES.has(finding.sourceReliability),
    isCorroborated(finding),
  ].filter(Boolean).length;
}

// One organization counts once: "edition.cnn.com" and "www.cnn.com" are the same source.
function sourceDomain(url: string): string {
  const labels = new URL(url).hostname.toLowerCase().split(".");
  const topLevel = labels.at(-1) ?? "";
  const secondLevel = labels.at(-2) ?? "";
  const kept = topLevel.length === 2 && GENERIC_SECOND_LEVELS.has(secondLevel) ? 3 : 2;
  return labels.slice(-kept).join(".");
}

function isWithinYears(date: string | null, years: number, screenedAt: Date): boolean {
  const day = latestDayOf(date);
  return day !== null && day >= yearsBefore(screenedAt, years);
}

function isOlderThan(date: string | null, years: number, screenedAt: Date): boolean {
  const day = latestDayOf(date);
  return day !== null && day < yearsBefore(screenedAt, years);
}

// A partial date is read at the end of its period ("2024" as 2024-12-31), so that an imprecise
// date never makes a matter look older, and the risk lower, than it may be.
function latestDayOf(date: string | null): Date | null {
  const match = date === null ? null : PARTIAL_DATE.exec(date);
  if (!match) return null;
  const [, year, month, day] = match;
  if (year === undefined) return null;
  if (month === undefined) return new Date(Date.UTC(Number(year), 11, 31));
  if (day === undefined) return new Date(Date.UTC(Number(year), Number(month), 0));
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function yearsBefore(date: Date, years: number): Date {
  const shifted = new Date(date);
  shifted.setUTCFullYear(shifted.getUTCFullYear() - years);
  return shifted;
}

function next(level: RiskLevel): RiskLevel {
  return level === "low" ? "medium" : "high";
}

function higher<Level extends RiskLevel>(a: Level, b: Level): Level {
  return RANK[a] >= RANK[b] ? a : b;
}

function lower<Level extends RiskLevel>(a: Level, b: Level): Level {
  return RANK[a] <= RANK[b] ? a : b;
}
