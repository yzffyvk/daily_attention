import { sql } from "drizzle-orm";
import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const wechatUsers = sqliteTable("wechat_users", {
  id: text("id").primaryKey(),
  openId: text("open_id").notNull(),
  unionId: text("union_id"),
  nickname: text("nickname").notNull(),
  avatarUrl: text("avatar_url").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => wechatUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const checkIns = sqliteTable(
  "check_ins",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => wechatUsers.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    attention: text("attention").notNull(),
    sourceUrl: text("source_url").notNull().default(""),
    summary: text("summary").notNull().default(""),
    inspiration: text("inspiration").notNull().default(""),
    imageKey: text("image_key"),
    imageName: text("image_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("check_ins_user_date_unique").on(table.userId, table.date),
  ],
);
