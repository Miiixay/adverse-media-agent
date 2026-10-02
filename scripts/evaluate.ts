import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import testCases from "../fixtures/test-cases.json";
import {
  appendRunLog,
  requirePseudonymKey,
  runLogEntry,
  screenIndividual,
  screeningInputSchema,
  type ScreeningResult,
} from "../src/agent";

type TestCase = (typeof testCases)[number];
type CaseRun = { testCase: TestCase } & ({ result: ScreeningResult } | { error: unknown });
type Expectation = {
  risk: string;
  countedFindings?: number;
  minCountedFindings?: number;
  minLowIdentityFindings?: number;
  // At least one counted finding must carry these values.
  countedFindingWith?: { language?: string; status?: string };
};

const RESULTS_DIRECTORY = "logs/evaluation";
const COLUMNS = [
  "case",
  "expected",
  "risk",
  "pass",
  "status",
  "confidence",
  "counted / findings",
  "searches",
  "articles",
  "input tokens",
  "cache read",
  "cache write",
  "output tokens",
  "cost USD",
  "duration s",
  "errors",
];

async function main(): Promise<void> {
  const pseudonymKey = requirePseudonymKey(process.env.LOG_PSEUDONYM_KEY);
  const [first, ...others] = selectCases(process.argv.slice(2));
  if (first === undefined) {
    throw new Error("fixtures/test-cases.json holds no case");
  }

  // The first case runs alone: a prompt cache entry becomes readable only once a response has
  // started, so the cases after it can read the entry it writes.
  const firstRun = await runCase(first, pseudonymKey);
  const otherRuns = await Promise.all(others.map((testCase) => runCase(testCase, pseudonymKey)));
  const runs = [firstRun, ...otherRuns];

  console.log(table(runs));
  console.log(totals(runs));
  if (!runs.every(passed)) process.exitCode = 1;
}

// Case ids on the command line narrow the run: npm run evaluate -- homonym
function selectCases(ids: readonly string[]): TestCase[] {
  if (ids.length === 0) return testCases;
  const unknown = ids.filter((id) => !testCases.some((testCase) => testCase.id === id));
  if (unknown.length > 0) {
    throw new Error(`Unknown case id: ${unknown.join(", ")}`);
  }
  return testCases.filter((testCase) => ids.includes(testCase.id));
}

// A failed case is reported in the table and in the exit code, without stopping the others.
async function runCase(testCase: TestCase, pseudonymKey: string): Promise<CaseRun> {
  try {
    const input = screeningInputSchema.parse(testCase.input);
    const result = await screenIndividual(input);
    await appendRunLog(runLogEntry(input, result, pseudonymKey));
    await saveResult(testCase.id, result);
    return { testCase, result };
  } catch (error) {
    return { testCase, error };
  }
}

// The full result, names included: the fixed cases are test data and logs/ stays out of git.
async function saveResult(id: string, result: ScreeningResult): Promise<void> {
  await mkdir(RESULTS_DIRECTORY, { recursive: true });
  const path = join(RESULTS_DIRECTORY, `${id}.json`);
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function passed(run: CaseRun): boolean {
  if (!("result" in run)) return false;
  const expected: Expectation = run.testCase.expected;
  const counted = run.result.findings.filter((finding) => finding.countedInScore);
  const lowIdentity = run.result.findings.length - counted.length;
  const wanted = expected.countedFindingWith;
  return (
    run.result.risk === expected.risk &&
    (expected.countedFindings === undefined || counted.length === expected.countedFindings) &&
    (expected.minCountedFindings === undefined || counted.length >= expected.minCountedFindings) &&
    (expected.minLowIdentityFindings === undefined ||
      lowIdentity >= expected.minLowIdentityFindings) &&
    (wanted === undefined ||
      counted.some(
        (finding) =>
          (wanted.language === undefined || finding.language === wanted.language) &&
          (wanted.status === undefined || finding.status === wanted.status),
      ))
  );
}

function countedFindings(result: ScreeningResult): number {
  return result.findings.filter((finding) => finding.countedInScore).length;
}

function table(runs: readonly CaseRun[]): string {
  const rows = runs.map((run) => {
    const { id, expected } = run.testCase;
    if (!("result" in run)) {
      const message = run.error instanceof Error ? run.error.message : String(run.error);
      const failed = [id, expected.risk, "failed", "no"];
      return [...failed, ...Array(COLUMNS.length - failed.length - 1).fill(""), message];
    }
    const { result } = run;
    return [
      id,
      expected.risk,
      result.risk,
      passed(run) ? "yes" : "no",
      result.status,
      result.confidence,
      `${countedFindings(result)} / ${result.findings.length}`,
      String(result.usage.webSearches),
      String(result.coverage.articlesReviewed),
      String(result.usage.inputTokens),
      String(result.usage.cacheReadTokens),
      String(result.usage.cacheWrite5mTokens + result.usage.cacheWrite1hTokens),
      String(result.usage.outputTokens),
      result.usage.estimatedCostUsd.toFixed(4),
      (result.durationMs / 1000).toFixed(1),
      result.coverage.errors.map((error) => error.code).join(", ") || "none",
    ];
  });
  return [COLUMNS, COLUMNS.map(() => "---"), ...rows]
    .map((cells) => `| ${cells.map((cell) => cell.replace(/[|\r\n]+/g, " ")).join(" | ")} |`)
    .join("\n");
}

function totals(runs: readonly CaseRun[]): string {
  const costs = runs.flatMap((run) => ("result" in run ? [run.result.usage.estimatedCostUsd] : []));
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  const mean = costs.length > 0 ? total / costs.length : 0;
  const passedCount = runs.filter(passed).length;
  return (
    `\n${passedCount}/${runs.length} cases pass. ` +
    `Total cost $${total.toFixed(4)}, mean $${mean.toFixed(4)} per answered case.`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
