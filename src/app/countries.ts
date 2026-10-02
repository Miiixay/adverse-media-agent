import { COUNTRY_LANGUAGES } from "@/agent/data/country-languages";

import type { CountryOption } from "./person-fields";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

// The countries whose national press the agent searches in its own languages, by name.
export const COUNTRIES: CountryOption[] = [...COUNTRY_LANGUAGES.keys()]
  .map((code) => ({ code, name: regionNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));
