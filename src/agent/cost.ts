import { createHmac } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  Confidence,
  CoverageErrorCode,
  RiskLevel,
  ScreeningInput,
  ScreeningResult,
  ScreeningStatus,
  TokenUsage,
} from "./types";

// USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing, read on
// 2026-09-30. Opus 5.5 is priced for the model comparison (D-09).
export const PRICES = {
  "claude-sonnet-5-5": { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  "claude-opus-5-5": { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
} as const;
export type PricedModel = keyof typeof PRICES;

// Billed per search on top of the tokens of its results; the Batches API does not discount it.
export const WEB_SEARCH_PRICE_USD = 0.01;
const TOKENS_PER_MILLION = 1_000_000;
const MICRODOLLARS_PER_DOLLAR = 1_000_000;

export const RUN_LOG_PATH = "logs/runs.jsonl";
const MIN_PSEUDONYM_KEY_LENGTH = 32;
const PSEUDONYM_LENGTH = 16;

export type RunLogEntry = {
  screenedAt: string;
  // Keyed hash of the name and country: the runs of one person can be grouped, the name is not
  // stored.
  subject: string;
  country: string;
  model: string;
  promptVersion: string;
  status: ScreeningStatus;
  risk: RiskLevel;
  confidence: Confidence;
  articlesReviewed: number;
  findings: number;
  countedFindings: number;
  errors: CoverageErrorCode[];
  usage: ScreeningResult["usage"];
  durationMs: number;
};

export function estimateCostUsd(usage: TokenUsage, model: PricedModel): number {
  const price = PRICES[model];
  const tokenCost =
    (usage.inputTokens * price.input +
      usage.cacheWrite5mTokens * price.cacheWrite5m +
      usage.cacheWrite1hTokens * price.cacheWrite1h +
      usage.cacheReadTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    TOKENS_PER_MILLION;
  const cost = tokenCost + usage.webSearches * WEB_SEARCH_PRICE_USD;
  return Math.round(cost * MICRODOLLARS_PER_DOLLAR) / MICRODOLLARS_PER_DOLLAR;
}

// Only counts, codes and figures: the summary, findings, queries and URLs all contain the name.
export function runLogEntry(
  input: ScreeningInput,
  result: ScreeningResult,
  pseudonymKey: string,
): RunLogEntry {
  return {
    screenedAt: result.screenedAt,
    subject: pseudonym(input, pseudonymKey),
    country: input.country,
    model: result.model,
    promptVersion: result.promptVersion,
    status: result.status,
    risk: result.risk,
    confidence: result.confidence,
    articlesReviewed: result.coverage.articlesReviewed,
    findings: result.findings.length,
    countedFindings: result.findings.filter((finding) => finding.countedInScore).length,
    errors: result.coverage.errors.map((error) => error.code),
    usage: result.usage,
    durationMs: result.durationMs,
  };
}

// Names are guessable: a plain hash would be reversed by hashing candidate names, a keyed hash
// cannot be without the key.
export function pseudonym(input: ScreeningInput, key: string): string {
  const subject = `${input.firstName} ${input.lastName}|${input.country}`
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
  return createHmac("sha256", key).update(subject).digest("hex").slice(0, PSEUDONYM_LENGTH);
}

export function requirePseudonymKey(value: string | undefined): string {
  if (value === undefined || value.length < MIN_PSEUDONYM_KEY_LENGTH) {
    throw new Error(
      `LOG_PSEUDONYM_KEY must hold at least ${MIN_PSEUDONYM_KEY_LENGTH} characters; generate one ` +
        `with: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return value;
}

export async function appendRunLog(entry: RunLogEntry, path = RUN_LOG_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}
