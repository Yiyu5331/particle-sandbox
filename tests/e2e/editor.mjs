// 全程使用编辑器控件，下载文件保存在测试上下文的临时目录中。
export async function checkPuzzleEditor(page) {
  const url = new URL(page.url());
  url.search = '?mode=puzzle';
  await page.goto(url.href);
  const button = name => page.getByRole('button',{name,exact:true});
  const status = page.locator('#puzzle-tools [role=status]');
  async function drag(x0,y0,x1,y1) {
    const rect = await page.locator('#canvas').boundingBox();
    const point = (x,y) => [rect.x+rect.width*(x+0.5)/80,rect.y+rect.height*(y+0.5)/48];
    await page.mouse.move(...point(x0,y0)); await page.mouse.down();
    await page.mouse.move(...point(x1,y1)); await page.mouse.up();
  }
  async function solve() {
    await drag(25,26,35,26); await button('运行').click();
    await page.getByRole('dialog',{name:'胜利'}).waitFor();
  }
  await button('新建关卡').click();
  await page.getByLabel('关卡名称',{exact:true}).fill('浏览器量杯');
  await page.getByRole('tab',{name:'元信息、失败条件与星级',exact:true}).click();
  await page.getByLabel('关卡标识',{exact:true}).fill('sand-cup');
  await page.getByRole('tab',{name:'地形',exact:true}).click();
  await drag(0,45,79,47);
  await page.getByRole('combobox',{name:/绘制内容/}).selectOption('goal');
  await page.getByLabel('区域标识',{exact:true}).fill('bucket');
  await drag(20,35,40,44);
  await page.getByRole('tab',{name:'目标和预算'}).click();
  await page.getByLabel('材料白名单与上限',{exact:true}).fill('{"SAND":5}');
  await page.getByLabel('总预算',{exact:true}).fill('6');
  const goal = page.getByLabel('通关条件',{exact:true});
  await goal.fill('{"op":"integrity","region":"bucket","material":"BRICK","percent":100}');
  await button('录制参考解法').click();
  await status.filter({hasText:'结构目标没有初始承重格'}).waitFor();
  await page.getByRole('tab',{name:'地形',exact:true}).click();
  if (await page.getByLabel('关卡名称',{exact:true}).inputValue() !== '浏览器量杯') throw new Error('试播失败后草稿丢失');
  await page.getByRole('tab',{name:'目标和预算'}).click();
  await goal.fill('{"op":"count","region":"bucket","material":"SAND","compare":">=","value":4}');
  await button('录制参考解法').click(); await solve();
  await button('采用本次录制').click(); await button('验证参考解法').click();
  await status.filter({hasText:'验证通过'}).waitFor();
  const [file] = await Promise.all([page.waitForEvent('download'),button('导出 JSON').click()]);
  await button('返回选关').click();
  await page.locator('#puzzle-tools input[type=file]').first().setInputFiles(await file.path());
  await page.getByRole('heading',{name:'浏览器量杯'}).waitFor(); await solve();
  const summary = await page.getByRole('dialog',{name:'胜利'}).innerText();
  await page.evaluate(() => {
    const won = game.mode.serialize(), hash = game.world.hash();
    const events = [];
    const offEnter = game.bus.on('mode:enter',() => events.push('enter'));
    const offOutcome = game.bus.on('outcome',o => events.push(o.state));
    try {
      game.mode.deserialize(won);
      if (game.world.hash() !== hash || !game.paused || game.outcome.state !== 'won' ||
        game.outcome.score !== 3 || events.join(',') !== 'enter,won') throw new Error('胜局恢复不一致');
      const previous = game.world, previousMode = game.mode;
      let rejected = false;
      try { game.mode.deserialize({...won,phase:'lost'}); } catch { rejected = true; }
      if (!rejected || game.world !== previous || previousMode !== game.mode || game.world.hash() !== hash ||
        events.length !== 2) throw new Error('坏档替换了当前局面');
      const lost = structuredClone(won);
      lost.level.maxSteps = 1; lost.level.goal = {op:'survive',steps:2}; lost.level.reference = {steps:0,log:[]};
      lost.saved = {steps:1,log:[]}; lost.phase = 'lost';
      game.mode.deserialize(lost);
      if (game.outcome.state !== 'lost' || game.outcome.score !== 0 || !game.paused ||
        events.join(',') !== 'enter,won,enter,lost') throw new Error('败局恢复不一致');
    } finally { offEnter(); offOutcome(); }
  });
  await page.getByRole('dialog',{name:'失败'}).getByRole('button',{name:'返回选关'}).click();
  if (!await page.getByRole('button',{name:/蓄水闸/}).isDisabled()) throw new Error('自制同名关写入了官方解锁进度');
  return summary;
}
