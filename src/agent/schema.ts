import { z } from "zod";

import { CATEGORIES, CONFIDENCE_LEVELS, SEVERITIES, SOURCE_RELIABILITIES, STATUSES } from "./types";

// A full date, or the year and month, or the year, as far as the article gives it.
const DATE_PATTERN = "^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$";

// Structured outputs do not support maxItems, so the grammar enforces neither limit: the prompt
// asks for both, and search.ts cuts the corroborating URLs after filtering them (D-22).
export const MAX_FINDINGS = 8;
export const MAX_CORROBORATING_URLS = 3;

// Sent as is in output_config.format. The SDK helpers would fold the enums into descriptions and
// the grammar would stop constraining them (D-18).
export const ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: {
      type: "string",
      description: "Two or three factual sentences on the overall picture.",
    },
    findings: {
      type: "array",
      description: `At most ${MAX_FINDINGS} findings, one per matter.`,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "url",
          "corroboratingUrls",
          "language",
          "date",
          "category",
          "severity",
          "status",
          "identityConfidence",
          "identityEvidence",
          "sourceReliability",
          "summary",
        ],
        properties: {
          url: { type: "string", description: "Copied exactly from a web search result." },
          corroboratingUrls: {
            type: "array",
            items: { type: "string" },
            description: `Up to ${MAX_CORROBORATING_URLS} other search results, from other publications, reporting the same facts.`,
          },
          language: { type: "string", description: "ISO 639-1 code of the article's language." },
          date: {
            anyOf: [{ type: "string", pattern: DATE_PATTERN }, { type: "null" }],
            description: "YYYY-MM-DD, YYYY-MM or YYYY; null when the article gives no date.",
          },
          category: { type: "string", enum: CATEGORIES },
          severity: { type: "string", enum: SEVERITIES },
          status: { type: "string", enum: STATUSES },
          identityConfidence: { type: "string", enum: CONFIDENCE_LEVELS },
          identityEvidence: { type: "array", items: { type: "string" } },
          sourceReliability: { type: "string", enum: SOURCE_RELIABILITIES },
          summary: { type: "string", description: "One factual sentence." },
        },
      },
    },
  },
} as const;

// The API does not guarantee the casing of enum values, so they are compared in lowercase.
function caseInsensitiveEnum<const T extends readonly string[]>(values: T) {
  return z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.enum(values));
}

export const AssessmentSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      url: z.string(),
      corroboratingUrls: z.array(z.string()),
      language: z.string().transform((value) => value.toLowerCase()),
      date: z.string().regex(new RegExp(DATE_PATTERN)).nullable(),
      category: caseInsensitiveEnum(CATEGORIES),
      severity: caseInsensitiveEnum(SEVERITIES),
      status: caseInsensitiveEnum(STATUSES),
      identityConfidence: caseInsensitiveEnum(CONFIDENCE_LEVELS),
      identityEvidence: z.array(z.string()),
      sourceReliability: caseInsensitiveEnum(SOURCE_RELIABILITIES),
      summary: z.string(),
    }),
  ),
});

export type Assessment = z.infer<typeof AssessmentSchema>;

// Letters of any script, combining marks, spaces, apostrophes, periods and hyphens. Anything else,
// such as angle brackets or line breaks, could break out of the data tags of the prompt.
const NAME_PATTERN = /^[\p{L}\p{M}' .’-]+$/u;
const NAME_MAX_LENGTH = 100;

const personName = z.string().trim().min(1).max(NAME_MAX_LENGTH).regex(NAME_PATTERN);

export const screeningInputSchema = z.object({
  firstName: personName,
  lastName: personName,
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "expected an ISO 3166-1 alpha-2 country code"),
});
