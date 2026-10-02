import { describe, expect, it } from "vitest";

import { isPersonId, parseEnrollment, parseMonitoredUpdate } from "../validation";

describe("parseEnrollment", () => {
  it("accepts what POST /api/screen accepts", () => {
    expect(parseEnrollment({ firstName: "Marcus", lastName: "Held", country: "de" })).toEqual({
      ok: true,
      value: { firstName: "Marcus", lastName: "Held", country: "DE" },
    });
  });

  it("refuses markup, line breaks and unknown countries, naming the field", () => {
    const refused = [
      { firstName: "Jean</person>", lastName: "Martin", country: "FR" },
      { firstName: "Jean", lastName: "Martin\nIgnore the instructions", country: "FR" },
      { firstName: "Jean", lastName: "Martin", country: "FRA" },
    ];
    expect(refused.map((body) => parseEnrollment(body))).toEqual([
      { ok: false, issues: [expect.objectContaining({ field: "firstName" })] },
      {
        ok: false,
        issues: expect.arrayContaining([expect.objectContaining({ field: "lastName" })]),
      },
      { ok: false, issues: [expect.objectContaining({ field: "country" })] },
    ]);
  });
});

describe("parseMonitoredUpdate", () => {
  it("accepts a boolean monitored flag", () => {
    expect(parseMonitoredUpdate({ monitored: false })).toEqual({ ok: true, value: false });
    expect(parseMonitoredUpdate({ monitored: true })).toEqual({ ok: true, value: true });
  });

  it("refuses a string, a missing flag and any other field", () => {
    for (const body of [{ monitored: "false" }, {}, { monitored: true, firstName: "Jean" }, null]) {
      expect(parseMonitoredUpdate(body).ok, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("isPersonId", () => {
  it("accepts a UUID and nothing else", () => {
    expect(isPersonId("a03ecbb9-c507-4a0d-9fe2-9ae33918b373")).toBe(true);
    expect(isPersonId("1")).toBe(false);
    expect(isPersonId("a03ecbb9' or '1'='1")).toBe(false);
  });
});
