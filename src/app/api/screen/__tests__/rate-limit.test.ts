import { describe, expect, it } from "vitest";

import { clientAddress, createRateLimiter } from "../rate-limit";

describe("createRateLimiter", () => {
  it("allows five requests a minute per address and says when to retry", () => {
    const take = createRateLimiter(60_000, 5);
    for (let second = 0; second < 5; second += 1) {
      expect(take("203.0.113.7", second * 1_000)).toEqual({ allowed: true });
    }

    expect(take("203.0.113.7", 10_000)).toEqual({ allowed: false, retryAfterSeconds: 50 });
    expect(take("198.51.100.2", 10_000)).toEqual({ allowed: true });
    expect(take("203.0.113.7", 60_000)).toEqual({ allowed: true });
  });
});

describe("clientAddress", () => {
  it("takes the first address of x-forwarded-for, or one shared bucket without it", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
    expect(clientAddress(new Headers())).toBe("local");
  });
});
