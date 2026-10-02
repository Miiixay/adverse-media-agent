import { appendRunLog, requirePseudonymKey, runLogEntry } from "@/agent";
import type { ScreeningInput, ScreeningResult } from "@/agent";

// The file system of a Vercel function is read-only: there the run log is skipped, as intended.
const READ_ONLY_CODES: ReadonlySet<string> = new Set(["EROFS", "EACCES", "EPERM"]);

// Without a key there is no pseudonym, and a name is never logged in clear: no run log. A key set
// but too short throws, before any screening is paid for.
export function runLogKey(): string | null {
  const key = process.env.LOG_PSEUDONYM_KEY;
  return key === undefined || key === "" ? null : requirePseudonymKey(key);
}

export async function logRun(
  input: ScreeningInput,
  result: ScreeningResult,
  key: string,
): Promise<void> {
  try {
    await appendRunLog(runLogEntry(input, result, key));
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
    if (READ_ONLY_CODES.has(code)) return;
    // The screening succeeded and is returned; the failure goes to the server log, without the name.
    console.error(`run log not written: ${code}`);
  }
}

// What a server log may say about an error: its name and code, never its message, since a failed
// query carries its parameters, the name of the person among them.
export function errorLabel(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const cause = error.cause instanceof Error ? error.cause : undefined;
  const code = [error, cause]
    .map((item) => (item !== undefined && "code" in item ? String(item.code) : ""))
    .find(Boolean);
  return [error.name, cause?.name, code].filter(Boolean).join(" ");
}
