// The human-facing root must be interactive without knowing a demo query flag.
import { chromium, expect } from "@playwright/test";

const origin = "http://127.0.0.1:4300";
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const suffix of ["/", "/?theme=light", "/?demo=1&scenario=ai"]) {
    const page = await browser.newPage();
    page.on("pageerror", error => failures.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith("/api/")) {
        failures.push(`Unexpected live API: ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${origin}${suffix}`, { waitUntil: "networkidle" });
    const manual = page.getByRole("button", { name: /手动记录/ });
    const ai = page.getByRole("button", { name: /AI 提炼/ });
    await expect(manual).toBeEnabled();
    await expect(ai).toBeEnabled();
    await manual.click();
    await expect(manual).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#attention")).toBeEnabled();
    await page.locator("#attention").fill("手动记录的独立草稿");
    await page.locator("#summary").fill("切换方式后这段文字应当保留。");
    await ai.click();
    await expect(ai).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#source-url")).toHaveValue("https://example.com/learning/user-interviews");
    await manual.click();
    await expect(page.locator("#attention")).toHaveValue("手动记录的独立草稿");
    await expect(page.locator("#summary")).toHaveValue("切换方式后这段文字应当保留。");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.close();
  }
  expect(failures).toEqual([]);
  console.log("PASS: bare root, theme-only link, explicit demo; both modes clickable; independent drafts retained; no real API requests.");
} finally { await browser.close(); }
