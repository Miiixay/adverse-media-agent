import type { AssessedFinding, CoverageError } from "./types";

const YEAR = /\b(?:19|20)\d{2}\b/g;

// A year the summary cites but no finding is dated in points to a matter left without a finding,
// which the prompt forbids and the model sometimes does. A warning for the analyst, not a gap in
// the coverage: the status stays as it is.
export function unsourcedSummaryError(
  summary: string | null,
  findings: readonly Pick<AssessedFinding, "date">[],
): CoverageError | null {
  if (summary === null) return null;
  const dated = new Set(findings.flatMap((finding) => finding.date?.slice(0, 4) ?? []));
  const unsourced = [...new Set(summary.match(YEAR) ?? [])].filter((year) => !dated.has(year));
  if (unsourced.length === 0) return null;
  return {
    code: "unsourced_summary",
    detail: `the summary mentions years without a dated finding: ${unsourced.toSorted().join(", ")}`,
  };
}
