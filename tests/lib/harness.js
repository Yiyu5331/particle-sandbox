'use strict';
import { resetWorld } from '../../src/engine/commands.js';
import { env } from '../../src/engine/env.js';
import { F_BURN, H, N, W, clearGrid, flags, gridSet, put, setGravity, temp, type } from '../../src/engine/grid.js';
import { AMBIENT, ASH, CHARCOAL, DEADPLANT, EMBER, FIRE, FLOWER, FOAM, GLASS, ICE, LAVA, MATERIALS, NT, PLANT, SEED, SMOKE, SNOW, SOIL, SPARK, STEAM, STONE, WATER, WOOD } from '../../src/engine/materials.js';
import { fpCount } from '../../src/engine/particles.js';
import { seedRng } from '../../src/engine/rng.js';
import { SCENES, buildScene, scenesSet } from '../../src/engine/scenes.js';
import { slowSet } from '../../src/engine/slow.js';
import { perf, simStep } from '../../src/engine/step.js';
import { bodyCount, structureSet } from '../../src/engine/structure.js';
import { GH, GW, cloud, setWeather, updateSun } from '../../src/engine/weather.js';
/* 自测的公共部分：用例注册表、测试场地、soak 采样与判定。只给 tests/ 和 tools/ 用。 */

/* =====================================================================
 * 6. 自测（?test=1）。模拟类用例不依赖 DOM，在 Node 里也能跑。
 * ===================================================================== */
export const TESTS = [];
export let tArenaHook = null;
export function setTArenaHook(fn) { tArenaHook = fn; }
export function defTest(name, fn) { TESTS.push({ name, fn }); }
export function runSteps(n) { for (let k = 0; k < n; k++) simStep(); }

export function tArena() {
  // 自测默认环境：恒为正午、20°C、无风、晴，结构力学关闭（很多用例把容器悬在半空）。需要的用例自己打开。
  env.dayNight = false; env.temp = AMBIENT; env.wind = 0; env.windPower = 0; env.structure = false; env.plantAging = 1; scenesSet('sceneState', null);
  setWeather('clear'); env.windPower = 0; env.cloudFade = 0; updateSun();
  clearGrid(); setGravity('down'); seedRng(20240607);
  gridSet('tick', 0); gridSet('parity', 0); slowSet('slowPhase', 0);
  for (const [k, v] of [['structCooldown', 0], ['structSettle', false], ['pinTick', -100], ['fracTick', -100]]) structureSet(k, v);   // 每个用例都从第 0 步开始，结果不受前面用例的影响
  if (tArenaHook !== null) tArenaHook();                   // 浏览器里：前面用例的爆炸留下的闪白、震动、冲击波也清掉
  return { cx: W >> 1, cy: H >> 1 };
}

export function tBox(x0, y0, x1, y1, m) {
  for (let x = x0; x <= x1; x++) { put(x + y0 * W, m, x, y0); put(x + y1 * W, m, x, y1); }
  for (let y = y0; y <= y1; y++) { put(x0 + y * W, m, x0, y); put(x1 + y * W, m, x1, y); }
}

export function tFloor(y, m) { for (let x = 0; x < W; x++) put(x + y * W, m || GLASS, x, y); }

// 跑到条件成立为止；返回用了多少步，超时返回 -1
export function tUntil(maxSteps, every, cond) {
  for (let s = 0; s < maxSteps; s++) {
    simStep();
    if (s % every === 0 && cond()) return s + 1;
  }
  return cond() ? maxSteps : -1;
}

// 同步跑完全部模拟用例（Node 用）
export function runSimTestsSync(log) {
  let pass = 0;
  const results = [];
  for (const t of TESTS) {
    if (t.browser) continue;
    let r;
    try { r = t.fn(); } catch (e) { r = { ok: false, info: '异常：' + (e && e.stack || e) }; }
    results.push({ name: t.name, ok: r.ok, info: r.info });
    if (r.ok) pass++;
    if (log) log((r.ok ? '通过  ' : '失败  ') + t.name + ' — ' + r.info);
  }
  return { pass, total: results.length, results };
}

/* =====================================================================
 * 6b. v4 新增用例
 * ===================================================================== */
export function countBurning() { let n = 0; for (let i = 0; i < N; i++) if (type[i] !== 0 && (flags[i] & F_BURN)) n++; return n; }
export function sumCloud() { let s = 0; for (let c = 0; c < GW * GH; c++) s += cloud[c]; return s; }
export function centroid(t) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (type[x + y * W] === t) { sx += x; sy += y; n++; }
  return n ? { x: sx / n, y: sy / n, n } : null;
}

/* =====================================================================
 * 6c. 长时间稳定性测试（soak）：每个预设跑 10 分钟模拟时间（36000 步），每 10 秒记一次
 * ===================================================================== */
export const SOAK_TRANSIENT = [FIRE, SMOKE, STEAM, EMBER, SPARK, FOAM];
export const SOAK_MATS = [WATER, PLANT, DEADPLANT, WOOD, CHARCOAL, ASH, SOIL, LAVA, STONE, SEED, FLOWER, SNOW, ICE, SMOKE, STEAM];

export function soakSample() {
  const cnt = new Uint32Array(NT);
  let tsum = 0, n = 0, burning = 0;
  for (let i = 0; i < N; i++) {
    const t = type[i];
    if (t === 0) continue;
    cnt[t]++; n++; tsum += temp[i];
    if (flags[i] & F_BURN) burning++;
  }
  return { cnt, total: n, avgT: n ? tsum / n : 0, burning, fire: cnt[FIRE], chunks: perf.activeChunks, bodies: bodyCount, free: fpCount,
           cloud: sumCloud(), heap: (typeof process !== 'undefined' && process.memoryUsage) ? process.memoryUsage().heapUsed / 1048576
                 : (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0) };
}

// 同步跑一个场景；onSample(k, sample) 每 10 秒模拟时间回调一次。返回结论。
export function soakScene(k, steps, onSample) {
  resetWorld(1000 + k);                                  // 每个场景都从干净的世界、第 0 步开始，单独跑和连着跑结果一样
  buildScene(k);
  const samples = [soakSample()];
  for (let s = 1; s <= steps; s++) {
    simStep();
    if (s % 600 === 0) { const sm = soakSample(); samples.push(sm); if (onSample) onSample(s / 600, sm); }
  }
  return soakVerdict(k, samples);
}

export function soakVerdict(k, samples) {
  const first = samples[0], last = samples[samples.length - 1], n = samples.length;
  const late = samples.slice(Math.floor(n * 0.75)), mid = samples.slice(Math.floor(n * 0.5), Math.floor(n * 0.75));
  const avg = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
  // 「无限增长」判定：最后四分之一的平均值比前一个四分之一还高出 15% 以上，且绝对增量不小
  const growing = [];
  for (const t of SOAK_MATS) {
    const a = avg(mid, s => s.cnt[t]), b = avg(late, s => s.cnt[t]);
    if (b > a * 1.15 && b - a > 150) growing.push(MATERIALS[t].name + ' ' + Math.round(a) + '→' + Math.round(b));
  }
  const totalA = avg(mid, s => s.total), totalB = avg(late, s => s.total);
  if (totalB > totalA * 1.1 && totalB - totalA > 400) growing.push('总量 ' + Math.round(totalA) + '→' + Math.round(totalB));
  const peakChunks = samples.reduce((m, s) => Math.max(m, s.chunks), 0);
  const peakBurn = samples.reduce((m, s) => Math.max(m, s.burning + s.fire), 0);
  const heapGrowth = avg(late, s => s.heap) - avg(samples.slice(1, Math.max(2, Math.floor(n * 0.25))), s => s.heap);
  // v4.1 判定：最后 2 分钟（最后 13 个采样点，相隔 10 秒）里，每种材料数量的趋势变化 < 2%。
  // 数量很少的材料允许 ±5 格的抖动（几十格的东西 2% 还不到一格，单个粒子进出就会超标）；火、烟、蒸汽、余烬、电火花、泡沫这类转瞬即逝的东西只记录不判定。
  const win = samples.slice(Math.max(0, n - 13));
  const unstable = [], drift = {};
  for (let t = 1; t < NT; t++) {
    if (SOAK_TRANSIENT.indexOf(t) >= 0) continue;
    const a = win[0].cnt[t], b = win[win.length - 1].cnt[t];
    const mean = win.reduce((s, x) => s + x.cnt[t], 0) / win.length;
    if (mean === 0) continue;
    // 用最小二乘拟合这 13 个点的直线，按斜率算 2 分钟里的趋势变化（下落中的雨滴这类逐点噪声不算）
    const m = win.length, xm = (m - 1) / 2;
    let sxy = 0, sxx = 0;
    for (let q = 0; q < m; q++) { sxy += (q - xm) * (win[q].cnt[t] - mean); sxx += (q - xm) * (q - xm); }
    const d = Math.abs(sxy / sxx * (m - 1)), pct = d / mean;
    drift[MATERIALS[t].name] = +(pct * 100).toFixed(2);
    if (pct >= 0.02 && d > 5) unstable.push(MATERIALS[t].name + ' ' + a + '→' + b + '（趋势 ' + (pct * 100).toFixed(1) + '%）');
  }
  return { name: SCENES[k].name, first, last, samples, growing, peakChunks, peakBurn, heapGrowth, unstable, drift,
           lateChunks: avg(late, s => s.chunks), lateBurn: avg(late, s => s.burning + s.fire) };
}

/* =====================================================================
 * 6e. v4.1 新增用例：平衡、确定性、存档完整性、风影、刚体炸药、增量支撑
 * ===================================================================== */
export function groupCentroidX(t, xFrom, xTo) {
  let s = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = Math.max(0, xFrom); x <= Math.min(W - 1, xTo); x++) if (type[x + y * W] === t) { s += x; n++; }
  return n ? s / n : NaN;
}
