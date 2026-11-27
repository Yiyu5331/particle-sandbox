// C3 解谜关卡的公共工具：回放任意笔画日志、随机布置机器人、参考解法扰动、ASCII 画面。
// 只用解谜模块的公开函数（puzzleSession）和引擎公开入口，判定与游戏内完全相同。
import { MATERIALS } from '../../src/engine/index.js';
import { puzzleSession } from '../../src/modes/puzzle/session.js';

// 确定性随机数（xorshift32），机器人和扰动都用它，报告可复现。
export function c3Rng(seed) {
  let s = (seed | 0) || 0x9e3779b9;
  const next = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  return { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), pick: arr => arr[Math.floor(next() * arr.length)] };
}

// 按日志回放一局，直到结算或超时。日志的 step 是相对本关起点的已完成步数。
// 返回 {state, stars, steps, used, hash, placed}，不要求日志恰好在结算步结束。
export function c3Play(level, log, { keep = false, until } = {}) {
  const s = puzzleSession(level);
  let i = 0, placed = 0;
  const sorted = [...log].sort((a, b) => a.step - b.step);
  try {
    if (level.type === 'planning') {
      for (const e of sorted) placed += s.stroke(e.args).placed;
      s.run();
    }
    while (s.phase === 'running') {
      if (level.type === 'realtime') while (sorted[i]?.step === s.elapsed) placed += s.stroke(sorted[i++].args).placed;
      if (until !== undefined && s.elapsed >= until) break;
      s.advance();
    }
    const r = { state: s.phase, stars: s.outcome.score, steps: s.elapsed, used: s.used, hash: s.world.hash(), placed };
    if (keep) { r.session = s; return r; }
    return r;
  } finally { if (!keep) s.dispose(); }
}

// 把实际结算结果整理成可直接写进关卡的参考解法：规划关全部在第 0 步，实时关去掉结算后的笔画。
export function c3Reference(level, log) {
  const r = c3Play(level, log);
  if (r.state !== 'won') throw new Error(`${level.id} 参考解法未通关（${r.state}，${r.steps} 步）`);
  const kept = log.filter(e => e.step < r.steps || level.type === 'planning' && e.step === 0)
    .map(e => ({ step: level.type === 'planning' ? 0 : e.step, command: 'stroke', args: c3Args(level, e.args) }));
  return { steps: r.steps, log: kept, result: r };
}

// 笔画参数规范化：材料写成键名，去掉 shape 的默认值，坐标夹在世界内。
export function c3Args(level, a) {
  const key = typeof a.tool === 'number' ? MATERIALS[a.tool].key : a.tool;
  const clamp = (v, n) => Math.max(0, Math.min(n - 1, Math.round(v)));
  const out = { tool: key, x0: clamp(a.x0, level.world.width), y0: clamp(a.y0, level.world.height),
    x1: clamp(a.x1 ?? a.x0, level.world.width), y1: clamp(a.y1 ?? a.y0, level.world.height), size: Math.max(1, Math.min(16, a.size ?? 1)) };
  if (a.shape && a.shape !== 'circle') out.shape = a.shape;
  return out;
}

// 随机布置机器人：在白名单和总预算内随机选材料、位置、笔刷大小和形状，直到用完预算或画满笔数。
// 实时关的每一笔再随机选一个时刻（前 60% 时限内）。
export function c3RandomLog(level, rng) {
  const mats = Object.keys(level.materials).filter(k => level.materials[k] > 0);
  const W = level.world.width, H = level.world.height;
  const strokes = rng.int(1, 6), log = [];
  for (let k = 0; k < strokes; k++) {
    const x0 = rng.int(0, W - 1), y0 = rng.int(0, H - 1);
    const line = rng.next() < 0.6;
    const len = rng.int(1, 12), ang = rng.int(0, 3);
    const dx = line ? [len, 0, len, -len][ang] : 0, dy = line ? [0, len, len, len][ang] : 0;
    const args = { tool: rng.pick(mats), x0, y0, x1: x0 + dx, y1: y0 + dy, size: rng.pick([1, 1, 1, 2, 2, 3, 4]), shape: rng.pick(['circle', 'circle', 'square', 'spray']) };
    const step = level.type === 'realtime' ? rng.int(0, Math.floor(level.maxSteps * 0.6)) : 0;
    log.push({ step, command: 'stroke', args: c3Args(level, args) });
  }
  return log.sort((a, b) => a.step - b.step);
}

// 把参考解法的每一笔整体随机平移 −1、0、+1 格（x、y 各自独立）。
export function c3Jitter(level, log, rng) {
  return log.map(e => {
    const dx = rng.int(-1, 1), dy = rng.int(-1, 1), a = e.args;
    return { ...e, args: c3Args(level, { ...a, x0: a.x0 + dx, x1: a.x1 + dx, y0: a.y0 + dy, y1: a.y1 + dy }) };
  });
}

const C3_GLYPH = {
  EMPTY: ' ', SAND: '.', WATER: '~', FIRE: '^', WOOD: 'w', STONE: '#', LAVA: 'L', PLANT: 'p', ICE: 'I', ACID: 'a', SMOKE: ',',
  STEAM: '"', EMBER: '*', TNT: 'T', METAL: 'M', OIL: 'o', GUNPOWDER: 'g', GLASS: 'G', ASH: '_', CHARCOAL: 'c', SALT: 's',
  SALTWATER: '=', SPARK: '!', SOIL: 'd', BRICK: 'B', CONCRETE: 'C', STEEL: 'H', ANCHOR: 'A', ROPE: '|', DEADPLANT: 'x', FOAM: 'f', SNOW: '*',
};
// 字符画：方便在终端里检查关卡布局和结算画面。区域边界用小写字母标在右侧。
export function c3Ascii(world, regions = []) {
  const type = world.getField('type'), W = world.width, H = world.height, rows = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const k = MATERIALS[type[x + y * W]].key;
      let ch = C3_GLYPH[k] ?? '?';
      if (ch === ' ') for (const r of regions) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && (x === r.x || x === r.x + r.w - 1 || y === r.y || y === r.y + r.h - 1)) ch = r.type === 'goal' ? '+' : r.type === 'noBuild' ? ':' : '%';
      row += ch;
    }
    rows.push(String(y).padStart(2) + ' ' + row);
  }
  return rows.join('\n');
}
