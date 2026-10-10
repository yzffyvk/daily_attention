// Read-only acceptance against a saved, genuinely generated AI result.
// Usage: node tests/visual/verify-structure-reader.mjs SESSION_JSON RESULT_JSON OUTPUT_DIR
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { parseKnowledgeStructure } from '../../lib/domain/knowledge-structure.ts';

const [sessionPath, resultPath, output = '/tmp/aura-structure-reader'] = process.argv.slice(2);
if (!sessionPath || !resultPath) throw new Error('Provide the existing local acceptance session and successful result files.');
const session = JSON.parse(await readFile(sessionPath, 'utf8'));
const result = JSON.parse(await readFile(resultPath, 'utf8'));
const structure = parseKnowledgeStructure(result.result.summary);
if (!structure || result.status !== 'succeeded') throw new Error('A real successful structured result is required.');
const origin = process.env.ACCEPTANCE_ORIGIN || 'http://127.0.0.1:3001';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const pageErrors = [];
const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1487, height: 1058 }, timezoneId: 'Asia/Shanghai' });
  await context.addCookies(Object.entries(session.cookies).map(([name, value]) => ({ name, value, url: origin, httpOnly: true, sameSite: 'Lax' })));
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  const openRecord = async () => {
    await page.goto(origin, { waitUntil: 'networkidle' });
    const calendarToggle = page.getByRole('button', { name: '展开日历', exact: true });
    if (await calendarToggle.isVisible()) await calendarToggle.click();
    await page.locator('.calendar-cell').filter({ hasText: result.result.attention }).click();
    await page.getByRole('button', { name: /AI 提炼/ }).click();
    await expect(page.getByRole('heading', { name: result.result.attention, exact: true })).toBeVisible();
    await expect(page.getByLabel(/学习资料来源/)).toHaveValue(result.sourceUrl);
  };
  await openRecord();
  await page.getByRole('button', { name: '展开阅读', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '知识骨架阅读' });
  await expect(dialog).toBeVisible();
  const map = page.getByRole('group', { name: '骨架节点' });
  const coordinates = await map.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('style')));
  await expect(map.getByRole('button')).toHaveCount(structure.nodes.length);
  await page.getByRole('button', { name: '阅读 方法与过程', exact: true }).click();
  await page.getByRole('group', { name: '本段节点' }).getByRole('button', { name: '上下文压缩', exact: true }).click();
  await expect(page.getByRole('region', { name: '节点解释' })).toContainText('在两次 API 调用之间预处理');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: `${output}/desktop-dark.png` });
  await page.getByRole('region', { name: '知识关系骨架' }).screenshot({ path: `${output}/map-dark.png` });
  await page.getByRole('region', { name: '节点解释' }).screenshot({ path: `${output}/detail-dark.png` });
  await map.getByRole('button', { name: 'KV Cache', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.screenshot({ path: `${output}/cache-relations-dark.png` });
  await expect(page.getByRole('button', { name: '返回阅读：上下文压缩', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回阅读：上下文压缩', exact: true }).click();
  expect(await map.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('style')))).toEqual(coordinates);
  await page.getByRole('region', { name: '知识关系骨架' }).getByRole('button', { name: '查看关系：上下文压缩 ↔ KV Cache（权衡）', exact: true }).focus();
  await page.keyboard.press('Enter');
  const edge = page.getByRole('region', { name: '关系解释' });
  await expect(edge).toContainText('需在接近窗口阈值时批量处理');
  await edge.getByText('查看原文依据', { exact: true }).click();
  await expect(edge.locator('blockquote')).toContainText('虽然损失了部分缓存');
  await page.screenshot({ path: `${output}/edge-dark.png` });
  await page.getByRole('button', { name: '返回阅读：上下文压缩', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '展开阅读', exact: true })).toBeFocused();
  checks.push('saved article, route, node and edge keyboard navigation, evidence, return cursor, stable positions, Escape and focus restoration');
  for (const width of [1487, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1058 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.getByRole('button', { name: '展开阅读', exact: true }).click();
      await expect(page.getByRole('region', { name: '节点解释' })).toContainText('上下文压缩');
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.structure-reader-dialog').scrollWidth > innerWidth);
      expect(hasOverflow).toBe(false);
      if (width === 390) {
        const disclosure = page.getByRole('button', { name: /展开结构图/ });
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByRole('group', { name: '骨架节点' })).toBeHidden();
        await page.getByRole('region', { name: '节点解释' }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${output}/mobile-${theme}.png` });
        await disclosure.click();
        await expect(map).toBeVisible();
        await page.getByRole('button', { name: /收起结构图/ }).click();
      } else {
        await dialog.evaluate(element => { element.scrollTop = 0; });
        await page.screenshot({ path: `${output}/desktop-${width}-${theme}.png` });
      }
      await page.keyboard.press('Escape');
      checks.push(`${width}px ${theme}: readable responsive layout, no page overflow, fullscreen state retained`);
    }
  }
  await page.setViewportSize({ width: 1487, height: 1058 });
  await page.getByRole('button', { name: '收起日历', exact: true }).click();
  await page.locator('.relation-reader').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/inline-wide.png` });
  await openRecord();
  await expect(map.getByRole('button')).toHaveCount(structure.nodes.length);
  expect(pageErrors).toEqual([]);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, nodes: structure.nodes.length, relations: structure.relations.length, pageErrors, sourceUrl: result.sourceUrl, jobId: result.jobId, output }, null, 2));
  console.log(JSON.stringify({ checks, nodes: structure.nodes.length, relations: structure.relations.length, pageErrors, output }, null, 2));
} finally { await browser.close(); }
