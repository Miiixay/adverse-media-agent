import { describe, expect, it } from "vitest";

import type { DailyCandidate } from "@/db/screenings";

import {
  parseMaxDailyScreenings,
  planDailyRun,
  runWithinBudget,
  summarizeDailyRun,
  utcDay,
  type PersonOutcome,
} from "../plan";

const NOW = new Date("2026-10-02T05:20:00Z");

function candidate(
  id: string,
  lastDailyAt: string | null,
  createdAt = "2026-10-01T10:00:00Z",
  monitored = true,
): DailyCandidate {
  return {
    id,
    input: { firstName: "Jean", lastName: id, country: "FR" },
    monitored,
    createdAt: new Date(createdAt),
    lastDailyAt: lastDailyAt === null ? null : new Date(lastDailyAt),
  };
}

describe("utcDay", () => {
  it("takes the UTC calendar day, whatever the local time zone", () => {
    expect(utcDay(new Date("2026-10-01T23:30:00-02:00"))).toBe("2026-10-02");
  });
});

describe("planDailyRun", () => {
  it("skips the persons already screened by a daily run today", () => {
    const plan = planDailyRun(
      [candidate("today", "2026-10-02T00:10:00Z"), candidate("yesterday", "2026-10-01T05:30:00Z")],
      NOW,
    );

    expect(plan.day).toBe("2026-10-02");
    expect(plan.toScreen.map((item) => item.id)).toEqual(["yesterday"]);
    expect(plan.alreadyScreened.map((item) => item.id)).toEqual(["today"]);
  });

  it("puts never screened persons first, then the oldest daily screening, then the oldest record", () => {
    const plan = planDailyRun(
      [
        candidate("recent", "2026-10-01T05:30:00Z"),
        candidate("new-later", null, "2026-10-01T12:00:00Z"),
        candidate("old", "2026-09-28T05:30:00Z"),
        candidate("new-earlier", null, "2026-09-30T12:00:00Z"),
      ],
      NOW,
    );

    expect(plan.toScreen.map((item) => item.id)).toEqual([
      "new-earlier",
      "new-later",
      "old",
      "recent",
    ]);
  });
});

describe("watchlist selection", () => {
  it("screens monitored persons only and counts the others apart", () => {
    const plan = planDailyRun(
      [
        candidate("watched", null),
        candidate("suspended", null, "2026-09-01T10:00:00Z", false),
        candidate("suspended-today", "2026-10-02T00:10:00Z", "2026-09-01T10:00:00Z", false),
      ],
      NOW,
    );

    expect(plan.toScreen.map((item) => item.id)).toEqual(["watched"]);
    expect(plan.alreadyScreened).toEqual([]);
    expect(plan.notMonitored.map((item) => item.id)).toEqual(["suspended", "suspended-today"]);
    expect(summarizeDailyRun(plan, [], plan.toScreen)).toMatchObject({
      persons: 1,
      notMonitored: 2,
    });
  });

  it("says when nobody is monitored", () => {
    const plan = planDailyRun([candidate("suspended", null, "2026-09-01T10:00:00Z", false)], NOW);

    expect(plan.toScreen).toEqual([]);
    expect(summarizeDailyRun(plan, [], []).note).toBe(
      "No person is monitored (1 recorded): nothing to screen.",
    );
  });
});

describe("runWithinBudget", () => {
  it("never runs more than the given number of items at once", async () => {
    let running = 0;
    let peak = 0;
    const { results } = await runWithinBudget(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      () => true,
      async (item) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return item * 10;
      },
    );

    expect(peak).toBe(3);
    expect(results.toSorted((a, b) => a - b)).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it("stops starting items once the budget is spent and returns the others in order", async () => {
    let starts = 0;
    const { results, notStarted } = await runWithinBudget(
      ["a", "b", "c", "d", "e"],
      2,
      () => starts < 3,
      async (item) => {
        starts += 1;
        return item;
      },
    );

    expect(results).toHaveLength(3);
    expect(notStarted).toEqual(["d", "e"]);
  });
});

describe("summarizeDailyRun", () => {
  const screened = (personId: string, newFindings: number, costUsd: number): PersonOutcome => ({
    personId,
    outcome: "screened",
    screeningId: `screening-${personId}`,
    risk: "high",
    status: "complete",
    newFindings,
    costUsd,
  });

  it("counts the persons, the new findings per person and the total cost", () => {
    const plan = planDailyRun(
      [candidate("a", null), candidate("b", null), candidate("c", "2026-10-02T00:10:00Z")],
      NOW,
    );
    const summary = summarizeDailyRun(
      plan,
      [screened("a", 2, 0.06), { personId: "b", outcome: "failed", error: "APIError" }],
      [],
    );

    expect(summary).toMatchObject({
      day: "2026-10-02",
      persons: 3,
      screened: 1,
      alreadyScreenedToday: 1,
      notReached: 0,
      failed: 1,
      totalNewFindings: 2,
      newFindings: [
        {
          personId: "a",
          screeningId: "screening-a",
          newFindings: 2,
          risk: "high",
          status: "complete",
        },
      ],
      totalCostUsd: 0.06,
    });
  });

  it("says so when a second call the same day finds every person already screened", () => {
    const plan = planDailyRun(
      [candidate("a", "2026-10-02T05:01:00Z"), candidate("b", "2026-10-02T05:02:00Z")],
      NOW,
    );
    const summary = summarizeDailyRun(plan, [], []);

    expect(summary).toMatchObject({ screened: 0, alreadyScreenedToday: 2, totalCostUsd: 0 });
    expect(summary.note).toBe(
      "Every person was already screened today: nothing was run or stored again.",
    );
  });

  it("counts a run that lost the race to store the day's screening as already screened", () => {
    const plan = planDailyRun([candidate("a", null)], NOW);
    const summary = summarizeDailyRun(
      plan,
      [{ personId: "a", outcome: "already_screened_today", costUsd: 0.05 }],
      [],
    );

    expect(summary).toMatchObject({ screened: 0, alreadyScreenedToday: 1, totalCostUsd: 0.05 });
  });

  it("reports the persons left for the next run", () => {
    const plan = planDailyRun([candidate("a", null), candidate("b", null)], NOW);
    const summary = summarizeDailyRun(plan, [screened("a", 0, 0.05)], plan.toScreen.slice(1));

    expect(summary.notReached).toBe(1);
    expect(summary.note).toContain("1 not reached within the time budget");
  });
});

describe("MAX_DAILY_SCREENINGS", () => {
  it("reads 20 by default and refuses anything but a positive integer", () => {
    expect(parseMaxDailyScreenings(undefined)).toBe(20);
    expect(parseMaxDailyScreenings("")).toBe(20);
    expect(parseMaxDailyScreenings("5")).toBe(5);
    for (const value of ["0", "-1", "2.5", "twenty"]) {
      expect(() => parseMaxDailyScreenings(value)).toThrow(/MAX_DAILY_SCREENINGS/);
    }
  });

  it("screens the first persons in order up to the cap and defers the others", () => {
    const plan = planDailyRun(
      [
        candidate("recent", "2026-10-01T05:10:00Z"),
        candidate("never", null),
        candidate("older", "2026-09-30T05:10:00Z"),
      ],
      NOW,
      2,
    );

    expect(plan.toScreen.map((person) => person.id)).toEqual(["never", "older"]);
    expect(plan.deferred.map((person) => person.id)).toEqual(["recent"]);
  });

  it("gives the cap and the deferred persons in the summary", () => {
    const plan = planDailyRun([candidate("a", null), candidate("b", null)], NOW, 1);
    const outcome: PersonOutcome = {
      personId: "a",
      outcome: "screened",
      screeningId: "screening-a",
      risk: "low",
      status: "complete",
      newFindings: 0,
      costUsd: 0.05,
    };
    const summary = summarizeDailyRun(plan, [outcome], []);

    expect(summary).toMatchObject({ persons: 2, maxScreenings: 1, screened: 1, deferred: 1 });
    expect(summary.note).toContain("1 over the cap of MAX_DAILY_SCREENINGS=1");
  });
});
