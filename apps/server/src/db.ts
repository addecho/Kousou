import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import type { Plan } from "@kousou/core";
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required. Run pnpm setup.");
export const sql = postgres(process.env.DATABASE_URL, { max: 8 });
export const plans = pgTable("checkout_plans", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  revision: integer("revision").notNull(),
  document: jsonb("document").$type<Plan>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const db = drizzle(sql);
