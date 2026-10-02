import { describe, expect, it } from "vitest";

import type { ScreeningResult } from "../../agent/types";
import {
  countNewFindings,
  findingsToStore,
  isDuplicateDailyScreening,
  resultFromRows,
  screeningRows,
  urlHash,
  type FindingRow,
  type ScreeningRow,
} from "../mapping";

const DOJ = "https://www.justice.gov/madoff-plea";
const NAMESAKE = "https://archives.fbi.gov/david-smith";

const RESULT: ScreeningResult = {
  status: "complete",
  risk: "high",
  confidence: "high",
  summary: "Convicted for a Ponzi scheme.",
  findings: [
    {
      url: DOJ,
      corroboratingUrls: ["https://www.npr.org/madoff"],
      title: "Madoff pleads guilty",
      date: "2009-03",
      language: "en",
      subject: "person",
      category: "fraud",
      severity: "critical",
      status: "conviction",
      identityConfidence: "high",
      identityEvidence: ["Full name and country match"],
      sourceReliability: "official",
      summary: "Pleaded guilty to eleven federal felonies.",
      countedInScore: true,
      riskLevel: "high",
    },
    {
      url: NAMESAKE,
      corroboratingUrls: [],
      title: "Namesake sentenced",
      date: null,
      language: "en",
      subject: "person",
      category: "money_laundering",
      severity: "critical",
      status: "conviction",
      identityConfidence: "low",
      identityEvidence: ["Different country"],
      sourceReliability: "official",
      summary: "A namesake was sentenced.",
      countedInScore: false,
      riskLevel: null,
    },
  ],
  coverage: {
    languages: ["en"],
    countrySupported: true,
    plannedQueries: ['"Bernard Madoff" fraud'],
    executedQueries: ['"Bernard Madoff" fraud'],
    searchesUsed: 1,
    articlesReviewed: 9,
    urlsReviewed: [DOJ, NAMESAKE],
    rejectedUrls: [],
    errors: [],
  },
  usage: {
    inputTokens: 255,
    outputTokens: 652,
    cacheReadTokens: 5_416,
    cacheWrite5mTokens: 12_994,
    cacheWrite1hTokens: 0,
    webSearches: 1,
    estimatedCostUsd: 0.0506,
  },
  model: "claude-sonnet-5-5",
  promptVersion: "v6",
  screenedAt: "2026-10-01T14:11:03.000Z",
  durationMs: 7_400,
};

const IDS = { screeningId: "6f1c2a52-6d0b-4c56-9a51-0f2f8f7e1c11", personId: "person-1" };

// What Postgres gives back: the inserted values plus the defaults it fills in.
function stored(result: ScreeningResult, firstSeen = new Map<string, Date>()) {
  const rows = screeningRows(result, IDS, "one_shot", firstSeen);
  const screening: ScreeningRow = {
    ...rows.screening,
    id: IDS.screeningId,
    summary: rows.screening.summary ?? null,
    kind: rows.screening.kind ?? "one_shot",
  };
  const findings: FindingRow[] = rows.findings.map((finding, index) => ({
    ...finding,
    id: `finding-${index}`,
    date: finding.date ?? null,
    riskLevel: finding.riskLevel ?? null,
  }));
  return { screening, findings };
}

describe("screeningRows and resultFromRows", () => {
  it("give back the stored result unchanged", () => {
    const { screening, findings } = stored(RESULT);

    expect(resultFromRows(screening, findings)).toEqual(RESULT);
  });

  it("put counted findings first, the most serious first, whatever the order read", () => {
    const { screening, findings } = stored(RESULT);

    expect(resultFromRows(screening, findings.toReversed()).findings.map((f) => f.url)).toEqual([
      DOJ,
      NAMESAKE,
    ]);
  });

  it("keep the first sighting of a URL already stored for the person", () => {
    const earlier = new Date("2026-09-01T08:00:00Z");
    const rows = screeningRows(RESULT, IDS, "daily", new Map([[urlHash(DOJ), earlier]]));

    expect(rows.screening.kind).toBe("daily");
    expect(rows.findings.map((finding) => finding.firstSeenAt)).toEqual([
      earlier,
      new Date(RESULT.screenedAt),
    ]);
  });

  it("hash the URL with SHA-256", () => {
    expect(urlHash(DOJ)).toMatch(/^[0-9a-f]{64}$/);
    expect(urlHash(DOJ)).not.toBe(urlHash(`${DOJ}/`));
  });
});

describe("findingsToStore", () => {
  const rows = screeningRows(RESULT, IDS, "daily", new Map()).findings;
  const known = new Set([urlHash(DOJ)]);

  it("keeps only the findings whose URL is new for the person in a daily screening", () => {
    expect(findingsToStore(rows, "daily", known).map((row) => row.url)).toEqual([NAMESAKE]);
    expect(countNewFindings(rows, known)).toBe(1);
  });

  it("keeps every finding of a one-shot screening, as the analyst saw them", () => {
    expect(findingsToStore(rows, "one_shot", known).map((row) => row.url)).toEqual([DOJ, NAMESAKE]);
  });

  it("stores nothing when every URL is already known", () => {
    const all = new Set([urlHash(DOJ), urlHash(NAMESAKE)]);

    expect(findingsToStore(rows, "daily", all)).toEqual([]);
    expect(countNewFindings(rows, all)).toBe(0);
  });
});

describe("isDuplicateDailyScreening", () => {
  it("recognizes a unique violation, also when wrapped as the cause of a query error", () => {
    const violation = Object.assign(new Error("duplicate key"), { code: "23505" });

    expect(isDuplicateDailyScreening(violation)).toBe(true);
    expect(isDuplicateDailyScreening(new Error("Failed query", { cause: violation }))).toBe(true);
    expect(isDuplicateDailyScreening(Object.assign(new Error("timeout"), { code: "57014" }))).toBe(
      false,
    );
    expect(isDuplicateDailyScreening("23505")).toBe(false);
  });
});
