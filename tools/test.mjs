// 无头测试：node tools/test.mjs [--only=关键字] [--grid=宽x高] [--quiet] [--no-dom] [--dom-only]
// 依次跑：引擎纯净扫描 → 依赖方向 → 全部模拟用例（v3 + v4 + v4.1 + API）→ 黄金快照比对
//        → tests/suites/*.test.{js,mjs}（node:test，各自独立进程）→ tests/dom/*.test.{js,mjs}（DOM 用例，先构建单文件）
// 新模块加用例：在 tests/suites/ 或 tests/dom/ 里新建 *.test.mjs 就会被自动发现，不用改这个文件（见 AGENTS.md「共享文件」）。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const [GW, GH] = String(args.grid || '220x140').split('x').map(Number);
globalThis.__SRC_DIR = path.join(ROOT, 'src', 'engine');

let failed = 0;
const log = s => { if (!args.quiet || s.startsWith('失败')) console.log(s); };
const domOnly = !!args['dom-only'];

// 1) 引擎纯净：src/engine/ 里不能碰 DOM / Canvas / Audio / 时钟 / Math.random / 超越函数
if (!domOnly) {
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
if (!domOnly) {
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
if (!domOnly) {
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
}

// 4) 自动发现的 node:test 用例：每个文件单独一个进程（异步存储、DOM 环境之类不和同步模拟用例共享引擎状态）。
//    --only=关键字 时，文件名或用例名里带关键字的才跑（用例名过滤交给 node --test-name-pattern）。
{
  const { spawnSync } = await import('node:child_process');
  const { existsSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const find = dir => existsSync(path.join(ROOT, dir)) ? readdirSync(path.join(ROOT, dir)).filter(f => /\.test\.m?js$/.test(f)).sort().map(f => path.join(dir, f)) : [];
  const runFiles = (files, env) => {
    for (const f of files) {
      const nodeArgs = ['--test'];
      if (args.only && !f.includes(String(args.only))) nodeArgs.push('--test-name-pattern=' + String(args.only).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const r = spawnSync(process.execPath, [...nodeArgs, f], { cwd: ROOT, stdio: args.quiet ? 'pipe' : 'inherit', env });
      console.log((r.status === 0 ? '通过  ' : '失败  ') + f);
      if (r.status !== 0) { failed++; if (args.quiet && r.stdout) console.log(String(r.stdout).slice(-4000)); }
    }
  };
  if (!domOnly) runFiles(find('tests/suites'), process.env);
  // DOM 用例：先把当前源码构建成一个临时单文件，路径放在环境变量 PARTICLE_TEST_HTML 里（X4 的旧名 PARTICLE_UI_TEST_HTML 也给）
  const domFiles = args['no-dom'] ? [] : find('tests/dom');
  if (domFiles.length) {
    const temp = mkdtempSync(path.join(tmpdir(), 'particle-dom-'));
    try {
      const html = path.join(temp, 'particle-sandbox.html');
      const b = spawnSync(process.execPath, ['tools/build.mjs', '--out=' + html], { cwd: ROOT, stdio: args.quiet ? 'pipe' : 'inherit' });
      if (b.status !== 0) { console.log('失败  DOM 用例：构建单文件失败'); failed++; }
      else runFiles(domFiles, { ...process.env, PARTICLE_TEST_HTML: html, PARTICLE_UI_TEST_HTML: html });
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
}
process.exitCode = failed ? 1 : 0;
