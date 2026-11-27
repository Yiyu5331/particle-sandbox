// node tools/c3/audit.mjs [--bot=200] [--jitter=50] [--only=c3-1-1-pour]
// 检查 src/modes/puzzle/levels/c3/ 里的正式关卡（不读源定义，验证的是交付的 JSON）：
//   1. 参考解法双播（puzzleVerify）：必须三星、两次哈希一致
//   2. meta.json 里的每个备选解法都要通关
//   3. 什么都不做必须失败
//   4. 随机布置机器人 n 次，通关率 < 5%
//   5. 规划关：参考解法每笔随机平移 ±1 格 m 次，通过率 ≥ 80%
//   6. 实时关：参考解法全部提前到第 0 步应当失败（说明确实考时机；只报告）
// 结果写到 docs/puzzle-levels-report.json，并重新生成 docs/puzzle-levels.md 里的数据表。
import { readFileSync, writeFileSync } from 'node:fs';
import { puzzleVerify } from '../../src/modes/puzzle/session.js';
import { c3Bot, c3JitterRuns } from './core.mjs';
import { c3Play } from './lib.mjs';
import { c3RenderDoc } from './doc.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? true]; }));
const BOT = +(args.bot ?? 200), JIT = +(args.jitter ?? 50);
const dir = new URL('../../src/modes/puzzle/levels/c3/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8'));
const rows = [];
let failed = 0;
for (const id of meta.order) {
  if (args.only && !id.includes(args.only)) continue;
  const level = JSON.parse(readFileSync(new URL(id + '.json', dir), 'utf8'));
  const m = meta.levels[id];
  const t0 = performance.now();
  const verify = puzzleVerify(level);
  const solutions = m.solutions.map(s => { const r = c3Play(level, s.log); return { name: s.name, reference: s.reference, state: r.state, stars: r.stars, steps: r.steps, used: r.used, strokes: s.log.length }; });
  const nothing = c3Play(level, []);
  const bot = c3Bot(level, BOT);
  const jitter = level.type === 'planning' ? c3JitterRuns(level, JIT) : null;
  const early = level.type === 'realtime' ? c3Play(level, level.reference.log.map(e => ({ ...e, step: 0 }))) : null;
  const problems = [];
  if (verify.stars !== 3) problems.push('参考解法不是三星');
  for (const s of solutions) if (s.state !== 'won') problems.push(`解法「${s.name}」未通关`);
  if (solutions.length < 2) problems.push('少于两种解法');
  if (nothing.state === 'won') problems.push('空解通关');
  if (bot.rate >= 0.05) problems.push(`随机通关率 ${(bot.rate * 100).toFixed(1)}%`);
  if (jitter && jitter.rate < 0.8) problems.push(`扰动通过率 ${(jitter.rate * 100).toFixed(0)}%`);
  if (problems.length) failed++;
  const ref = solutions.find(s => s.reference);
  const row = {
    id, n: m.n, type: level.type, name: m.name, mechanic: m.mechanic, difficulty: level.difficulty,
    reference: { stars: verify.stars, steps: verify.steps, used: verify.used, hash: verify.hash, strokes: ref.strokes },
    stars: level.stars, budget: level.budget, maxSteps: level.maxSteps,
    solutions, nothing: nothing.state, bot, jitter,
    early: early && { state: early.state, steps: early.steps }, problems, seconds: +((performance.now() - t0) / 1000).toFixed(1),
  };
  rows.push(row);
  console.log(`${problems.length ? '失败' : '通过'}  ${m.n} ${id}  三星 ${verify.used} 格 ${ref.strokes} 笔 ${verify.steps} 步  随机 ${bot.wins}/${bot.n}` +
    (jitter ? `  扰动 ${jitter.wins}/${jitter.n}` : `  提前到第 0 步：${early.state === 'won' ? '仍通关' : '失败'}`) + (problems.length ? '  ' + problems.join('；') : '') + `  (${row.seconds}s)`);
}
if (!args.only) {
  const report = { generated: new Date().toISOString().slice(0, 10), bot: BOT, jitter: JIT, levels: rows };
  writeFileSync(new URL('../../docs/puzzle-levels-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(new URL('../../docs/puzzle-levels.md', import.meta.url), c3RenderDoc(meta, report));
  console.log('已写 docs/puzzle-levels-report.json 和 docs/puzzle-levels.md');
}
console.log(failed ? `${failed} 关有问题` : `全部 ${rows.length} 关通过`);
process.exitCode = failed ? 1 : 0;
