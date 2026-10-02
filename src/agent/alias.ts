import { addUsage } from "./cost";
import { screeningInputSchema } from "./schema";
import { higherRisk } from "./score";
import type { AssessedFinding, ScreeningInput, SearchOutcome, Status } from "./types";

// The stages one matter goes through, each final outcome last. Two statuses of different stages
// can be one matter seen at two moments; unclear has no stage.
const STAGES: Partial<Record<Status, number>> = {
  allegation: 0,
  investigation: 1,
  indictment: 2,
  conviction: 3,
  sanctioned: 3,
  acquitted: 3,
};

// The first other name the sources use for the person, when no query ran under it (D-42). Only
// one: each alias costs a second search turn. An alias holding both the first name and the last
// name entered, such as a longer legal form, is searched already by the planned queries.
export function aliasToSearch(
  aliases: readonly string[],
  executedQueries: readonly string[],
  input: Pick<ScreeningInput, "firstName" | "lastName">,
): string | null {
  const alias = aliases[0]?.trim();
  if (alias === undefined || alias === "") return null;
  if (containsWords(alias, input.firstName) && containsWords(alias, input.lastName)) return null;
  const wanted = fold(alias);
  const searched = executedQueries.some((query) => fold(query).includes(wanted));
  return searched ? null : alias;
}

// Whole words, so that "Jean" is not found in "Jeanne".
function containsWords(text: string, words: string): boolean {
  return ` ${fold(text)} `.includes(` ${fold(words)} `);
}

// Without case or diacritics: "Mardoché" and "MARDOCHE" are one name.
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .split(" ")
    .filter(Boolean)
    .join(" ");
}

// The alias comes from the model, which read web pages: it is validated like a name typed in the
// form before it reaches a prompt, and dropped if it fails. A single word is taken as a first name
// used with the person's last name ("Bernie" for Bernard Madoff).
export function aliasInput(alias: string, input: ScreeningInput): ScreeningInput | null {
  const words = alias.split(" ").filter((word) => word !== "");
  const [lastWord] = words.slice(-1);
  const candidate =
    words.length === 1
      ? { firstName: alias, lastName: input.lastName, country: input.country }
      : { firstName: words.slice(0, -1).join(" "), lastName: lastWord, country: input.country };
  const parsed = screeningInputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// One outcome for the screening: its queries, errors, usage and calls are added to the first
// turn's, and so are its findings, except those the first turn already holds.
export function mergeOutcomes(
  primary: SearchOutcome,
  alias: SearchOutcome,
  aliasName: string,
): SearchOutcome {
  const read = new Set(primary.articles.map((article) => article.url));
  return {
    summary: joinSummaries(primary.summary, alias.summary, aliasName),
    // Each turn judged the matters it found about the same person: the higher view stands.
    suggestedRisk: higherRisk(primary.suggestedRisk, alias.suggestedRisk),
    findings: mergeFindings(primary.findings, alias.findings),
    rejectedUrls: [...new Set([...primary.rejectedUrls, ...alias.rejectedUrls])],
    articles: [...primary.articles, ...alias.articles.filter((article) => !read.has(article.url))],
    executedQueries: [...primary.executedQueries, ...alias.executedQueries],
    aliases: primary.aliases,
    errors: [...primary.errors, ...alias.errors],
    usage: addUsage(primary.usage, alias.usage),
    model: primary.model,
    apiCalls: primary.apiCalls + alias.apiCalls,
  };
}

// The alias turn often reports a matter the first turn holds, from another article or at another
// stage. A finding with the same category and year as a first-turn finding, and the same status or
// a status of another stage, is taken for that matter: the finding at the later stage is kept, in
// the first one's place, and the other's URL joins its corroborating URLs, uncapped. An undated
// finding is never matched.
export function mergeFindings(
  primary: readonly AssessedFinding[],
  alias: readonly AssessedFinding[],
): AssessedFinding[] {
  const merged: AssessedFinding[] = primary.map((finding) => ({
    ...finding,
    corroboratingUrls: [...finding.corroboratingUrls],
  }));
  const reported = new Set(primary.map((finding) => finding.url));
  const added: AssessedFinding[] = [];
  for (const finding of alias) {
    if (reported.has(finding.url)) continue;
    reported.add(finding.url);
    const index = merged.findIndex((existing) => sameMatter(existing, finding));
    const existing = merged[index];
    if (existing === undefined) {
      added.push(finding);
      continue;
    }
    const [kept, folded] =
      stage(finding) > stage(existing) ? [finding, existing] : [existing, finding];
    merged[index] = {
      ...kept,
      corroboratingUrls: [...new Set([...kept.corroboratingUrls, folded.url])],
    };
  }
  return [...merged, ...added];
}

function sameMatter(a: AssessedFinding, b: AssessedFinding): boolean {
  const year = a.date?.slice(0, 4);
  const sameYear = year !== undefined && year === b.date?.slice(0, 4);
  return sameYear && a.category === b.category && (a.status === b.status || stagesDiffer(a, b));
}

function stagesDiffer(a: AssessedFinding, b: AssessedFinding): boolean {
  const first = STAGES[a.status];
  const second = STAGES[b.status];
  return first !== undefined && second !== undefined && first !== second;
}

function stage(finding: AssessedFinding): number {
  return STAGES[finding.status] ?? -1;
}

function joinSummaries(
  primary: string | null,
  alias: string | null,
  aliasName: string,
): string | null {
  if (alias === null) return primary;
  const underAlias = `Under the name ${aliasName}: ${alias}`;
  return primary === null ? underAlias : `${primary} ${underAlias}`;
}
