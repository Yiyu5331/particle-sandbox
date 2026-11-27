// node tools/c3/shots.mjs [--only=c3-1-1]
// 用真实页面给每关拍两张图，存进 docs/puzzle-levels/：
//   <id>-start.png  初始画面：在选关页用「载入关卡 JSON」导入正式关卡
//   <id>-won.png    通关画面：在 Node 里回放参考解法到结算步，把终局世界存成快照关卡（world.serialized）再导入
// 需要 @playwright/test 和本机的 Google Chrome（channel: 'chrome'，不下载浏览器）。
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { c3Play } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? true]; }));
const dir = path.join(ROOT, 'src/modes/puzzle/levels/c3');
const out = path.join(ROOT, 'docs/puzzle-levels');
mkdirSync(out, { recursive: true });
const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const temp = mkdtempSync(path.join(tmpdir(), 'c3-shots-'));

try {
  const html = path.join(temp, 'particle-sandbox.html');
  const b = spawnSync(process.execPath, ['tools/build.mjs', '--out=' + html], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) throw new Error('构建失败');

  // 终局快照关：同样的区域，类型改成规划关，载入后保持暂停。
  function wonVariant(level) {
    const r = c3Play(level, level.reference.log, { keep: true });
    try {
      if (r.state !== 'won') throw new Error(level.id + ' 参考解法没有通关');
      const { commands, ...world } = level.world;
      return { ...level, id: level.id + '-won', type: 'planning', world: { ...world, serialized: r.session.world.serialize() }, reference: { steps: 0, log: [] } };
    } finally { r.session.dispose(); }
  }

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  async function shoot(level, file) {
    const json = path.join(temp, level.id + '.json');
    writeFileSync(json, JSON.stringify(level));
    await page.goto(pathToFileURL(html).href + '?mode=puzzle');
    const load = page.getByRole('button', { name: '载入关卡 JSON', exact: true });
    await load.waitFor();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), load.click()]);
    await chooser.setFiles(json);
    await page.getByRole('button', { name: '运行', exact: true }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    await page.locator('#viewport').screenshot({ path: path.join(out, file) });
  }
  for (const id of meta.order) {
    if (args.only && !id.includes(args.only)) continue;
    const level = JSON.parse(readFileSync(path.join(dir, id + '.json'), 'utf8'));
    await shoot({ ...level, type: 'planning', reference: { steps: 0, log: [] } }, id + '-start.png');
    await shoot(wonVariant(level), id + '-won.png');
    console.log('截图', id);
  }
  await browser.close();
  if (errors.length) { console.error('页面错误：\n' + errors.join('\n')); process.exitCode = 1; }
} finally { rmSync(temp, { recursive: true, force: true }); }
