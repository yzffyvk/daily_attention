import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { authSessions, wechatUsers } from "@/db/schema";

export const SESSION_COOKIE = "attention_wechat_session";
export const WECHAT_STATE_COOKIE = "attention_wechat_state";

export type WeChatUser = {
  id: string;
  displayName: string;
  avatarUrl: string;
};

export async function hashSessionToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function getWeChatUser(): Promise<WeChatUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await getDb()
    .select({
      id: wechatUsers.id,
      nickname: wechatUsers.nickname,
      avatarUrl: wechatUsers.avatarUrl,
    })
    .from(authSessions)
    .innerJoin(wechatUsers, eq(authSessions.userId, wechatUsers.id))
    .where(
      and(
        eq(authSessions.tokenHash, await hashSessionToken(token)),
        gt(authSessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);

  return row
    ? {
        id: row.id,
        displayName: row.nickname || "微信用户",
        avatarUrl: row.avatarUrl,
      }
    : null;
}
