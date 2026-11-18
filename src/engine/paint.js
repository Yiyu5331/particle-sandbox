'use strict';
import { env } from './env.js';
import { F_BODY, H, N, W, clearCell, flags, inb, put, temp, type, wake, wet } from './grid.js';
import { EMPTY, ICE, SALTWATER, SNOW, STEAM, TOOL_COOL, TOOL_ERASE, TOOL_HEAT, WATER } from './materials.js';
import { FP_MAX, fpAlive, fpType } from './particles.js';
import { rnd } from './rng.js';
import { weatherWater } from './weather.js';

/* ---------------------------------------------------------------------
 * 2.13 绘制到网格（笔刷、预设、测试共用）与统计
 * ------------------------------------------------------------------- */
// 返回 1 = 放下了一格，-1 = 擦掉了一格，0 = 没变（预算系统按这个扣材料）
export function paintCell(x, y, t, replace) {
  if (x < 0 || x >= W || y < 0 || y >= H) return 0;
  const i = x + y * W;
  if (flags[i] & F_BODY) return 0;
  if (t === TOOL_ERASE) { if (type[i] !== 0) { clearCell(i, x, y); return -1; } return 0; }
  if (t === TOOL_HEAT) { temp[i] = Math.min(2500, temp[i] + 60); wake(x, y); return 0; }
  if (t === TOOL_COOL) { temp[i] = Math.max(-200, temp[i] - 60); wake(x, y); return 0; }
  if (t >= 100) return 0;
  const o = type[i];
  if (o === t) return 0;
  if (o !== 0 && !replace) return 0;
  put(i, t, x, y);
  return 1;
}

export function fillRect(t, x0, y0, x1, y1) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(W - 1, x1 | 0); y1 = Math.min(H - 1, y1 | 0);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = x + y * W;
    if (t === EMPTY) clearCell(i, x, y); else put(i, t, x, y);
  }
}

export function fillCircle(t, cx, cy, r, chance) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    if (!inb(x, y)) continue;
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy > r2) continue;
    if (chance !== undefined && rnd() > chance) continue;
    if (t === EMPTY) clearCell(x + y * W, x, y); else put(x + y * W, t, x, y);
  }
}

export function countType(t, x0, y0, x1, y1) {
  if (x0 === undefined) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (type[x + y * W] === t) n++;
  return n;
}

// 水量账本：所有形态的水加起来（单位：格水）。没有外部输入输出时应当守恒。
export function totalWater() {
  let n = 0, w = 0;
  for (let i = 0; i < N; i++) {
    const t = type[i];
    if (t === 0) continue;
    if (t === WATER || t === SALTWATER || t === STEAM || t === ICE || t === SNOW) n++;
    w += wet[i];
  }
  for (let k = 0; k < FP_MAX; k++) {
    if (!fpAlive[k]) continue;
    const t = fpType[k];
    if (t === WATER || t === SALTWATER || t === STEAM || t === ICE || t === SNOW) n++;
  }
  return n + w / 100 + weatherWater() + env.waterSink + env.waterOut - env.waterIn;
}
