import { expect, test } from "@playwright/test";
import { appHeading, register } from "./helpers";

test("keeps the journal usable without horizontal overflow or sticky overlap", async ({ page }) => {
  await register(page);
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("heading", { name: appHeading })).toHaveCSS("white-space", "nowrap");
  await expect(page.getByTestId("month-calendar")).toBeVisible();
  await expect(page.getByTestId("checkin-actions")).toBeVisible();

  const field = page.getByLabel("灵感记录");
  await expect(field).toBeEnabled();
  const scrollState = await page.evaluate(async () => {
    const scroller = document.scrollingElement as HTMLElement | null;
    if (!scroller) return { reached: false, reason: "missing scrolling element" };
    const previousScrollBehavior = scroller.style.scrollBehavior;
    scroller.style.scrollBehavior = "auto";
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    scroller.style.scrollBehavior = previousScrollBehavior;
    return {
      reached: Math.ceil(scroller.scrollTop + window.innerHeight) >= scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
      innerHeight: window.innerHeight,
      visualViewportHeight: window.visualViewport?.height ?? null,
      scrollHeight: scroller.scrollHeight,
      windowY: window.scrollY,
    };
  });
  expect(scrollState.reached, JSON.stringify(scrollState)).toBe(true);

  const [fieldBox, actionBox] = await Promise.all([field.boundingBox(), page.getByTestId("checkin-actions").boundingBox()]);
  expect(fieldBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(fieldBox!.y + fieldBox!.height).toBeLessThanOrEqual(actionBox!.y + 1);
});
