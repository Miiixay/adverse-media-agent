import { enrollPerson } from "@/db/persons";

import { readJsonBody } from "../body";
import { errorLabel } from "../server-log";
import { parseEnrollment } from "./validation";

export const runtime = "nodejs";

// Three fields of at most 100 characters each: a valid body is well under 1 KB.
const MAX_BODY_BYTES = 2_048;

// Puts a person on the watchlist without screening them now: the daily run will.
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.message }, { status: body.status });

  const parsed = parseEnrollment(body.value);
  if (!parsed.ok) {
    return Response.json({ error: "invalid input", issues: parsed.issues }, { status: 400 });
  }

  try {
    const { id, created } = await enrollPerson(parsed.value);
    return Response.json({ id, monitored: true, created }, { status: created ? 201 : 200 });
  } catch (error) {
    console.error(`person not enrolled: ${errorLabel(error)}`);
    return Response.json({ error: "the database did not answer" }, { status: 503 });
  }
}
