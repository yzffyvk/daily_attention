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
  const part = q => page.getByRole('button', { name: `展开核心部分：${/[。！？：]/u.test(q.mainlineRole) || q.mainlineRole.length > 18 ? q.scope : q.mainlineRole}`, exact: true });
  const openPart = async q => {
    if (await part(q).getAttribute('aria-expanded') !== 'true') await part(q).click();
    const show = page.getByRole('button', { name: '查看简图', exact: true });
    if (await show.count()) await show.click();
  };
  // The default overview must not expose answers or a dense diagram.
  await expect(page.locator('.question-section-toggle')).toHaveCount(s.questions.length);
  await expect(page.locator('.question-direct-answer')).toHaveCount(0);
  await expect(page.locator('.question-graph')).toHaveCount(0);
  for (const qid of s.questionOrder) {
    const q = s.questions.find(q => q.id === qid);
    await openPart(q);
    await expect(page.locator('.question-direct-answer')).toHaveText(q.answer);
    await expect(page.getByRole('heading', { name: q.title, exact: true })).toHaveCount(1);
    await expect(page.getByRole('region', { name: '节点解释' })).toHaveCount(0);
    for (const v of q.views) {
      if (q.views.length > 1) await page.getByRole('group', { name: '本题局部视图' }).getByRole('button', { name: v.title, exact: true }).click();
      const map = page.getByRole('group', { name: '骨架节点' });
      await expect(map.locator('.question-graph-node')).toHaveCount(v.nodeIds.length);
      const expectedNames = v.nodeIds.map(id => s.nodes.find(n => n.id === id).name).sort();
      expect((await map.locator('.question-graph-node').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))).sort()).toEqual(expectedNames);
      const localNames = new Set(expectedNames);
      for (const relation of v.relationIds.map(id => s.relations.find(e => e.id === id))) {
        expect(localNames.has(s.nodes.find(n => n.id === relation.from).name)).toBe(true);
        expect(localNames.has(s.nodes.find(n => n.id === relation.to).name)).toBe(true);
      }
      const found = [];
      const next = page.getByRole('button', { name: '下一条关系', exact: true });
      do {
        found.push(...await page.locator('.question-graph-label').evaluateAll(els => els.map(el => Number(el.dataset.edgeIndex))));
        if (!await next.count() || !await next.isEnabled()) break;
        await next.click();
      } while (true);
      expect([...new Set(found)].sort((a, b) => a - b)).toEqual(v.relationIds.map((_, i) => i));
      await expect(page.locator('.question-graph-lines')).toHaveCount(0);
      // Shared nodes use the same on-demand explanation, with no ownership or cross-question panels.
      const n = s.nodes.find(n => n.id === (v.referenceNodeIds[0] ?? v.nodeIds[0]));
      const trigger = map.getByRole('button', { name: n.name, exact: true });
      await trigger.click();
      await expect(page.getByRole('region', { name: '节点解释' })).toContainText(n.explanation);
      await expect(page.getByText('它属于什么', { exact: true })).toHaveCount(0);
      await expect(page.getByText('与其他问题的联系', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: '收起详情', exact: true }).click();
      await expect(trigger).toBeFocused();
      checks.push(`${q.title} / ${v.title}: one answer, all nodes/relations accessible, on-demand explanation`);
    }
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '展开阅读', exact: true })).toBeFocused();
  for (const width of [1487, 1024, 390, 320]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1058 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.getByRole('button', { name: '展开阅读', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const dimensions = await page.evaluate(() => ({ window: innerWidth, page: document.documentElement.scrollWidth, dialog: document.querySelector('.structure-reader-dialog').scrollWidth }));
    expect(dimensions.page).toBeLessThanOrEqual(width); expect(dimensions.dialog).toBeLessThanOrEqual(width);
    for (const q of s.questions) {
      await openPart(q);
      for (const v of q.views) {
        if (q.views.length > 1) await page.getByRole('group', { name: '本题局部视图' }).getByRole('button', { name: v.title, exact: true }).click();
        await expect(page.getByRole('group', { name: '骨架节点' }).getByRole('button').first()).toBeVisible();
        // Inspect actual DOM geometry and unclipped text at every supported width.
        await expect.poll(async () => page.locator('.question-graph-node, .question-graph-label').evaluateAll(elements => elements.filter(el => {
          const rect = el.getBoundingClientRect(), parent = el.closest('.question-graph').getBoundingClientRect();
          return rect.left < parent.left - 1 || rect.right > parent.right + 1 || el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
        }).map(el => el.textContent))).toEqual([]);
      }
    }
    const first = part(s.questions.find(q => q.id === s.questionOrder[0]));
    if (await first.getAttribute('aria-expanded') === 'true') await first.click();
    else { await first.click(); await first.click(); }
    await dialog.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `${output}/${width}-${theme}.png` });
    await page.keyboard.press('Escape');
    checks.push(`${width}px ${theme}: no page overflow, all diagrams visible, unclipped labels and fullscreen`);
  }
  expect(pageErrors).toEqual([]);
  const report = { dataKind: real ? 'real-generated' : 'synthetic-fixture', jobId: real?.jobId ?? null, questions: s.questions.length, nodes: s.nodes.length, relations: s.relations.length, checks, pageErrors };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
