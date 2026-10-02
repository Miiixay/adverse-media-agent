import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  Category,
  Confidence,
  ScreeningResult,
  Severity,
  SourceReliability,
  Status,
  Subject,
} from "../agent/types";

// The levels of the result are stable and get Postgres enums. The classifications of a finding
// follow the agent's schema, which still changes (a status was added on 2026-10-01): they are text,
// typed in TypeScript.
export const riskLevel = pgEnum("risk_level", ["low", "medium", "high"]);
export const confidenceLevel = pgEnum("confidence_level", ["low", "medium", "high"]);
export const screeningStatus = pgEnum("screening_status", ["complete", "incomplete"]);
export const screeningKind = pgEnum("screening_kind", ["one_shot", "daily"]);

export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    country: text("country").notNull(),
    // On the watchlist: the daily run re-screens only these persons. Off by default: a person is
    // monitored only when enrolled from the watchlist or when the analyst asks for it on a screening.
    monitored: boolean("monitored").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("persons_identity").on(table.firstName, table.lastName, table.country)],
);

export const screenings = pgTable(
  "screenings",
  {
    id: uuid("id").primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    risk: riskLevel("risk").notNull(),
    confidence: confidenceLevel("confidence").notNull(),
    status: screeningStatus("status").notNull(),
    summary: text("summary"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    // Languages, queries, URLs read and rejected, errors: what the analyst needs to judge coverage.
    coverageJson: jsonb("coverage_json").$type<ScreeningResult["coverage"]>().notNull(),
    usageJson: jsonb("usage_json").$type<ScreeningResult["usage"]>().notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6, mode: "number" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    kind: screeningKind("kind").notNull().default("one_shot"),
    // When the screening ran, taken from the result.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("screenings_created_at_idx").on(table.createdAt),
    index("screenings_person_idx").on(table.personId, table.createdAt),
    // One daily screening per person and UTC day: a cron delivered twice, or called again by
    // hand, cannot store a second one, even when both calls run at the same time.
    uniqueIndex("screenings_one_daily_per_day")
      .on(table.personId, sql`((${table.createdAt} at time zone 'UTC')::date)`)
      .where(sql`${table.kind} = 'daily'`),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    screeningId: uuid("screening_id")
      .notNull()
      .references(() => screenings.id, { onDelete: "cascade" }),
    // SHA-256 of the URL: the daily run inserts only the findings whose hash is new for the person.
    urlHash: text("url_hash").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    language: text("language").notNull(),
    // As precise as the article: YYYY-MM-DD, YYYY-MM or YYYY.
    date: text("date"),
    category: text("category").$type<Category>().notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    status: text("status").$type<Status>().notNull(),
    subject: text("subject").$type<Subject>().notNull(),
    identityConfidence: text("identity_confidence").$type<Confidence>().notNull(),
    identityEvidence: jsonb("identity_evidence").$type<string[]>().notNull(),
    sourceReliability: text("source_reliability").$type<SourceReliability>().notNull(),
    // Null when the finding is not counted in the risk: a probable namesake or an associate.
    riskLevel: riskLevel("risk_level"),
    summary: text("summary").notNull(),
    corroboratingUrls: jsonb("corroborating_urls").$type<string[]>().notNull(),
    // The first screening of this person that returned this URL.
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("findings_screening_idx").on(table.screeningId),
    index("findings_url_hash_idx").on(table.urlHash),
  ],
);
