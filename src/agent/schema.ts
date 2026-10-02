import { z } from "zod";

import {
  CATEGORIES,
  CONFIDENCE_LEVELS,
  RISK_LEVELS,
  SEVERITIES,
  SOURCE_RELIABILITIES,
  STATUSES,
  SUBJECTS,
} from "./types";

// A full date, or the year and month, or the year, as far as the article gives it.
const DATE_PATTERN = "^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$";

// Structured outputs do not support maxItems, so the grammar enforces neither limit: the prompt
// asks for both, and search.ts cuts the corroborating URLs after filtering them (D-22).
export const MAX_FINDINGS = 8;
export const MAX_CORROBORATING_URLS = 3;
export const MAX_ALIASES = 3;

// Sent as is in output_config.format. The SDK helpers would fold the enums into descriptions and
// the grammar would stop constraining them (D-18).
export const ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  // Written in this order under constrained decoding: the findings, then the model's view of the
  // risk they add up to, then the summary that describes them, then the aliases (D-44, D-51).
  required: ["findings", "suggestedRisk", "summary", "aliases"],
  properties: {
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
          "subject",
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
            description:
              "Date of the latest known status of the matter (verdict, decision, charge), not of the article; failing that, the date of the article. YYYY-MM-DD, YYYY-MM or YYYY; null when the article gives no date.",
          },
          subject: {
            type: "string",
            enum: SUBJECTS,
            description:
              "person: the screened person; organization: a company or body linked to the person; associate: a relative, partner or associate, the person not being personally involved.",
          },
          category: { type: "string", enum: CATEGORIES },
          severity: { type: "string", enum: SEVERITIES },
          status: {
            type: "string",
            enum: STATUSES,
            description:
              "sanctioned: a final administrative or regulatory decision against the person, such as a fine, a ban, an ineligibility or a listing on a sanctions list.",
          },
          identityConfidence: { type: "string", enum: CONFIDENCE_LEVELS },
          identityEvidence: { type: "array", items: { type: "string" } },
          sourceReliability: { type: "string", enum: SOURCE_RELIABILITIES },
          summary: { type: "string", description: "One factual sentence." },
        },
      },
    },
    suggestedRisk: {
      type: "string",
      enum: RISK_LEVELS,
      description:
        "Your own view of the person's overall risk, low, medium or high, from the findings you report and the definitions of identityConfidence, category, severity and status in these instructions. The final risk level is calculated elsewhere: your view is recorded as an opinion and does not change it.",
    },
    summary: {
      type: "string",
      description:
        "Two or three factual sentences on the overall picture, describing the findings listed.",
    },
    aliases: {
      type: "array",
      items: { type: "string" },
      // The wording of the prompt (v12).
      description: `Names the sources use instead of the legal name, such as a nickname-based name ("Toni Rossi" for Antonio Rossi), a stage name or a different spelling of the surname; not a longer legal form with middle names, not a maiden name mentioned in passing, never a namesake; at most ${MAX_ALIASES}, usually empty.`,
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
  findings: z.array(
    z.object({
      url: z.string(),
      corroboratingUrls: z.array(z.string()),
      language: z.string().transform((value) => value.toLowerCase()),
      date: z.string().regex(new RegExp(DATE_PATTERN)).nullable(),
      subject: caseInsensitiveEnum(SUBJECTS),
      category: caseInsensitiveEnum(CATEGORIES),
      severity: caseInsensitiveEnum(SEVERITIES),
      status: caseInsensitiveEnum(STATUSES),
      identityConfidence: caseInsensitiveEnum(CONFIDENCE_LEVELS),
      identityEvidence: z.array(z.string()),
      sourceReliability: caseInsensitiveEnum(SOURCE_RELIABILITIES),
      summary: z.string(),
    }),
  ),
  suggestedRisk: caseInsensitiveEnum(RISK_LEVELS),
  summary: z.string(),
  aliases: z.array(z.string()),
});

export type Assessment = z.infer<typeof AssessmentSchema>;

// Letters of any script, combining marks, spaces, apostrophes, periods and hyphens. Anything else,
// such as angle brackets or line breaks, could break out of the data tags of the prompt.
const NAME_PATTERN = /^[\p{L}\p{M}' .’-]+$/u;
const NAME_MAX_LENGTH = 100;

// Line breaks, tabs and other control characters are refused before trimming, so that a trailing
// one is an error rather than silently dropped.
const CONTROL_CHARACTER = /\p{Cc}/u;
const CONTROL_CHARACTER_MESSAGE = "control characters, line breaks included, are not allowed";

function withoutControlCharacters(value: string): boolean {
  return !CONTROL_CHARACTER.test(value);
}

const personName = z
  .string()
  .refine(withoutControlCharacters, CONTROL_CHARACTER_MESSAGE)
  .trim()
  .min(1)
  .max(NAME_MAX_LENGTH)
  .regex(NAME_PATTERN);

export const screeningInputSchema = z.object({
  firstName: personName,
  lastName: personName,
  country: z
    .string()
    .refine(withoutControlCharacters, CONTROL_CHARACTER_MESSAGE)
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "expected an ISO 3166-1 alpha-2 country code"),
});
