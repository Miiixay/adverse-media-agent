import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { listWatchlist, type WatchlistEntry } from "@/db/persons";

import { COUNTRIES } from "../countries";
import { EnrollForm } from "./enroll-form";
import { MonitorToggle } from "./monitor-toggle";

export const metadata: Metadata = { title: "Watchlist" };

export default async function WatchlistPage() {
  // Read at request time, never at build time.
  await connection();

  let entries: WatchlistEntry[];
  try {
    entries = await listWatchlist();
  } catch (error) {
    console.error(`watchlist not loaded: ${error instanceof Error ? error.name : "unknown error"}`);
    return (
      <main className="page">
        <h1>Watchlist</h1>
        <p className="notice notice-error">
          The watchlist is unavailable: the database did not answer.
        </p>
      </main>
    );
  }
  const monitored = entries.filter((entry) => entry.monitored).length;

  return (
    <main className="page">
      <h1>Watchlist</h1>
      <p className="muted">
        The daily run screens every monitored person once a day and stores only the findings new for
        them. {monitored} of {entries.length} persons are monitored.
      </p>
      <EnrollForm countries={COUNTRIES} />

      {entries.length === 0 ? (
        <p className="muted">No person recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="history">
            <thead>
              <tr>
                <th>Person</th>
                <th>Country</th>
                <th>Monitoring</th>
                <th>Last daily screening (UTC)</th>
                <th>Risk</th>
                <th>New findings</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className={entry.monitored ? undefined : "suspended"}>
                  <td>
                    <Link href={`/history?person=${entry.id}`}>
                      {entry.firstName} {entry.lastName}
                    </Link>
                  </td>
                  <td>{entry.country}</td>
                  <td>{entry.monitored ? "on" : "off"}</td>
                  {entry.lastDaily === null ? (
                    <td colSpan={3} className="muted">
                      not screened by a daily run yet
                    </td>
                  ) : (
                    <>
                      <td>
                        <Link href={`/history/${entry.lastDaily.screeningId}`}>
                          {entry.lastDaily.screenedAt.toISOString().slice(0, 16).replace("T", " ")}
                        </Link>
                      </td>
                      <td>
                        <span className={`badge risk-${entry.lastDaily.risk}`}>
                          {entry.lastDaily.risk}
                        </span>
                      </td>
                      <td className={entry.lastDaily.newFindings > 0 ? "new-findings" : undefined}>
                        {entry.lastDaily.newFindings}
                      </td>
                    </>
                  )}
                  <td>
                    <MonitorToggle personId={entry.id} monitored={entry.monitored} />
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
