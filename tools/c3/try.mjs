// 设计关卡时用：node tools/c3/try.mjs <编号，如 1-1> [--sol=0] [--frames=0,60,结算] [--bot=200] [--jitter=50] [--quiet]
// 打印某个解法在指定步数的字符画，以及整关的检查结果。
import { C3_LEVELS } from './levels.src.mjs';
import { c3Audit, c3Log, c3Skeleton } from './core.mjs';
import { c3Args, c3Ascii, c3Play } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(3).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? true]; }));
const def = C3_LEVELS.find(d => d.n === process.argv[2]);
if (!def) { console.error('没有这一关：' + process.argv[2]); process.exit(2); }
const level = c3Skeleton(def);

if (!args.quiet) {
  const sol = args.sol === 'none' ? { name: '空解', strokes: [] } : def.solutions[+(args.sol ?? 0)];
  const log = c3Log(def, sol).map(e => ({ ...e, args: c3Args(level, e.args) }));
  const frames = String(args.frames ?? '0,end').split(',');
  for (const f of frames) {
    const until = f === 'end' ? undefined : +f;
    const r = c3Play(level, log, { keep: true, until });
    if (f === '0' && level.type === 'planning') {
      // 第 0 步：放完笔画、还没运行
    }
    console.log(`--- ${sol.name} @ ${f}：${r.state} ${r.stars}★ 步数 ${r.steps} 用料 ${r.used}`);
    const regs = level.regions;
    const q = Object.fromEntries(regs.map(g => [g.id, Object.entries(r.session.world.queryRegion({ x: g.x, y: g.y, w: g.w, h: g.h }).byKey).filter(([k]) => k !== 'EMPTY').map(([k, v]) => k + v).join(',')]));
    console.log(c3Ascii(r.session.world, regs).split('\n').filter(l => /\S/.test(l.slice(3))).join('\n'));
    console.log('区域：', JSON.stringify(q));
    r.session.dispose();
  }
}
const a = c3Audit(def, { bot: +(args.bot ?? 200), jitter: +(args.jitter ?? 50) });
for (const s of a.solutions) console.log(`解法「${s.name}」：${s.state} ${s.stars}★ ${s.steps} 步 用料 ${s.used}，${s.strokes} 笔`);
console.log(`空解：${a.nothing.state}；随机：${a.bot ? `${a.bot.wins}/${a.bot.n}（星 ${a.bot.stars.slice(1).join('/')}）` : '-'}；扰动：${a.jitter ? `${a.jitter.wins}/${a.jitter.n}（三星 ${a.jitter.three}）` : '-'}`);
console.log(a.problems.length ? '问题：' + a.problems.join('；') : '全部通过');
