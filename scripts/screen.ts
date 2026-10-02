import {
  appendRunLog,
  requirePseudonymKey,
  runLogEntry,
  screenIndividual,
  screeningInputSchema,
} from "../src/agent";

const USAGE = "Usage: npm run screen -- <first name> <last name> <country code>";

async function main(): Promise<void> {
  const [firstName, lastName, country, ...extra] = process.argv.slice(2);
  if (firstName === undefined || lastName === undefined || country === undefined || extra.length) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  // Both checks run before the API call, so a bad argument or a missing key costs nothing.
  const pseudonymKey = requirePseudonymKey(process.env.LOG_PSEUDONYM_KEY);
  const input = screeningInputSchema.parse({ firstName, lastName, country });

  const result = await screenIndividual(input);
  await appendRunLog(runLogEntry(input, result, pseudonymKey));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
