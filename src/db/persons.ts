import "server-only";

import { asc, count, desc, eq, sql } from "drizzle-orm";

import type { RiskLevel, ScreeningInput } from "../agent/types";
import { db } from "./client";
import { findings, persons, screenings } from "./schema";

export type PersonRecord = ScreeningInput & { id: string; monitored: boolean };

export type WatchlistEntry = PersonRecord & {
  lastDaily: {
    screeningId: string;
    screenedAt: Date;
    risk: RiskLevel;
    // A daily screening stores only the findings new for the person: its findings are the new ones.
    newFindings: number;
  } | null;
};

// Puts the person on the watchlist, creating them if needed. `created` tells a new person from
// one already recorded, whose monitoring is switched back on.
export async function enrollPerson(
  input: ScreeningInput,
): Promise<{ id: string; created: boolean }> {
  const [row] = await db()
    .insert(persons)
    .values({ ...input, monitored: true })
    .onConflictDoUpdate({
      target: [persons.firstName, persons.lastName, persons.country],
      set: { monitored: true },
    })
    // xmax is 0 on a row this statement inserted, and set on a row it updated.
    .returning({ id: persons.id, created: sql<boolean>`(xmax = 0)` });
  if (row === undefined) throw new Error("the person upsert returned no row");
  return row;
}

// Null when no person has this id.
export async function setMonitored(id: string, monitored: boolean): Promise<PersonRecord | null> {
  const [row] = await db().update(persons).set({ monitored }).where(eq(persons.id, id)).returning({
    id: persons.id,
    firstName: persons.firstName,
    lastName: persons.lastName,
    country: persons.country,
    monitored: persons.monitored,
  });
  return row ?? null;
}

export async function findPerson(id: string): Promise<PersonRecord | null> {
  const [row] = await db()
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      country: persons.country,
      monitored: persons.monitored,
    })
    .from(persons)
    .where(eq(persons.id, id));
  return row ?? null;
}

export async function listWatchlist(): Promise<WatchlistEntry[]> {
  const database = db();
  const people = await database
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      country: persons.country,
      monitored: persons.monitored,
    })
    .from(persons)
    .orderBy(asc(persons.lastName), asc(persons.firstName), asc(persons.country));
  // The latest daily screening of each person, with the number of findings it stored.
  const latest = await database
    .selectDistinctOn([screenings.personId], {
      personId: screenings.personId,
      screeningId: screenings.id,
      screenedAt: screenings.createdAt,
      risk: screenings.risk,
      newFindings: count(findings.id),
    })
    .from(screenings)
    .leftJoin(findings, eq(findings.screeningId, screenings.id))
    .where(eq(screenings.kind, "daily"))
    .groupBy(screenings.id)
    .orderBy(screenings.personId, desc(screenings.createdAt));

  const latestByPerson = new Map(latest.map(({ personId, ...daily }) => [personId, daily]));
  return people.map((person) => ({ ...person, lastDaily: latestByPerson.get(person.id) ?? null }));
}
