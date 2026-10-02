import { createHash, timingSafeEqual } from "node:crypto";

export const REALM = "adverse-media-agent";
// Vercel Cron calls this route with Authorization: Bearer CRON_SECRET, and no Basic credentials.
const CRON_PATH = "/api/cron/daily";

export type AccessRequest = { method: string; pathname: string; authorization: string | null };
export type AccessSecrets = { appPassword: string | undefined; cronSecret: string | undefined };
export type AccessDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 500; message: string; headers: Record<string, string> };

export function checkAccess(request: AccessRequest, secrets: AccessSecrets): AccessDecision {
  // Without a password the site would be open: everything is refused until it is set.
  if (secrets.appPassword === undefined || secrets.appPassword === "") {
    return {
      allowed: false,
      status: 500,
      message: "APP_PASSWORD is not set: access is refused until it is.",
      headers: {},
    };
  }
  if (isCronCall(request, secrets.cronSecret)) return { allowed: true };

  const password = basicPassword(request.authorization);
  if (password !== null && safeEqual(password, secrets.appPassword)) return { allowed: true };
  return {
    allowed: false,
    status: 401,
    message: "Authentication required.",
    headers: { "WWW-Authenticate": `Basic realm="${REALM}"` },
  };
}

// Any user name is accepted: the prototype has one shared password, not accounts.
export function basicPassword(authorization: string | null): string | null {
  const [scheme, encoded] = (authorization ?? "").trim().split(/ +/);
  if (scheme?.toLowerCase() !== "basic" || encoded === undefined) return null;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon === -1 ? null : decoded.slice(colon + 1);
}

// Both sides are hashed first: digests of equal length let timingSafeEqual compare them, so the
// time taken reveals neither the content nor the length of the secret.
export function safeEqual(candidate: string, secret: string): boolean {
  return timingSafeEqual(digest(candidate), digest(secret));
}

// Checked by the proxy and again by the cron route, so that the route stays closed if the proxy
// matcher ever stops covering it.
export function cronAuthorized(
  authorization: string | null,
  cronSecret: string | undefined,
): boolean {
  if (cronSecret === undefined || cronSecret === "") return false;
  const [scheme, token] = (authorization ?? "").trim().split(/ +/);
  return scheme === "Bearer" && token !== undefined && safeEqual(token, cronSecret);
}

function isCronCall(request: AccessRequest, cronSecret: string | undefined): boolean {
  return (
    request.method === "GET" &&
    request.pathname === CRON_PATH &&
    cronAuthorized(request.authorization, cronSecret)
  );
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
