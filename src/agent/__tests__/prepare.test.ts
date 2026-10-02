import { describe, expect, it } from "vitest";

import { COUNTRY_LANGUAGES } from "../data/country-languages";
import { NEGATIVE_KEYWORDS } from "../data/negative-keywords";
import {
  MAX_SEARCHES,
  RESERVED_FREE_SEARCHES,
  buildQueries,
  languagesFor,
  nameVariants,
  parseQueriesPerLanguage,
  prepare,
} from "../prepare";

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

  it("keeps the first term of each offence category and every proceedings term", () => {
    expect(buildQueries("Jean Martin", ["fr"]).map((query) => query.text)).toEqual([
      `"Jean Martin" fraude OR blanchiment OR corruption OR sanctions OR terrorisme OR "crime organisé" OR agression OR condamnation OR "mise en examen" OR procès`,
    ]);
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
    expect(buildQueries("David Smith", ["en"])[0]?.text).toContain(
      `"organized crime" OR "organised crime"`,
    );
  });
});

describe("queries per language switch", () => {
  it("replays the two v1 queries per language word for word", () => {
    expect(buildQueries("Jean Martin", ["fr", "en"], 2).map((query) => query.text)).toEqual([
      `"Jean Martin" fraude OR escroquerie OR blanchiment OR corruption OR pots-de-vin OR sanctions`,
      `"Jean Martin" terrorisme OR "crime organisé" OR mafia OR agression OR meurtre OR condamnation OR "mise en examen" OR procès`,
      `"Jean Martin" fraud OR embezzlement OR "money laundering" OR corruption OR bribery OR sanctions`,
      `"Jean Martin" terrorism OR "organized crime" OR "organised crime" OR assault OR murder OR convicted OR indicted OR arrested`,
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
