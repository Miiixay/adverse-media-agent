import { describe, expect, it } from "vitest";

import { findingLevel, isCorroborated, isCoverageComplete, score } from "../score";
import type { AssessedFinding } from "../types";

const SCREENED_AT = new Date("2026-10-01T00:00:00Z");
const LE_MONDE = "https://www.lemonde.fr/justice/article";
const LE_FIGARO = "https://www.lefigaro.fr/actualite/article";

// Neutral by default: a critical category at high identity, dated neither recent nor old, from a
// local source without corroboration, so that no modulator holds.
function finding(overrides: Partial<AssessedFinding> = {}): AssessedFinding {
  return {
    url: LE_MONDE,
    corroboratingUrls: [],
    title: "Article",
    date: "2020-06-01",
    language: "fr",
    subject: "person",
    category: "fraud",
    severity: "critical",
    status: "investigation",
    identityConfidence: "high",
    identityEvidence: ["same full name and country"],
    sourceReliability: "local_press",
    summary: "Under investigation for fraud.",
    ...overrides,
  };
}

describe("score", () => {
  it("returns low with high confidence when nothing is found and the coverage is complete", () => {
    expect(score([], true, SCREENED_AT)).toEqual({ risk: "low", confidence: "high", findings: [] });
  });

  it("returns low with low confidence when nothing is found and the coverage is incomplete", () => {
    expect(score([], false, SCREENED_AT)).toMatchObject({ risk: "low", confidence: "low" });
  });

  it("shows findings about homonyms without counting them", () => {
    const result = score(
      [finding({ identityConfidence: "low", category: "civil_litigation" })],
      true,
      SCREENED_AT,
    );

    expect(result).toMatchObject({ risk: "low", confidence: "high" });
    expect(result.findings.map((item) => item.countedInScore)).toEqual([false]);
  });

  it("lowers the confidence to medium when a homonym hit falls in a critical category", () => {
    const result = score(
      [finding({ identityConfidence: "low", status: "conviction" })],
      true,
      SCREENED_AT,
    );

    expect(result).toMatchObject({ risk: "low", confidence: "medium" });
  });

  it("rates a critical category at high identity high", () => {
    expect(score([finding()], true, SCREENED_AT)).toMatchObject({
      risk: "high",
      confidence: "high",
    });
  });

  it("rates a critical category at medium identity medium, and lowers the confidence", () => {
    expect(score([finding({ identityConfidence: "medium" })], true, SCREENED_AT)).toMatchObject({
      risk: "medium",
      confidence: "medium",
    });
  });

  it("keeps an old conviction high, whatever its category", () => {
    const oldConviction = finding({
      category: "other",
      severity: "moderate",
      status: "conviction",
      date: "2009-03-12",
    });

    expect(score([oldConviction], true, SCREENED_AT).risk).toBe("high");
  });

  it("rates a minor conviction at high identity medium", () => {
    const minorConviction = finding({ category: "other", severity: "minor", status: "conviction" });

    expect(findingLevel(minorConviction, SCREENED_AT)).toBe("medium");
  });

  it("rates a conviction at medium identity medium, in any category", () => {
    const conviction = finding({
      category: "other",
      status: "conviction",
      identityConfidence: "medium",
    });

    expect(findingLevel(conviction, SCREENED_AT)).toBe("medium");
  });

  it("keeps a critical category high at high identity, even for a minor conviction", () => {
    expect(findingLevel(finding({ severity: "minor", status: "conviction" }), SCREENED_AT)).toBe(
      "high",
    );
  });

  it("rates a moderate category at high identity medium", () => {
    expect(score([finding({ category: "regulatory" })], true, SCREENED_AT).risk).toBe("medium");
  });

  it("does not count an acquittal against the person, even in a critical category", () => {
    expect(score([finding({ status: "acquitted" })], true, SCREENED_AT).risk).toBe("low");
  });

  it("ignores an old minor matter but not a recent one", () => {
    const minor = { category: "regulatory", severity: "minor" } as const;

    expect(findingLevel(finding({ ...minor, date: "2014-05-01" }), SCREENED_AT)).toBe("low");
    expect(findingLevel(finding({ ...minor, date: "2022-05-01" }), SCREENED_AT)).toBe("medium");
  });

  it("lists the counted findings first, the most serious first", () => {
    const homonym = finding({ url: "https://homonym.fr/a", identityConfidence: "low" });
    const regulatory = finding({ url: "https://amf-france.org/a", category: "regulatory" });
    const fraud = finding({ url: "https://justice.fr/a" });

    const result = score([homonym, regulatory, fraud], true, SCREENED_AT);

    expect(result.findings.map((item) => item.url)).toEqual([
      fraud.url,
      regulatory.url,
      homonym.url,
    ]);
  });
});

describe("subject", () => {
  it("never counts a finding about an associate, even a conviction at high identity", () => {
    const result = score(
      [finding({ subject: "associate", category: "organized_crime", status: "conviction" })],
      true,
      SCREENED_AT,
    );

    expect(result.risk).toBe("low");
    expect(result.findings.map((item) => item.countedInScore)).toEqual([false]);
  });

  it("does not let an associate lower the confidence of the person's own findings", () => {
    const associate = finding({ url: "https://corsematin.com/a", subject: "associate" });

    expect(
      score([finding(), { ...associate, identityConfidence: "medium" }], true, SCREENED_AT),
    ).toMatchObject({ risk: "high", confidence: "high" });
  });

  it("keeps the confidence high when the only critical finding is about an associate", () => {
    expect(score([finding({ subject: "associate" })], true, SCREENED_AT).confidence).toBe("high");
  });

  it("counts a finding about an organization linked to the person", () => {
    expect(score([finding({ subject: "organization" })], true, SCREENED_AT).risk).toBe("high");
  });
});

describe("modulators", () => {
  it("raise a finding one level when two of them hold", () => {
    const recentOfficial = finding({
      category: "regulatory",
      date: "2026-03-01",
      sourceReliability: "official",
    });

    expect(findingLevel(recentOfficial, SCREENED_AT)).toBe("high");
  });

  it("leave a finding where it is when only one holds", () => {
    const official = finding({ category: "regulatory", sourceReliability: "official" });

    expect(findingLevel(official, SCREENED_AT)).toBe("medium");
  });

  it("count corroboration by another publication as one of them", () => {
    const corroborated = finding({
      category: "regulatory",
      sourceReliability: "national_press",
      corroboratingUrls: [LE_FIGARO],
    });

    expect(findingLevel(corroborated, SCREENED_AT)).toBe("high");
  });

  it("never take a finding at medium identity to high", () => {
    const allModulators = finding({
      identityConfidence: "medium",
      date: "2026-03-01",
      sourceReliability: "official",
      corroboratingUrls: [LE_FIGARO],
    });

    expect(findingLevel(allModulators, SCREENED_AT)).toBe("medium");
  });

  it("read a partial date at the end of its period", () => {
    const official = { category: "regulatory", sourceReliability: "official" } as const;

    expect(findingLevel(finding({ ...official, date: "2024" }), SCREENED_AT)).toBe("high");
    expect(findingLevel(finding({ ...official, date: "2024-09" }), SCREENED_AT)).toBe("medium");
  });
});

describe("isCorroborated", () => {
  it("is true when another publication reports the same facts", () => {
    expect(isCorroborated({ url: LE_MONDE, corroboratingUrls: [LE_FIGARO] })).toBe(true);
  });

  it("counts the sites of one organization as a single source", () => {
    expect(
      isCorroborated({
        url: "https://edition.cnn.com/2009/madoff",
        corroboratingUrls: ["https://www.cnn.com/us/madoff"],
      }),
    ).toBe(false);
    expect(
      isCorroborated({
        url: "https://www.bbc.co.uk/news/madoff",
        corroboratingUrls: ["https://news.bbc.co.uk/madoff"],
      }),
    ).toBe(false);
  });

  it("is false without corroborating URLs", () => {
    expect(isCorroborated({ url: LE_MONDE, corroboratingUrls: [] })).toBe(false);
  });
});

describe("isCoverageComplete", () => {
  const planned = ['"Jean Martin" fraude', '"Jean Martin" fraud'];

  it("is true when every planned query ran without error", () => {
    expect(isCoverageComplete(planned, [...planned, '"Jean Martin" Lyon'], [])).toBe(true);
  });

  it("is false when a planned query did not run", () => {
    expect(isCoverageComplete(planned, [planned[0] ?? ""], [])).toBe(false);
  });

  it("is false when a search failed", () => {
    const failed = { code: "unavailable", detail: "search failed" } as const;

    expect(isCoverageComplete(planned, planned, [failed])).toBe(false);
  });

  it("is still true when the model only went over the search budget", () => {
    const overBudget = { code: "max_uses_exceeded", detail: "search failed" } as const;

    expect(isCoverageComplete(planned, planned, [overBudget])).toBe(true);
  });
});
