'use strict';
import { H, W, type } from './grid.js';
import { NT } from './materials.js';
import { RULES } from './rules.js';
/* =====================================================================
 * 事件计数：模拟过程中只做计数和记位置（不影响模拟、不进哈希），
 * 每步结束时由 world.js 汇总成事件数组，按固定顺序发给订阅者。
 * 顺序：reaction → materialFirstCreated → ignite → extinguish → explosion → collapse → lightning（→ regionChanged，由 world.js 追加）
 * ===================================================================== */

export let evRule = new Uint32Array(RULES.length);      // 本步每条接触规则触发了几次
export let evRuleX = new Int32Array(RULES.length), evRuleY = new Int32Array(RULES.length);
export let evSeen = new Uint8Array(NT);                 // 这个世界里出现过的材料
export let evNewMats = [];                              // 本步第一次出现的材料
export let evIgnite = 0, evIgniteX = 0, evIgniteY = 0;
export let evExt = 0, evExtX = 0, evExtY = 0;
export let evBooms = [];                                // [{x, y, radius, power}]
export let evCollapses = [];                            // [{cells, x, y, material}]
export let evBolts = [];                                // [{x, y, fromX, fromY}]

export function noteRule(k, x, y) { if (evRule[k]++ === 0) { evRuleX[k] = x; evRuleY[k] = y; } }
export function noteMat(t) { if (evSeen[t] === 0) { evSeen[t] = 1; evNewMats.push(t); } }
export function noteIgnite(x, y) { if (evIgnite++ === 0) { evIgniteX = x; evIgniteY = y; } }
export function noteExtinguish(x, y) { if (evExt++ === 0) { evExtX = x; evExtY = y; } }
export function noteBoom(x, y, radius, power) { evBooms.push({ x, y, radius, power }); }
export function noteCollapse(cells, x, y, material) { evCollapses.push({ cells, x, y, material }); }
export function noteBolt(x, y, fromX, fromY) { evBolts.push({ x, y, fromX, fromY }); }

// 每步开始：清空本步的计数
export function eventsBegin() {
  evRule.fill(0); evNewMats = [];
  evIgnite = 0; evExt = 0; evBooms = []; evCollapses = []; evBolts = [];
}

// 每步结束：把计数汇总成事件（按固定顺序）
export function eventsCollect(step) {
  const out = [];
  for (let k = 0; k < RULES.length; k++) {
    if (evRule[k] === 0) continue;
    const r = RULES[k];
    out.push({ type: 'reaction', step, rule: k, reactant: r.a, other: r.b, products: [r.a2, r.b2], count: evRule[k], x: evRuleX[k], y: evRuleY[k] });
  }
  for (const t of evNewMats) out.push({ type: 'materialFirstCreated', step, material: t });
  if (evIgnite) out.push({ type: 'ignite', step, count: evIgnite, x: evIgniteX, y: evIgniteY });
  if (evExt) out.push({ type: 'extinguish', step, count: evExt, x: evExtX, y: evExtY });
  for (const b of evBooms) out.push({ type: 'explosion', step, x: b.x, y: b.y, radius: b.radius, power: b.power });
  for (const c of evCollapses) out.push({ type: 'collapse', step, cells: c.cells, x: c.x, y: c.y, material: c.material });
  for (const b of evBolts) out.push({ type: 'lightning', step, x: b.x, y: b.y, fromX: b.fromX, fromY: b.fromY });
  return out;
}

// 已出现材料的扫描：put / morph 会立刻登记；其它直接改类型的路径（相变、腐烂……）由这里每步扫 1/16 的格子补上（最多晚 16 步）
let scanRow = 0;
export function scanNewMaterials(type, W, H) {
  for (let y = scanRow; y < H; y += 16) {
    for (let i = y * W, e = i + W; i < e; i++) { const t = type[i]; if (evSeen[t] === 0) { evSeen[t] = 1; evNewMats.push(t); } }
  }
  scanRow = (scanRow + 1) & 15;
}

export function eventsSave() { return { evRule, evRuleX, evRuleY, evSeen, evNewMats, evIgnite, evIgniteX, evIgniteY, evExt, evExtX, evExtY, evBooms, evCollapses, evBolts, scanRow }; }
export function eventsLoad(s) { ({ evRule, evRuleX, evRuleY, evSeen, evNewMats, evIgnite, evIgniteX, evIgniteY, evExt, evExtX, evExtY, evBooms, evCollapses, evBolts, scanRow } = s); }

// 新世界 / resetWorld：清空“出现过的材料”，让 materialFirstCreated 从头算
export function eventsReset() { evSeen.fill(0); scanRow = 0; eventsBegin(); }
