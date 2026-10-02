import Anthropic from "@anthropic-ai/sdk";

import {
  screenIndividual,
  screeningInputSchema,
  type ScreeningInput,
  type ScreeningResult,
} from "@/agent";
import { saveScreening } from "@/db/screenings";

import { errorLabel, logRun, runLogKey } from "../server-log";
import { readJsonBody } from "../body";
import { clientAddress, createRateLimiter } from "./rate-limit";

export const runtime = "nodejs";
// Vercel Hobby stops a function after 300 s with fluid compute. The agent stops searching after
// 240 s and returns an incomplete result; the route gives up at 280 s with a 504.
export const maxDuration = 300;

const ROUTE_DEADLINE_MS = 280_000;
// Three fields of at most 100 characters each: a valid body is well under 1 KB.
const MAX_BODY_BYTES = 2_048;

const takeRequest = createRateLimiter();

class DeadlineExceeded extends Error {}

export async function POST(request: Request): Promise<Response> {
  const decision = takeRequest(clientAddress(request.headers), Date.now());
  if (!decision.allowed) {
    return problem(429, "too many screenings from this address, retry later", {
      "Retry-After": String(decision.retryAfterSeconds),
    });
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return problem(body.status, body.message);

  const parsed = screeningInputSchema.safeParse(body.value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.map(String).join("."),
      message: issue.message,
    }));
    return Response.json({ error: "invalid input", issues }, { status: 400 });
  }

  // Checked before the screening, so that a misconfigured key fails without spending anything.
  const pseudonymKey = runLogKey();

  let result: ScreeningResult;
  try {
    result = await withDeadline(screenIndividual(parsed.data), ROUTE_DEADLINE_MS);
  } catch (error) {
    if (error instanceof DeadlineExceeded || error instanceof Anthropic.APIConnectionTimeoutError) {
      return problem(504, "the screening did not finish in time");
    }
    if (error instanceof Anthropic.APIError) {
      return problem(502, "the model API failed, retry later");
    }
    throw error;
  }

  await Promise.all([
    pseudonymKey === null ? undefined : logRun(parsed.data, result, pseudonymKey),
    saveRun(parsed.data, result),
  ]);
  return Response.json(result);
}

// The screening is returned even when it cannot be stored: the database is a record, not a
// dependency of the result.
async function saveRun(input: ScreeningInput, result: ScreeningResult): Promise<void> {
  try {
    await saveScreening(input, result, "one_shot");
  } catch (error) {
    // Never the message: a failed query carries its parameters, the name among them.
    console.error(`screening not saved: ${errorLabel(error)}`);
  }
}

// The agent cannot be cancelled once started; past the deadline its result is dropped.
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded()), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function problem(status: number, message: string, headers: HeadersInit = {}): Response {
  return Response.json({ error: message }, { status, headers });
}
