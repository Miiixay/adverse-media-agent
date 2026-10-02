import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { estimateCostUsd } from "./cost";
import { parseQueriesPerLanguage, prepare } from "./prepare";
import { PROMPT_VERSION } from "./prompts";
import { screeningInputSchema } from "./schema";
import { isCoverageComplete, score, untrustedScore } from "./score";
import { MODEL, parseEffort, searchAdverseMedia } from "./search";
import type { ScreeningInput, ScreeningResult } from "./types";

export { appendRunLog, requirePseudonymKey, runLogEntry } from "./cost";
export { screeningInputSchema } from "./schema";
export type { ScreeningInput, ScreeningResult } from "./types";

// Vercel stops a function after 300 s on the Hobby plan. The search stops 60 s earlier, so that a
// slow screening still returns an incomplete result rather than a gateway timeout.
export const SEARCH_TIME_BUDGET_MS = 240_000;

export async function screenIndividual(rawInput: ScreeningInput): Promise<ScreeningResult> {
  const input = screeningInputSchema.parse(rawInput);
  const screenedAt = new Date();
  const plan = prepare(input, parseQueriesPerLanguage(process.env.QUERIES_PER_LANGUAGE));
  const outcome = await searchAdverseMedia(
    new Anthropic(),
    input,
    plan,
    SEARCH_TIME_BUDGET_MS,
    parseEffort(process.env.EFFORT),
  );

  const plannedQueries = plan.queries.map((query) => query.text);
  const coverageComplete = isCoverageComplete(
    plannedQueries,
    outcome.executedQueries,
    outcome.errors,
  );
  const compromised = outcome.errors.some((error) => error.code === "compromised");
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
      urlsReviewed: outcome.articles.map((article) => article.url),
      rejectedUrls: outcome.rejectedUrls,
      errors: outcome.errors,
    },
    usage: { ...outcome.usage, estimatedCostUsd: estimateCostUsd(outcome.usage, MODEL) },
    model: outcome.model,
    promptVersion: PROMPT_VERSION,
    screenedAt: screenedAt.toISOString(),
    durationMs: Date.now() - screenedAt.getTime(),
  };
}
