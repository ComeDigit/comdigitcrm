import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Supabase connection string (pooled). Set in .env — never committed.
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/comedigit",
  },
  strict: true,
  verbose: true,
});
