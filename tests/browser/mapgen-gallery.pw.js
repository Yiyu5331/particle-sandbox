// Playwright CLI：在已打开的单文件页面运行，验证真实表单、种子翻页和物理检查。
async page => {
  const url=new URL(page.url()); url.search='?dev=1&mapgen=1'; await page.goto(url.href);
  const cards=page.locator('.mg-grid button');
  if (await cards.count()!==16) throw new Error('全部群系应显示 16 张地图');
  await page.locator('[name=biome]').selectOption('volcano');
  await page.locator('[name=size]').selectOption('422×246');
  await page.locator('[name=villageWidth]').fill('32');
  await page.locator('[name=temperature]').fill('20');
  await page.locator('[name=seed]').fill('812'); await page.getByRole('button',{name:'生成图册'}).click();
  if (await cards.count()!==12) throw new Error('筛选后应显示 12 个连续种子');
  await cards.nth(3).click();
  if (!(await page.locator('.mg-detail h3').innerText()).includes('815')) throw new Error('选中种子不匹配');
  await page.getByLabel('显示区域').uncheck(); await page.getByLabel('显示区域').check();
  await page.getByRole('button',{name:'验证 300 步稳定性'}).click();
  const result=page.locator('.mg-detail [role=status]');
  await result.filter({hasText:'通过 300 步检查'}).waitFor(); const summary=await result.innerText();
  await page.locator('[name=preset]').selectOption('eco'); await page.getByRole('button',{name:'下一组种子'}).click();
  if (await page.locator('[name=seed]').inputValue()!=='824') throw new Error('种子翻页错误');
  const sha=await page.evaluate(async()=>{
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(mapgenFixtureText()));
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  });
  if (sha!==await page.evaluate(()=>mapgenExpectedSHA)) throw new Error('地图输出哈希与 Node 不同');
  return {summary,sha};
}
