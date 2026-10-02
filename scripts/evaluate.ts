import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import {
  appendRunLog,
  requirePseudonymKey,
  runLogEntry,
  screenIndividual,
  screeningInputSchema,
  type ScreeningResult,
} from "../src/agent";

const FIXED_CASES = "fixtures/test-cases.json";
const EXTENDED_CASES = "fixtures/extended-cases.json";
const RESULTS_DIRECTORY = "logs/evaluation";
// The search call does not retry, so a burst of parallel requests that hit the rate limit would
// fail cases instead of slowing them down.
const CONCURRENT_CASES = 4;

const RISK_LEVELS = ["low", "medium", "high"] as const;
const MATCHED_FIELDS = ["language", "status", "subject", "category", "identityConfidence"] as const;

// One accepted value, or several when the model may report the matter either way.
const acceptedValues = z.union([z.string(), z.array(z.string()).min(1)]).optional();

const findingMatchSchema = z
  .object({
    language: acceptedValues,
    status: acceptedValues,
    subject: acceptedValues,
    category: acceptedValues,
    identityConfidence: acceptedValues,
    // A word the title or the summary must contain, in any case: the matter, not just any finding.
    mentions: z.string().optional(),
  })
  .strict();

const expectationSchema = z
  .object({
    // One level, or the levels the grid can give when a modulator may or may not hold.
    risk: z.union([z.enum(RISK_LEVELS), z.array(z.enum(RISK_LEVELS)).min(1)]),
    countedFindings: z.number().int().optional(),
    minCountedFindings: z.number().int().optional(),
    // Counted or not.
    minFindings: z.number().int().optional(),
    minLowIdentityFindings: z.number().int().optional(),
    minArticlesReviewed: z.number().int().optional(),
    // At least one counted finding must carry these values.
    countedFindingWith: findingMatchSchema.optional(),
    // At least one finding, counted or not, must carry these values.
    findingWith: findingMatchSchema.optional(),
    // At least `count` counted findings must carry these values.
    minCountedFindingsWith: z
      .object({ count: z.number().int().min(1), match: findingMatchSchema })
      .strict()
      .optional(),
  })
  .strict();

const testCaseSchema = z
  .object({
    id: z.string(),
    input: z.object({ firstName: z.string(), lastName: z.string(), country: z.string() }),
    expected: expectationSchema,
    rationale: z.string(),
    sources: z.array(z.string()).optional(),
  })
  .strict();

type TestCase = z.infer<typeof testCaseSchema>;
type FindingMatch = z.infer<typeof findingMatchSchema>;
type Finding = ScreeningResult["findings"][number];
type CaseRun = { testCase: TestCase } & ({ result: ScreeningResult } | { error: unknown });

const COLUMNS = [
  "case",
  "expected",
  "risk",
  "pass",
  "status",
  "confidence",
  "counted / findings",
  "levels",
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

// npm run evaluate -- [--extended] [case ids]
async function main(): Promise<void> {
  const pseudonymKey = requirePseudonymKey(process.env.LOG_PSEUDONYM_KEY);
  const args = process.argv.slice(2);
  const path = args.includes("--extended") ? EXTENDED_CASES : FIXED_CASES;
  const cases = selectCases(
    await loadCases(path),
    args.filter((arg) => arg !== "--extended"),
  );
  const [first, ...others] = cases;
  if (first === undefined) {
    throw new Error(`${path} holds no case`);
  }

  // The first case runs alone: a prompt cache entry becomes readable only once a response has
  // started, so the cases after it can read the entry it writes.
  const runs = [await runCase(first, pseudonymKey)];
  for (let start = 0; start < others.length; start += CONCURRENT_CASES) {
    const batch = others.slice(start, start + CONCURRENT_CASES);
    runs.push(...(await Promise.all(batch.map((testCase) => runCase(testCase, pseudonymKey)))));
  }

  console.log(table(runs));
  console.log(totals(runs));
  if (!runs.every(passed)) process.exitCode = 1;
}

async function loadCases(path: string): Promise<TestCase[]> {
  const json: unknown = JSON.parse(await readFile(path, "utf8"));
  return z.array(testCaseSchema).parse(json);
}

// Case ids on the command line narrow the run: npm run evaluate -- homonym
function selectCases(cases: readonly TestCase[], ids: readonly string[]): TestCase[] {
  if (ids.length === 0) return [...cases];
  const unknown = ids.filter((id) => !cases.some((testCase) => testCase.id === id));
  if (unknown.length > 0) {
    throw new Error(`Unknown case id: ${unknown.join(", ")}`);
  }
  return cases.filter((testCase) => ids.includes(testCase.id));
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

// The full result, names included: the cases are test data and logs/ stays out of git.
async function saveResult(id: string, result: ScreeningResult): Promise<void> {
  await mkdir(RESULTS_DIRECTORY, { recursive: true });
  const path = join(RESULTS_DIRECTORY, `${id}.json`);
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function passed(run: CaseRun): boolean {
  if (!("result" in run)) return false;
  const { expected } = run.testCase;
  const { findings, coverage, risk } = run.result;
  const counted = findings.filter((finding) => finding.countedInScore);
  const lowIdentity = findings.filter((finding) => finding.identityConfidence === "low");
  return (
    expectedRisks(run.testCase).includes(risk) &&
    (expected.countedFindings === undefined || counted.length === expected.countedFindings) &&
    (expected.minCountedFindings === undefined || counted.length >= expected.minCountedFindings) &&
    (expected.minFindings === undefined || findings.length >= expected.minFindings) &&
    (expected.minLowIdentityFindings === undefined ||
      lowIdentity.length >= expected.minLowIdentityFindings) &&
    (expected.minArticlesReviewed === undefined ||
      coverage.articlesReviewed >= expected.minArticlesReviewed) &&
    (expected.countedFindingWith === undefined ||
      counted.some((finding) => matches(finding, expected.countedFindingWith ?? {}))) &&
    (expected.findingWith === undefined ||
      findings.some((finding) => matches(finding, expected.findingWith ?? {}))) &&
    (expected.minCountedFindingsWith === undefined ||
      counted.filter((finding) => matches(finding, expected.minCountedFindingsWith?.match ?? {}))
        .length >= expected.minCountedFindingsWith.count)
  );
}

function expectedRisks(testCase: TestCase): readonly string[] {
  const { risk } = testCase.expected;
  return typeof risk === "string" ? [risk] : risk;
}

function matches(finding: Finding, wanted: FindingMatch): boolean {
  const fieldsMatch = MATCHED_FIELDS.every((field) => {
    const accepted = wanted[field];
    if (accepted === undefined) return true;
    return typeof accepted === "string"
      ? finding[field] === accepted
      : accepted.includes(finding[field]);
  });
  const text = `${finding.title} ${finding.summary}`.toLowerCase();
  return (
    fieldsMatch && (wanted.mentions === undefined || text.includes(wanted.mentions.toLowerCase()))
  );
}

function countedFindings(result: ScreeningResult): number {
  return result.findings.filter((finding) => finding.countedInScore).length;
}

function table(runs: readonly CaseRun[]): string {
  const rows = runs.map((run) => {
    const { id } = run.testCase;
    const expected = expectedRisks(run.testCase).join(" or ");
    if (!("result" in run)) {
      const message = run.error instanceof Error ? run.error.message : String(run.error);
      const failed = [id, expected, "failed", "no"];
      return [...failed, ...Array(COLUMNS.length - failed.length - 1).fill(""), message];
    }
    const { result } = run;
    return [
      id,
      expected,
      result.risk,
      passed(run) ? "yes" : "no",
      result.status,
      result.confidence,
      `${countedFindings(result)} / ${result.findings.length}`,
      result.findings.flatMap((finding) => finding.riskLevel ?? []).join(", ") || "none",
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
