import { aliasInput, aliasToSearch } from "./alias";
import { addCostsUsd, addUsage, type PricedModel } from "./cost";
import type { CoverageErrorCode, EscalationSignal, ScreeningInput, ScreeningResult } from "./types";

// After these a second screening must not run, or cannot help: a compromised answer read an
// injection the second would read again (D-36), a refusal is not handed to another model (D-21),
// and a timeout leaves no time.
const FATAL_ERRORS: ReadonlySet<CoverageErrorCode> = new Set(["compromised", "refusal", "timeout"]);

type Screened = Pick<ScreeningResult, "status" | "findings"> & {
  coverage: Pick<ScreeningResult["coverage"], "errors" | "aliases" | "executedQueries">;
};

export function escalationSignals(screened: Screened, input: ScreeningInput): EscalationSignal[] {
  const { errors, aliases, executedQueries } = screened.coverage;
  if (errors.some((error) => FATAL_ERRORS.has(error.code))) return [];
  const alias = aliasToSearch(aliases, executedQueries, input);
  const signals: [EscalationSignal, boolean][] = [
    ["counted_finding", screened.findings.some((finding) => finding.countedInScore)],
    // The alias D-42 would search: one the queries did not cover, valid as a typed name.
    ["alias", alias !== null && aliasInput(alias, input) !== null],
    ["unsourced_summary", errors.some((error) => error.code === "unsourced_summary")],
    ["incomplete", screened.status === "incomplete"],
  ];
  return signals.flatMap(([signal, present]) => (present ? [signal] : []));
}

// The escalated screening replaces the first, which is paid all the same: tokens, cost and calls
// add up, each screening priced at its own model. The signals kept are those that escalated.
export function mergeEscalation(
  first: ScreeningResult,
  escalated: ScreeningResult,
  model: PricedModel,
): ScreeningResult {
  return {
    ...escalated,
    coverage: {
      ...escalated.coverage,
      escalatedTo: model,
      escalationSignals: first.coverage.escalationSignals,
    },
    usage: {
      ...addUsage(first.usage, escalated.usage),
      estimatedCostUsd: addCostsUsd(first.usage.estimatedCostUsd, escalated.usage.estimatedCostUsd),
      apiCalls: first.usage.apiCalls + escalated.usage.apiCalls,
    },
  };
}
