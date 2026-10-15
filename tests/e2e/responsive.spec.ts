import { expect, test } from '@playwright/test';
import { appHeading, beginManualRecord, register } from './helpers';

test('keeps record lists, detail, albums and editing usable on each viewport',async({page},testInfo)=>{
 await register(page);
 const noOverflow=async()=>expect(await page.locator('body').evaluate(body=>body.scrollWidth<=window.innerWidth)).toBe(true);
 await noOverflow();
 const heading=page.getByRole('heading',{name:appHeading});await expect(heading).toBeVisible();
 const headingBox=await heading.boundingBox();expect(headingBox!.x).toBeGreaterThanOrEqual(0);expect(headingBox!.x+headingBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
 await expect(page.getByTestId('month-calendar')).toBeVisible();
 await expect(page.getByRole('region',{name:'我的专辑'})).toHaveCount(0);
 const account=page.getByRole('button',{name:'打开账户菜单',exact:true});
 await expect(account.locator('img')).toBeVisible();
 await expect(page.locator('.app-header .learning-persona')).toHaveCount(0);
 const navigation=page.getByRole('navigation',{name:'学习内容导航'});
 await expect(navigation.getByRole('button',{name:'待处理',exact:true})).toHaveCount(0);
 await expect(navigation.getByRole('button',{name:'未归类',exact:true})).toHaveCount(0);
 await navigation.getByRole('button',{name:'全部记录',exact:true}).click();
 await expect(page.getByRole('heading',{name:'全部记录',exact:true})).toBeVisible();
 await noOverflow();
 await navigation.getByRole('button',{name:'日历',exact:true}).click();
 await expect(page.getByTestId('month-calendar')).not.toBeVisible();
 await navigation.getByRole('button',{name:'专辑',exact:true}).click();
 const library=page.getByRole('region',{name:'专辑列表'});
 await expect(library.getByRole('heading',{name:'我的专辑',exact:true})).toBeVisible();
 const createAlbum=library.getByRole('button',{name:'新建专辑',exact:true});
 const createBox=await createAlbum.boundingBox();
 expect(createBox!.x).toBeGreaterThanOrEqual(0);
 expect(createBox!.x+createBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
 await createAlbum.click();
 const albumDialog=page.getByRole('dialog',{name:'新建专辑',exact:true});
 await albumDialog.getByLabel('专辑名称').fill('Responsive learning album');
 await albumDialog.getByRole('button',{name:'保存专辑',exact:true}).click();
 await expect(albumDialog).not.toBeVisible();
 await expect(library.getByRole('button',{name:'打开专辑 Responsive learning album',exact:true})).toBeVisible();
 await noOverflow();
 if(process.env.E2E_CAPTURE_UI==='true'){await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:`/tmp/aura-${testInfo.project.name}-albums.png`,fullPage:true});}
 await library.getByRole('button',{name:'打开专辑 Responsive learning album',exact:true}).click();
 await expect(navigation.getByRole('button',{name:'专辑',exact:true})).toHaveAttribute('aria-pressed','true');
 await navigation.getByRole('button',{name:'日历',exact:true}).click();
 await expect(page.getByTestId('month-calendar')).toBeVisible();

 await beginManualRecord(page);
 await page.getByRole('textbox',{name:'学习主题',exact:true}).fill('Responsive learning record');
 const field=page.getByRole('textbox',{name:/^用自己的话解释\s*（选填）$/});await expect(field).toBeEnabled();await field.fill('This is my own reflection.');
 await noOverflow();
 const mobile=page.viewportSize()!.width<=650;
 if(mobile){await expect(page.locator('.learning-list-pane')).not.toBeVisible();await expect(page.getByRole('button',{name:'返回记录列表',exact:true})).toBeVisible();}
 const action=page.getByRole('button',{name:'确认',exact:true});await action.scrollIntoViewIfNeeded();
 const [fieldBox,actionBox]=await Promise.all([field.boundingBox(),action.boundingBox()]);expect(fieldBox).not.toBeNull();expect(actionBox).not.toBeNull();expect(fieldBox!.y+fieldBox!.height).toBeLessThanOrEqual(actionBox!.y+1);
 await action.click();const echo=page.getByRole('dialog',{name:'今日回响'});await expect(echo).toBeVisible();await echo.getByRole('button',{name:'关闭纪念卡'}).click();
 await noOverflow();
 if(process.env.E2E_CAPTURE_UI==='true'){await expect(page.locator('.celebration-banner')).toHaveCount(0);await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:`/tmp/aura-${testInfo.project.name}-detail.png`,fullPage:true});}
 if(mobile){await page.getByRole('button',{name:'返回记录列表',exact:true}).click();await expect(page.getByRole('button',{name:'打开记录 Responsive learning record',exact:true})).toBeVisible();}
 const heights=await page.getByTestId('month-calendar').locator('button.calendar-cell').evaluateAll(cells=>cells.map(cell=>cell.getBoundingClientRect().height));expect(Math.max(...heights)-Math.min(...heights)).toBeLessThan(1);
 if(process.env.E2E_CAPTURE_UI==='true'){await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:`/tmp/aura-${testInfo.project.name}-list.png`,fullPage:true});}
 await navigation.getByRole('button',{name:'全部记录',exact:true}).click();
 await expect(page.getByRole('button',{name:'打开记录 Responsive learning record',exact:true})).toBeVisible();
 await expect(page.locator('.learning-detail-placeholder')).toHaveCount(0);
 await noOverflow();
 await page.getByRole('button',{name:'新增记录',exact:true}).first().click();
 await page.getByRole('textbox',{name:'学习主题',exact:true}).fill('Another browser draft');
 await navigation.getByRole('button',{name:'全部记录',exact:true}).click();
 const list=page.getByRole('region',{name:'学习记录列表'});
 const rows=list.locator('.learning-records>li');
 await expect(rows).toHaveCount(2);
 const boxes=await rows.evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return {x:box.x,y:box.y,bottom:box.bottom};}));
 expect(Math.abs(boxes[0].x-boxes[1].x)).toBeLessThan(1);
 expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].y+1);
 const search=list.getByRole('searchbox',{name:'搜索学习主题',exact:true});
 await search.fill('RESPONSIVE');
 await expect(rows).toHaveCount(1);
 await expect(list.getByRole('button',{name:'打开记录 Responsive learning record',exact:true})).toBeVisible();
 await expect(list.getByRole('button',{name:'打开记录 Another browser draft',exact:true})).toHaveCount(0);
 await noOverflow();
 await list.getByRole('button',{name:'清空搜索',exact:true}).click();
 await expect(rows).toHaveCount(2);
 if(process.env.E2E_CAPTURE_UI==='true'){await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:`/tmp/aura-${testInfo.project.name}-all-records.png`,fullPage:true});}
});
