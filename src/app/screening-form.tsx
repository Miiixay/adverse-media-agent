"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { ScreeningInput, ScreeningResult } from "@/agent/types";

import {
  EMPTY_VALUES,
  fieldErrors,
  hasIssues,
  validateInput,
  type FieldErrors,
  type FieldValues,
} from "./input-validation";
import { PersonFields, type CountryOption } from "./person-fields";
import { ScreeningReport } from "./screening-report";

// Whether the person was put on daily monitoring after the screening, when the analyst asked for it.
type Monitoring = "not_requested" | "added" | { failed: string };

type State =
  | { phase: "idle" }
  | { phase: "loading"; startedAt: number }
  | { phase: "done"; result: ScreeningResult; monitoring: Monitoring }
  | { phase: "failed"; message: string };

export function ScreeningForm({ countries }: { countries: readonly CountryOption[] }) {
  const [values, setValues] = useState<FieldValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [monitor, setMonitor] = useState(false);
  const [state, setState] = useState<State>({ phase: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validated = validateInput(values);
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    setErrors({});
    setState({ phase: "loading", startedAt: Date.now() });

    let response: Response;
    try {
      response = await fetch("/api/screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validated.input),
      });
    } catch {
      setState({ phase: "failed", message: "The server could not be reached." });
      return;
    }
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const monitoring = monitor ? await enroll(validated.input) : "not_requested";
      setState({ phase: "done", result: payload as ScreeningResult, monitoring });
      return;
    }
    if (response.status === 400 && hasIssues(payload)) setErrors(fieldErrors(payload.issues));
    setState({ phase: "failed", message: failureMessage(response) });
  }

  const loading = state.phase === "loading";
  return (
    <>
      <form className="screening-form" onSubmit={submit} noValidate>
        <PersonFields
          values={values}
          errors={errors}
          countries={countries}
          onChange={(field, value) => setValues({ ...values, [field]: value })}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Screening…" : "Screen"}
        </button>
        <label className="checkbox">
          <input
            type="checkbox"
            name="monitor"
            checked={monitor}
            onChange={(event) => setMonitor(event.target.checked)}
          />
          Add to daily monitoring
        </label>
      </form>

      <section aria-live="polite">
        {state.phase === "loading" && <Progress startedAt={state.startedAt} />}
        {state.phase === "failed" && <p className="notice notice-error">{state.message}</p>}
        {state.phase === "done" && (
          <>
            <MonitoringNotice monitoring={state.monitoring} />
            <ScreeningReport result={state.result} />
          </>
        )}
      </section>
    </>
  );
}

// After the screening succeeded: the same route as the watchlist form, which sets monitoring on.
async function enroll(input: ScreeningInput): Promise<Monitoring> {
  try {
    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return response.ok ? "added" : { failed: `HTTP ${response.status}` };
  } catch {
    return { failed: "the server could not be reached" };
  }
}

function MonitoringNotice({ monitoring }: { monitoring: Monitoring }) {
  if (monitoring === "not_requested") return null;
  if (monitoring === "added") {
    return (
      <p className="notice">
        Added to daily monitoring: the daily run will screen this person again each day.
      </p>
    );
  }
  return (
    <p className="notice notice-error">
      The screening is done, but the person was not added to daily monitoring ({monitoring.failed}).
      Add them from the watchlist.
    </p>
  );
}

function Progress({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="notice notice-progress">
      <span className="spinner" aria-hidden="true" />
      Screening in progress, {Math.round((now - startedAt) / 1000)} s. A screening takes between 10
      and 60 seconds.
    </p>
  );
}

function failureMessage(response: Response): string {
  switch (response.status) {
    case 400:
      return "The input was refused by the server.";
    case 413:
      return "The request is too large.";
    case 429:
      return `Too many screenings from this address. Retry in ${response.headers.get("Retry-After") ?? "60"} s.`;
    case 502:
      return "The model API failed. Retry later.";
    case 504:
      return "The screening did not finish in time.";
    default:
      return `The screening failed (HTTP ${response.status}).`;
  }
}
