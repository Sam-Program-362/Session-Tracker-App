import { pgTable, uuid, timestamp, text, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ----------------------------------------------------------------------
// App data tables
// These keep the same shape as the device records so sync can map 1:1.
// Every app table is scoped by userId and queries must filter by it.
// ----------------------------------------------------------------------

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("userId").notNull(),

  name: text("name").notNull(),
  icon: text("icon").notNull(),
  color: text("color").notNull(),

  createdAt: timestamp("createdAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updatedAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),

  deleted: boolean("deleted").notNull().default(false),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("userId").notNull(),

  categoryId: uuid("categoryId").notNull(),
  categoryName: text("categoryName").notNull(),

  status: text("status").notNull(), // "running" | "stopped"
  startedAt: timestamp("startedAt", { precision: 3, mode: "string" })
    .notNull(),
  endedAt: timestamp("endedAt", { precision: 3, mode: "string" }), // null while running

  note: text("note"),
  summary: text("summary"),

  createdAt: timestamp("createdAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updatedAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),

  deleted: boolean("deleted").notNull().default(false),
});

// ----------------------------------------------------------------------
// Better Auth tables
// We use Better Auth's Postgres adapter, which owns these tables.
// We keep them in the same schema file so the migration is one command.
// ----------------------------------------------------------------------

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", {
    precision: 3,
    mode: "string",
  }),
  image: text("image"),
  createdAt: timestamp("createdAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updatedAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),
});

export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expiresAt", { precision: 3, mode: "string" })
    .notNull(),
  createdAt: timestamp("createdAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updatedAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),
});

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
    precision: 3,
    mode: "string",
  }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
    precision: 3,
    mode: "string",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updatedAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),
});

export const verification = pgTable("verification", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { precision: 3, mode: "string" })
    .notNull(),
  createdAt: timestamp("createdAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updatedAt", { precision: 3, mode: "string" })
    .notNull()
    .default(sql`now()`),
});
