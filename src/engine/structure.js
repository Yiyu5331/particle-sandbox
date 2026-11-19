'use strict';
import { dcos, dsin } from './dmath.js';
import { env, onCrash, st } from './env.js';
import { noteCollapse } from './events.js';
import { startExplosion } from './explosion.js';
import { DX4, DY4, F_BODY, F_BURN, F_PIN, F_SCORCH, H, N, W, addRipple, aux, charge, flags, fuel, gx, gy, initFuel, life, parity, put, seed, temp, tick, type, wake, wet } from './grid.js';
import { EMBER, FIRE, GLASS, LAVA, METAL, M_BLAST, M_BOND, M_BPOW, M_BURNTIME, M_DENS, M_FRAC, M_HARD, M_RIGID, M_STATE, NT, ROPE, SMOKE, STEEL, S_LIQUID, S_POWDER, S_SOLID } from './materials.js';
import { FP_MAX, fpCount, spawnFree } from './particles.js';
import { rnd, rndi } from './rng.js';

/* =====================================================================
 * 2s. 结构力学
 *   支撑检测：从「锚」出发在刚性固体里做洪泛搜索。锚 = 重力方向的画布边缘、锚点材料、
 *             克隆体 / 黑洞、以及直接压在土 / 沙 / 植物上的刚性固体。
 *             连接要求两格完整度都够（爆炸、燃烧、腐蚀会降低完整度；异种材料之间要求更高；
 *             金属 / 钢超过 900°C 软化）。正上方的格子靠压力支撑，不看完整度。
 *             绳子只受拉：支撑不能经过绳子向上传。
 *             只有在刚性固体被增删、削弱，或它脚下的粉末挪动时才重算，不是每帧都算。
 *   刚体：    搜不到的连通块变成刚体（质心、质量、转动惯量、速度、角速度），
 *             每帧先擦掉上一帧盖在网格里的章 → 积分 → 与网格碰撞 → 按新姿态（旋转后逆映射，
 *             最近邻采样）重新盖章。撞得够狠就碎裂，静止后冻结回静态网格。
 * ===================================================================== */
export const BOND_MIN = 70, BODY_MAX = 64;
export let stMark = null, stQueue = null;
export let structDirty = true;    // 有待处理的支撑检测（脏格列表见下）
export let structCooldown = 0, structHold = false;
export let bodies = new Array(BODY_MAX).fill(null);
export let bodyCount = 0, colX = 0, colY = 0;
export let fracVX = 0, fracVY = 0, fracTick = -100;
export let structStats = { checks: 0, made: 0, frozen: 0, fractured: 0 };

// 增量支撑检测用的「脏格」列表：哪里的刚性固体被增删、削弱，或者脚下的东西挪走了，就把那一格记进来。
// 每次只从这些格子出发做局部搜索；变动太多（或换了重力方向）才退回全图检测。
export let sdList = new Int32Array(1), sdSeen = new Uint8Array(1), sdCount = 0, structFull = true;
export let structSettle = false;   // 有刚体在动：等它们全部静止后再做一次全图兜底检测
export let stBuf = new Int32Array(1), stGrp = new Int32Array(1);
export function allocStruct() {
  stMark = new Uint8Array(N); stQueue = new Int32Array(N);
  sdList = new Int32Array(N); sdSeen = new Uint8Array(N); sdCount = 0; structFull = true; stBuf = new Int32Array(N); stGrp = new Int32Array(N);
}
export function markStruct(i) {
  if (sdSeen[i] === 0) { sdSeen[i] = 1; sdList[sdCount++] = i; }
  structDirty = true;
}
// 这一格和它四周的刚性格都要重新评估
export function markStructAround(i) {
  const x = i % W, y = (i / W) | 0;
  if (M_RIGID[type[i]]) markStruct(i);
  if (x > 0 && M_RIGID[type[i - 1]]) markStruct(i - 1);
  if (x < W - 1 && M_RIGID[type[i + 1]]) markStruct(i + 1);
  if (y > 0 && M_RIGID[type[i - W]]) markStruct(i - W);
  if (y < H - 1 && M_RIGID[type[i + W]]) markStruct(i + W);
  structDirty = true;
}
export function markStructAll() { structFull = true; structDirty = true; }
export function clearStructDirty() { for (let k = 0; k < sdCount; k++) sdSeen[sdList[k]] = 0; sdCount = 0; }

// 这一格能不能当锚（不用靠别人就站得住）
export function isAnchor(i) {
  const t = type[i];
  if (M_HARD[t] > 1 || (flags[i] & F_PIN) !== 0) return true;
  const x = i % W, y = (i / W) | 0, bx = x + gx, by = y + gy;
  if (bx < 0 || bx >= W || by < 0 || by >= H) return true;
  const j = bx + by * W, o = type[j];
  return o !== 0 && !M_RIGID[o] && M_STATE[o] < S_LIQUID && !(flags[j] & F_BODY);
}

// n 能不能撑住相邻的 c（和全图检测的连接规则完全一致）
export function canSupport(n, c) {
  const a = type[n], b = type[c];
  if (c === n - (gx + gy * W)) return !(a === ROPE || b === ROPE);   // c 在 n 正上方：压着就行，但绳子撑不住上面的东西
  const thr = a === b ? BOND_MIN : BOND_MIN * 1.3;
  if ((aux[n] < thr && M_HARD[a] <= 1) || (aux[c] < thr && M_HARD[b] <= 1)) return false;
  if ((a === METAL || a === STEEL) && temp[n] > 900) return false;
  if ((b === METAL || b === STEEL) && temp[c] > 900) return false;
  return true;
}

// 局部检测：从每个脏格出发，逆着「支撑」关系往回找锚。找到了就说明它站得住（提前停止）；
// 找遍了也没有，搜到的这一片全都失去了支撑，变成刚体。mark：1 = 本轮已确认站得住，2 = 已确认失去支撑，3 = 正在搜
export function checkLocal() {
  structStats.checks++;
  const mark = stMark, q = stQueue, buf = stBuf;
  let touched = 0;
  for (let s = 0; s < sdCount; s++) {
    const seedI = sdList[s];
    if (mark[seedI] !== 0 || !M_RIGID[type[seedI]] || (flags[seedI] & F_BODY)) continue;
    let qh = 0, qt = 0, found = false;
    q[qt++] = seedI; mark[seedI] = 3;
    while (qh < qt) {
      const c = q[qh++];
      if (mark[c] === 1 || isAnchor(c)) { found = true; break; }
      const x = c % W, y = (c / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k], ny = y + DY4[k];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const n = nx + ny * W, mn = mark[n];
        if (mn === 3 || mn === 2 || !M_RIGID[type[n]] || (flags[n] & F_BODY)) continue;
        if (!canSupport(n, c)) continue;
        if (mn === 1) { found = true; break; }
        mark[n] = 3; q[qt++] = n;
      }
      if (found) break;
    }
    if (found) {
      for (let k = 0; k < qt; k++) mark[q[k]] = 0;     // 搜到的其它格子还不能确定，清掉
      mark[seedI] = 1; buf[touched++] = seedI;
    } else {
      for (let k = 0; k < qt; k++) { mark[q[k]] = 2; buf[touched++] = q[k]; }
      // 失去支撑的这一片按四连通分组，各自成为刚体
      for (let k = 0; k < qt; k++) {
        const start = q[k];
        if (mark[start] !== 2) continue;
        const g = stGrp;
        let h = 0, tl = 0;
        g[tl++] = start; mark[start] = 4;
        while (h < tl) {
          const c = g[h++], x = c % W, y = (c / W) | 0;
          for (let d = 0; d < 4; d++) {
            const nx = x + DX4[d], ny = y + DY4[d];
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const j = nx + ny * W;
            if (mark[j] === 2) { mark[j] = 4; g[tl++] = j; }
          }
        }
        makeBodies(g.slice(0, tl));
      }
    }
  }
  for (let k = 0; k < touched; k++) mark[buf[k]] = 0;
  clearStructDirty();
}
export function bodiesClear() { bodies.fill(null); bodyCount = 0; }

export function checkStructure() {
  structStats.checks++;
  structFull = false;
  clearStructDirty();
  const mark = stMark, q = stQueue, gOff = gx + gy * W;
  mark.fill(0);
  let qh = 0, qt = 0;
  // 1) 找锚
  for (let i = 0; i < N; i++) {
    const t = type[i];
    if (!M_RIGID[t] || (flags[i] & F_BODY)) continue;
    let anchored = M_HARD[t] > 1 || (flags[i] & F_PIN) !== 0;
    if (!anchored) {
      const x = i % W, y = (i / W) | 0, bx = x + gx, by = y + gy;
      if (bx < 0 || bx >= W || by < 0 || by >= H) anchored = true;
      else {
        const o = type[i + gOff];
        if (o !== 0 && !M_RIGID[o] && M_STATE[o] < S_LIQUID && !(flags[i + gOff] & F_BODY)) anchored = true;
      }
    }
    if (anchored) { mark[i] = 1; q[qt++] = i; }
  }
  // 2) 洪泛
  while (qh < qt) {
    const i = q[qh++], a = type[i], x = i % W, y = (i / W) | 0;
    const ai = aux[i], up = i - gOff;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k], ny = y + DY4[k];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const j = nx + ny * W;
      if (mark[j]) continue;
      const b = type[j];
      if (!M_RIGID[b] || (flags[j] & F_BODY)) continue;
      if (j === up) {
        if (a === ROPE || b === ROPE) continue;        // 绳子撑不住上面的东西
      } else {                                         // 侧向和向下靠连接强度
        const thr = a === b ? BOND_MIN : BOND_MIN * 1.3;
        if ((ai < thr && M_HARD[a] <= 1) || (aux[j] < thr && M_HARD[b] <= 1)) continue;
        if ((b === METAL || b === STEEL) && temp[j] > 900) continue;
        if ((a === METAL || a === STEEL) && temp[i] > 900) continue;
      }
      mark[j] = 1; q[qt++] = j;
    }
  }
  // 3) 没被搜到的刚性格：按连通块变成刚体
  for (let i = 0; i < N; i++) {
    if (mark[i] || !M_RIGID[type[i]] || (flags[i] & F_BODY)) continue;
    let h = 0, tl = 0;
    q[tl++] = i; mark[i] = 2;
    while (h < tl) {
      const c = q[h++], x = c % W, y = (c / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k], ny = y + DY4[k];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const j = nx + ny * W;
        if (mark[j] || !M_RIGID[type[j]] || (flags[j] & F_BODY)) continue;
        mark[j] = 2; q[tl++] = j;
      }
    }
    makeBodies(q.slice(0, tl));
  }
  mark.fill(0);                                       // 局部检测要用干净的标记
}

// 太大的块按随机偏移的方格切开（近似「沿薄弱处分裂」），每块各自成为刚体。
// 切几块要看刚体池还剩多少空位：空位不够就切得粗一些，保证整片失去支撑的结构都能动起来，
// 不会因为池子满了而留一部分悬在半空挡路。
export function makeBodies(cells) {
  let free = 0;
  for (let k = 0; k < BODY_MAX; k++) if (!bodies[k]) free++;
  const n = cells.length;
  const pieces = Math.max(1, Math.min(free - 1, Math.ceil(n / 900)));
  if (pieces <= 1) { makeBody(cells); return; }
  let minx = W, miny = H, maxx = 0, maxy = 0;
  for (let k = 0; k < n; k++) { const c = cells[k], x = c % W, y = (c / W) | 0; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  const S = Math.max(20, Math.ceil(Math.sqrt((maxx - minx + 1) * (maxy - miny + 1) / pieces))) + rndi(6);
  const ox = rndi(S), oy = rndi(S), groups = new Map();
  for (let k = 0; k < n; k++) {
    const c = cells[k], x = c % W, y = (c / W) | 0;
    const key = (((x - minx + ox) / S) | 0) + (((y - miny + oy) / S) | 0) * 4096;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(c);
  }
  for (const g of groups.values()) makeBody(Int32Array.from(g));
}

export function debrisCell(c, vx, vy) {
  const x = c % W, y = (c / W) | 0;
  if (M_BLAST[type[c]] && (flags[c] & F_BURN)) {         // 引信在烧的炸药：不变成碎渣，当场引爆
    const t = type[c];
    type[c] = 0; flags[c] = parity; life[c] = 0; aux[c] = 0; wet[c] = 0; fuel[c] = 0;
    markStructAround(c);
    startExplosion(x, y, M_BLAST[t], M_BPOW[t]);
    return;
  }
  if (fpCount < FP_MAX - 20) spawnFree(type[c], x + 0.5, y + 0.5, vx + (rnd() - 0.5) * 1.2, vy + (rnd() - 0.5) * 1.2, temp[c], seed[c]);
  type[c] = 0; flags[c] = parity; life[c] = 0; aux[c] = 0; wet[c] = 0; fuel[c] = 0;
  markStructAround(c);                               // 挂在它上面 / 下面的东西要重新评估
  wake(x, y);
}

export function makeBody(cells) {
  const n = cells.length;
  if (n <= 2) { for (let k = 0; k < n; k++) debrisCell(cells[k], 0, 0); return; }
  let id = -1;
  for (let k = 0; k < BODY_MAX; k++) if (!bodies[k]) { id = k; break; }
  if (id < 0) {                                        // 刚体满了：小块直接碎成渣，大块先原地不动，稍后再试
    if (n <= 40) for (let k = 0; k < n; k++) debrisCell(cells[k], 0, 0);
    else { markStruct(cells[0]); structCooldown = 20; }
    return;
  }
  let minx = W, miny = H, maxx = 0, maxy = 0, mass = 0, mx = 0, my = 0;
  const cnt = new Uint16Array(NT);
  for (let k = 0; k < n; k++) {
    const c = cells[k], x = c % W, y = (c / W) | 0, m = M_DENS[type[c]];
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    mass += m; mx += m * (x + 0.5); my += m * (y + 0.5);
    cnt[type[c]]++;
  }
  const comX = mx / mass, comY = my / mass, lw = maxx - minx + 1, lh = maxy - miny + 1;
  const lt = new Uint8Array(lw * lh), ls = new Uint8Array(lw * lh), lf = new Uint8Array(lw * lh), lT = new Float32Array(lw * lh);
  const pts = new Float32Array(n * 2), litL = [];
  let I = 0, r = 0, mat = 0;
  for (let t = 1; t < NT; t++) if (cnt[t] > cnt[mat]) mat = t;
  noteCollapse(n, comX, comY, mat);
  for (let k = 0; k < n; k++) {
    const c = cells[k], x = c % W, y = (c / W) | 0, li = (x - minx) + (y - miny) * lw;
    const px = x + 0.5 - comX, py = y + 0.5 - comY, d2 = px * px + py * py;
    lt[li] = type[c]; ls[li] = seed[c]; lf[li] = flags[c] & F_SCORCH; lT[li] = temp[c];
    if (M_BLAST[type[c]] && (flags[c] & F_BURN)) { lf[li] |= F_BURN; litL.push([li, life[c] > 1 ? life[c] : 1]); }   // 引信在烧的炸药：带着引信一起掉
    pts[k * 2] = px; pts[k * 2 + 1] = py;
    I += M_DENS[type[c]] * (d2 + 0.17);
    if (d2 > r) r = d2;
    type[c] = 0; flags[c] = parity; life[c] = 0; aux[c] = 0; wet[c] = 0; fuel[c] = 0;
    markStructAround(c);
  }
  const b = { id, n, mass, I, x: comX, y: comY, vx: 0, vy: 0, ang: 0, om: (rnd() - 0.5) * 0.012,
              lw, lh, cx: comX - minx, cy: comY - miny, lt, ls, lf, lT, pts, r: Math.sqrt(r) + 1.5, mat,
              stamp: new Int32Array(n * 2 + 64), stampL: new Int32Array(n * 2 + 64), stampN: 0, rest: 0, age: 0, sub: 0, subDens: 0, stuck: 0, sx: comX, sy: comY,
              blast: 0, fuses: [] };
  for (let t = 1; t < NT; t++) if (M_BLAST[t]) b.blast += cnt[t];
  b.fuses = litL;
  if (tick - fracTick <= 4) { b.vx = fracVX; b.vy = fracVY; }      // 碎裂出来的块继承原来的速度
  bodies[id] = b; bodyCount++;
  structStats.made++;
  stampBody(b);
}

export function stampBody(b) {
  const c = dcos(b.ang), s = dsin(b.ang), R = b.r, lw = b.lw, lh = b.lh, tag = b.id + 1;
  const x0 = Math.max(0, Math.floor(b.x - R)), x1 = Math.min(W - 1, Math.ceil(b.x + R));
  const y0 = Math.max(0, Math.floor(b.y - R)), y1 = Math.min(H - 1, Math.ceil(b.y + R));
  let n = 0, sub = 0, subD = 0;
  const stamp = b.stamp, cap = stamp.length;
  for (let wy = y0; wy <= y1; wy++) {
    // 这一行两侧（刚体外面）有没有液体：有的话这一行的格子算浸没。用来算浮力
    let rowDens = 0;
    for (let k = 0; k < 2 && rowDens === 0; k++) {
      const sx = k === 0 ? x0 - 1 : x1 + 1;
      if (sx < 0 || sx >= W) continue;
      const o = type[sx + wy * W];
      if (M_STATE[o] === S_LIQUID) rowDens = M_DENS[o];
    }
    for (let wx = x0; wx <= x1; wx++) {
      const dx = wx + 0.5 - b.x, dy = wy + 0.5 - b.y;
      const li = Math.floor(c * dx + s * dy + b.cx), lj = Math.floor(-s * dx + c * dy + b.cy);   // 逆映射回刚体自己的坐标
      if (li < 0 || li >= lw || lj < 0 || lj >= lh) continue;
      const l = li + lj * lw, t = b.lt[l];
      if (t === 0) continue;
      const j = wx + wy * W, o = type[j];
      if (o !== 0) {
        const so = M_STATE[o];
        if ((flags[j] & F_BODY) || so === S_SOLID) continue;
        if (so === S_LIQUID || so === S_POWDER) {      // 把占着位置的液体 / 粉末挤出去（水花、扬尘）
          if (fpCount < FP_MAX - 50) spawnFree(o, wx + 0.5, wy + 0.5, b.vx * 0.6 + (rnd() - 0.5) * 1.6 + dx * 0.04, b.vy * 0.3 - gy * (0.5 + rnd()) - gx * (0.5 + rnd()), temp[j], seed[j]);
          if (so === S_LIQUID && rnd() < 0.1) addRipple(wx, wy);
        }
      }
      type[j] = t; seed[j] = b.ls[l]; temp[j] = b.lT[l]; flags[j] = parity | F_BODY | b.lf[l];
      life[j] = tag; aux[j] = 200; wet[j] = 0; fuel[j] = 0; charge[j] = 0;
      if (rowDens > 0) { sub++; subD += rowDens; }
      if (n < cap) { stamp[n] = j; b.stampL[n] = l; n++; }
      if (b.lf[l] & F_BURN) flags[j] |= F_BURN;          // 引信已点着的炸药：照样闪
      wake(wx, wy);
    }
  }
  b.stampN = n; b.sub = sub / b.n; b.subDens = sub ? subD / sub : 0;
}

export function unstampBody(b) {
  const stamp = b.stamp, tag = b.id + 1;
  for (let k = 0; k < b.stampN; k++) {
    const j = stamp[k];
    if ((flags[j] & F_BODY) && life[j] === tag) { type[j] = 0; flags[j] = parity; life[j] = 0; aux[j] = 0; }
  }
  b.stampN = 0;
}

// 某个姿态下有多少格撞进了固体 / 粉末 / 画布之外；顺便算出接触点的重心。
// colStatic = 其中撞在静止物上的格数，colBody = 撞到的另一个刚体（没有则为 -1）
export let colStatic = 0, colBody = -1;
export function collide(b, X, Y, A) {
  const c = dcos(A), s = dsin(A), pts = b.pts;
  let n = 0, sx = 0, sy = 0, ns = 0, other = -1;
  for (let k = 0, m = b.n * 2; k < m; k += 2) {
    const px = pts[k], py = pts[k + 1];
    const wx = X + c * px - s * py, wy = Y + s * px + c * py;
    const ix = Math.floor(wx), iy = Math.floor(wy);
    let hit = false;
    if (ix < 0 || ix >= W || iy < 0 || iy >= H) { hit = true; ns++; }
    else {
      const j = ix + iy * W, o = type[j];
      if (o !== 0 && M_STATE[o] < S_LIQUID) { hit = true; if (flags[j] & F_BODY) other = life[j] - 1; else ns++; }
    }
    if (hit) { n++; sx += wx; sy += wy; }
  }
  if (n) { colX = sx / n; colY = sy / n; }
  colStatic = ns; colBody = other;
  return n;
}

// 卡死的碎块（被别的东西楔住、动不了，但按连接关系又算不上有支撑）冻结时打上「楔住」标记，当作锚。
// 下一次爆炸或用户动笔时统一清掉，重新评估。
export let pinTick = -100;
export function clearPins() {
  if (tick - pinTick < 30) return;
  pinTick = tick;
  for (let i = 0; i < N; i++) if (flags[i] & F_PIN) { flags[i] &= ~F_PIN; markStruct(i); }
}

export function freezeBody(b, pin) {
  // 差不多摆正了的就对齐到 90° 的整数倍再盖章：这样是逐格精确的，不会因为旋转采样丢格子
  const q = Math.round(b.ang / 1.5708) * 1.5708;
  if (Math.abs(b.ang - q) < 0.3) {
    unstampBody(b);
    b.ang = q;
    for (let k = 0; k < 8 && collide(b, b.x, b.y, b.ang) > 0; k++) { b.x -= gx * 0.5; b.y -= gy * 0.5; }
    // 再顺着重力落回去，直到刚好贴住下面的东西（否则会悬着，被判成失去支撑，反复冻结 / 解冻）
    for (let k = 0; k < 16 && collide(b, b.x + gx * 0.5, b.y + gy * 0.5, b.ang) === 0; k++) { b.x += gx * 0.5; b.y += gy * 0.5; }
    stampBody(b);
  }
  const stamp = b.stamp, tag = b.id + 1;
  for (let k = 0; k < b.stampN; k++) {
    const j = stamp[k];
    if ((flags[j] & F_BODY) && life[j] === tag) {
      flags[j] = (flags[j] & ~F_BODY) | (pin ? F_PIN : 0); life[j] = 0; aux[j] = 120; fuel[j] = initFuel(type[j]); markStructAround(j);
      if (b.lf[b.stampL[k]] & F_BURN) life[j] = fuseLeft(b, b.stampL[k]);   // 还在烧的引信：落地后接着烧
    }
  }
  bodies[b.id] = null; bodyCount--;
  structStats.frozen++;
}

export function fractureBody(b, impact) {
  structStats.fractured++;
  // 撞击的震动把落点附近静止的刚性固体也震松
  const R = 9, ix = Math.round(colX), iy = Math.round(colY), dmgK = Math.min(2, impact) * 45;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = ix + dx, y = iy + dy;
    if (x < 0 || x >= W || y < 0 || y >= H || dx * dx + dy * dy > R * R) continue;
    const j = x + y * W, o = type[j];
    if (!M_RIGID[o] || M_HARD[o] > 1 || (flags[j] & F_BODY)) continue;
    const d = dmgK * (1 - Math.sqrt(dx * dx + dy * dy) / R) / M_BOND[o], a = aux[j], na = a > d ? a - d : 0;
    aux[j] = na;
    if ((a >= 70 && na < 70) || (a >= 91 && na < 91)) markStructAround(j);
  }
  fracVX = b.vx * 0.5; fracVY = b.vy * 0.5; fracTick = tick;
  const c = dcos(b.ang), s = dsin(b.ang);
  if (b.mat === GLASS || b.n < 24) {                   // 玻璃和小块：直接碎成渣
    for (let lj = 0; lj < b.lh; lj++) for (let li = 0; li < b.lw; li++) {
      const l = li + lj * b.lw, t = b.lt[l];
      if (!t || fpCount >= FP_MAX - 20) continue;
      const px = li + 0.5 - b.cx, py = lj + 0.5 - b.cy;
      if (M_BLAST[t] && (b.lf[l] & F_BURN)) {         // 引信在烧的炸药被摔碎：当场引爆
        const ex = Math.floor(b.x + c * px - s * py), ey = Math.floor(b.y + s * px + c * py);
        if (ex >= 0 && ex < W && ey >= 0 && ey < H) startExplosion(ex, ey, M_BLAST[t], M_BPOW[t]);
        continue;
      }
      spawnFree(t, b.x + c * px - s * py, b.y + s * px + c * py, b.vx * 0.5 + (rnd() - 0.5) * 2.6, b.vy * 0.3 + (rnd() - 0.5) * 2.6, b.lT[l], b.ls[l]);
    }
    bodies[b.id] = null; bodyCount--;
    return;
  }
  // 大块：盖回网格，沿穿过撞击点的一两条随机直线抠出裂缝，剩下的部分由支撑检测重新分成几个刚体
  stampBody(b);
  const stamp = b.stamp, tag = b.id + 1, cuts = 1 + (rnd() < 0.5 ? 1 : 0) + (b.n > 400 ? 1 : 0);
  const ca = [], sa = [];
  for (let k = 0; k < cuts; k++) { const a = rnd() * 3.1416; ca.push(dcos(a)); sa.push(dsin(a)); }
  for (let k = 0; k < b.stampN; k++) {
    const j = stamp[k];
    if (!((flags[j] & F_BODY) && life[j] === tag)) continue;
    const x = j % W, y = (j / W) | 0;
    flags[j] &= ~F_BODY; life[j] = 0; aux[j] = 255; markStruct(j);
    let onCut = false;
    for (let q = 0; q < cuts; q++) if (Math.abs((x + 0.5 - colX) * sa[q] - (y + 0.5 - colY) * ca[q]) < 0.8) { onCut = true; break; }
    if (!onCut) continue;
    if (rnd() < 0.5) debrisCell(j, fracVX, fracVY);
    else {                                             // 扬起尘土
      type[j] = 0; flags[j] = parity; aux[j] = 0;
      put(j, SMOKE, x, y); seed[j] = 100 + rndi(50); life[j] = 30 + rndi(50);
    }
  }
  bodies[b.id] = null; bodyCount--;
  structCooldown = 0;
}

export function bodyImpulse(id, ix, iy, px, py) {
  const b = bodies[id];
  if (!b) return;
  const k = 40 * M_DENS[b.mat] / 2600;
  ix *= k / 100; iy *= k / 100;
  b.vx += ix * 100 / b.mass; b.vy += iy * 100 / b.mass;
  b.om += ((px - b.x) * iy - (py - b.y) * ix) * 100 / b.I;
  b.rest = 0;
}

export function stepBody(b) {
  b.age++;
  let g = 0.22;
  if (b.sub > 0) {                                     // 浮力：排开的液体密度 × 浸没比例，对比自身平均密度
    const ratio = b.subDens * b.sub / (b.mass / b.n);
    g *= 1 - (ratio > 1.8 ? 1.8 : ratio);
    b.vx *= 0.94; b.vy *= 0.94; b.om *= 0.92;
  }
  b.vx += gx * g; b.vy += gy * g;
  if (b.vx > 6) b.vx = 6; else if (b.vx < -6) b.vx = -6;
  if (b.vy > 6) b.vy = 6; else if (b.vy < -6) b.vy = -6;
  if (b.om > 0.18) b.om = 0.18; else if (b.om < -0.18) b.om = -0.18;
  const m = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.om) * b.r);
  const n = m < 1 ? 1 : m > 8 ? 8 : Math.ceil(m);
  let resting = false, movedAny = false;
  for (let s = 0; s < n; s++) {
    const X = b.x + b.vx / n, Y = b.y + b.vy / n, A = b.ang + b.om / n;
    if (collide(b, X, Y, A) === 0) { b.x = X; b.y = Y; b.ang = A; movedAny = true; continue; }
    const other = colStatic === 0 && colBody >= 0 ? bodies[colBody] : null;
    if (other) {
      // 撞上的是另一个还在动的刚体：按质量把两者的速度拉平（一起往下掉），只有相对速度够大才算撞击
      const mt = b.mass + other.mass, rvx = b.vx - other.vx, rvy = b.vy - other.vy, rel = Math.sqrt(rvx * rvx + rvy * rvy);
      const vx = (b.vx * b.mass + other.vx * other.mass) / mt, vy = (b.vy * b.mass + other.vy * other.mass) / mt;
      b.vx = other.vx = vx; b.vy = other.vy = vy; b.om *= 0.8;
      if (rel > 0.9) { st.crash += rel * Math.min(400, b.n); if (onCrash) onCrash(colX, colY, rel, b.n); }
      if (rel > M_FRAC[b.mat] * 1.3 && b.n > 10) { fractureBody(b, rel); return; }
      break;
    }
    // 撞上静止物：对接触点施加冲量（会带来转动），再加一点摩擦
    let rx = colX - b.x, ry = colY - b.y;
    const rl = Math.sqrt(rx * rx + ry * ry);
    let nx, ny;
    if (rl < 0.6) { nx = -gx; ny = -gy; rx = 0; ry = 0; } else { nx = -rx / rl; ny = -ry / rl; }
    const vcx = b.vx - b.om * ry, vcy = b.vy + b.om * rx, vn = vcx * nx + vcy * ny;
    if (vn < 0) {
      const rn = rx * ny - ry * nx, j = -1.12 * vn / (1 / b.mass + rn * rn / b.I);
      b.vx += j * nx / b.mass; b.vy += j * ny / b.mass; b.om += rn * j / b.I;
    }
    b.vx *= 0.85; b.vy *= 0.85; b.om *= 0.6;
    const impact = -vn;
    // 接触点在侧面时上面的冲量抵不掉下落速度；只要正下方确实被静止物挡着，就把沿重力方向的速度清掉
    if (collide(b, b.x + gx * 0.5, b.y + gy * 0.5, b.ang) > 0 && colStatic > 0) {
      const along = b.vx * gx + b.vy * gy;
      if (along > 0) { b.vx -= gx * along; b.vy -= gy * along; }
      resting = true;
    }
    if (impact > 0.9) { st.crash += impact * Math.min(400, b.n); if (onCrash) onCrash(colX, colY, impact, b.n); }
    if (impact > M_FRAC[b.mat] && b.n > 10) { fractureBody(b, impact); return; }
    break;
  }
  stampBody(b);
  if (b.blast > 0 && stepFuses(b)) return;
  if (resting && Math.abs(b.vx) + Math.abs(b.vy) < 0.45 && Math.abs(b.om) < 0.05) b.rest++;
  else b.rest = 0;
  b.stuck = movedAny ? 0 : (b.stuck || 0) + 1;         // 卡在别的碎块里一动不动：一段时间后就地冻结
  let wedged = b.stuck > 24;
  if (b.age % 90 === 0) {                              // 每 1.5 秒看一次：几乎没挪窝也算卡住（浸在液体里漂着的不算）
    if (b.age > 90 && b.sub === 0 && (b.x - b.sx) * (b.x - b.sx) + (b.y - b.sy) * (b.y - b.sy) < 2.25) wedged = true;
    b.sx = b.x; b.sy = b.y;
  }
  if (b.rest > 10) freezeBody(b, false);
  else if (wedged || b.age > 2400) freezeBody(b, b.sub === 0);
}

/* ---- 刚体里的炸药：下落途中被火、熔岩、余烬或爆炸波及，照样点着、照样炸 ---- */
export function fuseLeft(b, l) {
  for (const f of b.fuses) if (f[0] === l) return f[1] > 1 ? f[1] : 1;
  return 1;
}

// 点着刚体里第 l 格（局部坐标）的炸药，引信 t 步
export function lightBodyCell(b, l, t) {
  if (b.lf[l] & F_BURN) { for (const f of b.fuses) if (f[0] === l && f[1] > t) f[1] = t; return; }
  b.lf[l] |= F_BURN;
  b.fuses.push([l, t]);
}

// 世界里第 j 格是刚体 id 盖的章：点着它对应的那格炸药
export function lightBodyAt(j, t) {
  const b = bodies[life[j] - 1];
  if (!b) return;
  for (let k = 0; k < b.stampN; k++) if (b.stamp[k] === j) { const l = b.stampL[k]; if (M_BLAST[b.lt[l]]) lightBodyCell(b, l, t); return; }
}

// 每步：检查刚体里的炸药有没有挨着火，推进引信，到点就炸。返回 true 表示这个刚体已经没了
export function stepFuses(b) {
  const stamp = b.stamp, sl = b.stampL;
  for (let k = 0; k < b.stampN; k++) {
    const j = stamp[k], l = sl[k], t = b.lt[l];
    if (!M_BLAST[t] || (b.lf[l] & F_BURN)) continue;
    const x = j % W, y = (j / W) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX4[d], ny = y + DY4[d];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const n = nx + ny * W, o = type[n];
      if ((flags[n] & F_BODY) && life[n] === b.id + 1) continue;
      if (o === FIRE || o === LAVA || o === EMBER || (o !== 0 && (flags[n] & F_BURN) && !(flags[n] & F_BODY))) { lightBodyCell(b, l, M_BURNTIME[t]); break; }
    }
  }
  if (b.fuses.length === 0) return false;
  const c = dcos(b.ang), s = dsin(b.ang);
  let boom = false;
  for (let q = b.fuses.length - 1; q >= 0; q--) {
    const f = b.fuses[q];
    if (--f[1] > 0) continue;
    const l = f[0], t = b.lt[l];
    b.fuses.splice(q, 1);
    if (!M_BLAST[t]) continue;
    const li = l % b.lw, lj = (l / b.lw) | 0, px = li + 0.5 - b.cx, py = lj + 0.5 - b.cy;
    const wx = Math.floor(b.x + c * px - s * py), wy = Math.floor(b.y + s * px + c * py);
    b.lt[l] = 0; b.lf[l] &= ~F_BURN; b.blast--;
    if (wx >= 0 && wx < W && wy >= 0 && wy < H) {
      const j = wx + wy * W;
      if ((flags[j] & F_BODY) && life[j] === b.id + 1) { type[j] = 0; flags[j] = parity; life[j] = 0; aux[j] = 0; }
      startExplosion(wx, wy, M_BLAST[t], M_BPOW[t]);
      boom = true;
    }
  }
  return boom && !bodies[b.id];
}

export let bodyOrder = [];
export function stepStructure() {
  if (bodyCount > 0) {
    // 先算靠重力下游的（下面的先落，上面的才有地方落）
    bodyOrder.length = 0;
    for (let k = 0; k < BODY_MAX; k++) if (bodies[k]) bodyOrder.push(bodies[k]);
    bodyOrder.sort((p, q) => (q.x * gx + q.y * gy) - (p.x * gx + p.y * gy));
    // 先把所有刚体的章都擦掉，再按顺序逐个移动、盖章：后动的只会撞上已经就位的，互相咬合的碎块不会死锁
    for (let k = 0; k < bodyOrder.length; k++) unstampBody(bodyOrder[k]);
    for (let k = 0; k < bodyOrder.length; k++) { const b = bodyOrder[k]; if (bodies[b.id] === b) stepBody(b); }
  }
  if (!env.structure) {
    if (bodyCount > 0) for (let k = 0; k < BODY_MAX; k++) { const b = bodies[k]; if (b) freezeBody(b, false); }
    return;
  }
  if ((tick % 300) === 0) clearPins();                    // 「楔住」的标记每 300 步失效一次，重新评估（真卡住的会再被标上）
  // 大规模坍塌时碎块互相撞来撞去，局部标记可能漏掉被连带削弱的地方：坍塌进行中每 120 步、
  // 以及所有碎块都静止下来的那一刻，各做一次全图兜底检测。平时只做局部检测
  if (bodyCount > 0) { structSettle = true; if ((tick % 120) === 0) markStructAll(); }
  else if (structSettle) { structSettle = false; markStructAll(); }
  if (structDirty && !structHold && --structCooldown <= 0) {
    structDirty = false; structCooldown = bodyCount > 8 ? 6 : 3;      // 正在大规模坍塌时少查几次
    if (structFull || sdCount > (N >> 4)) checkStructure();         // 换了重力方向、或者一次变动太多：全图检测
    else checkLocal();
  }
}

// 新开一局：上一局留下的结构力学状态全部清掉
export function resetStructState() {
  pinTick = -100; fracTick = -100; structCooldown = 0; structHold = false;
  structSettle = false; fracVX = 0; fracVY = 0; clearStructDirty(); markStructAll();
}

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function structureSave() { return { stMark, stQueue, structDirty, structCooldown, structHold, bodies, bodyCount, colX, colY, fracVX, fracVY, fracTick, structStats, sdList, sdSeen, sdCount, structFull, structSettle, stBuf, stGrp, colStatic, colBody, pinTick, bodyOrder }; }
export function structureLoad(s) { ({ stMark, stQueue, structDirty, structCooldown, structHold, bodies, bodyCount, colX, colY, fracVX, fracVY, fracTick, structStats, sdList, sdSeen, sdCount, structFull, structSettle, stBuf, stGrp, colStatic, colBody, pinTick, bodyOrder } = s); }
export function structureSet(name, v) {
  switch (name) {
    case 'stMark': stMark = v; break;
    case 'stQueue': stQueue = v; break;
    case 'structDirty': structDirty = v; break;
    case 'structCooldown': structCooldown = v; break;
    case 'structHold': structHold = v; break;
    case 'bodies': bodies = v; break;
    case 'bodyCount': bodyCount = v; break;
    case 'colX': colX = v; break;
    case 'colY': colY = v; break;
    case 'fracVX': fracVX = v; break;
    case 'fracVY': fracVY = v; break;
    case 'fracTick': fracTick = v; break;
    case 'structStats': structStats = v; break;
    case 'sdList': sdList = v; break;
    case 'sdSeen': sdSeen = v; break;
    case 'sdCount': sdCount = v; break;
    case 'structFull': structFull = v; break;
    case 'structSettle': structSettle = v; break;
    case 'stBuf': stBuf = v; break;
    case 'stGrp': stGrp = v; break;
    case 'colStatic': colStatic = v; break;
    case 'colBody': colBody = v; break;
    case 'pinTick': pinTick = v; break;
    case 'bodyOrder': bodyOrder = v; break;
    default: throw new Error('structure.js 没有可写的状态 ' + name);
  }
}
