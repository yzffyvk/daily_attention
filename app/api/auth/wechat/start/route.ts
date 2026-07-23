import { env } from "cloudflare:workers";
import { WECHAT_STATE_COOKIE } from "@/app/wechat-auth";

type Bindings = {
  WECHAT_APP_ID?: string;
  WECHAT_REDIRECT_URI?: string;
};

function cookie(value: string) {
  return `${WECHAT_STATE_COOKIE}=${value}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function GET(request: Request) {
  const bindings = env as unknown as Bindings;
  if (!bindings.WECHAT_APP_ID) {
    return new Response("微信登录尚未配置 AppID", { status: 503 });
  }

  const state = crypto.randomUUID();
  const callbackUrl =
    bindings.WECHAT_REDIRECT_URI ??
    `${new URL(request.url).origin}/api/auth/wechat/callback`;
  const authorizeUrl = new URL("https://open.weixin.qq.com/connect/qrconnect");
  authorizeUrl.searchParams.set("appid", bindings.WECHAT_APP_ID);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "snsapi_login");
  authorizeUrl.searchParams.set("state", state);

  const response = Response.redirect(`${authorizeUrl.toString()}#wechat_redirect`);
  response.headers.append("set-cookie", cookie(state));
  return response;
}
