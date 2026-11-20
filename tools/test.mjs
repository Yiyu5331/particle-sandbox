// 无头测试：node tools/test.mjs [--only=关键字] [--grid=宽x高] [--quiet]
// 依次跑：引擎纯净扫描 → 全部模拟用例（v3 + v4 + v4.1）→ 黄金快照比对
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const [GW, GH] = String(args.grid || '220x140').split('x').map(Number);
globalThis.__SRC_DIR = path.join(ROOT, 'src', 'engine');

let failed = 0;
const log = s => { if (!args.quiet || s.startsWith('失败')) console.log(s); };

// 1) 引擎纯净：src/engine/ 里不能碰 DOM / Canvas / Audio / 时钟 / Math.random / 超越函数
{
  const bad = [];
  const FORBID = /\b(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame|HTMLElement|CanvasRenderingContext2D|WebGL2?RenderingContext|getContext|AudioContext|OfflineAudioContext|Image|fetch|XMLHttpRequest|performance\.now|Date\.now|new Date|Math\.random|Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|pow|log|log2|log10|log1p|hypot|cbrt|sinh|cosh|tanh))\b/;
  for (const f of readdirSync(path.join(ROOT, 'src', 'engine')).filter(f => f.endsWith('.js'))) {
    readFileSync(path.join(ROOT, 'src', 'engine', f), 'utf8').split('\n').forEach((line, k) => {
      if (/^\s*(\*|\/\*|\/\/)/.test(line)) return;
      const code = line.replace(/\/\/.*$/, '').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, '``');
      if (FORBID.test(code)) bad.push(f + ':' + (k + 1) + '  ' + line.trim().slice(0, 80));
    });
  }
  log((bad.length ? '失败  ' : '通过  ') + '引擎纯净扫描：src/engine/ 里没有 DOM / Canvas / Audio / 时钟 / Math.random / 超越函数' + (bad.length ? '\n    ' + bad.join('\n    ') : ''));
  if (bad.length) failed++;
}

// 1b) 依赖方向：引擎只依赖引擎自己；引擎外面（模式、UI、渲染、音频、game）只能从公开入口 src/engine/index.js 取引擎的东西
{
  const bad = [];
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
  for (const f of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, f), inEngine = rel.startsWith(path.join('src', 'engine'));
    for (const m of readFileSync(f, 'utf8').matchAll(/^(?:import|export)[^'\n]*from\s*'([^']+)'|^import\s*'([^']+)'/gm)) {
      const target = path.relative(ROOT, path.resolve(path.dirname(f), m[1] || m[2]));
      const toEngine = target.startsWith(path.join('src', 'engine'));
      if (inEngine && !toEngine) bad.push(rel + ' → ' + target + '（引擎不能依赖引擎外面）');
      if (!inEngine && toEngine && target !== path.join('src', 'engine', 'index.js') && !rel.startsWith(path.join('src', 'main.js'))) bad.push(rel + ' → ' + target + '（只能用 src/engine/index.js）');
    }
  }
  log((bad.length ? '失败  ' : '通过  ') + '依赖方向：引擎不依赖外面；模式 / UI / 渲染 / 音频 / game 只用 src/engine/index.js' + (bad.length ? '\n    ' + bad.join('\n    ') : ''));
  if (bad.length) failed++;
}

// 2) 模拟用例
const { TESTS, runSimTestsSync } = await import('../tests/lib/harness.js');
await import('../tests/suites/v3.js');
await import('../tests/suites/v4.js');
await import('../tests/suites/v41.js');
await import('../tests/suites/api.js');
const { allocGrid } = await import('../src/engine/grid.js');
allocGrid(GW, GH);
if (args.only) for (let i = TESTS.length - 1; i >= 0; i--) if (!TESTS[i].name.includes(args.only)) TESTS.splice(i, 1);
const t0 = performance.now();
const r = runSimTestsSync(log);
failed += r.total - r.pass;
console.log(`\n模拟用例 ${r.pass}/${r.total} 通过，网格 ${GW}x${GH}，用时 ${((performance.now() - t0) / 1000).toFixed(1)}s`);

// 3) 黄金快照（--golden=full 跑满 36000 步；默认跑到 5000 步 + 5 段回放）
if (!args.only && args.golden !== 'skip') {
  const { goldenCompare } = await import('../tests/lib/golden-check.js');
  const g = goldenCompare(args.golden === 'full' ? 36000 : 5000);
  console.log((g.bad ? '失败  ' : '通过  ') + `黄金快照：${g.ok} 个一致，${g.bad} 个不一致` + (g.bad ? '\n    ' + g.rows.filter(x => x[0] === '✗').join('\n    ') : ''));
  failed += g.bad ? 1 : 0;
}
if (!args.only || String(args.only).includes('地图')) {
  const { spawnSync } = await import('node:child_process');
  const result=spawnSync(process.execPath,['--test','tests/suites/mapgen.test.mjs'],{cwd:ROOT,stdio:'inherit'});
  if (result.status!==0) failed++;
}
process.exitCode = failed ? 1 : 0;
