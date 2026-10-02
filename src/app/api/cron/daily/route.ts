import { cronAuthorized } from "@/access";
import { SEARCH_TIME_BUDGET_MS, screenIndividual, type ScreeningResult } from "@/agent";
import { isDuplicateDailyScreening } from "@/db/mapping";
import { listDailyCandidates, saveScreening, type DailyCandidate } from "@/db/screenings";

import { errorLabel, logRun, runLogKey } from "../../server-log";
import {
  DAILY_CONCURRENCY,
  planDailyRun,
  runWithinBudget,
  summarizeDailyRun,
  type PersonOutcome,
} from "./plan";

export const runtime = "nodejs";
// The Hobby maximum with fluid compute.
export const maxDuration = 300;

const MAX_DURATION_MS = 300_000;
// Kept after the last screening ends, to store it and answer.
const SAVE_MARGIN_MS = 15_000;
// A screening may run for SEARCH_TIME_BUDGET_MS: one started later than this would outlive the
// function. With 240 s for the agent, new screenings start during the first 45 s only.
const START_CUTOFF_MS = MAX_DURATION_MS - SEARCH_TIME_BUDGET_MS - SAVE_MARGIN_MS;

// Called once a day by Vercel Cron. Re-screens every recorded person, stores a daily screening
// with only the findings whose URL is new for that person, and answers with a summary.
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  const pseudonymKey = runLogKey();

  let candidates: DailyCandidate[];
  try {
    candidates = await listDailyCandidates();
  } catch (error) {
    console.error(`daily run not started: ${errorLabel(error)}`);
    return Response.json({ error: "the database did not answer" }, { status: 503 });
  }

  const plan = planDailyRun(candidates, new Date(startedAt));
  const { results, notStarted } = await runWithinBudget(
    plan.toScreen,
    DAILY_CONCURRENCY,
    () => Date.now() - startedAt < START_CUTOFF_MS,
    (candidate) => screenDaily(candidate, pseudonymKey),
  );
  return Response.json({
    ...summarizeDailyRun(plan, results, notStarted),
    durationMs: Date.now() - startedAt,
  });
}

async function screenDaily(
  candidate: DailyCandidate,
  pseudonymKey: string | null,
): Promise<PersonOutcome> {
  const personId = candidate.id;
  let result: ScreeningResult;
  try {
    result = await screenIndividual(candidate.input);
  } catch (error) {
    console.error(`daily screening failed: ${errorLabel(error)}`);
    return { personId, outcome: "failed", error: errorLabel(error) };
  }

  const costUsd = result.usage.estimatedCostUsd;
  if (pseudonymKey !== null) await logRun(candidate.input, result, pseudonymKey);
  try {
    const saved = await saveScreening(candidate.input, result, "daily");
    return {
      personId,
      outcome: "screened",
      screeningId: saved.screeningId,
      risk: result.risk,
      status: result.status,
      newFindings: saved.newFindings,
      costUsd,
    };
  } catch (error) {
    if (isDuplicateDailyScreening(error)) {
      return { personId, outcome: "already_screened_today", costUsd };
    }
    console.error(`daily screening not saved: ${errorLabel(error)}`);
    return { personId, outcome: "not_saved", costUsd, error: errorLabel(error) };
  }
}
