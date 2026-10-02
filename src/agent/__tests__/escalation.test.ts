import { describe, expect, it } from "vitest";

import { parseEscalationModel } from "../config";
import { escalationSignals, mergeEscalation } from "../escalation";
import type { CoverageErrorCode, Finding, ScreeningResult } from "../types";

const ROSSI = { firstName: "Antonio", lastName: "Rossi", country: "IT" };
const QUERY = '"Antonio Rossi" frode';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    url: "https://www.ansa.it/rossi-condannato",
    corroboratingUrls: [],
    title: "Rossi condannato",
    date: "2025-03-01",
    language: "it",
    subject: "person",
    category: "fraud",
    severity: "critical",
    status: "conviction",
    identityConfidence: "high",
    identityEvidence: ["Same full name, Italy"],
    sourceReliability: "national_press",
    summary: "Convicted of fraud.",
    countedInScore: true,
    riskLevel: "high",
    ...overrides,
  };
}

function result(
  overrides: Partial<ScreeningResult> = {},
  coverage: Partial<ScreeningResult["coverage"]> = {},
): ScreeningResult {
  return {
    status: "complete",
    risk: "low",
    confidence: "high",
    modelSuggestedRisk: null,
    riskDisagreement: false,
    summary: "Nothing adverse was found.",
    findings: [],
    coverage: {
      languages: ["it", "en"],
      countrySupported: true,
      plannedQueries: [QUERY],
      executedQueries: [QUERY],
      searchesUsed: 2,
      articlesReviewed: 18,
      aliases: [],
      urlsReviewed: [],
      rejectedUrls: [],
      errors: [],
      escalatedTo: null,
      escalationSignals: [],
      ...coverage,
    },
    usage: {
      inputTokens: 500,
      outputTokens: 1_000,
      cacheReadTokens: 12_000,
      cacheWrite5mTokens: 12_000,
      cacheWrite1hTokens: 0,
      webSearches: 2,
      estimatedCostUsd: 0.1,
      apiCalls: 1,
    },
    model: "claude-sonnet-5-5",
    promptVersion: "v13",
    screenedAt: "2026-10-02T09:00:00.000Z",
    durationMs: 9_000,
    ...overrides,
  };
}

function error(code: CoverageErrorCode) {
  return { code, detail: "fixture" };
}

describe("escalationSignals", () => {
  it("finds none in a complete result with only a namesake and no alias or warning", () => {
    const namesake = finding({ identityConfidence: "low", countedInScore: false, riskLevel: null });

    expect(escalationSignals(result({ findings: [namesake] }), ROSSI)).toEqual([]);
  });

  it("names every signal present", () => {
    const signaled = result(
      { status: "incomplete", findings: [finding()] },
      { aliases: ["Toni Rossi"], errors: [error("unsourced_summary")] },
    );

    expect(escalationSignals(signaled, ROSSI)).toEqual([
      "counted_finding",
      "alias",
      "unsourced_summary",
      "incomplete",
    ]);
  });

  it("ignores an alias the queries used already, or one holding the names entered", () => {
    const searched = result(
      {},
      { aliases: ["Toni Rossi"], executedQueries: ['"Toni Rossi" frode'] },
    );
    const legalForm = result({}, { aliases: ["Antonio Maria Rossi"] });

    expect(escalationSignals(searched, ROSSI)).toEqual([]);
    expect(escalationSignals(legalForm, ROSSI)).toEqual([]);
  });

  it("escalates an incomplete result whose errors are not fatal", () => {
    const invalid = result({ status: "incomplete" }, { errors: [error("invalid_output")] });

    expect(escalationSignals(invalid, ROSSI)).toEqual(["incomplete"]);
  });

  it("escalates nothing after a compromised answer, a refusal or a timeout, whatever it holds", () => {
    for (const code of ["compromised", "refusal", "timeout"] as const) {
      const fatal = result(
        { status: "incomplete", findings: [finding()] },
        { errors: [error(code)] },
      );

      expect(escalationSignals(fatal, ROSSI)).toEqual([]);
    }
  });
});

describe("parseEscalationModel", () => {
  it("escalates nowhere unless set, to the model set, and refuses a model without prices", () => {
    expect(parseEscalationModel(undefined, "claude-sonnet-5-5")).toBeNull();
    expect(parseEscalationModel("", "claude-sonnet-5-5")).toBeNull();
    expect(parseEscalationModel("claude-opus-5-5", "claude-sonnet-5-5")).toBe("claude-opus-5-5");
    expect(() => parseEscalationModel("claude-haiku-4-5", "claude-sonnet-5-5")).toThrow(
      /ESCALATION_MODEL/,
    );
  });

  it("does not escalate to the model of the first screening", () => {
    expect(parseEscalationModel("claude-opus-5-5", "claude-opus-5-5")).toBeNull();
  });
});

describe("mergeEscalation", () => {
  const first = result(
    { findings: [finding()] },
    { escalationSignals: ["counted_finding", "unsourced_summary"] },
  );
  const escalated = result(
    {
      risk: "high",
      findings: [finding()],
      model: "claude-opus-5-5",
      durationMs: 41_000,
      usage: {
        inputTokens: 600,
        outputTokens: 2_000,
        cacheReadTokens: 20_000,
        cacheWrite5mTokens: 12_000,
        cacheWrite1hTokens: 0,
        webSearches: 3,
        estimatedCostUsd: 0.2,
        apiCalls: 2,
      },
    },
    { aliases: ["Toni Rossi"] },
  );

  it("keeps the escalated screening, its model, and the signals that escalated it", () => {
    const merged = mergeEscalation(first, escalated, "claude-opus-5-5");

    expect(merged.risk).toBe("high");
    expect(merged.findings).toEqual(escalated.findings);
    expect(merged.coverage).toEqual({
      ...escalated.coverage,
      escalatedTo: "claude-opus-5-5",
      escalationSignals: ["counted_finding", "unsourced_summary"],
    });
    expect(merged.model).toBe("claude-opus-5-5");
    expect(merged.durationMs).toBe(41_000);
  });

  it("adds the tokens, searches, calls and cost of both screenings", () => {
    expect(mergeEscalation(first, escalated, "claude-opus-5-5").usage).toEqual({
      inputTokens: 1_100,
      outputTokens: 3_000,
      cacheReadTokens: 32_000,
      cacheWrite5mTokens: 24_000,
      cacheWrite1hTokens: 0,
      webSearches: 5,
      estimatedCostUsd: 0.3,
      apiCalls: 3,
    });
  });
});
