import { createHash } from "node:crypto";

import type { Finding, RiskLevel, ScreeningResult } from "../agent/types";
import type { findings, screenings } from "./schema";

export type ScreeningKind = "one_shot" | "daily";
export type ScreeningInsert = typeof screenings.$inferInsert;
export type FindingInsert = typeof findings.$inferInsert;
export type ScreeningRow = typeof screenings.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;

// Postgres error code of a unique constraint violation.
const UNIQUE_VIOLATION = "23505";
const LEVEL_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };
const UNCOUNTED_ORDER = 3;

export function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

// firstSeen maps the URL hashes already stored for this person to their first sighting; the
// other findings are first seen by this screening.
export function screeningRows(
  result: ScreeningResult,
  ids: { screeningId: string; personId: string },
  kind: ScreeningKind,
  firstSeen: ReadonlyMap<string, Date>,
): { screening: ScreeningInsert; findings: FindingInsert[] } {
  const screenedAt = new Date(result.screenedAt);
  return {
    screening: {
      id: ids.screeningId,
      personId: ids.personId,
      risk: result.risk,
      confidence: result.confidence,
      status: result.status,
      summary: result.summary,
      model: result.model,
      promptVersion: result.promptVersion,
      coverageJson: {
        ...result.coverage,
        modelSuggestedRisk: result.modelSuggestedRisk,
        riskDisagreement: result.riskDisagreement,
      },
      usageJson: result.usage,
      costUsd: result.usage.estimatedCostUsd,
      durationMs: result.durationMs,
      kind,
      createdAt: screenedAt,
    },
    findings: result.findings.map((finding) => {
      const hash = urlHash(finding.url);
      return {
        screeningId: ids.screeningId,
        urlHash: hash,
        url: finding.url,
        title: finding.title,
        language: finding.language,
        date: finding.date,
        category: finding.category,
        severity: finding.severity,
        status: finding.status,
        subject: finding.subject,
        identityConfidence: finding.identityConfidence,
        identityEvidence: finding.identityEvidence,
        sourceReliability: finding.sourceReliability,
        riskLevel: finding.riskLevel,
        summary: finding.summary,
        corroboratingUrls: finding.corroboratingUrls,
        firstSeenAt: firstSeen.get(hash) ?? screenedAt,
      };
    }),
  };
}

// The inverse of screeningRows, for the history page. A finding is counted exactly when it has a
// level (score.ts), and the order is the agent's: counted findings first, the most serious first.
export function resultFromRows(
  screening: ScreeningRow,
  findingRows: readonly FindingRow[],
): ScreeningResult {
  const resultFindings: Finding[] = findingRows.map((row) => ({
    url: row.url,
    corroboratingUrls: row.corroboratingUrls,
    title: row.title,
    date: row.date,
    language: row.language,
    subject: row.subject,
    category: row.category,
    severity: row.severity,
    status: row.status,
    identityConfidence: row.identityConfidence,
    identityEvidence: row.identityEvidence,
    sourceReliability: row.sourceReliability,
    summary: row.summary,
    countedInScore: row.riskLevel !== null,
    riskLevel: row.riskLevel,
  }));
  // Screenings stored before D-51 carry no opinion of the model.
  const {
    modelSuggestedRisk = null,
    riskDisagreement = false,
    ...coverage
  } = screening.coverageJson;
  return {
    status: screening.status,
    risk: screening.risk,
    confidence: screening.confidence,
    modelSuggestedRisk,
    riskDisagreement,
    summary: screening.summary,
    findings: resultFindings.toSorted((a, b) => rank(a) - rank(b)),
    // Screenings stored before D-44 have no aliases, before D-49 no escalation.
    coverage: {
      ...coverage,
      aliases: coverage.aliases ?? [],
      escalatedTo: coverage.escalatedTo ?? null,
      escalationSignals: coverage.escalationSignals ?? [],
    },
    // Screenings stored before D-42 made a single call.
    usage: { ...screening.usageJson, apiCalls: screening.usageJson.apiCalls ?? 1 },
    model: screening.model,
    promptVersion: screening.promptVersion,
    screenedAt: screening.createdAt.toISOString(),
    durationMs: screening.durationMs,
  };
}

function rank(finding: Finding): number {
  return finding.riskLevel === null ? UNCOUNTED_ORDER : LEVEL_ORDER[finding.riskLevel];
}

// A daily screening stores only the findings whose URL is new for the person: the earlier ones are
// already in the history. A one-shot screening stores them all, as the analyst saw them.
export function findingsToStore(
  rows: readonly FindingInsert[],
  kind: ScreeningKind,
  knownHashes: ReadonlySet<string>,
): FindingInsert[] {
  return kind === "daily" ? rows.filter((row) => !knownHashes.has(row.urlHash)) : [...rows];
}

export function countNewFindings(
  rows: readonly FindingInsert[],
  knownHashes: ReadonlySet<string>,
): number {
  return rows.filter((row) => !knownHashes.has(row.urlHash)).length;
}

// A second daily screening of the same person on the same UTC day, refused by the unique index.
export function isDuplicateDailyScreening(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ("code" in current && current.code === UNIQUE_VIOLATION) return true;
  }
  return false;
}
