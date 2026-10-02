import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { findPerson, type PersonRecord } from "@/db/persons";
import { listScreenings, type ScreeningSummary } from "@/db/screenings";

import { isPersonId } from "../api/watchlist/validation";

export const metadata: Metadata = { title: "Screening history" };

const HISTORY_LIMIT = 100;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Read at request time, never at build time.
  await connection();
  // ?person=<id> narrows the history to one person, from the watchlist.
  const { person: personParam } = await searchParams;
  const personId =
    typeof personParam === "string" && isPersonId(personParam) ? personParam : undefined;

  let rows: ScreeningSummary[];
  let person: PersonRecord | null = null;
  try {
    [rows, person] = await Promise.all([
      listScreenings(HISTORY_LIMIT, personId),
      personId === undefined ? null : findPerson(personId),
    ]);
  } catch (error) {
    console.error(`history not loaded: ${error instanceof Error ? error.name : "unknown error"}`);
    return (
      <main className="page">
        <h1>Screening history</h1>
        <p className="notice notice-error">
          The history is unavailable: the database did not answer.
        </p>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>
        {person === null
          ? "Screening history"
          : `History of ${person.firstName} ${person.lastName} (${person.country})`}
      </h1>
      <p>
        {person === null ? (
          <Link href="/watchlist">Manage the watchlist</Link>
        ) : (
          <>
            <Link href="/history">All screenings</Link> · <Link href="/watchlist">Watchlist</Link>
          </>
        )}
      </p>
      <p className="muted">
        The {HISTORY_LIMIT} most recent screenings, newest first. Daily screenings come from the
        cron and store only the findings first seen that day.
      </p>
      {rows.length === 0 ? (
        <p className="muted">No screening recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="history">
            <thead>
              <tr>
                <th>Date (UTC)</th>
                <th>Person</th>
                <th>Risk</th>
                <th>Status</th>
                <th>New findings</th>
                <th>Cost</th>
                <th>Kind</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.kind === "daily" ? "history-daily" : undefined}>
                  <td>
                    <Link href={`/history/${row.id}`}>{formatDate(row.screenedAt)}</Link>
                  </td>
                  <td>
                    {row.firstName} {row.lastName} ({row.country})
                  </td>
                  <td>
                    <span className={`badge risk-${row.risk}`}>{row.risk}</span>
                  </td>
                  <td>{row.status}</td>
                  <td className={row.newFindings > 0 ? "new-findings" : undefined}>
                    {row.newFindings}
                  </td>
                  <td>${row.costUsd.toFixed(4)}</td>
                  <td>
                    {row.kind === "daily" ? (
                      <span className="badge kind-daily">daily</span>
                    ) : (
                      "one-shot"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}
