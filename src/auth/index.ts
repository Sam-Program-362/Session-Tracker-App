import { betterAuth, type BetterAuthOptions } from "better-auth";
import { neon } from "@neondatabase/serverless";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";

declare global {
  // eslint-disable-next-line no-var
  var __auth__: ReturnType<typeof betterAuth<BetterAuthOptions>> | undefined;
}

function buildAuth() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!process.env.BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_URL is not set");
  }
  return betterAuth<BetterAuthOptions>({
    database: drizzleAdapter(
      drizzle(neon(process.env.DATABASE_URL), { schema }),
      {
        provider: "pg",
        schema,
      }
    ),
    emailAndPassword: {
      enabled: true,
    },
    session: {
      // A phone that is only opened now and then must not be asked for a
      // password again: the session lasts a year and is refreshed (slid
      // forward) once it is a day old.
      expiresIn: 365 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
  });
}

export const auth = new Proxy({} as ReturnType<typeof betterAuth<BetterAuthOptions>>, {
  get(_target, prop) {
    if (!global.__auth__) {
      global.__auth__ = buildAuth();
    }
    return (global.__auth__ as any)[prop as string];
  },
}) as ReturnType<typeof betterAuth<BetterAuthOptions>>;
