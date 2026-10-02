import { describe, expect, it } from "vitest";

import {
  disagrees,
  findingLevel,
  higherRisk,
  isCorroborated,
  isCoverageComplete,
  score,
  untrustedScore,
} from "../score";
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

describe("statuses", () => {
  it("starts an allegation alone in a critical category at medium", () => {
    expect(findingLevel(finding({ status: "allegation" }), SCREENED_AT)).toBe("medium");
  });

  it("keeps that allegation at medium even when two modulators hold (D-43)", () => {
    const corroboratedAllegation = finding({
      status: "allegation",
      date: "2026-03-01",
      sourceReliability: "official",
    });

    expect(findingLevel(corroboratedAllegation, SCREENED_AT)).toBe("medium");
  });

  it("keeps every official step in a critical category high, and an unclear status too", () => {
    for (const status of [
      "investigation",
      "indictment",
      "conviction",
      "sanctioned",
      "unclear",
    ] as const) {
      expect(findingLevel(finding({ status }), SCREENED_AT), status).toBe("high");
    }
  });

  it("keeps a trial for false accounting high, as in the Santanchè case", () => {
    const trial = finding({ category: "fraud", status: "indictment", language: "it" });

    expect(score([trial], true, SCREENED_AT).risk).toBe("high");
  });

  it("treats a final regulatory sanction like a conviction", () => {
    const sanction = { category: "regulatory", status: "sanctioned" } as const;

    expect(findingLevel(finding({ ...sanction, severity: "moderate" }), SCREENED_AT)).toBe("high");
    expect(findingLevel(finding({ ...sanction, severity: "minor" }), SCREENED_AT)).toBe("medium");
    expect(findingLevel(finding({ ...sanction, identityConfidence: "medium" }), SCREENED_AT)).toBe(
      "medium",
    );
  });
});

describe("untrustedScore", () => {
  it("counts no finding of a compromised answer and reports low at low confidence", () => {
    const result = untrustedScore([finding(), finding({ url: LE_FIGARO, status: "conviction" })]);

    expect(result.risk).toBe("low");
    expect(result.confidence).toBe("low");
    expect(result.findings.map((item) => [item.url, item.countedInScore, item.riskLevel])).toEqual([
      [LE_MONDE, false, null],
      [LE_FIGARO, false, null],
    ]);
  });
});

describe("level per finding", () => {
  it("exposes the level of each counted finding and null for the others", () => {
    const result = score(
      [
        finding({ url: "https://homonym.fr/a", identityConfidence: "low" }),
        finding({ url: "https://amf-france.org/a", category: "regulatory" }),
        finding({ url: "https://corsematin.com/a", subject: "associate" }),
        finding({ url: "https://justice.fr/a" }),
      ],
      true,
      SCREENED_AT,
    );

    expect(result.findings.map((item) => [item.url, item.riskLevel])).toEqual([
      ["https://justice.fr/a", "high"],
      ["https://amf-france.org/a", "medium"],
      ["https://corsematin.com/a", null],
      ["https://homonym.fr/a", null],
    ]);
  });
});

describe("the model's own view of the risk", () => {
  it("disagrees only when the model gave a level and it differs from the computed one", () => {
    expect(disagrees("low", "medium")).toBe(true);
    expect(disagrees("high", "high")).toBe(false);
    expect(disagrees("low", null)).toBe(false);
  });

  it("keeps the higher of two views, or the only one", () => {
    expect(higherRisk("medium", "high")).toBe("high");
    expect(higherRisk("low", null)).toBe("low");
    expect(higherRisk(null, null)).toBeNull();
  });
});

describe("blog and social sources", () => {
  it("never counts a finding whose best source is a blog or a social network, even critical", () => {
    const result = score(
      [
        finding({ sourceReliability: "blog", status: "conviction" }),
        finding({ url: "https://social.example/post", sourceReliability: "social" }),
      ],
      true,
      SCREENED_AT,
    );

    expect(result.risk).toBe("low");
    expect(result.findings.map((item) => [item.countedInScore, item.riskLevel])).toEqual([
      [false, null],
      [false, null],
    ]);
  });

  it("does not let a blog lower the confidence of the person's own findings", () => {
    const blog = finding({
      url: "https://blog.example/post",
      sourceReliability: "blog",
      identityConfidence: "medium",
    });

    expect(score([finding(), blog], true, SCREENED_AT)).toMatchObject({
      risk: "high",
      confidence: "high",
    });
  });

  it("leaves the confidence at medium when only a blog reports a critical matter", () => {
    expect(score([finding({ sourceReliability: "blog" })], true, SCREENED_AT).confidence).toBe(
      "medium",
    );
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

  it("counts a finding about an organization linked to the person, capped at medium", () => {
    const result = score([finding({ subject: "organization" })], true, SCREENED_AT);

    expect(result.risk).toBe("medium");
    expect(result.findings.map((item) => item.countedInScore)).toEqual([true]);
  });

  it("keeps a sanctioned organization at medium even when every modulator holds, as for N26", () => {
    const fine = finding({
      subject: "organization",
      category: "regulatory",
      status: "sanctioned",
      severity: "moderate",
      date: "2025-08-19",
      sourceReliability: "national_press",
      corroboratingUrls: ["https://tech.eu/a", "https://sifted.eu/a"],
    });

    expect(findingLevel(fine, SCREENED_AT)).toBe("medium");
  });

  it("caps an organization matter without lowering it below medium", () => {
    const dispute = finding({
      subject: "organization",
      category: "civil_litigation",
      status: "allegation",
      severity: "minor",
      date: "2026-03-01",
    });

    expect(findingLevel(dispute, SCREENED_AT)).toBe("medium");
  });
});

describe("moderate categories (D-40)", () => {
  const credible: Partial<AssessedFinding> = {
    date: "2026-03-01",
    sourceReliability: "national_press",
    corroboratingUrls: [LE_FIGARO],
  };

  it("stay at medium whatever the modulators, short of a final decision", () => {
    for (const category of ["civil_litigation", "regulatory", "controversy", "violence"] as const) {
      expect(findingLevel(finding({ ...credible, category }), SCREENED_AT), category).toBe(
        "medium",
      );
    }
  });

  it("still reach high on a final decision", () => {
    expect(
      findingLevel(
        finding({ ...credible, category: "regulatory", status: "sanctioned" }),
        SCREENED_AT,
      ),
    ).toBe("high");
    expect(
      findingLevel(
        finding({ ...credible, category: "violence", status: "conviction" }),
        SCREENED_AT,
      ),
    ).toBe("high");
  });

  it("fall to low for an allegation or an unclear status older than two years", () => {
    for (const status of ["allegation", "unclear"] as const) {
      const old = finding({ ...credible, category: "civil_litigation", status, date: "2023-03" });

      expect(findingLevel(old, SCREENED_AT), status).toBe("low");
    }
  });

  it("keep their level when the claim is recent, undated or went further than an allegation", () => {
    const claim = { ...credible, category: "civil_litigation" } as const;

    expect(
      findingLevel(finding({ ...claim, status: "allegation", date: "2025-06" }), SCREENED_AT),
    ).toBe("medium");
    expect(findingLevel(finding({ ...claim, status: "allegation", date: null }), SCREENED_AT)).toBe(
      "medium",
    );
    expect(
      findingLevel(finding({ ...claim, status: "investigation", date: "2019" }), SCREENED_AT),
    ).toBe("medium");
  });

  it("share with every category the cap on allegations (D-43)", () => {
    for (const category of [
      "fraud",
      "money_laundering",
      "regulatory",
      "civil_litigation",
    ] as const) {
      const allegation = finding({ ...credible, category, status: "allegation" });

      expect(findingLevel(allegation, SCREENED_AT), category).toBe("medium");
    }
  });
});

describe("modulators", () => {
  // A minor final sanction starts at medium and may reach high: the case where modulators count.
  const minorSanction = {
    category: "regulatory",
    status: "sanctioned",
    severity: "minor",
  } as const;

  it("raise a finding one level when two of them hold", () => {
    const recentOfficial = finding({
      ...minorSanction,
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
      ...minorSanction,
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
    const official = { ...minorSanction, sourceReliability: "official" } as const;

    expect(findingLevel(finding({ ...official, date: "2024" }), SCREENED_AT)).toBe("high");
    expect(findingLevel(finding({ ...official, date: "2024-09" }), SCREENED_AT)).toBe("medium");
  });
});

describe("encyclopedia sources (D-44)", () => {
  it("weigh like unknown sources: not a reliability modulator", () => {
    const sourced = (sourceReliability: AssessedFinding["sourceReliability"]) =>
      findingLevel(
        finding({
          category: "regulatory",
          status: "sanctioned",
          severity: "minor",
          date: "2026-03-01",
          sourceReliability,
        }),
        SCREENED_AT,
      );

    expect(sourced("official")).toBe("high");
    expect(sourced("encyclopedia")).toBe("medium");
    expect(sourced("unknown")).toBe("medium");
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

  it("recognizes a planned query run with its language tag in front", () => {
    const tagged = ['[fr] "Jean Martin" fraude', '[en]  "Jean Martin" fraud'];

    expect(isCoverageComplete(planned, tagged, [])).toBe(true);
  });

  it("does not take any other change to a planned query for the query itself", () => {
    const changed = ['"Jean Martin" fraude [fr]', '[english] "Jean Martin" fraud'];

    expect(isCoverageComplete(planned, changed, [])).toBe(false);
  });

  it("is false when a planned query did not run", () => {
    expect(isCoverageComplete(planned, [planned[0] ?? ""], [])).toBe(false);
  });

  it("is false when a search failed", () => {
    const failed = { code: "unavailable", detail: "search failed" } as const;

    expect(isCoverageComplete(planned, planned, [failed])).toBe(false);
  });

  it("is false when most search results came from blocked domains", () => {
    const flooded = {
      code: "flooded",
      detail: "6 of 10 search results are on blocked domains",
    } as const;

    expect(isCoverageComplete(planned, planned, [flooded])).toBe(false);
  });

  it("is false when the answer reproduced the prompt canary", () => {
    const compromised = { code: "compromised", detail: "canary" } as const;

    expect(isCoverageComplete(planned, planned, [compromised])).toBe(false);
  });

  it("is still true when the model only went over the search budget", () => {
    const overBudget = { code: "max_uses_exceeded", detail: "search failed" } as const;

    expect(isCoverageComplete(planned, planned, [overBudget])).toBe(true);
  });
});
