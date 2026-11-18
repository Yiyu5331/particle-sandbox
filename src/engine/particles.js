'use strict';
import { DX8, DY8, F_SCORCH, H, W, aux, flags, gx, gy, put, seed, temp, type } from './grid.js';
import { BRICK, CONCRETE, EMBER, M_RIGID, M_STATE, SAND, SOIL, STONE, S_GAS, WOOD } from './materials.js';
import { rnd } from './rng.js';

/* ---------------------------------------------------------------------
 * 2.8 飞行粒子：对象池（上限 4000，满了覆盖最旧的），不占网格，
 *     带浮点位置和速度，落地后写回网格。爆炸碎片、水花、反弹的沙粒都走这里。
 * ------------------------------------------------------------------- */
export const FP_MAX = 4000;
export let fpAlive = new Uint8Array(FP_MAX), fpType = new Uint8Array(FP_MAX), fpSeed = new Uint8Array(FP_MAX),
      fpAge = new Uint16Array(FP_MAX), fpTemp = new Float32Array(FP_MAX),
      fpX = new Float32Array(FP_MAX), fpY = new Float32Array(FP_MAX),
      fpVX = new Float32Array(FP_MAX), fpVY = new Float32Array(FP_MAX),
      fpPX = new Float32Array(FP_MAX), fpPY = new Float32Array(FP_MAX),     // 上一帧位置（拖尾）
      fpQX = new Float32Array(FP_MAX), fpQY = new Float32Array(FP_MAX);     // 上上帧位置
export let fpHead = 0, fpCount = 0;

export function fpClear() {
  fpAlive.fill(0); fpType.fill(0); fpSeed.fill(0); fpAge.fill(0); fpTemp.fill(0); fpX.fill(0); fpY.fill(0);
  fpVX.fill(0); fpVY.fill(0); fpPX.fill(0); fpPY.fill(0); fpQX.fill(0); fpQY.fill(0);
  fpCount = 0; fpHead = 0;
}

export function spawnFree(t, x, y, vx, vy, T, sd) {
  const k = fpHead;
  fpHead = (k + 1) % FP_MAX;
  if (!fpAlive[k]) fpCount++;
  fpAlive[k] = 1; fpType[k] = t; fpSeed[k] = sd; fpAge[k] = 0; fpTemp[k] = T;
  fpX[k] = fpPX[k] = fpQX[k] = x; fpY[k] = fpPY[k] = fpQY[k] = y;
  fpVX[k] = vx; fpVY[k] = vy;
}

export function fpSolidAt(cx, cy) {
  if (cx < 0 || cx >= W || cy < 0 || cy >= H) return true;
  const o = type[cx + cy * W];
  return o !== 0 && M_STATE[o] < S_GAS;
}

export function landFree(k, x, y) {
  fpAlive[k] = 0; fpCount--;
  let cx = Math.floor(x), cy = Math.floor(y);
  cx = cx < 0 ? 0 : cx >= W ? W - 1 : cx; cy = cy < 0 ? 0 : cy >= H ? H - 1 : cy;
  if (fpSolidAt(cx, cy)) {
    let found = false;
    for (let q = 0; q < 8; q++) {
      const nx = cx + DX8[q], ny = cy + DY8[q];
      if (!fpSolidAt(nx, ny)) { cx = nx; cy = ny; found = true; break; }
    }
    if (!found) {                            // 周围全被占了：往上弹一下再找地方，实在落不了脚（很少见）才丢弃
      if (fpAge[k] > 1500) return;
      fpAlive[k] = 1; fpCount++;
      fpX[k] = cx + 0.5 - gx * 1.5; fpY[k] = cy + 0.5 - gy * 1.5; fpVX[k] = -gx * 1.2 + (rnd() - 0.5); fpVY[k] = -gy * 1.2 + (rnd() - 0.5);
      return;
    }
  }
  const j = cx + cy * W, t = fpType[k];
  put(j, t, cx, cy);
  seed[j] = fpSeed[k]; temp[j] = fpTemp[k];
  if (M_RIGID[t]) aux[j] = 150;
  if (t === SAND || t === SOIL || t === STONE || t === WOOD || t === BRICK || t === CONCRETE) {
    if (fpTemp[k] > 150) flags[j] |= F_SCORCH;
  }
}

export function stepFree() {
  if (fpCount === 0) return;
  for (let k = 0; k < FP_MAX; k++) {
    if (!fpAlive[k]) continue;
    let x = fpX[k], y = fpY[k];
    let vx = (fpVX[k] + gx * 0.22) * 0.992, vy = (fpVY[k] + gy * 0.22) * 0.992;
    fpQX[k] = fpPX[k]; fpQY[k] = fpPY[k]; fpPX[k] = x; fpPY[k] = y;
    const age = ++fpAge[k];
    if (fpType[k] === EMBER && age > 60 + (fpSeed[k] & 63)) { fpAlive[k] = 0; fpCount--; continue; }
    const m = Math.max(vx < 0 ? -vx : vx, vy < 0 ? -vy : vy);
    const n = m < 1 ? 1 : Math.ceil(m), sx = vx / n, sy = vy / n;
    let hit = false;
    for (let s = 0; s < n; s++) {
      const nx = x + sx, ny = y + sy;
      if (fpSolidAt(Math.floor(nx), Math.floor(ny))) { hit = true; break; }
      x = nx; y = ny;
    }
    if (hit) {
      // 脚下有支撑才算落地；撞墙或撞天花板就弹回来接着飞，避免碎块挂在半空
      if (age > 600 || fpSolidAt(Math.floor(x) + gx, Math.floor(y) + gy)) { landFree(k, x, y); continue; }
      vx = -vx * 0.3; vy = -vy * 0.3;
    } else if (age > 900) { landFree(k, x, y); continue; }
    fpX[k] = x; fpY[k] = y; fpVX[k] = vx; fpVY[k] = vy;
  }
}

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function particlesSave() { return { fpAlive, fpType, fpSeed, fpAge, fpTemp, fpX, fpY, fpVX, fpVY, fpPX, fpPY, fpQX, fpQY, fpHead, fpCount }; }
export function particlesLoad(s) { ({ fpAlive, fpType, fpSeed, fpAge, fpTemp, fpX, fpY, fpVX, fpVY, fpPX, fpPY, fpQX, fpQY, fpHead, fpCount } = s); }
export function particlesSet(name, v) {
  switch (name) {
    case 'fpAlive': fpAlive = v; break;
    case 'fpType': fpType = v; break;
    case 'fpSeed': fpSeed = v; break;
    case 'fpAge': fpAge = v; break;
    case 'fpTemp': fpTemp = v; break;
    case 'fpX': fpX = v; break;
    case 'fpY': fpY = v; break;
    case 'fpVX': fpVX = v; break;
    case 'fpVY': fpVY = v; break;
    case 'fpPX': fpPX = v; break;
    case 'fpPY': fpPY = v; break;
    case 'fpQX': fpQX = v; break;
    case 'fpQY': fpQY = v; break;
    case 'fpHead': fpHead = v; break;
    case 'fpCount': fpCount = v; break;
    default: throw new Error('particles.js 没有可写的状态 ' + name);
  }
}
