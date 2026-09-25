// Reproduce the screenshot's indefinite draft recovery without changing the editor.
import { chromium, expect } from "@playwright/test";

const origin = "http://127.0.0.1:4300";
const browser = await chromium.launch({ headless: true });
try {
  for (const storage of ["pending", "denied"]) {
    const context = await browser.newContext();
    await context.addInitScript(storage => {
      // Some embedded/private browser contexts never finish opening IndexedDB.
      Object.defineProperty(IDBFactory.prototype, "open", { value() {
        if (storage === "denied") throw new DOMException("Storage unavailable", "SecurityError");
        return Object.setPrototypeOf(new EventTarget(), IDBOpenDBRequest.prototype);
      } });
    }, storage);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith("/api/")) {
        errors.push(`Unexpected real request: ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${origin}/?demo=1&scenario=ai`, { waitUntil: "networkidle" });
    const manual = page.getByRole("button", { name: /手动记录/ });
    const ai = page.getByRole("button", { name: /AI 提炼/ });
    await expect(manual, `${storage}: draft recovery must not lock the demo`).toBeEnabled();
    await manual.click();
    await expect(manual).toHaveAttribute("aria-pressed", "true");
    await page.locator("#attention").fill("演示时保留我的手动草稿");
    await page.locator("#summary").fill("切换回来之后还在，刷新之后也还在。");
    await ai.click();
    await expect(ai).toHaveAttribute("aria-pressed", "true");
    await page.reload({ waitUntil: "networkidle" });
    await manual.click();
    await expect(page.locator("#attention")).toHaveValue("演示时保留我的手动草稿");
    await expect(page.locator("#summary")).toHaveValue("切换回来之后还在，刷新之后也还在。");
    await ai.click();
    await page.getByRole("button", { name: "生成知识小结", exact: true }).click();
    // Finish a background AI job while the independent manual draft stays open.
    await manual.click();
    await expect(page.getByText(/的 AI 小结已生成/)).toBeVisible({ timeout: 18000 });
    await ai.click();
    await expect(page.locator(".knowledge-summary-view")).toBeVisible();
    await manual.click();
    await expect(page.locator("#attention")).toHaveValue("演示时保留我的手动草稿");
    expect(errors).toEqual([]);
    console.log(`PASS: ${storage} IndexedDB; both modes, draft refresh, background AI result, no real API.`);
    await context.close();
  }
} finally { await browser.close(); }
