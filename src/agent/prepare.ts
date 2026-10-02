import { COUNTRY_LANGUAGES } from "./data/country-languages";
import { NEGATIVE_KEYWORDS, type KeywordCategory } from "./data/negative-keywords";
import type { Language, ScreeningInput, SearchPlan, SearchQuery } from "./types";

export const MAX_SEARCHES = 8;
// Searches kept out of the plan so the model can settle an identity doubt or try another form
// of the name.
export const RESERVED_FREE_SEARCHES = 2;
const QUERY_BUDGET = MAX_SEARCHES - RESERVED_FREE_SEARCHES;

const INTERNATIONAL_LANGUAGE: Language = "en";

// Two focused queries per language rank better than one long OR list, and keep financial crime
// apart from general criminal and judicial coverage.
const QUERY_GROUPS: readonly (readonly KeywordCategory[])[] = [
  ["fraud", "money_laundering", "corruption", "sanctions"],
  ["terrorism", "organized_crime", "violence", "legal_proceedings"],
];
const ALL_CATEGORIES = QUERY_GROUPS.flat();

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

const COMBINING_MARKS = /[̀-ͯ]/g;

export function prepare(input: ScreeningInput): SearchPlan {
  const firstName = normalizeName(input.firstName);
  const lastName = normalizeName(input.lastName);
  const { languages, countrySupported } = languagesFor(input.country);
  return {
    languages,
    countrySupported,
    nameVariants: nameVariants(firstName, lastName),
    queries: buildQueries(`${firstName} ${lastName}`, languages),
  };
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

export function buildQueries(fullName: string, languages: readonly Language[]): SearchQuery[] {
  const merged = languagesToMerge(languages);
  return languages.flatMap((language) => {
    const groups = merged.has(language) ? [ALL_CATEGORIES] : QUERY_GROUPS;
    return groups.map((categories) => ({
      language,
      text: queryText(fullName, language, categories),
    }));
  });
}

// Over budget, native languages fall back to one merged query each, starting from the last
// listed: the first language carries the most press and English covers the international press.
function languagesToMerge(languages: readonly Language[]): Set<Language> {
  const merged = new Set<Language>();
  let plannedQueries = languages.length * QUERY_GROUPS.length;
  const nativeFromLast = languages
    .filter((language) => language !== INTERNATIONAL_LANGUAGE)
    .reverse();
  for (const language of nativeFromLast) {
    if (plannedQueries <= QUERY_BUDGET) break;
    merged.add(language);
    plannedQueries -= QUERY_GROUPS.length - 1;
  }
  if (plannedQueries > QUERY_BUDGET) {
    throw new Error(
      `Languages ${languages.join(", ")} need ${plannedQueries} queries, over the budget of ${QUERY_BUDGET}`,
    );
  }
  return merged;
}

function queryText(
  fullName: string,
  language: Language,
  categories: readonly KeywordCategory[],
): string {
  const terms = categories.flatMap((category) => NEGATIVE_KEYWORDS[language][category]);
  return `"${fullName}" ${terms.map(quoteIfPhrase).join(" OR ")}`;
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
