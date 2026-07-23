import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses WeChat QR login before the application", async () => {
  const [page, auth, startRoute, callbackRoute, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/wechat-auth.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/auth/wechat/start/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/auth/wechat/callback/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /getWeChatUser/);
  assert.match(page, /\/api\/auth\/wechat\/start/);
  assert.match(page, /微信扫码登录/);
  assert.match(page, /微信扫码登录后，你的每日学习记录会安全保存/);
  assert.match(auth, /attention_wechat_session/);
  assert.match(startRoute, /open\.weixin\.qq\.com\/connect\/qrconnect/);
  assert.match(startRoute, /snsapi_login/);
  assert.match(callbackRoute, /api\.weixin\.qq\.com\/sns\/oauth2\/access_token/);
  assert.match(callbackRoute, /authSessions/);
  assert.match(layout, /title:\s*"今天你attention了吗？"/);
});

test("loads complete records when a calendar date is selected", async () => {
  const client = await readFile(
    new URL("../app/attention-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(client, /requestCheckIns/);
  assert.match(client, /selectDate/);
  assert.match(client, /draftFromRecord\(record\)/);
  assert.match(client, /setSelectedDate\(date\)/);
  assert.match(client, /setDraft\(draftFromRecord\(record\)\)/);
  assert.match(client, /完成今日打卡/);
  assert.match(client, /把每天学到的一点新知，积累成看得见的成长/);
  assert.doesNotMatch(client, /ATTENTION ARCHIVE|最近学习记录/);
});

test("stores dated records behind authenticated APIs", async () => {
  const [schema, listApi, saveApi, imageApi, hosting, packageJson] =
    await Promise.all([
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/checkins/route.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/api/checkins/[date]/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/checkins/[date]/image/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);

  assert.match(schema, /wechat_users/);
  assert.match(schema, /auth_sessions/);
  assert.match(schema, /check_ins_user_date_unique/);
  assert.match(listApi, /getWeChatUser/);
  assert.match(saveApi, /onConflictDoUpdate/);
  assert.match(saveApi, /ATTENTION_IMAGES/);
  assert.match(imageApi, /getWeChatUser/);
  assert.match(hosting, /"d1":\s*"DB"/);
  assert.match(hosting, /"r2":\s*"ATTENTION_IMAGES"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
