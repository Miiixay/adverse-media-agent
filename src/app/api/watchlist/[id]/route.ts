import { setMonitored } from "@/db/persons";

import { readJsonBody } from "../../body";
import { errorLabel } from "../../server-log";
import { isPersonId, parseMonitoredUpdate } from "../validation";

export const runtime = "nodejs";

// {"monitored": true} or {"monitored": false}.
const MAX_BODY_BYTES = 256;

// Switches the daily monitoring of a person on or off.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isPersonId(id)) return Response.json({ error: "no such person" }, { status: 404 });

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.message }, { status: body.status });
  const parsed = parseMonitoredUpdate(body.value);
  if (!parsed.ok) {
    return Response.json({ error: "invalid input", issues: parsed.issues }, { status: 400 });
  }

  try {
    const person = await setMonitored(id, parsed.value);
    if (person === null) return Response.json({ error: "no such person" }, { status: 404 });
    return Response.json({ id: person.id, monitored: person.monitored });
  } catch (error) {
    console.error(`monitoring not changed: ${errorLabel(error)}`);
    return Response.json({ error: "the database did not answer" }, { status: 503 });
  }
}
