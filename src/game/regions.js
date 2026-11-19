'use strict';
import { world } from '../modes/sandbox/ui.js';
/* 区域辅助：在引擎区域（world.addRegion）上加一层“按标签管理”和“胜负判定常用查询”。 */
export function regionsByTag(world, tag) { return world.regions().filter(r => r.tag === tag); }

/** 区域里某种材料的格数（材料用 key，例如 'WATER'） */
export function countInRegion(world, idOrRect, key) {
  const q = world.queryRegion(idOrRect);
  return q.byKey[key] || 0;
}

/** 区域里是否在燃烧 / 温度是否超标，给塔防“基地”之类用 */
export function regionDanger(world, idOrRect, maxTemp = 200) {
  const q = world.queryRegion(idOrRect);
  return { burning: q.burning, hot: q.maxTemp > maxTemp, maxTemp: q.maxTemp };
}

/** 画一个受保护的矩形区域（玩家笔刷改不了，点火 / 爆炸 / 生成也不行） */
export function protectRect(world, x, y, w, h, tag = 'protected') {
  return world.addRegion({ tag, x, y, w, h, rules: { protect: true } });
}
