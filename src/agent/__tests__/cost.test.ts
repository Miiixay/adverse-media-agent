import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendRunLog,
  estimateCostUsd,
  pseudonym,
  requirePseudonymKey,
  runLogEntry,
} from "../cost";
import type { ScreeningResult, TokenUsage } from "../types";

const KEY = "0123456789abcdef0123456789abcdef";
const MADOFF = { firstName: "Bernard", lastName: "Madoff", country: "US" };

// The usage of the first real run of search.ts, on 2026-10-01, shown rounded as $0.0973.
const MADOFF_RUN_USAGE: TokenUsage = {
  inputTokens: 26_048,
  outputTokens: 2_522,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  webSearches: 2,
};

function result(): ScreeningResult {
  return {
    status: "complete",
    risk: "high",
    confidence: "high",
    modelSuggestedRisk: "high",
    riskDisagreement: false,
    summary: "Bernard Madoff pleaded guilty to a Ponzi scheme in 2009.",
    findings: [
      {
        url: "https://www.justice.gov/usao-sdny/bernard-l-madoff",
        corroboratingUrls: ["https://www.cnn.com/us/bernard-madoff-fast-facts"],
        title: "United States v. Bernard L. Madoff",
        date: "2009-06-29",
        language: "en",
        subject: "person",
        category: "fraud",
        severity: "critical",
        status: "conviction",
        identityConfidence: "high",
        identityEvidence: ["Bernard Madoff, former NASDAQ chairman"],
        sourceReliability: "official",
        summary: "Madoff was sentenced to 150 years.",
        countedInScore: true,
        riskLevel: "high",
      },
    ],
    coverage: {
      languages: ["en"],
      countrySupported: true,
      plannedQueries: ['"Bernard Madoff" fraud'],
      executedQueries: ['"Bernard Madoff" fraud'],
      searchesUsed: 2,
      articlesReviewed: 17,
      aliases: [],
      urlsReviewed: ["https://www.justice.gov/usao-sdny/pr/bernard-madoff-sentenced"],
      rejectedUrls: [],
      errors: [],
      escalatedTo: null,
      escalationSignals: ["counted_finding"],
    },
    usage: { ...MADOFF_RUN_USAGE, estimatedCostUsd: 0.097316, apiCalls: 1 },
    model: "claude-sonnet-5-5",
    promptVersion: "v1-draft-2",
    screenedAt: "2026-10-01T10:00:00.000Z",
    durationMs: 20_000,
  };
}

describe("estimateCostUsd", () => {
  it("matches the cost of a measured run", () => {
    expect(estimateCostUsd(MADOFF_RUN_USAGE, "claude-sonnet-5-5")).toBe(0.097316);
  });

  it("prices cache writes by TTL and cache reads at their own rate", () => {
    const cached: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWrite5mTokens: 1_000_000,
      cacheWrite1hTokens: 1_000_000,
      webSearches: 0,
    };

    expect(estimateCostUsd(cached, "claude-sonnet-5-5")).toBe(0.2 + 2.5 + 4);
    expect(estimateCostUsd(cached, "claude-opus-5-5")).toBe(0.2 + 5 + 8);
  });
});

describe("pseudonym", () => {
  it("is the same for one person whatever the casing and spacing", () => {
    const messy = { firstName: " bernard ", lastName: "MADOFF", country: "US" };

    expect(pseudonym(messy, KEY)).toBe(pseudonym(MADOFF, KEY));
  });

  it("differs from one key to another", () => {
    expect(pseudonym(MADOFF, KEY)).not.toBe(pseudonym(MADOFF, `${KEY}0`));
  });
});

describe("requirePseudonymKey", () => {
  it("refuses a missing or short key", () => {
    expect(() => requirePseudonymKey(undefined)).toThrow(/LOG_PSEUDONYM_KEY/);
    expect(() => requirePseudonymKey("too-short")).toThrow(/LOG_PSEUDONYM_KEY/);
  });

  it("returns a long enough key", () => {
    expect(requirePseudonymKey(KEY)).toBe(KEY);
  });
});

describe("runLogEntry", () => {
  it("keeps the figures of the run and nothing that contains the name", () => {
    const entry = runLogEntry(MADOFF, result(), KEY);

    expect(entry).toMatchObject({
      subject: pseudonym(MADOFF, KEY),
      risk: "high",
      modelSuggestedRisk: "high",
      riskDisagreement: false,
      findings: 1,
      countedFindings: 1,
      errors: [],
      escalatedTo: null,
      escalationSignals: ["counted_finding"],
    });
    expect(JSON.stringify(entry).toLowerCase()).not.toContain("madoff");
    expect(JSON.stringify(entry).toLowerCase()).not.toContain("bernard");
  });

  it("leaves out the URLs read, which carry the name in their path", () => {
    const entry = runLogEntry(MADOFF, result(), KEY);

    expect(entry).not.toHaveProperty("urlsReviewed");
    expect(JSON.stringify(entry)).not.toContain("https://");
  });
});

describe("appendRunLog", () => {
  it("appends one JSON line per run", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "runs-")), "logs", "runs.jsonl");
    const entry = runLogEntry(MADOFF, result(), KEY);

    await appendRunLog(entry, path);
    await appendRunLog(entry, path);

    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    expect(lines.map((line) => JSON.parse(line))).toEqual([entry, entry]);
  });
});
