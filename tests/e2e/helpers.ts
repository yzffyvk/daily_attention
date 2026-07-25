import { expect, type Page } from "@playwright/test";

export const password = "password123";
export const appHeading = /今天你\s*attention\s*了吗？/;

export async function waitForClient(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(700);
}

export function uniquePhone(seed: number) {
  return `139${String(seed).padStart(8, "0").slice(-8)}`;
}

const assignedClientIps = new Set<string>();
let phoneSeed = Date.now();

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

export async function register(page: Page, phone = uniquePhone(phoneSeed++)) {
  await page.context().setExtraHTTPHeaders({ "CF-Connecting-IP": e2eClientIp(phone) });
  await page.goto("/register", { waitUntil: "load" });
  await waitForClient(page);
  await expect(page.getByRole("link", { name: "返回登录" })).toHaveAttribute("href", "/login");
  await page.getByLabel("手机号").fill(phone);
  await page.getByLabel("头像 4").check();
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码").fill(password);
  await page.getByRole("button", { name: "注册并进入" }).click();

  const recoveryCode = page.locator('output[aria-label="恢复码"]');
  await expect(page.getByRole("heading", { name: "恢复码只显示这一次" })).toBeVisible();
  const code = (await recoveryCode.textContent())?.trim();
  if (!code) throw new Error("The registration dialog did not show a recovery code");
  await page.getByRole("button", { name: "我已保存" }).click();
  await expect(page.getByRole("button", { name: "打开账户菜单" })).toBeVisible();
  return { code, phone };
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
