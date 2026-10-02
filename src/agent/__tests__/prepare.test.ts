import { describe, expect, it } from "vitest";

import { COUNTRY_LANGUAGES } from "../data/country-languages";
import { NEGATIVE_KEYWORDS } from "../data/negative-keywords";
import {
  MAX_QUERY_CHARACTERS,
  MAX_QUERY_WORDS,
  MAX_SEARCHES,
  RESERVED_FREE_SEARCHES,
  buildQueries,
  languagesFor,
  nameVariants,
  parseQueriesPerLanguage,
  withinQueryLimits,
  prepare,
} from "../prepare";
import type { Language } from "../types";

describe("languagesFor", () => {
  it("adds English after the national press language", () => {
    expect(languagesFor("FR")).toEqual({ languages: ["fr", "en"], countrySupported: true });
  });

  it("does not repeat English for an English-speaking country", () => {
    expect(languagesFor("GB").languages).toEqual(["en"]);
  });

  it("keeps every press language of a multilingual country", () => {
    expect(languagesFor("BE").languages).toEqual(["nl", "fr", "en"]);
    expect(languagesFor("CH").languages).toEqual(["de", "fr", "it", "en"]);
  });

  it("falls back to English only for a country missing from the table", () => {
    expect(languagesFor("ZZ")).toEqual({ languages: ["en"], countrySupported: false });
  });
});

describe("nameVariants", () => {
  it("gives the name as entered, in reverse order and with the first-name initial", () => {
    expect(nameVariants("Jean", "Martin")).toEqual(["Jean Martin", "Martin Jean", "J. Martin"]);
  });

  it("adds the same forms without diacritics", () => {
    expect(nameVariants("Éric", "Müller")).toEqual([
      "Éric Müller",
      "Müller Éric",
      "É. Müller",
      "Eric Muller",
      "Muller Eric",
      "E. Muller",
    ]);
  });

  it("folds letters that Unicode does not decompose", () => {
    expect(nameVariants("Łukasz", "Wałęsa")).toContain("Lukasz Walesa");
    expect(nameVariants("Søren", "Groß")).toContain("Soren Gross");
  });

  it("abbreviates compound and multiple first names", () => {
    expect(nameVariants("Jean-Pierre", "Martin")).toContain("J.-P. Martin");
    expect(nameVariants("Anna Maria", "Schmidt")).toContain("A. M. Schmidt");
  });
});

describe("buildQueries", () => {
  it("builds one query per language, native first", () => {
    const languages = buildQueries("Jean Martin", ["fr", "en"]).map((query) => query.language);
    expect(languages).toEqual(["fr", "en"]);
  });

  it("repeats the name in every clause, terms in order of priority", () => {
    expect(buildQueries("Jean Martin", ["fr"]).map((query) => query.text)).toEqual([
      `"Jean Martin" fraude OR "Jean Martin" blanchiment OR "Jean Martin" corruption OR "Jean Martin" sanctions OR "Jean Martin" condamnation OR "Jean Martin" "mise en examen" OR "Jean Martin" enquête OR "Jean Martin" plainte OR "Jean Martin" scandale`,
    ]);
  });

  it("keeps nine clauses in every language for a short name, each within the limits", () => {
    for (const language of Object.keys(NEGATIVE_KEYWORDS) as Language[]) {
      const [query] = buildQueries("Jean Martin", [language]);
      const clauses = query?.text.split(" OR ") ?? [];

      expect(clauses, language).toHaveLength(9);
      expect(
        clauses.every((clause) => clause.startsWith('"Jean Martin" ')),
        language,
      ).toBe(true);
      expect(new Set(clauses).size, language).toBe(clauses.length);
      expect(withinQueryLimits(query?.text ?? ""), language).toBe(true);
    }
  });

  it("drops the last clauses of the longest fixture name to stay within the limits", () => {
    const [german, english] = buildQueries("Friederike Wenzlaff-Obermaier", ["de", "en"]);

    expect(german?.text.split(" OR ")).toHaveLength(8);
    expect(german?.text).not.toContain("Skandal");
    expect(english?.text.split(" OR ").at(-1)).toBe('"Friederike Wenzlaff-Obermaier" lawsuit');
    expect(english?.text.length).toBeLessThanOrEqual(MAX_QUERY_CHARACTERS);
  });

  it("stays within the limits in every language for the longest name the input allows", () => {
    const name = `${"A".repeat(50)} ${"B".repeat(50)}`;
    for (const language of Object.keys(NEGATIVE_KEYWORDS) as Language[]) {
      const [query] = buildQueries(name, [language]);

      expect(withinQueryLimits(query?.text ?? ""), language).toBe(true);
      expect(query?.text.startsWith(`"${name}" `), language).toBe(true);
    }
  });

  it("keeps the first clause alone when the name leaves no room for a second", () => {
    const name = Array.from({ length: 40 }, () => "Al").join(" ");
    const [query] = buildQueries(name, ["en"]);

    expect(query?.text).toBe(`"${name}" fraud`);
  });

  it("counts words and characters against both limits", () => {
    expect(withinQueryLimits("a ".repeat(MAX_QUERY_WORDS).trim())).toBe(true);
    expect(withinQueryLimits("a ".repeat(MAX_QUERY_WORDS + 1).trim())).toBe(false);
    expect(withinQueryLimits("a".repeat(MAX_QUERY_CHARACTERS + 1))).toBe(false);
  });
});

describe("prepare", () => {
  it("plans native and English queries for a supported country", () => {
    const plan = prepare({ firstName: "Jean", lastName: "Martin", country: "FR" });
    expect(plan.countrySupported).toBe(true);
    expect(plan.queries).toHaveLength(2);
    expect(plan.queries.every((query) => query.text.startsWith(`"Jean Martin" `))).toBe(true);
  });

  it("searches in English only and flags a country missing from the table", () => {
    const plan = prepare({ firstName: "Jean", lastName: "Martin", country: "ZZ" });
    expect(plan.countrySupported).toBe(false);
    expect(plan.queries.map((query) => query.language)).toEqual(["en"]);
  });

  it("queries the name with its diacritics and keeps the folded form as a variant", () => {
    const plan = prepare({ firstName: "Éric", lastName: "Müller", country: "DE" });
    expect(plan.queries[0]?.text.startsWith(`"Éric Müller" `)).toBe(true);
    expect(plan.nameVariants).toContain("Eric Muller");
  });

  it("collapses whitespace and composes decomposed accents", () => {
    const plan = prepare({
      firstName: "  Éric ".normalize("NFD"),
      lastName: "Müller  ".normalize("NFD"),
      country: "DE",
    });
    expect(plan.nameVariants[0]).toBe("Éric Müller");
  });
});

describe("search budget", () => {
  it("leaves the reserved free searches for every country in the table", () => {
    for (const country of COUNTRY_LANGUAGES.keys()) {
      const plan = prepare({ firstName: "Anna", lastName: "Keller", country });
      expect(plan.queries.length, country).toBeLessThanOrEqual(
        MAX_SEARCHES - RESERVED_FREE_SEARCHES,
      );
    }
  });

  it("refuses more languages than the queries the budget allows", () => {
    const languages = ["de", "fr", "it", "nl", "pl", "sv", "en"] as const;
    expect(() => buildQueries("Anna Keller", languages)).toThrow(/over the budget/);
  });
});

describe("spelling variants", () => {
  it("searches the British and American spellings together", () => {
    expect(buildQueries("David Smith", ["en"], 2)[1]?.text).toContain(
      `"David Smith" "organized crime" OR "David Smith" "organised crime"`,
    );
  });
});

describe("queries per language switch", () => {
  it("keeps the two v1 groups per language, with the name repeated in every clause", () => {
    expect(buildQueries("Jean Martin", ["fr", "en"], 2).map((query) => query.text)).toEqual([
      `"Jean Martin" fraude OR "Jean Martin" escroquerie OR "Jean Martin" blanchiment OR "Jean Martin" corruption OR "Jean Martin" pots-de-vin OR "Jean Martin" sanctions`,
      `"Jean Martin" terrorisme OR "Jean Martin" "crime organisé" OR "Jean Martin" mafia OR "Jean Martin" agression OR "Jean Martin" meurtre OR "Jean Martin" condamnation OR "Jean Martin" "mise en examen" OR "Jean Martin" procès`,
      `"Jean Martin" fraud OR "Jean Martin" embezzlement OR "Jean Martin" "money laundering" OR "Jean Martin" corruption OR "Jean Martin" bribery OR "Jean Martin" sanctions`,
      `"Jean Martin" terrorism OR "Jean Martin" "organized crime" OR "Jean Martin" "organised crime" OR "Jean Martin" assault OR "Jean Martin" murder OR "Jean Martin" convicted OR "Jean Martin" indicted OR "Jean Martin" arrested`,
    ]);
  });

  it("gives native languages a single query over budget, from the last listed, as v1 did", () => {
    const languages = buildQueries("Anna Keller", ["de", "fr", "it", "en"], 2).map(
      (query) => query.language,
    );
    expect(languages).toEqual(["de", "de", "fr", "it", "en", "en"]);
  });

  it("leaves the reserved free searches for every country in both configurations", () => {
    for (const country of COUNTRY_LANGUAGES.keys()) {
      const plan = prepare({ firstName: "Anna", lastName: "Keller", country }, 2);
      expect(plan.queries.length, country).toBeLessThanOrEqual(
        MAX_SEARCHES - RESERVED_FREE_SEARCHES,
      );
    }
  });

  it("reads 1 by default, 2 on request, and refuses anything else", () => {
    expect(parseQueriesPerLanguage(undefined)).toBe(1);
    expect(parseQueriesPerLanguage("")).toBe(1);
    expect(parseQueriesPerLanguage("2")).toBe(2);
    expect(() => parseQueriesPerLanguage("3")).toThrow(/QUERIES_PER_LANGUAGE/);
  });
});

describe("reference data", () => {
  it("uses uppercase ISO 3166-1 alpha-2 country codes", () => {
    for (const country of COUNTRY_LANGUAGES.keys()) {
      expect(country).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("has clean keywords in every category of every language", () => {
    for (const categories of Object.values(NEGATIVE_KEYWORDS)) {
      for (const terms of Object.values(categories)) {
        expect(terms.length).toBeGreaterThan(0);
        for (const term of terms) {
          expect(term).toBe(term.trim());
          expect(term).not.toContain(`"`);
        }
      }
    }
  });
});
