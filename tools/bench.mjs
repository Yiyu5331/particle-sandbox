// 性能基准（Node，无渲染）：
//   node tools/bench.mjs                 稳态：10 个场景各跑 --steps 步（默认 1500），比较 ES 模块引擎、公开 API（world.step + 事件）
//                                        和 v4.1 单文件引擎（v4-src 拼接，作为重构前的基线）的每步耗时
//   node tools/bench.mjs --cold          冷启动：新进程里第一次大爆炸前后 60 步最慢的一步（有 / 没有热身）
//   node tools/bench.mjs --grid=240x150 --rounds=3
import { writeFileSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const [GW, GH] = String(args.grid || '240x150').split('x').map(Number);
const STEPS = +(args.steps || 1500), ROUNDS = +(args.rounds || 3);
const TMP = mkdtempSync(path.join(os.tmpdir(), 'psb-bench-'));
const src = p => pathToFileURL(path.join(ROOT, p)).href;

// 同一段工作负载，分别在三种引擎上跑（自由变量：allocGrid resetWorld buildScene simStep，或 api）
const WORKLOAD = `
const times = [];
for (let k = 0; k < 10; k++) {
  const t0 = performance.now();
  RUN_SCENE(k);
  times.push((performance.now() - t0) / ${STEPS});
}
console.log(JSON.stringify(times));`;
const DIRECT = `function RUN_SCENE(k) { allocGrid(${GW}, ${GH}); resetWorld(1000 + k); buildScene(k); for (let s = 0; s < ${STEPS}; s++) simStep(); }`;

function writeVariants() {
  const files = {};
  files.esm = path.join(TMP, 'esm.mjs');
  writeFileSync(files.esm, `import { allocGrid } from '${src('src/engine/grid.js')}';\nimport { resetWorld } from '${src('src/engine/commands.js')}';\nimport { buildScene } from '${src('src/engine/scenes.js')}';\nimport { simStep } from '${src('src/engine/step.js')}';\n${DIRECT}\n${WORKLOAD}`);
  files.api = path.join(TMP, 'api.mjs');
  writeFileSync(files.api, `import { createWorld } from '${src('src/engine/index.js')}';\nfunction RUN_SCENE(k) { const w = createWorld({ width: ${GW}, height: ${GH}, seed: 1000 + k }); let n = 0; w.on('*', () => { n++; }); w.setRecording(false); w.exec('loadScene', { index: k }); for (let s = 0; s < ${STEPS}; s++) w.step(1); w.dispose(); }\n${WORKLOAD}`);
  if (args.base) {                                       // 对照：另一份源码树（比如某个旧提交的 worktree）的 ES 模块引擎
    const b = p => pathToFileURL(path.join(path.resolve(args.base), p)).href;
    files.base = path.join(TMP, 'base.mjs');
    writeFileSync(files.base, `import { allocGrid } from '${b('src/engine/grid.js')}';\nimport { resetWorld } from '${b('src/engine/commands.js')}';\nimport { buildScene } from '${b('src/engine/scenes.js')}';\nimport { simStep } from '${b('src/engine/step.js')}';\n${DIRECT}\n${WORKLOAD}`);
  }
  // 打包后的引擎（和 dist 单文件同样的拼接方式：所有模块在同一个作用域里）——这才是浏览器里真正运行的形态
  const eng = path.join(TMP, 'engine-bundle.js');
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.mjs'), '--entry=src/engine/index.js', '--script=' + eng], { stdio: 'pipe' });
  files.bundle = path.join(TMP, 'bundle.js');
  writeFileSync(files.bundle, readFileSync(eng, 'utf8') + '\n' + DIRECT + '\n' + WORKLOAD);
  const v4 = ['10-core.js', '20-sim.js', '22-struct.js', '23-weather.js', '25-codec.js', '26-state.js', '27-scenes.js'].map(f => path.join(ROOT, 'v4-src', f));
  if (v4.every(existsSync)) {
    files.v41 = path.join(TMP, 'v41.js');
    // 'use strict' 必须在第一行才生效：浏览器里的 v4.1 单文件是严格模式，基线也要一样
    writeFileSync(files.v41, "'use strict';\nglobalThis.location={search:''};\n" + v4.map(f => readFileSync(f, 'utf8')).join('\n') + '\n' + DIRECT + '\n' + WORKLOAD);
  }
  return files;
}

function runSteady() {
  const files = writeVariants();
  const names = Object.keys(files), best = {};
  for (let r = 0; r < ROUNDS; r++) for (const n of names) {          // 轮流跑，抵消机器忙闲
    const per = JSON.parse(execFileSync(process.execPath, [files[n]], { encoding: 'utf8' }).trim().split('\n').pop());
    best[n] = best[n] ? best[n].map((v, i) => Math.min(v, per[i])) : per;
  }
  const label = { bundle: '打包后的引擎（dist 同款拼接）', base: '对照源码树（--base）', v41: 'v4.1 单文件引擎（重构前）', esm: 'ES 模块引擎（simStep）', api: '公开 API（world.step + 事件订阅）' };
  const tot = n => best[n].reduce((a, b) => a + b, 0) / best[n].length;
  console.log(`网格 ${GW}×${GH}，每个场景 ${STEPS} 步，${ROUNDS} 轮取最快；每步平均毫秒：`);
  for (const n of names) console.log('  ' + label[n].padEnd(26) + tot(n).toFixed(3) + ' ms   [' + best[n].map(v => v.toFixed(2)).join(' ') + ']');
  if (best.v41) for (const n of ['bundle', 'esm', 'api']) console.log(`  ${label[n]} 相对重构前：${((tot(n) / tot('v41') - 1) * 100).toFixed(1)}%`);
  return { best, grid: [GW, GH], steps: STEPS };
}

// 冷启动：和浏览器 ?coldboom=1 同一个场景（5 万粒子 + 10 个 TNT + 会塌的楼 + 雷暴），只是不渲染
const COLD = (warm, how = 'world') => `
import { allocGrid, clearGrid, put, flags, life, setGravity, F_BURN, W, H, N, type } from '${src('src/engine/grid.js')}';
import { env, envSet } from '${src('src/engine/env.js')}';
import { AMBIENT, SAND, TNT, WATER } from '${src('src/engine/materials.js')}';
import { fillRect } from '${src('src/engine/paint.js')}';
import { seedRng } from '${src('src/engine/rng.js')}';
import { buildDemolition, scenesSet } from '${src('src/engine/scenes.js')}';
import { simStep } from '${src('src/engine/step.js')}';
import { GW, GH, altitudeOf, cloud, setWeather, updateSun } from '${src('src/engine/weather.js')}';
import { warmUp, warmMs } from '${src('src/game/warmup.js')}';
import { resetWorld } from '${src('src/engine/commands.js')}';
import { lightning } from '${src('src/engine/weather.js')}';
const t00 = performance.now();
${!warm ? '' : how === 'world' ? 'warmUp();' : `{ // 对照：v4.1 的做法，在同一个（默认）世界里热身，不换台
  allocGrid(200, 130); resetWorld(7); env.structure = true; env.time = 0.9; setWeather('storm'); updateSun();
  buildDemolition(true, 100); fillRect(WATER, 0, 106, W - 1, 112); fillRect(SAND, 0, 113, W - 1, H - 1);
  for (let k = 0; k < 4; k++) { const x = 30 + k * 40, i = x + 118 * W; put(i, TNT, x, 118); flags[i] |= F_BURN; life[i] = 10 + k * 6; }
  for (let c = 0; c < GW * 4; c++) cloud[c] = 2.4;
  for (let s = 0; s < 360; s++) { simStep(); if (s % 90 === 30) lightning(); }
}${how === 'hostswap' ? "\n{ const { createWorld: cw } = await import('" + src('src/engine/index.js') + "'); const w2 = cw({ width: 64, height: 64, seed: 1 }); w2.step(1); w2.dispose(); }" : ''}`}
allocGrid(${GW * 2}, ${GH * 2});
env.dayNight = true; env.time = 0.9; env.timeScale = 1; env.structure = true; env.temp = AMBIENT; scenesSet('sceneState', null);
setWeather('storm'); env.wind = 0.6;
clearGrid(); setGravity('down'); seedRng(4242); updateSun();
const rows = Math.max(20, Math.min(Math.floor(H * 0.45), Math.ceil(50000 / W))), floor = H - rows - 6;
buildDemolition(true, floor);
fillRect(SAND, 0, floor + 6 + (rows >> 1), W - 1, H - 1);
fillRect(WATER, 0, floor + 6, W - 1, floor + 5 + (rows >> 1));
for (let k = 0; k < 10; k++) { const x = Math.floor(W * (k + 0.5) / 10), y = H - 2 - (rows >> 2), i = x + y * W; put(i, TNT, x, y); flags[i] |= F_BURN; life[i] = 40 + k * 8; }
for (let c = 0; c < GW * GH; c++) if (altitudeOf((c / GW) | 0) > 0.7) cloud[c] = 2.4;
env.charge = 0.9;
let first = -1; const frames = [];
envSet('onBoom', () => { if (first < 0) first = frames.length; });
for (let s = 0; s < 260; s++) { const t0 = performance.now(); simStep(); frames.push(performance.now() - t0); }
const win = frames.slice(first, first + 60);
console.log(JSON.stringify({ warm: ${warm}, how: '${how}', warmMs: +warmMs.toFixed(0), grid: W + 'x' + H, firstBoom: first, firstBoomMax: +Math.max(...win).toFixed(1), first20Max: +Math.max(...frames.slice(0, 20)).toFixed(1), avg: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2) }));
`;
function runCold() {
  const out = [];
  const variants = [[false, 'none'], [true, 'world'], ...(args.compare ? [[true, 'host'], [true, 'hostswap']] : [])];
  for (const [warm, how] of variants) for (let r = 0; r < ROUNDS; r++) {
    const f = path.join(TMP, `cold-${how}.mjs`);
    writeFileSync(f, COLD(warm, how));
    const o = JSON.parse(execFileSync(process.execPath, [f], { encoding: 'utf8' }).trim().split('\n').pop());
    out.push(o);
    console.log((warm ? (how === 'host' ? '同世界热身（v4.1 做法）' : how === 'hostswap' ? '同世界热身后换台一次' : '独立世界热身') : '不热身') + `：第一次爆炸后 60 步里最慢 ${o.firstBoomMax}ms，前 20 步最慢 ${o.first20Max}ms，平均 ${o.avg}ms` + (warm ? `（热身 ${o.warmMs}ms）` : '') + `，网格 ${o.grid}`);
  }
  return out;
}

const result = args.cold ? { cold: runCold() } : { steady: runSteady() };
if (args.out) writeFileSync(path.resolve(ROOT, args.out), JSON.stringify(result, null, 1));
