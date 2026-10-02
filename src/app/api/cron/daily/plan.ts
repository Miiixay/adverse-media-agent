import type { RiskLevel, ScreeningResult } from "@/agent/types";
import type { DailyCandidate } from "@/db/screenings";

// The batch tests replay four cases at once without hitting the rate limit (scripts/evaluate.ts).
export const DAILY_CONCURRENCY = 4;
// Bounds what one run can spend: about $1.70 at the $0.086 mean of a screening on the fixtures.
export const DEFAULT_MAX_DAILY_SCREENINGS = 20;

export type DailyPlan = {
  day: string;
  maxScreenings: number;
  toScreen: DailyCandidate[];
  // Over the cap of this run. Screened least recently, they come first in the next one.
  deferred: DailyCandidate[];
  alreadyScreened: DailyCandidate[];
  // Recorded but not monitored: never re-screened until monitoring is switched on.
  notMonitored: DailyCandidate[];
};

export type PersonOutcome =
  | {
      personId: string;
      outcome: "screened";
      screeningId: string;
      risk: RiskLevel;
      status: ScreeningResult["status"];
      newFindings: number;
      costUsd: number;
    }
  // Another run stored this person's daily screening first; this one was paid for and dropped.
  | { personId: string; outcome: "already_screened_today"; costUsd: number }
  | { personId: string; outcome: "not_saved"; costUsd: number; error: string }
  | { personId: string; outcome: "failed"; error: string };

export type DailySummary = {
  day: string;
  // Monitored persons; the others are counted apart.
  persons: number;
  notMonitored: number;
  maxScreenings: number;
  screened: number;
  alreadyScreenedToday: number;
  // Over the cap of MAX_DAILY_SCREENINGS, left for the next run.
  deferred: number;
  notReached: number;
  failed: number;
  totalNewFindings: number;
  newFindings: {
    personId: string;
    screeningId: string;
    newFindings: number;
    risk: RiskLevel;
    status: ScreeningResult["status"];
  }[];
  totalCostUsd: number;
  note: string;
};

export function parseMaxDailyScreenings(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_MAX_DAILY_SCREENINGS;
  const max = Number(value);
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`MAX_DAILY_SCREENINGS must be a positive integer, got "${value}"`);
  }
  return max;
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Only monitored persons are screened. A person already screened by a daily run on the same UTC
// day is skipped: a second call does
// nothing new. The others go in order of their last daily screening, never screened first, so that
// the persons a run could not reach in time come first the next day.
export function planDailyRun(
  candidates: readonly DailyCandidate[],
  now: Date,
  maxScreenings = DEFAULT_MAX_DAILY_SCREENINGS,
): DailyPlan {
  const day = utcDay(now);
  const screenedToday = (candidate: DailyCandidate) =>
    candidate.lastDailyAt !== null && utcDay(candidate.lastDailyAt) === day;
  const monitored = candidates.filter((candidate) => candidate.monitored);
  const due = monitored
    .filter((candidate) => !screenedToday(candidate))
    .toSorted(
      (a, b) =>
        compare(lastDaily(a), lastDaily(b)) ||
        compare(a.createdAt.getTime(), b.createdAt.getTime()),
    );
  return {
    day,
    maxScreenings,
    toScreen: due.slice(0, maxScreenings),
    deferred: due.slice(maxScreenings),
    alreadyScreened: monitored.filter(screenedToday),
    notMonitored: candidates.filter((candidate) => !candidate.monitored),
  };
}

// Runs up to `concurrency` items at a time and starts a new one only while mayStart() holds; the
// items never started are returned in their order. work must not throw: it reports its failures.
export async function runWithinBudget<T, R>(
  items: readonly T[],
  concurrency: number,
  mayStart: () => boolean,
  work: (item: T) => Promise<R>,
): Promise<{ results: R[]; notStarted: T[] }> {
  const queue = [...items];
  const results: R[] = [];
  async function worker(): Promise<void> {
    while (queue.length > 0 && mayStart()) {
      const item = queue.shift();
      if (item === undefined) return;
      results.push(await work(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { results, notStarted: queue };
}

export function summarizeDailyRun(
  plan: DailyPlan,
  outcomes: readonly PersonOutcome[],
  notStarted: readonly DailyCandidate[],
): DailySummary {
  const screened = outcomes.flatMap((outcome) => (outcome.outcome === "screened" ? [outcome] : []));
  const lostRaces = outcomes.filter((outcome) => outcome.outcome === "already_screened_today");
  const totalCostUsd = outcomes.reduce(
    (sum, outcome) => sum + ("costUsd" in outcome ? outcome.costUsd : 0),
    0,
  );
  const summary = {
    day: plan.day,
    persons: plan.toScreen.length + plan.deferred.length + plan.alreadyScreened.length,
    notMonitored: plan.notMonitored.length,
    maxScreenings: plan.maxScreenings,
    screened: screened.length,
    alreadyScreenedToday: plan.alreadyScreened.length + lostRaces.length,
    deferred: plan.deferred.length,
    notReached: notStarted.length,
    failed: outcomes.filter(
      (outcome) => outcome.outcome === "failed" || outcome.outcome === "not_saved",
    ).length,
    totalNewFindings: screened.reduce((sum, outcome) => sum + outcome.newFindings, 0),
    newFindings: screened.map(({ personId, screeningId, newFindings, risk, status }) => ({
      personId,
      screeningId,
      newFindings,
      risk,
      status,
    })),
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
  };
  return { ...summary, note: note(summary) };
}

function note(summary: Omit<DailySummary, "note">): string {
  if (summary.persons === 0) {
    return summary.notMonitored === 0
      ? "No person is recorded yet: nothing to screen."
      : `No person is monitored (${summary.notMonitored} recorded): nothing to screen.`;
  }
  if (summary.alreadyScreenedToday === summary.persons) {
    return "Every person was already screened today: nothing was run or stored again.";
  }
  const parts = [`${summary.screened} of ${summary.persons} persons screened.`];
  if (summary.alreadyScreenedToday > 0) {
    parts.push(`${summary.alreadyScreenedToday} already screened today, skipped.`);
  }
  if (summary.deferred > 0) {
    parts.push(
      `${summary.deferred} over the cap of MAX_DAILY_SCREENINGS=${summary.maxScreenings}; they come first next run.`,
    );
  }
  if (summary.notReached > 0) {
    parts.push(
      `${summary.notReached} not reached within the time budget; they come first next run.`,
    );
  }
  if (summary.failed > 0) parts.push(`${summary.failed} failed; see the server log.`);
  if (summary.notMonitored > 0) parts.push(`${summary.notMonitored} not monitored, not screened.`);
  return parts.join(" ");
}

function lastDaily(candidate: DailyCandidate): number {
  return candidate.lastDailyAt?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function compare(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
