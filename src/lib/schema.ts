import { boolean, index, pgTable, text, timestamp, uuid, bigint } from "drizzle-orm/pg-core";

// Better Auth tables. IDs are strings because Better Auth generates them.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [index("account_user_id_idx").on(table.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Device UUIDs remain the primary keys: no sequence or auto-increment IDs.
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  icon: text("icon").notNull(),
  color: text("color").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  deleted: boolean("deleted").notNull().default(false),
}, (table) => [index("categories_user_updated_idx").on(table.userId, table.updatedAt)]);

export const trackerSessions = pgTable("tracker_sessions", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").notNull(),
  categoryName: text("category_name").notNull(),
  status: text("status").notNull(),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  endedAt: bigint("ended_at", { mode: "number" }).notNull(),
  note: text("note").notNull().default(""),
  summary: text("summary").notNull().default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  deleted: boolean("deleted").notNull().default(false),
}, (table) => [index("tracker_sessions_user_updated_idx").on(table.userId, table.updatedAt)]);
