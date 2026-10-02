import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { aliasInput, aliasToSearch, mergeOutcomes } from "./alias";
import { estimateCostUsd } from "./cost";
import { parseQueriesPerLanguage, prepare } from "./prepare";
import { PROMPT_VERSION } from "./prompts";
import { screeningInputSchema } from "./schema";
import { isCoverageComplete, score, untrustedScore } from "./score";
import { parseEffort, parseModel, searchAdverseMedia } from "./search";
import { unsourcedSummaryError } from "./summary-check";
import type { ScreeningInput, ScreeningResult } from "./types";

export { appendRunLog, requirePseudonymKey, runLogEntry } from "./cost";
export { screeningInputSchema } from "./schema";
export type { ScreeningInput, ScreeningResult } from "./types";

// Vercel stops a function after 300 s on the Hobby plan. The search stops 60 s earlier, so that a
// slow screening still returns an incomplete result rather than a gateway timeout.
export const SEARCH_TIME_BUDGET_MS = 240_000;
// A second turn under an alias starts only with this much of the budget left: a screening usually
// takes 10 to 20 s, and one cut by the deadline would report the whole screening incomplete.
const MIN_ALIAS_BUDGET_MS = 60_000;

export async function screenIndividual(rawInput: ScreeningInput): Promise<ScreeningResult> {
  const input = screeningInputSchema.parse(rawInput);
  const screenedAt = new Date();
  const queriesPerLanguage = parseQueriesPerLanguage(process.env.QUERIES_PER_LANGUAGE);
  const effort = parseEffort(process.env.EFFORT);
  const model = parseModel(process.env.MODEL);
  const client = new Anthropic();
  const plan = prepare(input, queriesPerLanguage);
  const first = await searchAdverseMedia(client, input, plan, SEARCH_TIME_BUDGET_MS, effort, model);

  let outcome = first;
  let plannedQueries = plan.queries.map((query) => query.text);
  // The sources call the person by another name the queries did not use: one more turn under that
  // name, with the same languages, inside the same time budget (D-42).
  const alias = aliasToSearch(first.aliases, first.executedQueries, input);
  const aliasPerson = alias === null ? null : aliasInput(alias, input);
  const remainingMs = SEARCH_TIME_BUDGET_MS - (Date.now() - screenedAt.getTime());
  if (alias !== null && aliasPerson !== null && remainingMs >= MIN_ALIAS_BUDGET_MS) {
    const aliasPlan = prepare(aliasPerson, queriesPerLanguage);
    const second = await searchAdverseMedia(
      client,
      aliasPerson,
      aliasPlan,
      remainingMs,
      effort,
      model,
    );
    outcome = mergeOutcomes(first, second, alias);
    plannedQueries = [...plannedQueries, ...aliasPlan.queries.map((query) => query.text)];
  }
  const unsourced = unsourcedSummaryError(outcome.summary, outcome.findings);
  const errors = unsourced === null ? outcome.errors : [...outcome.errors, unsourced];

  const coverageComplete = isCoverageComplete(plannedQueries, outcome.executedQueries, errors);
  const compromised = errors.some((error) => error.code === "compromised");
  const { risk, confidence, findings } = compromised
    ? untrustedScore(outcome.findings)
    : score(outcome.findings, coverageComplete, screenedAt);

  return {
    status: coverageComplete ? "complete" : "incomplete",
    risk,
    confidence,
    summary: outcome.summary,
    findings,
    coverage: {
      languages: plan.languages,
      countrySupported: plan.countrySupported,
      plannedQueries,
      executedQueries: outcome.executedQueries,
      searchesUsed: outcome.usage.webSearches,
      articlesReviewed: outcome.articles.length,
      aliases: outcome.aliases,
      urlsReviewed: outcome.articles.map((article) => article.url),
      rejectedUrls: outcome.rejectedUrls,
      errors,
    },
    usage: {
      ...outcome.usage,
      estimatedCostUsd: estimateCostUsd(outcome.usage, model),
      apiCalls: outcome.apiCalls,
    },
    model: outcome.model,
    promptVersion: PROMPT_VERSION,
    screenedAt: screenedAt.toISOString(),
    durationMs: Date.now() - screenedAt.getTime(),
  };
}
