// Render either a saved real generated result or clearly labeled synthetic fixture.
// No credentials, model calls, or server-side writes.
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseQuestionSummary, serializeQuestionSummary } from '../../lib/domain/knowledge-questions.ts';
import { questionSummaryFixture } from '../helpers/knowledge-questions-fixture.ts';
const [resultPath, output = '/tmp/aura-question-reader'] = process.argv.slice(2);
const real = resultPath && resultPath !== 'fixture' ? JSON.parse(await readFile(resultPath, 'utf8')) : null;
const summary = real ? real.result.summary : serializeQuestionSummary(questionSummaryFixture());
const doc = parseQuestionSummary(summary);
if (!doc) throw new Error('Valid question document required');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [], pageErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1487, height: 1058 } });
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.addInitScript(value => { window.__auraQuestionSummary = value; }, summary);
  await page.goto('http://127.0.0.1:4300/?view=question-reader&fixture=1', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '展开阅读', exact: true }).click();
  const s = doc.structure;
  for (const qid of s.questionOrder) {
    const q = s.questions.find(q => q.id === qid);
    if (s.questions.length > 1) await page.getByRole('button', { name: `阅读问题：${q.title}`, exact: true }).click();
    await expect(page.getByRole('region', { name: '本题答案' })).toContainText(q.answer);
    for (const v of q.views) {
      if (q.views.length > 1) await page.getByRole('group', { name: '本题局部视图' }).getByRole('button', { name: v.title, exact: true }).click();
      const map = page.getByRole('group', { name: '骨架节点' });
      await expect(map.getByRole('button')).toHaveCount(v.nodeIds.length);
      const expectedNames = v.nodeIds.map(id => s.nodes.find(n => n.id === id).name).sort();
      expect((await map.getByRole('button').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))).sort()).toEqual(expectedNames);
      const localNames = new Set(expectedNames);
      for (const relation of v.relationIds.map(id => s.relations.find(e => e.id === id))) {
        expect(localNames.has(s.nodes.find(n => n.id === relation.from).name)).toBe(true);
        expect(localNames.has(s.nodes.find(n => n.id === relation.to).name)).toBe(true);
      }
      if (v.referenceNodeIds.length) {
        const n = s.nodes.find(n => n.id === v.referenceNodeIds[0]);
        const owner = s.questions.find(q => q.id === n.homeQuestionId);
        await expect(map.getByRole('button', { name: n.name, exact: true }).getByText(/^引自问题/)).toBeVisible();
        await map.getByRole('button', { name: n.name, exact: true }).click();
        await page.getByRole('button', { name: `查看完整解释：${owner.title}`, exact: true }).click();
        await page.getByRole('button', { name: `返回来源问题：${q.title}`, exact: true }).click();
        await expect(page.getByRole('region', { name: '节点解释' })).toContainText(n.explanation);
        await page.getByRole('button', { name: '回到本题答案', exact: true }).click();
      }
      checks.push(`${q.title} / ${v.title}: exact local members, answer, references`);
    }
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '展开阅读', exact: true })).toBeFocused();
  for (const width of [1487, 1024, 390]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1058 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.getByRole('button', { name: '展开阅读', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const dimensions = await page.evaluate(() => ({ window: innerWidth, page: document.documentElement.scrollWidth, dialog: document.querySelector('.structure-reader-dialog').scrollWidth }));
    expect(dimensions.page).toBeLessThanOrEqual(width); expect(dimensions.dialog).toBeLessThanOrEqual(width);
    if (width === 390) {
      await expect(page.getByRole('group', { name: '骨架节点' })).toBeHidden();
      await page.getByRole('button', { name: /展开结构图/ }).click();
      await expect(page.getByRole('group', { name: '骨架节点' })).toBeVisible();
      await page.getByRole('button', { name: /收起结构图/ }).click();
    }
    await dialog.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `${output}/${width}-${theme}.png` });
    await page.keyboard.press('Escape');
    checks.push(`${width}px ${theme}: no page overflow, fullscreen and mobile map disclosure`);
  }
  expect(pageErrors).toEqual([]);
  const report = { dataKind: real ? 'real-generated' : 'synthetic-fixture', jobId: real?.jobId ?? null, questions: s.questions.length, nodes: s.nodes.length, relations: s.relations.length, checks, pageErrors };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
