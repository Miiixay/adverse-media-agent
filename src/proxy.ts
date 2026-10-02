import { NextResponse, type NextRequest } from "next/server";

import { checkAccess } from "./access";

// HTTP Basic on the whole prototype, pages and API routes alike: the history holds names in clear
// and every screening costs money (docs/security.md).
export function proxy(request: NextRequest): NextResponse {
  const decision = checkAccess(
    {
      method: request.method,
      pathname: request.nextUrl.pathname,
      authorization: request.headers.get("authorization"),
    },
    { appPassword: process.env.APP_PASSWORD, cronSecret: process.env.CRON_SECRET },
  );
  if (decision.allowed) return NextResponse.next();
  return new NextResponse(decision.message, { status: decision.status, headers: decision.headers });
}

export const config = {
  // Everything except the static assets of Next.js and the favicon.
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};
