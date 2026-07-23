import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { authSessions } from "@/db/schema";
import {
  hashSessionToken,
  SESSION_COOKIE,
} from "@/app/wechat-auth";

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return cookieHeader
    .split(";")
    .map((item) => item.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

export async function GET(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    await getDb()
      .delete(authSessions)
      .where(eq(authSessions.tokenHash, await hashSessionToken(token)));
  }

  const response = Response.redirect(new URL("/", request.url));
  response.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );
  return response;
}
