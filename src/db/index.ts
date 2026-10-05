import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __db__: ReturnType<typeof drizzle> | undefined;
}

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!global.__db__) {
    global.__db__ = drizzle(neon(process.env.DATABASE_URL), { schema });
  }
  return global.__db__;
}

export function createDb() {
  return getDb();
}

export { schema };
