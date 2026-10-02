import { describe, expect, it } from "vitest";

import { BLOCKED_DOMAINS } from "../data/blocked-domains";

// The matcher compares lowercase ASCII hostnames: an entry in another form, or a non-ASCII
// lookalike, would block nothing. The same form is what the search tool accepts, if the filter
// goes back there (D-37).
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[a-z0-9/_-]+)?$/;

describe("BLOCKED_DOMAINS", () => {
  it("holds bare ASCII domains, without scheme, www or wildcard", () => {
    for (const domain of BLOCKED_DOMAINS) {
      expect(domain, domain).toMatch(BARE_DOMAIN);
      expect(domain.startsWith("www."), domain).toBe(false);
    }
  });

  it("lists each domain once", () => {
    expect(new Set(BLOCKED_DOMAINS).size).toBe(BLOCKED_DOMAINS.length);
  });
});
