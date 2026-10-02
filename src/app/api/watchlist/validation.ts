import { z } from "zod";

import { screeningInputSchema } from "@/agent/schema";
import type { ScreeningInput } from "@/agent/types";

import { issuesOf, type Issue } from "../../input-validation";

type Parsed<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

const personIdSchema = z.uuid();
const monitoredUpdateSchema = z.object({ monitored: z.boolean() }).strict();

// The same validation as POST /api/screen: a name enrolled here is screened by the daily run.
export function parseEnrollment(body: unknown): Parsed<ScreeningInput> {
  const parsed = screeningInputSchema.safeParse(body);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, issues: issuesOf(parsed.error.issues) };
}

export function parseMonitoredUpdate(body: unknown): Parsed<boolean> {
  const parsed = monitoredUpdateSchema.safeParse(body);
  return parsed.success
    ? { ok: true, value: parsed.data.monitored }
    : { ok: false, issues: issuesOf(parsed.error.issues) };
}

export function isPersonId(value: string): boolean {
  return personIdSchema.safeParse(value).success;
}
