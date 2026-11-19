'use strict';
import { dcos, dsin } from './dmath.js';
import { onBoom, st } from './env.js';
import { noteBoom } from './events.js';
import { F_BODY, F_BURN, F_SCORCH, H, W, aux, clearCell, flags, gx, gy, life, put, seed, temp, type, wake } from './grid.js';
import { EMBER, FIRE, M_BLAST, M_BOND, M_HARD, M_RIGID, M_STATE, SMOKE, S_GAS } from './materials.js';
import { spawnFree } from './particles.js';
import { rnd, rndi } from './rng.js';
import { bodyImpulse, clearPins, lightBodyAt, markStructAround } from './structure.js';

/* ---------------------------------------------------------------------
 * 2.7 爆炸：从爆心放出一圈射线，分 3 帧由内向外推进。
 *     每条射线带能量，随距离衰减；碰到硬度低于能量的材料就炸碎并继续，
 *     碰到更硬的就被挡住 → 石头和金属后面是安全的，弹坑边缘天然不规则。
 *     冲击波还会震松范围内刚性固体的连接（完整度下降），给刚体一个冲量。
 * ------------------------------------------------------------------- */
export const EX_MAX = 48, EX_RAYS = 200;
export let exA = new Uint8Array(EX_MAX), exX = new Float32Array(EX_MAX), exY = new Float32Array(EX_MAX),
      exR = new Float32Array(EX_MAX), exP = new Float32Array(EX_MAX), exCur = new Float32Array(EX_MAX),
      exN = new Uint16Array(EX_MAX), exPhase = new Float32Array(EX_MAX),
      exRays = new Float32Array(EX_MAX * EX_RAYS);
export let exActive = 0;

// 整个池子归零（死槽位里的旧数据虽然不影响模拟，但会进哈希，必须清干净）
export function exClear() { exA.fill(0); exX.fill(0); exY.fill(0); exR.fill(0); exP.fill(0); exCur.fill(0); exN.fill(0); exPhase.fill(0); exRays.fill(0); exActive = 0; }

export function startExplosion(x, y, R, P) {
  noteBoom(x, y, R, P);
  let k = -1;
  for (let q = 0; q < EX_MAX; q++) if (!exA[q]) { k = q; break; }
  if (k < 0) {                               // 池满：把进度最靠前的那个立刻算完，腾出位置
    let bv = -1;
    for (let q = 0; q < EX_MAX; q++) { const v = exCur[q] / exR[q]; if (v > bv) { bv = v; k = q; } }
    while (exA[k]) stepExplosion(k);
  }
  exA[k] = 1; exActive++;
  exX[k] = x; exY[k] = y; exR[k] = R; exP[k] = P; exCur[k] = 0;
  const n = Math.min(EX_RAYS, Math.ceil(6.2832 * R * 1.5));
  exN[k] = n; exPhase[k] = rnd() * 6.2832;
  for (let r = 0; r < n; r++) exRays[k * EX_RAYS + r] = P * (0.65 + rnd() * 0.7);
  // 震松连接：范围内的刚性固体完整度下降，越近、连接系数越小降得越多
  const RR = Math.ceil(R * 1.15);
  for (let dy = -RR; dy <= RR; dy++) for (let dx = -RR; dx <= RR; dx++) {
    const px = x + dx, py = y + dy;
    if (px < 0 || px >= W || py < 0 || py >= H) continue;
    const j = px + py * W, o = type[j];
    if (o === 0) continue;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > RR) continue;
    if (M_BLAST[o] > 0) {                              // 殉爆：范围内的炸药不管有没有被挡住都会被引爆，时间按距离错开
      if (flags[j] & F_BODY) lightBodyAt(j, 3 + ((d * 0.5) | 0) + rndi(9));
      else if (!(flags[j] & F_BURN)) { flags[j] |= F_BURN; life[j] = 3 + ((d * 0.5) | 0) + rndi(9); wake(px, py); }
      continue;
    }
    if (!M_RIGID[o] || M_HARD[o] > 1) continue;
    const dmg = (1 - d / RR) * 110 * P / M_BOND[o];
    const a = aux[j], na = a > dmg ? a - dmg : 0;
    aux[j] = na;
    if ((a >= 70 && na < 70) || (a >= 91 && na < 91)) markStructAround(j);     // 只有跨过连接阈值的格子才会改变支撑关系
  }
  clearPins();
  st.boom++;
  if (onBoom) onBoom(x, y, R, P);
}

export function stepExplosion(k) {
  const cx = exX[k], cy = exY[k], R = exR[k], P = exP[k], n = exN[k], base = k * EX_RAYS, ph = exPhase[k];
  const r0 = exCur[k], r1 = Math.min(R, r0 + Math.max(1.5, R / 3));
  const fall = P / R * 0.6;
  for (let r = 0; r < n; r++) {
    let e = exRays[base + r];
    if (e <= 0) continue;
    const a = ph + r / n * 6.2832, dx = dcos(a), dy = dsin(a);
    let lastJ = -1;
    for (let d = r0 < 0.8 ? 0.8 : r0; d < r1; d += 0.6) {
      const px = Math.round(cx + dx * d), py = Math.round(cy + dy * d);
      if (px < 0 || px >= W || py < 0 || py >= H) { e = 0; break; }
      e -= fall;
      if (e <= 0) break;
      const j = px + py * W;
      if (j === lastJ) continue;
      lastJ = j;
      const o = type[j];
      const Tn = temp[j] + e * 140;                  // 瞬间升温，封顶 850°C：能点燃东西，但不至于熔穿石墙、烧软钢梁
      temp[j] = Tn > 850 ? (temp[j] > 850 ? temp[j] : 850) : Tn;
      if (o === 0) {
        const q = rnd();
        if (q < 0.05 * e) { put(j, SMOKE, px, py); seed[j] = 90 + rndi(60); }
        else if (q < 0.05 * e + 0.012) {
          const sp = 1 + e * 4;
          spawnFree(EMBER, px + 0.5, py + 0.5, dx * sp + rnd() - 0.5, dy * sp + rnd() - 0.5, 650, rndi(256));
        } else wake(px, py);
        continue;
      }
      if (flags[j] & F_BODY) {                       // 打在刚体上：推它一把；里面的炸药被引爆
        if (M_BLAST[o]) lightBodyAt(j, 3 + ((d * 0.4) | 0) + rndi(9));
        bodyImpulse(life[j] - 1, dx * e * 2600, dy * e * 2600, px, py);
        e -= 0.3;
        continue;
      }
      if (M_BLAST[o] > 0) {                          // 连锁：错开引爆时间，不在同一帧全炸
        const fz = 3 + ((d * 0.4) | 0) + rndi(9);
        if (!(flags[j] & F_BURN)) { flags[j] |= F_BURN; life[j] = fz; }
        else if (life[j] > fz + 6) life[j] = fz;
        e -= 0.03; wake(px, py);
        continue;
      }
      const h = M_HARD[o];
      if (e > h) {                                   // 炸碎
        const so = M_STATE[o], q = rnd();
        if (so < S_GAS && q < 0.6) {                 // 变成飞行粒子抛出去
          const sp = (1.2 + e * 4.5) * (0.6 + rnd() * 0.8);
          spawnFree(o, px + 0.5, py + 0.5, dx * sp - gx * 1.2 * e + rnd() - 0.5, dy * sp - gy * 1.2 * e + rnd() - 0.5,
                    temp[j] > 400 ? 400 : temp[j], seed[j]);
          clearCell(j, px, py);
        } else if (so < S_GAS && q < 0.75) {
          put(j, q < 0.68 ? FIRE : SMOKE, px, py);
        } else clearCell(j, px, py);
        e -= h * 0.6 + 0.01;
      } else {                                       // 挡住了：熏黑
        if (h <= 1) flags[j] |= F_SCORCH;
        wake(px, py);
        e = 0;
        break;
      }
    }
    exRays[base + r] = e;
  }
  exCur[k] = r1;
  if (r1 >= R) { exA[k] = 0; exActive--; }
}

export function stepExplosions() {
  if (exActive === 0) return;
  for (let k = 0; k < EX_MAX; k++) if (exA[k]) stepExplosion(k);
}

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function explosionSave() { return { exA, exX, exY, exR, exP, exCur, exN, exPhase, exRays, exActive }; }
export function explosionLoad(s) { ({ exA, exX, exY, exR, exP, exCur, exN, exPhase, exRays, exActive } = s); }
export function explosionSet(name, v) {
  switch (name) {
    case 'exA': exA = v; break;
    case 'exX': exX = v; break;
    case 'exY': exY = v; break;
    case 'exR': exR = v; break;
    case 'exP': exP = v; break;
    case 'exCur': exCur = v; break;
    case 'exN': exN = v; break;
    case 'exPhase': exPhase = v; break;
    case 'exRays': exRays = v; break;
    case 'exActive': exActive = v; break;
    default: throw new Error('explosion.js 没有可写的状态 ' + name);
  }
}
