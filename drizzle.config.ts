import { defineConfig } from "drizzle-kit";

// Migrations go through the direct connection: Neon's pooled one runs PgBouncer in transaction
// mode, which keeps no session state between statements.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? "" },
});
