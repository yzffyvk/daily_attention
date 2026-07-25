import { expect, test, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const password = "password123";
export const appHeading = /今天你\s*attention\s*了吗？/;

export async function waitForClient(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(700);
}

const projectPhoneIds: Record<string, number> = {
  "flows-desktop": 1,
  desktop: 2,
  tablet: 3,
  mobile: 4,
};
const reservedE2EPhone = /^139[1-4][0-9]{7}$/u;
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function phonePart(value: number, width: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 10 ** width) {
    throw new Error(`${label} must fit in ${width} decimal digits`);
  }
  return String(value).padStart(width, "0");
}

export function uniquePhone(
  projectName: string,
  workerIndex: number,
  retry: number,
  invocation: number,
  runScope: number,
) {
  const projectId = projectPhoneIds[projectName];
  if (projectId === undefined) throw new Error(`Unknown E2E project: ${projectName}`);
  return `139${projectId}${phonePart(runScope, 4, "runScope")}${phonePart(workerIndex, 1, "workerIndex")}${phonePart(retry, 1, "retry")}${phonePart(invocation, 1, "invocation")}`;
}

export function recordE2EOwnership(userId: string, phone: string) {
  if (!userIdPattern.test(userId)) {
    throw new Error("Cannot record invalid E2E user ownership");
  }
  if (!reservedE2EPhone.test(phone)) {
    throw new Error(`Cannot record non-reserved E2E phone: ${phone}`);
  }
  const registry = process.env.E2E_PHONE_REGISTRY_FILE;
  if (!registry || !isAbsolute(registry)) {
    throw new Error("E2E phone registry path is unavailable");
  }
  appendFileSync(
    registry,
    `${JSON.stringify({ userId, phone })}\n`,
    { encoding: "utf8", flag: "a", mode: 0o600 },
  );
}

const assignedClientIps = new Set<string>();
let registrationSequence = 0;

function currentRunScope() {
  const value = process.env.E2E_RUN_SCOPE;
  if (!value || !/^[0-9]{4}$/u.test(value)) {
    throw new Error("E2E run scope is unavailable");
  }
  return Number(value);
}

function hashValue(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function e2eClientIp(phone: string) {
  for (let collision = 0; collision < 256; collision += 1) {
    const hash = hashValue(`${phone}:${collision}`);
    const ip = `10.${1 + (hash >>> 16) % 254}.${1 + (hash >>> 8) % 254}.${1 + hash % 254}`;
    if (!assignedClientIps.has(ip)) {
      assignedClientIps.add(ip);
      return ip;
    }
  }
  throw new Error("Unable to allocate an isolated E2E client address");
}

export async function register(page: Page, phone?: string) {
  const testInfo = test.info();
  const allocatedPhone = phone ?? uniquePhone(
    testInfo.project.name,
    testInfo.workerIndex,
    testInfo.retry,
    registrationSequence++,
    currentRunScope(),
  );
  await page.context().setExtraHTTPHeaders({ "CF-Connecting-IP": e2eClientIp(allocatedPhone) });
  await page.goto("/register", { waitUntil: "load" });
  await waitForClient(page);
  await page.getByRole("link", { name: "返回登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/register", { waitUntil: "load" });
  await waitForClient(page);
  await page.getByLabel("手机号").fill(allocatedPhone);
  await page.getByLabel("头像 4").check();
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码").fill(password);
  const registrationResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/auth/register" && response.request().method() === "POST";
  });
  await page.getByRole("button", { name: "注册并进入" }).click();
  const response = await registrationResponse;
  if (!response.ok()) {
    throw new Error(`E2E registration failed with status ${response.status()}`);
  }
  const body = await response.json() as {
    ok?: unknown;
    data?: { profile?: { id?: unknown; phone?: unknown } };
  };
  const profile = body.data?.profile;
  if (
    body.ok !== true
    || typeof profile?.id !== "string"
    || profile.phone !== allocatedPhone
  ) {
    throw new Error("E2E registration returned invalid ownership");
  }
  recordE2EOwnership(profile.id, allocatedPhone);

  const recoveryCode = page.locator('output[aria-label="恢复码"]');
  await expect(page.getByRole("heading", { name: "恢复码只显示这一次" })).toBeVisible();
  const code = (await recoveryCode.textContent())?.trim();
  if (!code) throw new Error("The registration dialog did not show a recovery code");
  await page.getByRole("button", { name: "我已保存" }).click();
  await expect(page.getByRole("button", { name: "打开账户菜单" })).toBeVisible();
  return { code, phone: allocatedPhone };
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await waitForClient(page);
}

export async function saveCheckIn(page: Page, attention: string) {
  await page.getByRole("textbox", { name: "attention", exact: true }).fill(attention);
  await page.getByRole("button", { name: /完成打卡|保存修改/ }).click();
  await expect(page.getByText(`${attention}`, { exact: true }).first()).toBeVisible();
}

export function otherDateLabel() {
  const date = new Date();
  date.setDate(date.getDate() === 1 ? 2 : date.getDate() - 1);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
