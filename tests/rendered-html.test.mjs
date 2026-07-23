import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("opens the local name-based login before the journal", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<AttentionApp \/>/);
  assert.doesNotMatch(page, /getWeChatUser|微信扫码登录|auth\/wechat/);
  assert.match(layout, /title:\s*"今天你attention了吗？"/);
});

test("registers profiles with their normalized name as the primary key", async () => {
  const client = await readFile(
    new URL("../app/attention-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(client, /DATABASE_VERSION = 2/);
  assert.match(client, /USER_STORE = "users"/);
  assert.match(client, /createObjectStore\(USER_STORE, \{ keyPath: "name" \}\)/);
  assert.match(client, /normalizeUserName/);
  assert.match(client, /transaction\.objectStore\(USER_STORE\)\.add\(profile\)/);
  assert.match(client, /这个名称已经注册过了/);
  assert.match(client, /AVATAR_IDS = \[1, 2, 3, 4, 5\]/);
  assert.match(client, /注册并进入/);
  assert.match(client, /选择名称登录/);
  assert.match(client, /注册新的名称/);
});

test("keeps each user's dated records isolated by name", async () => {
  const client = await readFile(
    new URL("../app/attention-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(client, /USER_RECORD_STORE = "user-checkins"/);
  assert.match(client, /keyPath: \["userId", "date"\]/);
  assert.match(client, /saveStoredCheckIn\(user\.name, nextRecord\)/);
  assert.match(client, /getStoredCheckIns\(user\.name\)/);
  assert.match(client, /migrateAnonymousRecords\(profile\.name\)/);
  assert.match(client, /CURRENT_USER_STORAGE_KEY/);
  assert.match(client, /退出当前用户/);
});

test("loads records and protects unsaved work when changing dates", async () => {
  const client = await readFile(
    new URL("../app/attention-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(client, /indexedDB\.open/);
  assert.match(client, /saveStoredCheckIn/);
  assert.match(client, /draftSignature/);
  assert.match(client, /requestDateChange/);
  assert.match(client, /setPendingDate\(date\)/);
  assert.match(client, /saveAndSwitch/);
  assert.match(client, /放弃修改/);
  assert.match(client, /取消/);
  assert.match(client, /draftFromRecord\(record\)/);
  assert.match(client, /setSelectedDate\(date\)/);
  assert.match(client, /setDraft\(draftFromRecord\(record\)\)/);
  assert.match(client, /一下，完成打卡/);
  assert.match(client, /每天留下一点新知，慢慢长成自己的知识地图/);
  assert.doesNotMatch(client, /ATTENTION ARCHIVE|最近学习记录/);
});

test("stores dated records and images in the current browser", async () => {
  const client = await readFile(
    new URL("../app/attention-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(client, /DATABASE_NAME = "attention-journal"/);
  assert.match(client, /createObjectStore\(USER_RECORD_STORE/);
  assert.match(client, /imageDataUrl/);
  assert.match(client, /仅此浏览器/);
  assert.match(client, /handleImageDrop/);
  assert.match(client, /onDrop=\{handleImageDrop\}/);
  assert.doesNotMatch(client, /fetch\("\/api\/checkins/);
});

test("celebrates only a first check-in and respects sound preferences", async () => {
  const [client, packageJson] = await Promise.all([
    readFile(new URL("../app/attention-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(client, /const isFirstCheckIn = !selectedRecord/);
  assert.match(client, /launchCelebration/);
  assert.match(client, /prefers-reduced-motion: reduce/);
  assert.match(client, /if \(!isMuted\) playCheckInChime\(\)/);
  assert.match(client, /MUTE_STORAGE_KEY/);
  assert.match(client, /window\.localStorage\.setItem\(MUTE_STORAGE_KEY/);
  assert.match(packageJson, /canvas-confetti/);
  assert.match(packageJson, /lucide-react/);
});

test("defines compact responsive calendar and sticky save controls", async () => {
  const styles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /\.calendar-cell\s*\{[^}]*height:\s*6\.7rem/s);
  assert.match(styles, /\.form-actions\s*\{[^}]*position:\s*sticky/s);
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.avatar-options/);
  assert.match(styles, /\.profile-list/);
  assert.doesNotMatch(styles, /border-radius:\s*(1[0-9]|[2-9][0-9])px/);
});
