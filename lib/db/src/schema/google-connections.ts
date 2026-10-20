import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const googleConnectionsTable = pgTable("google_connections", {
  email: varchar("email", { length: 320 }).primaryKey(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scopes: text("scopes").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertGoogleConnectionSchema = createInsertSchema(
  googleConnectionsTable,
).omit({ updatedAt: true });

export type InsertGoogleConnection = z.infer<
  typeof insertGoogleConnectionSchema
>;
export type GoogleConnection = typeof googleConnectionsTable.$inferSelect;
