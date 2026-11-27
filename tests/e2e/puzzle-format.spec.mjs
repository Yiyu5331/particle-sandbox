import { test, expect } from '@playwright/test';

const gameUrl = '/particle-sandbox.html?mode=puzzle&nowarm=1';

test('解谜编辑器创建实时事件，导出、导入、通关及两种回放一致', async ({page})=>{
  await page.goto(gameUrl);
  const button = name=>page.getByRole('button',{name,exact:true});
  const tab = name=>page.getByRole('tab',{name,exact:true});
  const field = name=>page.getByLabel(name,{exact:true});
  await button('新建关卡').click();
  await field('关卡名称').fill('定时水闸');
  await field('绘制内容').selectOption('zone');
  const r = await page.locator('#canvas').boundingBox();
  const point = (x,y)=>[r.x+(x+0.5)*r.width/80,r.y+(y+0.5)*r.height/48];
  await page.mouse.move(...point(0,10)); await page.mouse.down();
  await page.mouse.move(...point(19,30)); await page.mouse.up();
  await expect(page.getByRole('status').filter({hasText:'区域已设置'})).toBeVisible();

  await tab('目标和预算').click();
  await field('玩法').selectOption('realtime');
  await field('通关条件').fill(JSON.stringify({op:'hold',steps:2,condition:{op:'count',region:'target',material:'WATER',compare:'>=',value:1}}));
  await tab('环境设定').click();
  await field('固定时间（0～1）').fill('0.5');
  await tab('定时事件').click();
  await field('执行步数').fill('20');
  await button('添加定时事件').click();
  await button('第 20 步 · spawn').click();
  await field('执行步数').fill('12');
  await field('命令参数（JSON）').fill('{"mat":"WATER","x":6,"y":12,"r":2}');
  await button('保存定时事件').click();
  await expect(button('第 20 步 · spawn')).toHaveCount(0);
  await expect(button('第 12 步 · spawn')).toBeVisible();
  await field('引擎命令').selectOption('setWeather');
  await field('执行步数').fill('1');
  await button('添加定时事件').click();
  const timeline = page.getByRole('tabpanel',{name:'定时事件'}).getByRole('list');
  await expect(timeline.getByRole('button')).toHaveText(['第 1 步 · setWeather','第 12 步 · spawn']);
  await button('第 1 步 · setWeather').click();
  await button('删除定时事件').click();
  await expect(timeline.getByRole('button')).toHaveText(['第 12 步 · spawn']);

  const win = page.getByRole('dialog',{name:'胜利'});
  await button('录制参考解法').click();
  await expect(win).toContainText('★★★');
  const firstHash = await page.evaluate(()=>game.world.hash());
  await win.getByRole('button',{name:'采用本次录制'}).click();
  const [file] = await Promise.all([page.waitForEvent('download'),button('导出 JSON').click()]);
  await button('返回选关').click();
  await page.locator('#puzzle-tools input[type=file]').first().setInputFiles(await file.path());
  await expect(page.getByRole('heading',{name:'定时水闸',exact:true})).toBeVisible();
  await expect(win).toContainText('★★★');
  const result = await page.evaluate(()=>{
    const saved = game.mode.serialize(), recording = game.world.recording(), hash = game.world.hash();
    const engine = createWorld(saved.level.world);
    const replayHash = engine.replay(recording);
    engine.dispose();
    game.mode.deserialize(saved);
    return {hash,replayHash,restoredHash:game.world.hash(),score:game.outcome.score,steps:saved.saved.steps,
      time:game.world.getEnv().time,spawnSteps:recording.log.filter(e=>e.command==='spawn').map(e=>e.step)};
  });
  expect(result).toEqual({hash:firstHash,replayHash:firstHash,restoredHash:firstHash,score:3,steps:13,time:0.5,spawnSteps:[11]});
});

test('解谜编辑器输入双语内容，试玩逐级显示并在语言切换和重试后保留', async ({page})=>{
  await page.goto(gameUrl);
  const button = name=>page.getByRole('button',{name,exact:true});
  const field = name=>page.getByLabel(name,{exact:true});
  await button('新建关卡').click();
  await field('关卡名称').fill('双语试验');
  await field('英文关卡名称').fill('Bilingual trial');
  await page.getByRole('tab',{name:'关卡文本',exact:true}).click();
  await field('中文描述').fill('中文试验说明');
  await field('英文描述').fill('English trial description');
  for (const [i,zh,en] of [[1,'第一条线索','First clue'],[2,'第二条线索','Second clue'],[3,'第三条线索','Third clue']]) {
    await field('中文提示 '+i).fill(zh);
    await field('英文提示 '+i).fill(en);
  }
  await button('录制参考解法').click();
  await expect(page.getByText('中文试验说明',{exact:true})).toBeVisible();
  await expect(page.getByText('第一条线索',{exact:true})).toBeHidden();
  await button('显示第 1 级提示').click();
  await expect(page.getByText('第一条线索',{exact:true})).toBeVisible();
  await expect(page.getByText('第二条线索',{exact:true})).toBeHidden();

  await page.keyboard.press('Escape');
  await button('设置').click();
  await page.getByRole('dialog').getByLabel('语言',{exact:true}).selectOption('en');
  await page.keyboard.press('Escape');
  await button('Resume').click();
  await expect(page.getByRole('heading',{name:'Bilingual trial',exact:true})).toBeVisible();
  await expect(page.getByText('English trial description',{exact:true})).toBeVisible();
  await expect(page.getByText('First clue',{exact:true})).toBeVisible();
  await button('Show hint 2').click();
  await expect(page.getByText('Third clue',{exact:true})).toBeHidden();
  await button('Show hint 3').click();
  await expect(button('All hints revealed')).toBeDisabled();
  await expect(page.getByText('Third clue',{exact:true})).toBeVisible();
  await button('Retry with opening moves').click();
  await expect(page.getByText('Third clue',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>game.mode.serialize().saved.hintsUsed)).toBe(3);
});
