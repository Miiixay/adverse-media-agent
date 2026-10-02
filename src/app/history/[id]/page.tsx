import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { loadScreening } from "@/db/screenings";

import { ScreeningReport } from "../../screening-report";

export const metadata: Metadata = { title: "Recorded screening" };

const screeningId = z.uuid();

export default async function RecordedScreeningPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!screeningId.safeParse(id).success) notFound();

  const stored = await loadScreening(id);
  if (stored === null) notFound();
  const { person, kind, result } = stored;

  return (
    <main className="page">
      <p>
        <Link href="/history">Back to the history</Link>
      </p>
      <h1>
        {person.firstName} {person.lastName} ({person.country})
      </h1>
      <p className="muted">
        {kind === "daily" ? "Daily" : "One-shot"} screening of{" "}
        {result.screenedAt.slice(0, 16).replace("T", " ")} UTC.
      </p>
      {kind === "daily" && (
        <p className="notice">
          A daily screening stores only the findings whose URL was new for this person that day. The
          risk and the coverage were computed on every finding the run returned.
        </p>
      )}
      <ScreeningReport result={result} />
    </main>
  );
}
