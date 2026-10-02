import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, min, sql } from "drizzle-orm";

import type { ScreeningInput, ScreeningResult } from "../agent/types";
import { db } from "./client";
import {
  countNewFindings,
  findingsToStore,
  resultFromRows,
  screeningRows,
  urlHash,
  type ScreeningKind,
} from "./mapping";
import { findings, persons, screenings } from "./schema";

export type ScreeningSummary = {
  id: string;
  screenedAt: Date;
  firstName: string;
  lastName: string;
  country: string;
  risk: ScreeningResult["risk"];
  status: ScreeningResult["status"];
  costUsd: number;
  kind: ScreeningKind;
  // Findings whose URL this screening was the first to return for the person.
  newFindings: number;
};

export type StoredScreening = {
  person: ScreeningInput;
  kind: ScreeningKind;
  result: ScreeningResult;
};

export type SavedScreening = { screeningId: string; newFindings: number };

export type DailyCandidate = {
  id: string;
  input: ScreeningInput;
  monitored: boolean;
  createdAt: Date;
  lastDailyAt: Date | null;
};

// Three requests: the person, the earlier sightings of the URLs, then the screening and its
// findings in one batch, which Neon runs as a single transaction.
export async function saveScreening(
  input: ScreeningInput,
  result: ScreeningResult,
  kind: ScreeningKind,
): Promise<SavedScreening> {
  const database = db();
  const [person] = await database
    .insert(persons)
    .values(input)
    .onConflictDoUpdate({
      target: [persons.firstName, persons.lastName, persons.country],
      // A no-op update, so that RETURNING gives the id of an existing person too.
      set: { firstName: input.firstName },
    })
    .returning({ id: persons.id });
  if (person === undefined) throw new Error("the person upsert returned no row");

  const hashes = result.findings.map((finding) => urlHash(finding.url));
  const sightings =
    hashes.length === 0
      ? []
      : await database
          .select({ urlHash: findings.urlHash, firstSeenAt: min(findings.firstSeenAt) })
          .from(findings)
          .innerJoin(screenings, eq(findings.screeningId, screenings.id))
          .where(and(eq(screenings.personId, person.id), inArray(findings.urlHash, hashes)))
          .groupBy(findings.urlHash);
  const firstSeen = new Map<string, Date>();
  for (const sighting of sightings) {
    if (sighting.firstSeenAt !== null) firstSeen.set(sighting.urlHash, sighting.firstSeenAt);
  }

  const screeningId = randomUUID();
  const rows = screeningRows(result, { screeningId, personId: person.id }, kind, firstSeen);
  const known = new Set(firstSeen.keys());
  const stored = findingsToStore(rows.findings, kind, known);
  const insertScreening = database.insert(screenings).values(rows.screening);
  if (stored.length === 0) {
    await insertScreening;
  } else {
    await database.batch([insertScreening, database.insert(findings).values(stored)]);
  }
  return { screeningId, newFindings: countNewFindings(rows.findings, known) };
}

// Every person, monitored or not, with the time of their latest daily screening, if any: the
// selection is planDailyRun's, tested without a database.
export async function listDailyCandidates(): Promise<DailyCandidate[]> {
  const rows = await db()
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      country: persons.country,
      monitored: persons.monitored,
      createdAt: persons.createdAt,
      lastDailyAt:
        sql<Date | null>`max(${screenings.createdAt}) filter (where ${screenings.kind} = 'daily')`.mapWith(
          screenings.createdAt,
        ),
    })
    .from(persons)
    .leftJoin(screenings, eq(screenings.personId, persons.id))
    .groupBy(persons.id);
  return rows.map((row) => ({
    id: row.id,
    input: { firstName: row.firstName, lastName: row.lastName, country: row.country },
    monitored: row.monitored,
    createdAt: row.createdAt,
    lastDailyAt: row.lastDailyAt,
  }));
}

// The most recent screenings, of every person or of one.
export async function listScreenings(
  limit: number,
  personId?: string,
): Promise<ScreeningSummary[]> {
  return db()
    .select({
      id: screenings.id,
      screenedAt: screenings.createdAt,
      firstName: persons.firstName,
      lastName: persons.lastName,
      country: persons.country,
      risk: screenings.risk,
      status: screenings.status,
      costUsd: screenings.costUsd,
      kind: screenings.kind,
      newFindings:
        sql<number>`count(${findings.id}) filter (where ${findings.firstSeenAt} = ${screenings.createdAt})`.mapWith(
          Number,
        ),
    })
    .from(screenings)
    .innerJoin(persons, eq(screenings.personId, persons.id))
    .leftJoin(findings, eq(findings.screeningId, screenings.id))
    .where(personId === undefined ? undefined : eq(screenings.personId, personId))
    .groupBy(screenings.id, persons.id)
    .orderBy(desc(screenings.createdAt))
    .limit(limit);
}

export async function loadScreening(id: string): Promise<StoredScreening | null> {
  const database = db();
  const [row] = await database
    .select({ screening: screenings, person: persons })
    .from(screenings)
    .innerJoin(persons, eq(screenings.personId, persons.id))
    .where(eq(screenings.id, id));
  if (row === undefined) return null;
  const findingRows = await database.select().from(findings).where(eq(findings.screeningId, id));
  return {
    person: {
      firstName: row.person.firstName,
      lastName: row.person.lastName,
      country: row.person.country,
    },
    kind: row.screening.kind,
    result: resultFromRows(row.screening, findingRows),
  };
}
