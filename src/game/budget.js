'use strict';
import { world } from '../modes/sandbox/ui.js';
/* 背包 / 预算：每种材料能放多少格。和引擎的配合方式：
 *   brushStroke(world, args) 把剩余额度作为 args.limit 交给 world.exec('stroke')，
 *   引擎返回实际放下的格数 {placed, removed}，这里再扣掉。（引擎不知道预算，只负责“最多放 limit 格”和“报告放了几格”。） */
export function createBudget(limits, bus) {
  const left = Object.assign({}, limits);      // { [materialId]: 剩余格数 }；没列出的材料不限
  return {
    left(mat) { return mat in left ? left[mat] : Infinity; },
    all() { return Object.assign({}, left); },
    /** 带预算地画一笔；返回引擎的结果 */
    brushStroke(world, args) {
      const m = args.tool;
      const has = !args.erase && m in left;
      if (has && left[m] <= 0) return { placed: 0, removed: 0, rejected: 'budget' };
      const res = world.exec('stroke', has ? Object.assign({}, args, { limit: left[m] }) : args);
      if (has && res && res.placed) { left[m] -= res.placed; if (bus) bus.emit('budget', { material: m, left: left[m] }); }
      return res;
    },
    refund(mat, n) { if (mat in left) { left[mat] += n; if (bus) bus.emit('budget', { material: mat, left: left[mat] }); } },
    serialize() { return Object.assign({}, left); },
    deserialize(o) { for (const k of Object.keys(left)) delete left[k]; Object.assign(left, o); },
  };
}
