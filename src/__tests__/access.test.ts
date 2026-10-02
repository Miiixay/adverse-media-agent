import { describe, expect, it } from "vitest";

import { basicPassword, checkAccess, cronAuthorized, safeEqual } from "../access";

const SECRETS = { appPassword: "correct horse battery", cronSecret: "cron-secret-value" };

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

function request(authorization: string | null, pathname = "/history", method = "GET") {
  return { method, pathname, authorization };
}

describe("safeEqual", () => {
  it("is true for the same string only, whatever the lengths", () => {
    expect(safeEqual("correct horse battery", "correct horse battery")).toBe(true);
    expect(safeEqual("correct horse batterz", "correct horse battery")).toBe(false);
    expect(safeEqual("", "correct horse battery")).toBe(false);
    expect(safeEqual("correct horse battery staple", "correct horse battery")).toBe(false);
  });
});

describe("basicPassword", () => {
  it("returns what follows the first colon, so a password may hold colons", () => {
    expect(basicPassword(basic("analyst", "a:b:c"))).toBe("a:b:c");
    expect(basicPassword(basic("", "secret"))).toBe("secret");
  });

  it("returns null for a missing, foreign or malformed header", () => {
    expect(basicPassword(null)).toBeNull();
    expect(basicPassword("Bearer token")).toBeNull();
    expect(basicPassword("Basic")).toBeNull();
    expect(basicPassword(`Basic ${Buffer.from("no-colon").toString("base64")}`)).toBeNull();
  });
});

describe("checkAccess", () => {
  it("lets in the right password with any user name", () => {
    expect(checkAccess(request(basic("anyone", SECRETS.appPassword)), SECRETS)).toEqual({
      allowed: true,
    });
  });

  it("answers 401 with a Basic challenge without credentials or with a wrong password", () => {
    for (const authorization of [null, basic("anyone", "wrong"), "Basic !!!"]) {
      expect(checkAccess(request(authorization, "/api/screen", "POST"), SECRETS)).toEqual({
        allowed: false,
        status: 401,
        message: "Authentication required.",
        headers: { "WWW-Authenticate": 'Basic realm="adverse-media-agent"' },
      });
    }
  });

  it("refuses everything with a 500 when APP_PASSWORD is missing or empty", () => {
    for (const appPassword of [undefined, ""]) {
      const secrets = { ...SECRETS, appPassword };
      for (const authorization of [null, basic("anyone", ""), `Bearer ${SECRETS.cronSecret}`]) {
        expect(checkAccess(request(authorization, "/api/cron/daily"), secrets)).toMatchObject({
          allowed: false,
          status: 500,
        });
      }
    }
  });

  it("lets Vercel Cron call GET /api/cron/daily with its bearer secret", () => {
    const cron = `Bearer ${SECRETS.cronSecret}`;

    expect(checkAccess(request(cron, "/api/cron/daily"), SECRETS)).toEqual({ allowed: true });
    expect(
      checkAccess(request(basic("x", SECRETS.appPassword), "/api/cron/daily"), SECRETS),
    ).toEqual({
      allowed: true,
    });
  });

  it("accepts the cron secret nowhere else, by no other method, and not when it is unset", () => {
    const cron = `Bearer ${SECRETS.cronSecret}`;

    expect(checkAccess(request(cron, "/history"), SECRETS)).toMatchObject({ status: 401 });
    expect(checkAccess(request(cron, "/api/cron/daily", "POST"), SECRETS)).toMatchObject({
      status: 401,
    });
    expect(checkAccess(request("Bearer wrong", "/api/cron/daily"), SECRETS)).toMatchObject({
      status: 401,
    });
    expect(
      checkAccess(request("Bearer ", "/api/cron/daily"), { ...SECRETS, cronSecret: "" }),
    ).toMatchObject({ status: 401 });
  });
});

describe("cronAuthorized", () => {
  it("accepts the bearer secret of Vercel Cron and nothing else", () => {
    expect(cronAuthorized(`Bearer ${SECRETS.cronSecret}`, SECRETS.cronSecret)).toBe(true);
    expect(cronAuthorized(`Bearer ${SECRETS.cronSecret}x`, SECRETS.cronSecret)).toBe(false);
    expect(cronAuthorized(`bearer ${SECRETS.cronSecret}`, SECRETS.cronSecret)).toBe(false);
    expect(cronAuthorized(basic("cron", SECRETS.cronSecret), SECRETS.cronSecret)).toBe(false);
    expect(cronAuthorized(null, SECRETS.cronSecret)).toBe(false);
  });

  it("accepts nothing while CRON_SECRET is unset or empty", () => {
    expect(cronAuthorized("Bearer ", "")).toBe(false);
    expect(cronAuthorized("Bearer anything", undefined)).toBe(false);
  });
});
