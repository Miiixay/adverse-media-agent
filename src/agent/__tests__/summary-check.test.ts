import { describe, expect, it } from "vitest";

import { isCoverageComplete } from "../score";
import { unsourcedSummaryError } from "../summary-check";

describe("unsourcedSummaryError", () => {
  it("names the years the summary cites that no finding is dated in", () => {
    const summary =
      "Convicted on appeal in 2017. Later convicted in 2024 for his insolvency, reduced on appeal in 2025, and again in 2026.";

    expect(unsourcedSummaryError(summary, [{ date: "2017" }, { date: "2026-04-09" }])).toEqual({
      code: "unsourced_summary",
      detail: "the summary mentions years without a dated finding: 2024, 2025",
    });
  });

  it("returns nothing when every year cited has a dated finding, or without a summary", () => {
    expect(unsourcedSummaryError("Convicted in March 2009.", [{ date: "2009-03-12" }])).toBeNull();
    expect(unsourcedSummaryError(null, [])).toBeNull();
  });

  it("reads only four-digit years of the last two centuries, once each", () => {
    const summary = "A fine of 12345 euros in 1850, 2019 and again 2019.";

    expect(unsourcedSummaryError(summary, [])?.detail).toBe(
      "the summary mentions years without a dated finding: 2019",
    );
  });

  it("does not make the coverage incomplete", () => {
    const warning = unsourcedSummaryError("Convicted in 2024.", []);
    const planned = ['"Jean Martin" fraude'];

    expect(isCoverageComplete(planned, planned, warning === null ? [] : [warning])).toBe(true);
  });
});
