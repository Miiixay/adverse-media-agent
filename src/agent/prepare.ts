import { COUNTRY_LANGUAGES } from "./data/country-languages";
import {
  NEGATIVE_KEYWORDS,
  SPELLING_VARIANTS,
  type KeywordCategory,
} from "./data/negative-keywords";
import type { Language, ScreeningInput, SearchPlan, SearchQuery } from "./types";

// A measurement switch, not a product setting: 2 replays the v1 plan, two queries per language,
// so that v1 and v2 can be compared on the same code (v2.2 in docs/evaluation.md).
export type QueriesPerLanguage = 1 | 2;

export const MAX_SEARCHES = 8;
// Searches kept out of the plan so the model can settle an identity doubt or try another form
// of the name.
export const RESERVED_FREE_SEARCHES = 2;
const QUERY_BUDGET = MAX_SEARCHES - RESERVED_FREE_SEARCHES;

const INTERNATIONAL_LANGUAGE: Language = "en";

// One query per language. It keeps the first term listed for each offence category and every
// proceedings term: topic words such as "sanctions" pull pages about the topic, while proceedings
// terms favour articles in which someone is the subject of a case.
const OFFENCE_CATEGORIES: readonly KeywordCategory[] = [
  "fraud",
  "money_laundering",
  "corruption",
  "sanctions",
  "terrorism",
  "organized_crime",
  "violence",
];

// The v1 plan: financial crime apart from general criminal and judicial coverage.
const SPLIT_GROUPS: readonly (readonly KeywordCategory[])[] = [
  ["fraud", "money_laundering", "corruption", "sanctions"],
  ["terrorism", "organized_crime", "violence", "legal_proceedings"],
];

// Letters that Unicode NFD does not split into a base letter and a combining mark.
const UNDECOMPOSABLE_LETTERS: Readonly<Record<string, string>> = {
  ß: "ss",
  ẞ: "SS",
  Æ: "AE",
  æ: "ae",
  Œ: "OE",
  œ: "oe",
  Ø: "O",
  ø: "o",
  Ł: "L",
  ł: "l",
  Đ: "D",
  đ: "d",
  ı: "i",
};

const COMBINING_MARKS = /\p{M}/gu;

export function prepare(
  input: ScreeningInput,
  queriesPerLanguage: QueriesPerLanguage = 1,
): SearchPlan {
  const firstName = normalizeName(input.firstName);
  const lastName = normalizeName(input.lastName);
  const { languages, countrySupported } = languagesFor(input.country);
  return {
    languages,
    countrySupported,
    nameVariants: nameVariants(firstName, lastName),
    queries: buildQueries(`${firstName} ${lastName}`, languages, queriesPerLanguage),
  };
}

export function parseQueriesPerLanguage(value: string | undefined): QueriesPerLanguage {
  if (value === undefined || value === "" || value === "1") return 1;
  if (value === "2") return 2;
  throw new Error(`QUERIES_PER_LANGUAGE must be 1 or 2, got "${value}"`);
}

export function languagesFor(country: string): Pick<SearchPlan, "languages" | "countrySupported"> {
  const nativeLanguages = COUNTRY_LANGUAGES.get(country);
  if (nativeLanguages === undefined) {
    return { languages: [INTERNATIONAL_LANGUAGE], countrySupported: false };
  }
  return {
    languages: [...new Set([...nativeLanguages, INTERNATIONAL_LANGUAGE])],
    countrySupported: true,
  };
}

export function nameVariants(firstName: string, lastName: string): string[] {
  return uniqueIgnoringCase([
    ...writtenForms(firstName, lastName),
    ...writtenForms(stripDiacritics(firstName), stripDiacritics(lastName)),
  ]);
}

export function buildQueries(
  fullName: string,
  languages: readonly Language[],
  queriesPerLanguage: QueriesPerLanguage = 1,
): SearchQuery[] {
  if (languages.length > QUERY_BUDGET) {
    throw new Error(
      `Languages ${languages.join(", ")} need ${languages.length} queries, over the budget of ${QUERY_BUDGET}`,
    );
  }
  const split = queriesPerLanguage === 2 ? languagesKeptSplit(languages) : new Set<Language>();
  return languages.flatMap((language) =>
    split.has(language)
      ? SPLIT_GROUPS.map((categories) => ({
          language,
          text: queryText(fullName, splitTerms(language, categories)),
        }))
      : [{ language, text: queryText(fullName, singleQueryTerms(language)) }],
  );
}

// Over budget, the v1 plan gives native languages a single query, starting from the last listed:
// the first language carries the most press and English covers the international press (D-20).
function languagesKeptSplit(languages: readonly Language[]): Set<Language> {
  const split = new Set(languages);
  let plannedQueries = languages.length * SPLIT_GROUPS.length;
  const unsplitOrder = [
    ...languages.filter((language) => language !== INTERNATIONAL_LANGUAGE).reverse(),
    INTERNATIONAL_LANGUAGE,
  ];
  for (const language of unsplitOrder) {
    if (plannedQueries <= QUERY_BUDGET) break;
    split.delete(language);
    plannedQueries -= SPLIT_GROUPS.length - 1;
  }
  return split;
}

function singleQueryTerms(language: Language): string[] {
  const keywords = NEGATIVE_KEYWORDS[language];
  return [
    ...OFFENCE_CATEGORIES.flatMap((category) => keywords[category].slice(0, 1)),
    ...keywords.legal_proceedings,
  ];
}

function splitTerms(language: Language, categories: readonly KeywordCategory[]): string[] {
  return categories.flatMap((category) => NEGATIVE_KEYWORDS[language][category]);
}

function queryText(fullName: string, terms: readonly string[]): string {
  const spellings = terms.flatMap((term) => [term, ...(SPELLING_VARIANTS[term] ?? [])]);
  return `"${fullName}" ${spellings.map(quoteIfPhrase).join(" OR ")}`;
}

function quoteIfPhrase(term: string): string {
  return term.includes(" ") ? `"${term}"` : term;
}

function writtenForms(firstName: string, lastName: string): string[] {
  return [
    `${firstName} ${lastName}`,
    `${lastName} ${firstName}`,
    `${initials(firstName)} ${lastName}`,
  ];
}

function initials(firstName: string): string {
  return firstName
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part) => `${part.charAt(0).toLocaleUpperCase()}.`)
        .join("-"),
    )
    .join(" ");
}

function stripDiacritics(text: string): string {
  const withoutMarks = text.normalize("NFD").replace(COMBINING_MARKS, "");
  return Array.from(withoutMarks, (char) => UNDECOMPOSABLE_LETTERS[char] ?? char).join("");
}

function normalizeName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

function uniqueIgnoringCase(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
