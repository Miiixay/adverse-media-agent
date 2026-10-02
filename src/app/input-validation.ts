import { screeningInputSchema } from "@/agent/schema";
import type { ScreeningInput } from "@/agent/types";

export type Field = "firstName" | "lastName" | "country";
export type FieldValues = Record<Field, string>;
export type FieldErrors = Partial<Record<Field, string>>;
// The shape of the issues returned by the API routes on a 400.
export type Issue = { field: string; message: string };

export const EMPTY_VALUES: FieldValues = { firstName: "", lastName: "", country: "" };
const FIELDS: readonly Field[] = ["firstName", "lastName", "country"];

// The schema of the API routes, run in the browser first: what the server would refuse is refused
// before any request, with the same messages.
export function validateInput(
  values: FieldValues,
): { ok: true; input: ScreeningInput } | { ok: false; errors: FieldErrors } {
  const parsed = screeningInputSchema.safeParse(values);
  if (parsed.success) return { ok: true, input: parsed.data };
  return { ok: false, errors: fieldErrors(issuesOf(parsed.error.issues)) };
}

export function issuesOf(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Issue[] {
  return issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

// The first message of each field; issues about anything else are dropped.
export function fieldErrors(issues: readonly Issue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = FIELDS.find((name) => name === issue.field);
    if (field !== undefined && errors[field] === undefined) errors[field] = issue.message;
  }
  return errors;
}

export function hasIssues(payload: unknown): payload is { issues: Issue[] } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "issues" in payload &&
    Array.isArray(payload.issues)
  );
}
