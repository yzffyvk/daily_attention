// Color, persistence and responsive checks using synthetic data only.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:4300";
const output = "/tmp/aura-theme-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const contrastReports = [];
async function inspect(page, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
  const contrast = await page.evaluate(() => {
    const rgb = s => [...s.matchAll(/[\d.]+/g)].map(v => Number(v[0]));
    const luminance = c => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    const issues = [];
    for (const el of document.querySelectorAll("h1,h2,h3,h4,p,label,button,small,.aura-avatar-name,.aura-avatar-description,.map-origin")) {
      if (!el.checkVisibility() || el.closest("[hidden], [disabled]")) continue;
      if (!Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue;
      const style = getComputedStyle(el);
      const color = rgb(style.color);
      let bg = [251, 248, 241], node = el;
      while (node) {
        const candidate = rgb(getComputedStyle(node).backgroundColor);
        if (candidate.length >= 3 && (candidate.length < 4 || candidate[3] === 1)) { bg = candidate; break; }
        node = node.parentElement;
      }
      const l1 = luminance(color), l2 = luminance(bg);
      const ratio = (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
      const required = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700 ? 3 : 4.5;
      if (ratio + .01 < required) issues.push({ selector: el.className, text: el.textContent.trim().slice(0,45), ratio: Math.round(ratio*100)/100, color:style.color, background:bg });
    }
    return issues;
  });
  contrastReports.push({name,issues:contrast});
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
try {
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: {width, height:960}, reducedMotion:"reduce" });
    const page = await context.newPage();
    page.on("pageerror", e => failures.push(e.message));
    page.on("console", msg => { if(msg.type()==="error") failures.push(msg.text()); });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { failures.push(`external request: ${url.origin}`); return route.abort(); }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (route.request().method() !== "GET") { failures.push(`unexpected write: ${url.pathname}`); return route.abort(); }
      const data = url.pathname === "/api/me" ? {profile:{id:"visual-fixture",email:"visual@example.invalid",displayName:"学习者",avatarKey:1,onboardingCompleted:true}}
        : url.pathname === "/api/checkins/stats" ? {totalCount:3,currentStreak:2,hasTodayRecord:false}
        : url.pathname === "/api/checkins" || url.pathname === "/api/knowledge-narratives" ? [] : null;
      return route.fulfill({json:{ok:true,data,requestId:"theme-qa"}});
    });
    await page.goto(`${origin}/?fixture=1`,{waitUntil:"networkidle"});
    await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
    await page.getByRole("button",{name:"切换为浅色"}).click();
    await expect(page.locator("body")).toHaveCSS("background-color","rgb(251, 248, 241)");
    await expect(page.locator(".current-account img")).toHaveAttribute("src","/avatars/aura-dreamer-light.png");
    await inspect(page,`workspace-light-${width}`);
    await page.reload({waitUntil:"networkidle"});
    await expect(page.locator("html")).toHaveAttribute("data-theme","light");
    await page.getByRole("button",{name:"AI 提炼",exact:false}).click();
    await inspect(page,`ai-light-${width}`);
    await page.getByRole("button",{name:"串联知识",exact:true}).click();
    await inspect(page,`library-light-${width}`);
    await page.goto(`${origin}/?view=knowledge-map&fixture=1`,{waitUntil:"networkidle"});
    await inspect(page,`map-light-${width}`);
    await page.getByRole("region",{name:"概念关系图"}).getByRole("button",{name:"查看概念 需求假设",exact:true}).click();
    await inspect(page,`map-supplement-light-${width}`);
    await page.getByRole("link",{name:"原始记录展示"}).click();
    await inspect(page,`sources-light-${width}`);
    await page.goto(`${origin}/?view=onboarding&fixture=1`,{waitUntil:"networkidle"});
    await inspect(page,`onboarding-light-${width}`);
    await page.getByRole("button",{name:"切换为深色"}).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
    await page.reload({waitUntil:"networkidle"});
    await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
    await context.close();
  }
  await writeFile(`${output}/contrast.json`,JSON.stringify(contrastReports,null,2));
  expect(failures).toEqual([]);
  expect(contrastReports.flatMap(r=>r.issues.map(issue=>({view:r.name,...issue})))).toEqual([]);
  console.log(JSON.stringify({result:"PASS",viewports:[1440,768,390,320],screenshots:output,checked:"switching, reload persistence, 5 light assets, forms, AI, knowledge library, graph, sources, contrast, no overflow or API writes"},null,2));
} finally { await browser.close(); }
