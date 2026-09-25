import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output='/tmp/learning-persona-qa';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const names=['白日梦家','学者','技术发烧友','摸鱼家','行动派'];
const files=['dreamer','scholar','technophile','lounger','doer'];
const failures=[];
try {
  for (const width of [1440,390,320]) {
    const page=await browser.newPage({viewport:{width,height:900},timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
    await page.clock.setFixedTime(new Date('2026-09-10T02:00:00Z'));
    let profile={id:'visual-fixture',email:'visual@example.invalid',displayName:'学习者',avatarKey:1,onboardingCompleted:true};
    const writes=[];
    page.on('pageerror',error=>failures.push(error.message));
    page.on('console',message=>{if(message.type()==='error') failures.push(message.text());});
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!=='http://127.0.0.1:4300'){failures.push(`External request: ${url.origin}`);return route.abort();}
      if(!url.pathname.startsWith('/api/'))return route.continue();
      let data;
      if(url.pathname==='/api/me'){
        if(request.method()==='PATCH'){const body=request.postDataJSON();writes.push(body);profile={...profile,...body};}
        data={profile};
      }else if(url.pathname==='/api/checkins/stats')data={totalCount:0,currentStreak:0,hasTodayRecord:false};
      else if(url.pathname==='/api/knowledge-narratives'||url.pathname==='/api/checkins')data=[];
      else if(url.pathname.startsWith('/api/checkins/'))data=null;
      else {failures.push(`Unhandled API: ${url.pathname}`);return route.abort();}
      await route.fulfill({json:{ok:true,data,requestId:'persona-visual'}});
    });
    await page.goto('http://127.0.0.1:4300/?fixture=1',{waitUntil:'networkidle'});
    const header=page.locator('.app-header');
    const hero=page.getByRole('button',{name:'更换学习形象，当前为白日梦家'});
    await expect(hero).toBeVisible();
    const portrait=page.getByRole('button',{name:'打开账户菜单'}).locator('img');
    await expect(page.locator('.account-portrait')).toBeVisible();
    expect((await page.getByRole('button',{name:'打开账户菜单'}).boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect.poll(()=>portrait.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    await page.screenshot({path:`${output}/home-${width}.png`,fullPage:true});
    await page.getByRole('textbox',{name:'今日知识主题',exact:true}).fill('尚未保存的个人学习草稿');
    await hero.click();
    await page.getByRole('radio',{name:'学者',exact:true}).locator("..").click();
    await expect(portrait).toHaveAttribute('src','/avatars/aura-dreamer.png');
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await expect(hero).toBeFocused();
    expect(writes.length).toBe(0);
    await page.getByRole('button',{name:'串联知识',exact:true}).click();
    const empty=page.locator('.knowledge-library-empty');
    await expect(empty.locator('.learning-persona img')).toHaveAttribute('src','/avatars/aura-dreamer.png');
    for(const key of (width===1440 ? [2,3,4,5] : [3])){
      await page.getByRole('button',{name:/更换学习形象，当前为/}).click();
      await page.getByRole('radio',{name:names[key-1],exact:true}).locator("..").click();
      await page.getByRole('button',{name:'保存资料',exact:true}).click();
      await expect(page.getByRole('dialog',{name:'编辑资料'})).toHaveCount(0);
      const src=`/avatars/aura-${files[key-1]}.png`;
      await expect(portrait).toHaveAttribute('src',src);
      await expect(header.locator('.learning-persona img')).toHaveAttribute('src',src);
      await expect(empty.locator('.learning-persona img')).toHaveAttribute('src',src);
      await expect.poll(()=>header.locator('.learning-persona img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
      await page.getByRole('button',{name:'打开账户菜单'}).scrollIntoViewIfNeeded();
      await page.screenshot({path:`${output}/identity-${key}-${width}.png`,fullPage:true});
    }
    await page.getByRole('button',{name:'返回学习记录',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'今日知识主题',exact:true})).toHaveValue('尚未保存的个人学习草稿');
    await page.reload();
    await expect(page.getByRole('button',{name:`更换学习形象，当前为${names[profile.avatarKey-1]}`})).toBeVisible();
    await page.getByRole('button',{name:'串联知识',exact:true}).click();
    await expect(empty.locator('.learning-persona img')).toHaveAttribute('src',`/avatars/aura-${files[profile.avatarKey-1]}.png`);
    await page.screenshot({path:`${output}/library-${width}.png`,fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.close();
  }
  expect(failures).toEqual([]);
  await writeFile(`${output}/verification.json`,JSON.stringify({passed:true,widths:[1440,390,320],failures},null,2));
  console.log(`Persona display and selection synchronization passed: ${output}`);
}finally{await browser.close();}
