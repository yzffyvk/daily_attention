import { env } from "cloudflare:workers";
import { authSessions, wechatUsers } from "@/db/schema";
import { getDb } from "@/db";
import {
  hashSessionToken,
  SESSION_COOKIE,
  WECHAT_STATE_COOKIE,
} from "@/app/wechat-auth";

type Bindings = {
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
};

type TokenResponse = {
  access_token?: string;
  openid?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

type UserInfoResponse = {
  openid?: string;
  unionid?: string;
  nickname?: string;
  headimgurl?: string;
  errcode?: number;
  errmsg?: string;
};

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return cookieHeader
    .split(";")
    .map((item) => item.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

function sessionCookie(token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, WECHAT_STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) {
    return new Response("微信登录校验失败，请重新扫码", { status: 400 });
  }

  const bindings = env as unknown as Bindings;
  if (!bindings.WECHAT_APP_ID || !bindings.WECHAT_APP_SECRET) {
    return new Response("微信登录配置不完整", { status: 503 });
  }

  const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  tokenUrl.searchParams.set("appid", bindings.WECHAT_APP_ID);
  tokenUrl.searchParams.set("secret", bindings.WECHAT_APP_SECRET);
  tokenUrl.searchParams.set("code", code);
  tokenUrl.searchParams.set("grant_type", "authorization_code");
  const token = (await fetch(tokenUrl).then((response) =>
    response.json(),
  )) as TokenResponse;
  if (!token.access_token || !token.openid) {
    return new Response(token.errmsg || "微信授权码兑换失败", { status: 502 });
  }

  const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
  profileUrl.searchParams.set("access_token", token.access_token);
  profileUrl.searchParams.set("openid", token.openid);
  profileUrl.searchParams.set("lang", "zh_CN");
  const profile = (await fetch(profileUrl).then((response) =>
    response.json(),
  )) as UserInfoResponse;
  if (!profile.openid) {
    return new Response(profile.errmsg || "微信用户信息读取失败", {
      status: 502,
    });
  }

  const userId = profile.openid;
  const updatedAt = new Date().toISOString();
  const db = getDb();
  await db
    .insert(wechatUsers)
    .values({
      id: userId,
      openId: profile.openid,
      unionId: profile.unionid ?? token.unionid ?? null,
      nickname: profile.nickname || "微信用户",
      avatarUrl: profile.headimgurl ?? "",
      updatedAt,
    })
    .onConflictDoUpdate({
      target: wechatUsers.id,
      set: {
        openId: profile.openid,
        unionId: profile.unionid ?? token.unionid ?? null,
        nickname: profile.nickname || "微信用户",
        avatarUrl: profile.headimgurl ?? "",
        updatedAt,
      },
    });

  const rawSessionToken = crypto.randomUUID() + crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const maxAge = 60 * 60 * 24 * 30;
  await db.insert(authSessions).values({
    id: sessionId,
    userId,
    tokenHash: await hashSessionToken(rawSessionToken),
    expiresAt: new Date(Date.now() + maxAge * 1000).toISOString(),
  });

  const response = Response.redirect(new URL("/", request.url));
  response.headers.append("set-cookie", sessionCookie(rawSessionToken, maxAge));
  response.headers.append(
    "set-cookie",
    `${WECHAT_STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );
  return response;
}
