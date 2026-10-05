import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./server-db";
import * as schema from "./schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET ?? "build-only-secret-that-must-be-replaced-in-production",
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
});
