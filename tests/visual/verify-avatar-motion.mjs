import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = '/tmp/aura-avatar-motion-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const report = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await page.goto('http://127.0.0.1:4300/avatar-motion.html', { waitUntil: 'networkidle' });
  const images = page.locator('.motion-review-card img');
  await expect(images).toHaveCount(5);
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: '切换为浅色' }).click();
    await expect.poll(() => images.evaluateAll(imgs => imgs.every(img => img.complete && img.naturalWidth === 320 && img.currentSrc.endsWith('.webp')))).toBe(true);
    const sources = await images.evaluateAll(imgs => imgs.map(img => new URL(img.currentSrc).pathname));
    expect(sources.every(source => theme === 'light' ? source.endsWith('-light.webp') : !source.endsWith('-light.webp'))).toBe(true);
    // Observe rendered pixels over a full action, not merely a WebP filename.
    const regions = page.locator('.motion-review-card .learning-persona-art');
    const samples = Array.from({ length: 5 }, () => new Set());
    for (let sample = 0; sample < 5; sample++) {
      for (let index = 0; index < 5; index++) samples[index].add((await regions.nth(index).screenshot()).toString('base64'));
      await page.waitForTimeout(600);
    }
    expect(samples.map(values => values.size).every(size => size > 1)).toBe(true);
    await page.screenshot({ path: `${output}/${theme}-desktop.png`, fullPage: true });
    report.push({ theme, sources, changingFrames: samples.map(values => values.size) });
  }
  await page.getByRole('button', { name: '查看原图' }).click();
  await expect.poll(() => images.evaluateAll(imgs => imgs.every(img => img.complete && img.currentSrc.endsWith('.png')))).toBe(true);
  await page.getByRole('button', { name: '播放动画' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => images.evaluateAll(imgs => imgs.every(img => img.complete && img.currentSrc.endsWith('.png')))).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => images.evaluateAll(imgs => imgs.every(img => img.complete && img.currentSrc.endsWith('.webp')))).toBe(true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${output}/light-${width}.png`, fullPage: true });
  }
  // A failed animation must reveal the original PNG in a real browser as well.
  const fallbackPage = await browser.newPage({ reducedMotion: 'no-preference' });
  await fallbackPage.route('**/avatars/motion/*.webp', route => route.abort());
  await fallbackPage.goto('http://127.0.0.1:4300/avatar-motion.html', { waitUntil: 'networkidle' });
  await expect.poll(() => fallbackPage.locator('.motion-review-card img').evaluateAll(imgs => imgs.length === 5 && imgs.every(img => img.complete && img.naturalWidth > 0 && img.currentSrc.endsWith('.png')))).toBe(true);
  expect(failures).toEqual([]);
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: true, report, widths: [1440, 390, 320], reducedMotion: true, errorFallback: true, failures }, null, 2));
  console.log(`Five avatars animate in both themes; reduced motion, error fallback and mobile layouts passed: ${output}`);
} finally { await browser.close(); }
