import { describe, expect, it } from "vitest";

import { readJsonBody } from "../body";

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/screen", { method: "POST", body, headers });
}

describe("readJsonBody", () => {
  it("parses a JSON body under the limit", async () => {
    expect(await readJsonBody(post('{"country":"FR"}'), 100)).toEqual({
      ok: true,
      value: { country: "FR" },
    });
  });

  it("refuses a body over the limit, declared or not", async () => {
    const large = JSON.stringify({ lastName: "a".repeat(200) });

    expect(await readJsonBody(post(large), 100)).toMatchObject({ ok: false, status: 413 });
    expect(await readJsonBody(post("{}", { "content-length": "5000" }), 100)).toMatchObject({
      ok: false,
      status: 413,
    });
  });

  it("refuses a body that is not JSON", async () => {
    expect(await readJsonBody(post("firstName=Jean"), 100)).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});
