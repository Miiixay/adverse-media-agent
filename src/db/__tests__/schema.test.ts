import { describe, expect, it } from "vitest";

import { persons } from "../schema";

describe("persons.monitored", () => {
  it("is off by default: a one-shot screening does not put the person on daily monitoring", () => {
    expect(persons.monitored.notNull).toBe(true);
    expect(persons.monitored.default).toBe(false);
  });
});
