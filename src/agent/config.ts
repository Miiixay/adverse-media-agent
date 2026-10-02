import { PRICES, isPricedModel, type PricedModel } from "./cost";

// A measurement switch, not a product setting: 2 replays the v1 plan, two queries per language,
// so that v1 and v2 can be compared on the same code (v2.2 in docs/evaluation.md).
export type QueriesPerLanguage = 1 | 2;
// medium by default (D-30); high replays the v1 configuration in measurements.
export type Effort = "high" | "medium";

// Sonnet 5.5 screens (D-09). MODEL replays the fixtures on another model whose prices cost.ts holds.
export const DEFAULT_MODEL: PricedModel = "claude-sonnet-5-5";

export type Config = {
  queriesPerLanguage: QueriesPerLanguage;
  effort: Effort;
  model: PricedModel;
  escalationModel: PricedModel | null;
};

// Every switch the agent reads from the environment, validated once per screening.
export function readConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const model = parseModel(env.MODEL);
  return {
    queriesPerLanguage: parseQueriesPerLanguage(env.QUERIES_PER_LANGUAGE),
    effort: parseEffort(env.EFFORT),
    model,
    escalationModel: parseEscalationModel(env.ESCALATION_MODEL, model),
  };
}

export function parseQueriesPerLanguage(value: string | undefined): QueriesPerLanguage {
  if (value === undefined || value === "" || value === "1") return 1;
  if (value === "2") return 2;
  throw new Error(`QUERIES_PER_LANGUAGE must be 1 or 2, got "${value}"`);
}

export function parseEffort(value: string | undefined): Effort {
  if (value === undefined || value === "" || value === "medium") return "medium";
  if (value === "high") return "high";
  throw new Error(`EFFORT must be high or medium, got "${value}"`);
}

export function parseModel(value: string | undefined): PricedModel {
  if (value === undefined || value === "") return DEFAULT_MODEL;
  if (isPricedModel(value)) return value;
  throw new Error(`MODEL must be one of ${Object.keys(PRICES).join(", ")}, got "${value}"`);
}

// Off unless set (D-49): the share of screenings that would escalate was measured on adverse
// fixtures only. The model of the first screening would only repeat it.
export function parseEscalationModel(
  value: string | undefined,
  firstModel: PricedModel,
): PricedModel | null {
  if (value === undefined || value === "") return null;
  if (!isPricedModel(value)) {
    const priced = Object.keys(PRICES).join(", ");
    throw new Error(`ESCALATION_MODEL must be unset or one of ${priced}, got "${value}"`);
  }
  return value === firstModel ? null : value;
}
