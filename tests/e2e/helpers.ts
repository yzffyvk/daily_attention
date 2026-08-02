import { expect, test, type Page } from "@playwright/test";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const password = "password123";
export const appHeading = /今天你\s*attention\s*了吗？/;

export async function waitForClient(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(700);
}

const projectEmailIds: Record<string, number> = {
  "flows-desktop": 1,
  desktop: 2,
  tablet: 3,
  mobile: 4,
};
const reservedE2EEmail = /^email-[1-4]-[0-9]{4}-[0-9]+-[0-9]+-[0-9]+@e2e\.daily-attention\.invalid$/u;
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const registryDirectoryName = "ai-learning-checkin-email-auth-e2e-registry";

export function assertReservedE2EEmail(email: string) {
  if (!reservedE2EEmail.test(email)) {
    throw new Error("Cannot use a non-reserved E2E email");
  }
}

function emailPart(value: number, width: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 10 ** width) {
    throw new Error(`${label} must fit in ${width} decimal digits`);
  }
  return String(value).padStart(width, "0");
}

export function uniqueEmail(
  projectName: string,
  workerIndex: number,
  retry: number,
  invocation: number,
  runScope: number,
) {
  const projectId = projectEmailIds[projectName];
  if (projectId === undefined) throw new Error(`Unknown E2E project: ${projectName}`);
  return `email-${projectId}-${emailPart(runScope, 4, "runScope")}-${emailPart(workerIndex, 1, "workerIndex")}-${emailPart(retry, 1, "retry")}-${emailPart(invocation, 1, "invocation")}@e2e.daily-attention.invalid`;
}

export function recordE2EEmailOwnership(userId: string, email: string) {
  if (!userIdPattern.test(userId)) {
    throw new Error("Cannot record invalid E2E user ownership");
  }
  assertReservedE2EEmail(email);
  const registry = process.env.E2E_EMAIL_REGISTRY_FILE;
  const registryDirectory = join(tmpdir(), registryDirectoryName);
  const expectedRegistry = join(registryDirectory, "emails");
  if (!registry || registry !== expectedRegistry) {
    throw new Error("E2E email registry path is unavailable");
  }
  const directoryMetadata = lstatSync(registryDirectory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error("E2E email registry directory is invalid");
  }
  const registryMetadata = lstatSync(registry);
  if (!registryMetadata.isFile() || registryMetadata.isSymbolicLink()) {
    throw new Error("E2E email registry file is invalid");
  }
  if (typeof fsConstants.O_NOFOLLOW !== "number" || fsConstants.O_NOFOLLOW === 0) {
    throw new Error("Safe E2E email registry writes are unavailable");
  }

  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      registry,
      fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW,
    );
    if (!fstatSync(descriptor).isFile()) {
      throw new Error("E2E email registry descriptor is invalid");
    }
    writeSync(
      descriptor,
      `${JSON.stringify({ userId, email })}\n`,
      null,
      "utf8",
    );
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
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

function e2eClientIp(email: string) {
  for (let collision = 0; collision < 256; collision += 1) {
    const hash = hashValue(`${email}:${collision}`);
    const ip = `10.${1 + (hash >>> 16) % 254}.${1 + (hash >>> 8) % 254}.${1 + hash % 254}`;
    if (!assignedClientIps.has(ip)) {
      assignedClientIps.add(ip);
      return ip;
    }
  }
  throw new Error("Unable to allocate an isolated E2E client address");
}

export async function register(page: Page, email?: string) {
  const allocatedEmail = email ?? (() => {
    const testInfo = test.info();
    return uniqueEmail(
      testInfo.project.name,
      testInfo.workerIndex,
      testInfo.retry,
      registrationSequence++,
      currentRunScope(),
    );
  })();
  assertReservedE2EEmail(allocatedEmail);
  await page.context().setExtraHTTPHeaders({ "CF-Connecting-IP": e2eClientIp(allocatedEmail) });
  await page.goto("/register", { waitUntil: "load" });
  await waitForClient(page);
  await page.getByRole("link", { name: "返回登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/register", { waitUntil: "load" });
  await waitForClient(page);
  await page.getByLabel("邮箱").fill(allocatedEmail);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码").fill(password);
  const registrationResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/auth/register" && response.request().method() === "POST";
  });
  await page.getByRole("button", { name: "创建账号" }).click();
  const response = await registrationResponse;
  if (!response.ok()) {
    throw new Error(`E2E registration failed with status ${response.status()}`);
  }
  const body = await response.json() as {
    ok?: unknown;
    data?: { profile?: { id?: unknown; email?: unknown } };
  };
  const profile = body.data?.profile;
  if (
    body.ok !== true
    || typeof profile?.id !== "string"
    || profile.email !== allocatedEmail
  ) {
    throw new Error("E2E registration returned invalid ownership");
  }
  recordE2EEmailOwnership(profile.id, allocatedEmail);

  const recoveryCode = page.locator('output[aria-label="恢复码"]');
  await expect(page.getByRole("heading", { name: "恢复码只显示这一次" })).toBeVisible();
  const code = (await recoveryCode.textContent())?.trim();
  if (!code) throw new Error("The registration dialog did not show a recovery code");
  await page.getByRole("button", { name: "我已保存" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await waitForClient(page);
  await page.getByLabel("邮箱").fill(allocatedEmail);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/", { waitUntil: "load" });
  await expect(page).toHaveURL(/\/onboarding$/);
  await waitForClient(page);
  await page.getByLabel("名称").fill("E2E 学习者");
  await expect(page.getByLabel("名称")).toHaveValue("E2E 学习者");
  await page.getByLabel("头像 4").check();
  const onboardingResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/onboarding" && response.request().method() === "POST";
  });
  await page.getByRole("button", { name: "进入学习空间" }).click();
  const completedOnboarding = await onboardingResponse;
  if (!completedOnboarding.ok()) {
    throw new Error(`E2E onboarding failed with status ${completedOnboarding.status()}`);
  }
  await expect(page.getByRole("button", { name: "打开账户菜单" })).toBeVisible({
    timeout: 15_000,
  });
  return { code, email: allocatedEmail };
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
