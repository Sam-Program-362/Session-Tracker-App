import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// The harmless build-time placeholder is never queried. Production must set DATABASE_URL.
const url = process.env.DATABASE_URL ?? "postgresql://build:build@localhost/build";
export const db = drizzle(neon(url), { schema });
