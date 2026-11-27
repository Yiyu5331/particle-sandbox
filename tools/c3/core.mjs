// 把 levels.src.mjs 里的关卡定义变成正式关卡 JSON，并做质量检查（参考解法、备选解法、空解、随机机器人、扰动）。
import { puzzleValidateLevel } from '../../src/modes/puzzle/format.js';
import { puzzleVerify } from '../../src/modes/puzzle/session.js';
import { c3Args, c3Jitter, c3Play, c3RandomLog, c3Reference, c3Rng } from './lib.mjs';

export const C3_CHAPTERS = {
  1: ['第一章 · 粉末与重力', 'Chapter 1 · Powder and gravity'],
  2: ['第二章 · 水与流体', 'Chapter 2 · Water and fluids'],
  3: ['第三章 · 火与热', 'Chapter 3 · Fire and heat'],
  4: ['第四章 · 相变', 'Chapter 4 · Phase changes'],
  5: ['第五章 · 结构与爆破', 'Chapter 5 · Structures and demolition'],
  6: ['第六章 · 天气与电', 'Chapter 6 · Weather and electricity'],
};

export const c3Id = def => `c3-${def.n}-${def.slug}`;

// 解法里的一笔写成日志条目。规划关全在第 0 步。
export function c3Log(def, solution) {
  return solution.strokes.map(s => s.args ? { step: s.step, command: 'stroke', args: s.args } : { step: 0, command: 'stroke', args: s });
}

// 不带参考解法的关卡骨架（JSON 字段顺序与示例关卡一致）。
export function c3Skeleton(def) {
  const [chapter] = C3_CHAPTERS[def.n[0]];
  const level = {
    version: 1, id: c3Id(def), name: def.text.name[0], chapter, difficulty: def.difficulty, hint: def.text.desc[0],
    type: def.type, world: { width: def.W ?? 64, height: def.H ?? 40, seed: def.seed ?? 1, commands: def.setup },
    regions: def.regions, materials: def.materials, budget: def.budget, maxSteps: def.maxSteps,
    goal: def.goal, fail: def.fail ?? null,
    stars: { two: { maxUsed: def.stars.two[0], maxSteps: def.stars.two[1] }, three: { maxUsed: def.stars.three[0], maxSteps: def.stars.three[1] } },
    reference: { steps: 0, log: [] },
  };
  for (const s of def.solutions) for (const e of c3Log(def, s)) e.args = c3Args(level, e.args);
  return level;
}

// 正式关卡：参考解法取第一个解法实际回放到结算步。
export function c3Level(def) {
  const level = c3Skeleton(def);
  const ref = c3Reference(level, c3Log(def, def.solutions[0]).map(e => ({ ...e, args: c3Args(level, e.args) })));
  level.reference = { steps: ref.steps, log: ref.log };
  return puzzleValidateLevel(level);
}

// 每个解法的回放结果。
export function c3Solutions(def, level) {
  return def.solutions.map(s => {
    const log = c3Log(def, s).map(e => ({ ...e, args: c3Args(level, e.args) }));
    const r = c3Play(level, log);
    return { name: s.name, strokes: log.length, ...r, log };
  });
}

// 随机机器人：n 次，种子按关卡 id 派生，返回通关次数和得星分布。
export function c3Bot(level, n = 200, seed = 1) {
  let wins = 0, stars = [0, 0, 0, 0];
  const base = [...level.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, seed);
  for (let k = 0; k < n; k++) {
    const rng = c3Rng(base + k * 7919);
    const r = c3Play(level, c3RandomLog(level, rng));
    if (r.state === 'won') { wins++; stars[r.stars]++; }
  }
  return { n, wins, rate: wins / n, stars };
}

// 扰动：把参考解法每一笔随机平移 ±1 格，n 次。
export function c3JitterRuns(level, n = 50, seed = 1) {
  let wins = 0, three = 0;
  const base = [...level.id].reduce((h, c) => (h * 131 + c.charCodeAt(0)) | 0, seed);
  for (let k = 0; k < n; k++) {
    const rng = c3Rng(base + k * 104729);
    const r = c3Play(level, c3Jitter(level, level.reference.log, rng));
    if (r.state === 'won') { wins++; if (r.stars === 3) three++; }
  }
  return { n, wins, rate: wins / n, three };
}

export function c3Nothing(level) { return c3Play(level, []); }

// 一关的完整检查。
export function c3Audit(def, { bot = 200, jitter = 50 } = {}) {
  const level = c3Level(def);
  const verify = puzzleVerify(level);
  const solutions = c3Solutions(def, level);
  const nothing = c3Nothing(level);
  const botRes = bot ? c3Bot(level, bot) : null;
  const jit = jitter && level.type === 'planning' ? c3JitterRuns(level, jitter) : null;
  // 实时关：把参考解法的每一笔都提前到第 0 步，必须失败，说明这关确实考时机（仅报告，不算硬性问题）。
  const early = level.type === 'realtime' ? c3Play(level, level.reference.log.map(e => ({ ...e, step: 0 }))) : null;
  const problems = [];
  if (verify.stars !== 3) problems.push(`参考解法只有 ${verify.stars} 星`);
  for (const s of solutions) if (s.state !== 'won') problems.push(`解法「${s.name}」没有通关（${s.state}，${s.steps} 步）`);
  if (solutions.length < 2) problems.push('少于两种解法');
  if (nothing.state === 'won') problems.push('什么都不做也能通关');
  if (botRes && botRes.rate >= 0.05) problems.push(`随机通关率 ${(botRes.rate * 100).toFixed(1)}% ≥ 5%`);
  if (jit && jit.rate < 0.8) problems.push(`扰动通过率 ${(jit.rate * 100).toFixed(0)}% < 80%`);
  return { def, level, verify, solutions, nothing, bot: botRes, jitter: jit, early, problems };
}
