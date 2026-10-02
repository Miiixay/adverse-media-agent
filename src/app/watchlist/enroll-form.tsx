"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  EMPTY_VALUES,
  fieldErrors,
  hasIssues,
  validateInput,
  type FieldErrors,
  type FieldValues,
} from "../input-validation";
import { PersonFields, type CountryOption } from "../person-fields";

type Notice = { kind: "info" | "error"; text: string } | null;

// Enrolls a person without screening them now: the next daily run will.
export function EnrollForm({ countries }: { countries: readonly CountryOption[] }) {
  const router = useRouter();
  const [values, setValues] = useState<FieldValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validated = validateInput(values);
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validated.input),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const created = response.status === 201;
        setNotice({
          kind: "info",
          text: created
            ? "Added to the watchlist. The next daily run will screen this person."
            : "Already recorded: monitoring is on again.",
        });
        setValues(EMPTY_VALUES);
        router.refresh();
      } else {
        if (response.status === 400 && hasIssues(payload)) setErrors(fieldErrors(payload.issues));
        setNotice({ kind: "error", text: `The person was not added (HTTP ${response.status}).` });
      }
    } catch {
      setNotice({ kind: "error", text: "The server could not be reached." });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form className="screening-form" onSubmit={submit} noValidate>
        <PersonFields
          values={values}
          errors={errors}
          countries={countries}
          onChange={(field, value) => setValues({ ...values, [field]: value })}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add to watchlist"}
        </button>
      </form>
      {notice !== null && (
        <p
          className={notice.kind === "error" ? "notice notice-error" : "notice"}
          aria-live="polite"
        >
          {notice.text}
        </p>
      )}
    </>
  );
}
