import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4300/?view=structure-reader&fixture=1&stress=1', { waitUntil: 'networkidle' });
  const name = 'A'.repeat(60);
  await expect(page.getByRole('group', { name: '本段节点' }).getByRole('button', { name, exact: true })).toBeVisible();
  const assertNoOverflow = async () => {
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, dialog: document.querySelector('.structure-reader-dialog')?.scrollWidth ?? 0 }));
    console.log(dimensions);
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.dialog).toBeLessThanOrEqual(dimensions.viewport);
  };
  await assertNoOverflow();
  await page.getByRole('button', { name: '展开阅读', exact: true }).click();
  await assertNoOverflow();
  await page.getByRole('button', { name: /展开结构图/ }).click();
  await page.getByRole('region', { name: '知识关系骨架' }).getByRole('button', { name: '查看关系：上下文压缩 ↔ KV Cache（权衡）', exact: true }).focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('region', { name: '关系解释' });
  await detail.getByRole('button', { name: '展开 KV Cache', exact: true }).focus();
  await page.keyboard.press('Tab');
  const summary = detail.locator('summary');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(detail.locator('blockquote')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '关闭全屏阅读', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '展开阅读', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
  console.log('PASS: 60-character node name, inline/fullscreen mobile overflow, native evidence keyboard loop, focus restoration.');
} finally { await browser.close(); }
