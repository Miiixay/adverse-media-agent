import { describe, expect, it } from "vitest";

import { COUNTRY_LANGUAGES } from "../data/country-languages";
import { NEGATIVE_KEYWORDS } from "../data/negative-keywords";
import {
  MAX_SEARCHES,
  RESERVED_FREE_SEARCHES,
  buildQueries,
  languagesFor,
  nameVariants,
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
  it("builds a financial crime query and a criminal justice query per language", () => {
    const languages = buildQueries("Jean Martin", ["fr", "en"]).map((query) => query.language);
    expect(languages).toEqual(["fr", "fr", "en", "en"]);
  });

  it("quotes the full name and the multi-word keywords", () => {
    expect(buildQueries("Jean Martin", ["fr"]).map((query) => query.text)).toEqual([
      `"Jean Martin" fraude OR escroquerie OR blanchiment OR corruption OR pots-de-vin OR sanctions`,
      `"Jean Martin" terrorisme OR "crime organisé" OR mafia OR agression OR meurtre OR condamnation OR "mise en examen" OR procès`,
    ]);
  });
});

describe("prepare", () => {
  it("plans native and English queries for a supported country", () => {
    const plan = prepare({ firstName: "Jean", lastName: "Martin", country: "FR" });
    expect(plan.countrySupported).toBe(true);
    expect(plan.queries).toHaveLength(4);
    expect(plan.queries.every((query) => query.text.startsWith(`"Jean Martin" `))).toBe(true);
  });

  it("searches in English only and flags a country missing from the table", () => {
    const plan = prepare({ firstName: "Jean", lastName: "Martin", country: "ZZ" });
    expect(plan.countrySupported).toBe(false);
    expect(plan.queries.map((query) => query.language)).toEqual(["en", "en"]);
  });

  it("queries the name with its diacritics and keeps the folded form as a variant", () => {
    const plan = prepare({ firstName: "Éric", lastName: "Müller", country: "DE" });
    expect(plan.queries[0]?.text.startsWith(`"Éric Müller" `)).toBe(true);
    expect(plan.nameVariants).toContain("Eric Muller");
  });

  it("collapses whitespace and composes decomposed accents", () => {
    const plan = prepare({ firstName: "  Éric ", lastName: "Müller  ", country: "DE" });
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

  it("keeps two queries per language when the plan fits", () => {
    const queries = buildQueries("Anna Keller", ["nl", "fr", "en"]);
    expect(queries.map((query) => query.language)).toEqual(["nl", "nl", "fr", "fr", "en", "en"]);
  });

  it("merges native languages into one query each, starting from the last", () => {
    const queries = buildQueries("Anna Keller", ["de", "fr", "it", "en"]);
    expect(queries.map((query) => query.language)).toEqual(["de", "de", "fr", "it", "en", "en"]);
    const italian = queries.find((query) => query.language === "it");
    expect(italian?.text).toContain("riciclaggio");
    expect(italian?.text).toContain("condanna");
  });

  it("refuses languages that cannot fit even with every native language merged", () => {
    expect(() => buildQueries("Anna Keller", ["de", "fr", "it", "nl", "pl", "en"])).toThrow(
      /over the budget/,
    );
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
