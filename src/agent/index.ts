import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { aliasInput, aliasToSearch, mergeOutcomes } from "./alias";
import { readConfig, type Config } from "./config";
import { estimateCostUsd } from "./cost";
import { escalationSignals, mergeEscalation } from "./escalation";
import { prepare } from "./prepare";
import { PROMPT_VERSION } from "./prompts";
import { screeningInputSchema } from "./schema";
import { disagrees, isCoverageComplete, score, untrustedScore } from "./score";
import { searchAdverseMedia } from "./search";
import { unsourcedSummaryError } from "./summary-check";
import type { ScreeningInput, ScreeningResult, SearchOutcome, SearchPlan } from "./types";

export { appendRunLog, requirePseudonymKey, runLogEntry } from "./cost";
export { screeningInputSchema } from "./schema";
export type { ScreeningInput, ScreeningResult } from "./types";

// Vercel stops a function after 300 s on the Hobby plan. The search stops 60 s earlier, so that a
// slow screening still returns an incomplete result rather than a gateway timeout.
export const SEARCH_TIME_BUDGET_MS = 240_000;
// A second turn starts only with 60 s left: a turn cut by the deadline would report the whole
// screening incomplete.
const MIN_ALIAS_BUDGET_MS = 60_000;
// An escalated screening starts only with this much of the budget left: on the fixtures an Opus
// screening took up to 34 s, about twice that with an alias turn, and one cut by the deadline
// would replace a complete result with an incomplete one.
const MIN_ESCALATION_BUDGET_MS = 120_000;

type Pass = Omit<Config, "escalationModel"> & { searchAlias: boolean };

export async function screenIndividual(rawInput: ScreeningInput): Promise<ScreeningResult> {
  const input = screeningInputSchema.parse(rawInput);
  const screenedAt = new Date();
  const deadline = screenedAt.getTime() + SEARCH_TIME_BUDGET_MS;
  const { escalationModel, ...settings } = readConfig(process.env);
  const client = new Anthropic();

  // With escalation on, a detected alias escalates and the escalated screening runs its own alias
  // turn: the first screening leaves that turn out rather than pay for one it would discard.
  const first = await screenOnce(client, input, screenedAt, deadline, {
    ...settings,
    searchAlias: escalationModel === null,
  });
  if (
    escalationModel === null ||
    first.coverage.escalationSignals.length === 0 ||
    deadline - Date.now() < MIN_ESCALATION_BUDGET_MS
  ) {
    return first;
  }
  // Something adverse, another name or a doubtful result: the person is screened again from the
  // start on the stronger model, inside the same time budget (D-49).
  const escalated = await screenOnce(client, input, screenedAt, deadline, {
    ...settings,
    model: escalationModel,
    searchAlias: true,
  });
  return mergeEscalation(first, escalated, escalationModel);
}

async function screenOnce(
  client: Anthropic,
  input: ScreeningInput,
  screenedAt: Date,
  deadline: number,
  pass: Pass,
): Promise<ScreeningResult> {
  const plan = prepare(input, pass.queriesPerLanguage);
  const first = await searchAdverseMedia(
    client,
    input,
    plan,
    deadline - Date.now(),
    pass.effort,
    pass.model,
  );
  const { outcome, plannedQueries } = await searchUnderAlias(
    client,
    input,
    plan,
    first,
    deadline,
    pass,
  );
  const unsourced = unsourcedSummaryError(outcome.summary, outcome.findings);
  const errors = unsourced === null ? outcome.errors : [...outcome.errors, unsourced];

  const coverageComplete = isCoverageComplete(plannedQueries, outcome.executedQueries, errors);
  const compromised = errors.some((error) => error.code === "compromised");
  const { risk, confidence, findings } = compromised
    ? untrustedScore(outcome.findings)
    : score(outcome.findings, coverageComplete, screenedAt);
  // A compromised answer is not trusted, its opinion of the risk included (D-36).
  const modelSuggestedRisk = compromised ? null : outcome.suggestedRisk;

  const status = coverageComplete ? "complete" : "incomplete";
  const coverage = {
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
    escalatedTo: null,
  };
  return {
    status,
    risk,
    confidence,
    modelSuggestedRisk,
    riskDisagreement: disagrees(risk, modelSuggestedRisk),
    summary: outcome.summary,
    findings,
    coverage: {
      ...coverage,
      escalationSignals: escalationSignals({ status, findings, coverage }, input),
    },
    usage: {
      ...outcome.usage,
      estimatedCostUsd: estimateCostUsd(outcome.usage, pass.model),
      apiCalls: outcome.apiCalls,
    },
    model: outcome.model,
    promptVersion: PROMPT_VERSION,
    screenedAt: screenedAt.toISOString(),
    durationMs: Date.now() - screenedAt.getTime(),
  };
}

// The sources call the person by another name the queries did not use: one more turn under that
// name, with the same languages, inside the same time budget (D-42).
async function searchUnderAlias(
  client: Anthropic,
  input: ScreeningInput,
  plan: SearchPlan,
  first: SearchOutcome,
  deadline: number,
  pass: Pass,
): Promise<{ outcome: SearchOutcome; plannedQueries: string[] }> {
  const plannedQueries = plan.queries.map((query) => query.text);
  const alias = aliasToSearch(first.aliases, first.executedQueries, input);
  const aliasPerson = alias === null ? null : aliasInput(alias, input);
  const remainingMs = deadline - Date.now();
  if (
    !pass.searchAlias ||
    alias === null ||
    aliasPerson === null ||
    remainingMs < MIN_ALIAS_BUDGET_MS
  ) {
    return { outcome: first, plannedQueries };
  }
  const aliasPlan = prepare(aliasPerson, pass.queriesPerLanguage);
  const second = await searchAdverseMedia(
    client,
    aliasPerson,
    aliasPlan,
    remainingMs,
    pass.effort,
    pass.model,
  );
  return {
    outcome: mergeOutcomes(first, second, alias),
    plannedQueries: [...plannedQueries, ...aliasPlan.queries.map((query) => query.text)],
  };
}
