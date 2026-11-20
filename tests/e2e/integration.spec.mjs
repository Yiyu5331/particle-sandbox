import { test, expect } from '@playwright/test';

import { checkPuzzleEditor } from './editor.mjs';

const gameUrl='/particle-sandbox.html?nowarm=1';
test('新玩家首关三星，刷新后模式进度、选关星级和第二关解锁一致', async ({page})=>{
  await page.goto(gameUrl);
  const button=name=>page.getByRole('button',{name,exact:true});
  const puzzle=page.locator('.ui-card[data-mode=puzzle]');
  const first=page.locator('[data-level="sand-cup"]'), second=page.locator('[data-level="water-lock"]');
  await button('选择模式').click();
  await expect(puzzle).toContainText('已完成 · 0 关');
  await puzzle.click();
  await expect(first).toContainText('☆☆☆'); await expect(second).toBeDisabled();
  await first.click();
  const r=await page.locator('#canvas').boundingBox();
  const point=x=>[r.x+(x+.5)*r.width/80,r.y+20.5*r.height/48];
  await page.mouse.move(...point(32)); await page.mouse.down(); await page.mouse.move(...point(43)); await page.mouse.up();
  await expect(page.locator('#ui-hud')).toContainText('12/20');
  await button('运行').click();
  await expect(page.getByRole('dialog',{name:'胜利'})).toContainText('★★★');
  await page.reload();
  await button('选择模式').click(); await expect(puzzle).toContainText('已完成 · 1 关');
  await puzzle.click(); await expect(first).toContainText('★★★'); await expect(second).toBeEnabled();
  await second.click(); await expect(page.getByRole('heading',{name:'蓄水闸'})).toBeVisible();
});

test('开发者菜单门禁，图鉴占位，编辑器切换语言保留草稿', async ({page})=>{
  await page.goto(gameUrl+'&mapgen=1');
  await expect(page.getByRole('heading',{name:'粒子沙盘'})).toBeVisible();
  await expect(page.getByRole('button',{name:'开发者'})).toHaveCount(0);
  await expect(page.locator('#mapgen')).toHaveCount(0);
  await page.getByRole('button',{name:'材料图鉴',exact:true}).click();
  await expect(page.getByText('图鉴将在后续版本开放。')).toBeVisible();
  await page.goto(gameUrl+'&dev=1');
  await page.getByRole('button',{name:'开发者'}).click();
  const link=page.getByRole('link',{name:'地图生成器'});
  const [gallery]=await Promise.all([page.waitForEvent('popup'),link.click()]);
  await expect(gallery.locator('.mg-grid button')).toHaveCount(16); await gallery.close();
  await page.goto(gameUrl+'&mode=puzzle');
  await page.getByRole('button',{name:'新建关卡'}).click();
  await page.getByLabel('关卡名称',{exact:true}).fill('我的草稿');
  await page.keyboard.press('Escape'); await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('dialog').getByLabel('语言',{exact:true}).selectOption('en');
  await page.keyboard.press('Escape'); await page.getByRole('button',{name:'Resume',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Level editor'})).toBeVisible();
  await expect(page.getByLabel('Level name',{exact:true})).toHaveValue('我的草稿');
  await page.getByRole('tab',{name:'Goals and budget'}).click();
  await expect(page.getByLabel('Win condition',{exact:true})).toBeVisible();
});

test('编辑器建关、失败试播、录制、导出、导入及终局恢复',async ({page})=>{
  await page.goto(gameUrl);
  await checkPuzzleEditor(page);
});

test('星级写入失败会提示，可在同一胜局重试后刷新',async ({page})=>{
  await page.goto(gameUrl+'&mode=puzzle');
  await page.locator('[data-level="sand-cup"]').click();
  await page.evaluate(()=>{
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key) {
      if (key==='profile' && value.parts?.puzzle?.value.stars['sand-cup']===3) {
        IDBObjectStore.prototype.put=put;
        throw new DOMException('测试写入失败','QuotaExceededError');
      }
      return put.apply(this,arguments);
    };
  });
  const r=await page.locator('#canvas').boundingBox();
  const y=r.y+20.5*r.height/48;
  await page.mouse.move(r.x+32.5*r.width/80,y); await page.mouse.down();
  await page.mouse.move(r.x+43.5*r.width/80,y); await page.mouse.up();
  await page.getByRole('button',{name:'运行',exact:true}).click();
  const result=page.getByRole('dialog',{name:'胜利'});
  await expect(result).toContainText('通关进度保存失败');
  await result.getByRole('button',{name:'重试保存'}).click();
  await expect(result).toContainText('目标达成');
  await page.reload();
  await expect(page.locator('[data-level="sand-cup"]')).toContainText('★★★');
  await expect(page.locator('[data-level="water-lock"]')).toBeEnabled();
});
