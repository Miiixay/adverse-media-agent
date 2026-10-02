import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

// Over HTTP: each query is one request, nothing to pool or close in a serverless function. The
// pooled URL is the one for the app; migrations use the direct one (drizzle.config.ts).
function connect(url: string) {
  return drizzle({ client: neon(url), schema });
}

let database: ReturnType<typeof connect> | undefined;

// Created on first use, so that a missing DATABASE_URL fails the database call, not the import of
// the route that also runs the screening.
export function db(): ReturnType<typeof connect> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set");
  database ??= connect(url);
  return database;
}
