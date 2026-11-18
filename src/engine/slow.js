'use strict';
import { canGrow } from './cells.js';
import { WL, env } from './env.js';
import { DX4, DY4, F_BODY, F_BURN, F_SCORCH, F_TIP, H, N, W, aux, clearCell, flags, fuel, gx, gy, inb, initFuel, life, lx, ly, morph, parity, put, seed, temp, type, wake, wet } from './grid.js';
import { ASH, DEADPLANT, FLOWER, ICE, M_ABSORB, M_STATE, NT, PLANT, SALTWATER, SAND, SEED, SNOW, SOIL, S_LIQUID, WATER, WOOD } from './materials.js';
import { biomass, geneHeight, plantLifespan, skyOpen, sprout, stemHeight } from './plants.js';
import { rnd, rndi } from './rng.js';
import { markStructAround } from './structure.js';
import { GW, vaporAdd, windX } from './weather.js';

/* ---------------------------------------------------------------------
 * 2.11 慢速环境过程：每步只处理 1/61 的格子（每格约每秒轮到一次），与分块休眠无关。
 *      蒸发、晾干、渗水、植物的吸水 / 老化 / 开花 / 落种 / 枯萎、腐烂、融雪、演替都在这里。
 * ------------------------------------------------------------------- */
export const SLOW_STRIDE = 61;
export let slowPhase = 0;

export function slowWet(x, y, i, t, w) {
  let exposed = false;
  // 渗水：先往下（顺着重力）渗，下面吃不下了再随机往旁边匀
  const bx = x + gx, by = y + gy;
  let bottom = bx < 0 || bx >= W || by < 0 || by >= H;
  if (!bottom) {
    const j = bx + by * W, o = type[j], cap = M_ABSORB[o];
    if (cap > 0 && o !== PLANT && !(flags[j] & F_BODY)) {
      const wj = wet[j];
      if (w > wj && wj < cap) {
        const q = Math.min(w - wj > 4 ? (w - wj) >> 1 : w - wj, cap - wj);
        if ((wj <= 60 && wj + q > 60) || (w > 60 && w - q <= 60)) { wake(x, y); wake(bx, by); }
        wet[j] = wj + q; w -= q;
      }
    } else if (o !== 0 && M_STATE[o] !== S_LIQUID) bottom = true;      // 下面是不吸水的石头 / 金属：这是最底层
  }
  const k0 = rndi(4);
  for (let k = 0; k < 4; k++) {
    const kk = (k0 + k) & 3, nx = x + DX4[kk], ny = y + DY4[kk];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W, o = type[j];
    if (o === 0) { exposed = true; continue; }
    if (k !== 0 || o === PLANT || (nx === bx && ny === by)) continue;
    const cap = M_ABSORB[o], wj = wet[j];
    if (cap > 0 && w - wj > 24 && wj < cap) {
      const q = Math.min((w - wj) >> 1, cap - wj);
      if ((wj <= 60 && wj + q > 60) || (w > 60 && w - q <= 60)) { wake(x, y); wake(nx, ny); }
      wet[j] = wj + q; w -= q;
    }
  }
  if (exposed && rnd() < (temp[i] < 0 ? 0.01 : 0.12)) {      // 晾干：按日照、温度、风速，水分进入空气（冻住的地面几乎不蒸发）
    const wv = windX[(x >> 3) + (y >> 3) * GW];
    const rate = 1 + ((env.sun * 3) | 0) + (temp[i] > 40 ? 3 : 0) + ((wv < 0 ? -wv : wv) > 0.4 ? 1 : 0);
    const d = w < rate ? w : rate;
    if (w > 60 && w - d <= 60) wake(x, y);
    w -= d;
    vaporAdd(x, y, d / 100); WL.evapWet += d / 100;
  }
  wet[i] = w;
}

export function slowWater(x, y, i) {
  // 下渗：积水下面是土 / 沙，没吸饱就渗进去；吸饱了也会慢慢渗进地下水
  const bx = x + gx, by = y + gy;
  if (bx >= 0 && bx < W && by >= 0 && by < H) {
    const j = bx + by * W, o = type[j];
    if ((o === SOIL || o === SAND) && !(flags[j] & F_BODY)) {
      const cap = M_ABSORB[o];
      if (cap - wet[j] >= 50) { wet[j] = Math.min(cap, wet[j] + 100); clearCell(i, x, y); wake(bx, by); return; }
      // 薄薄一层的积水（上面没有别的水压着）在吸饱的地面上也会慢慢渗走；深水（湖、池塘）不会
      const ux = x - gx, uy = y - gy;
      const isW = (px, py) => px >= 0 && px < W && py >= 0 && py < H && (type[px + py * W] === WATER || type[px + py * W] === SALTWATER);
      const thin = !isW(ux, uy) && !isW(x + lx, y + ly) && !isW(x - lx, y - ly);      // 孤立的一小摊水，不是湖边
      if (thin && rnd() < 0.01) { env.waterOut += 1; WL.seep += 1; clearCell(i, x, y); return; }
    } else if ((o === PLANT || o === FLOWER || o === DEADPLANT || o === WOOD) && !(flags[j] & F_BODY)) {
      // 截留：落在枝叶、树干上的水，没吸饱就被吸进去；吸饱了就挂在叶子上较快地蒸发掉，不会在树冠上越积越多
      const cap = M_ABSORB[o];
      if (cap - wet[j] >= 25) { wet[j] = Math.min(cap, wet[j] + 100); clearCell(i, x, y); return; }
      if (rnd() < 0.03) { clearCell(i, x, y); vaporAdd(x, y, 1); WL.evapSurface++; return; }
    }
  }
  const ux = x - gx, uy = y - gy;
  if (ux < 0 || ux >= W || uy < 0 || uy >= H || type[ux + uy * W] !== 0) return;
  // 水面蒸发：白天快、夜里慢，水越热越快（接近冰点的水几乎不蒸发），有风更快
  const Tw = temp[i];
  let k = Tw <= 0 ? 0.03 : Tw < 10 ? 0.03 + 0.04 * Tw : 1 + (Tw - 20) / 25;
  k = k > 3 ? 3 : k < 0.03 ? 0.03 : k;
  const wv = windX[(x >> 3) + (y >> 3) * GW];
  if (rnd() < 0.003 * (0.4 + 1.6 * env.sun) * k * (1 + (wv < 0 ? -wv : wv))) { clearCell(i, x, y); vaporAdd(x, y, 1); WL.evapSurface++; }
}

export function slowPlant(x, y, i) {
  const f = flags[i], g = seed[i];
  let w = wet[i];
  for (let k = 0; k < 4; k++) {                        // 根：从湿土或水里吸水
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W, o = type[j];
    if ((o === SOIL || o === SAND) && wet[j] > 20 && w < 60) {            // 根吸水只补到「汁液」的量，不会把自己泡湿
      const q = Math.min(wet[j] - 10, 60 - w, 50);
      wet[j] -= q; w += q;
    } else if (o === WATER && w < 60 && rnd() < 0.5) {
      const q = 60 - w;
      w += q;
      if (rnd() * 100 < q) clearCell(j, nx, ny);
    } else if (o === PLANT && w - wet[j] > 12) {       // 水分在植株里往别处匀
      const q = (w - wet[j]) >> 1;
      wet[j] += q; w -= q;
    }
  }
  if (w > 20 && rnd() < 0.12 * (0.3 + env.sun)) { w--; vaporAdd(x, y, 0.01); WL.transpire += 0.01; }  // 蒸腾
  wet[i] = w;
  if (f & (F_TIP | F_BURN | F_BODY)) return;
  let age = life[i] + (w === 0 ? 2 : 1) * env.plantAging;   // 缺水老得快；plantAging 是整体的衰老速度倍数
  if (age > 60000) age = 60000;
  life[i] = age;
  if (age > plantLifespan(g) && rnd() < 0.15) {        // 寿终：枯萎成枯枝
    type[i] = DEADPLANT; life[i] = 0; flags[i] = (f & F_SCORCH) | parity; fuel[i] = initFuel(DEADPLANT);
    wake(x, y);
    return;
  }
  if (!canGrow()) return;
  const ux = x - gx, uy = y - gy;
  if (ux < 0 || ux >= W || uy < 0 || uy >= H || type[ux + uy * W] !== 0) return;
  if (age < 160 * env.plantAging && w >= 50 && rnd() < 0.02 && skyOpen(x, y) && stemHeight(x, y) < geneHeight(g) && biomass(x, y, 3) < 24) {
    flags[i] |= F_TIP; life[i] = Math.min(2 + rndi(4), geneHeight(g) - stemHeight(x, y));   // 水分充足的幼株顶端再抽一小段，不超过株高上限
    wake(x, y);
  } else if (age > 30 * env.plantAging && w >= 30 && rnd() < 0.006 && skyOpen(x, y) && !flowerNear(x, y)) {
    const j = ux + uy * W;                             // 成株开花
    put(j, FLOWER, ux, uy); seed[j] = rndi(5) * 51 + 8 + rndi(34);
    wet[i] = w - 20; env.waterSink += 0.2; WL.plantUse += 0.2;
  }
}

// 附近 7×7 范围里已经有花了：不再开（花的数量很快饱和，不会越开越多）
export function flowerNear(x, y) {
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < W && ny >= 0 && ny < H && type[nx + ny * W] === FLOWER) return true;
  }
  return false;
}

export function slowFlower(x, y, i) {
  const age = life[i] + env.plantAging;
  life[i] = age;
  if (age > 600 && rnd() < 0.002) {                    // 开十分钟以后才陆续谢（平均再开八分钟），不会同时谢光                       // 谢了：六成落下一粒种子，基因来自母株并略有变异
    if (rnd() < 0.6) {
      let g = rndi(256);
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k], ny = y + DY4[k];
        if (inb(nx, ny) && type[nx + ny * W] === PLANT) { g = seed[nx + ny * W]; break; }
      }
      if (rnd() < 0.3) g ^= 1 << rndi(8);
      type[i] = SEED; seed[i] = g; life[i] = 0; flags[i] = parity; fuel[i] = initFuel(SEED); wet[i] = 0;
      wake(x, y);
    } else clearCell(i, x, y);
  }
}

export function slowSeed(x, y, i) {
  const age = life[i] + env.plantAging;
  life[i] = age;
  if (age > 180 && rnd() < 0.01) { clearCell(i, x, y); return; }      // 三分钟内没发芽（太挤、太干、没光）：大多烂掉
  const bx = x + gx, by = y + gy;
  if (bx < 0 || bx >= W || by < 0 || by >= H) return;
  const bj = bx + by * W, b = type[bj];
  if (b === SOIL) { if (wet[bj] < 30 || aux[bj] < 20) return; }
  else if (b === SAND) { if (wet[bj] < 60) return; }
  else return;
  if (!canGrow() || !skyOpen(x, y) || biomass(x, y, 4) > 10 || rnd() > 0.25) return;
  wet[bj] -= 30; env.waterSink += 0.3; WL.plantUse += 0.3;
  if (b === SOIL) aux[bj] -= 20;                        // 消耗养分
  sprout(i, x, y);
}

export function slowSoil(x, y, i) {
  // 植被演替：湿润、有养分、见得到光、周围还空着的土面，偶尔自己冒出新芽（土里的种子库）
  if (wet[i] < 80 || aux[i] < 40 || !canGrow() || rnd() > 0.0006) return;
  const ux = x - gx, uy = y - gy;
  if (ux < 0 || ux >= W || uy < 0 || uy >= H || type[ux + uy * W] !== 0) return;
  if (!skyOpen(x, y) || biomass(x, y, 4) > 0) return;
  const j = ux + uy * W;
  put(j, PLANT, ux, uy);
  flags[j] |= F_TIP; life[j] = geneHeight(seed[j]); wet[j] = 30;
  wet[i] -= 30; aux[i] -= 20; env.waterSink += 0.3; WL.plantUse += 0.3;
}

export function slowAsh(x, y, i) {
  if (wet[i] > 40 && rnd() < 0.03) { morph(i, SOIL, x, y); aux[i] = 255; }     // 灰受潮后变成肥土
}

export function slowDead(x, y, i) {
  // 枯枝分解：越湿越快（干的约 4 分钟，湿透的约 25 秒）；一小部分变成肥土，其余分解掉
  const w = wet[i];
  if (rnd() < 0.004 + 0.036 * (w > 60 ? 1 : w / 60)) {
    if (rnd() < 0.15) { morph(i, SOIL, x, y); aux[i] = 255; } else { env.waterOut += w / 100; WL.decayOut += w / 100; clearCell(i, x, y); }
  }
}

export function slowIce(x, y, i) {
  const amb = env.ambient, snow = type[i] === SNOW;
  let open = false;                                    // 任何一面挨着空气就算露天（被风吹成的雪墙，侧面也会升华）
  for (let k = 0; k < 4 && !open; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    open = nx < 0 || nx >= W || ny < 0 || ny >= H || type[nx + ny * W] === 0;
  }
  if (amb <= 1) {
    // 冰点以下：露天的积雪靠阳光升华（白天快、夜里很慢），所以夜里积得起来，白天又会变薄
    if (snow && open && rnd() < 0.0006 + env.sun * 0.014) { clearCell(i, x, y); vaporAdd(x, y, 1); WL.sublimate++; }
    return;
  }
  // 气温高于冰点：露在空气里的冰雪慢慢融化（日照加速），每融一格都从周围吸热
  if (rnd() > amb * (snow ? 0.006 : 0.0012) * (1 + env.sun)) return;
  let exposed = false;
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W;
    if (type[j] === 0) exposed = true;
    else temp[j] -= 3;
  }
  if (!exposed) return;
  type[i] = WATER; life[i] = 0; flags[i] = parity; temp[i] = 1; aux[i] = 0;
  markStructAround(i);
  wake(x, y);
}

export const SLOW = new Array(NT).fill(null);
SLOW[WATER] = slowWater; SLOW[SALTWATER] = slowWater; SLOW[PLANT] = slowPlant; SLOW[FLOWER] = slowFlower;
SLOW[SEED] = slowSeed; SLOW[SOIL] = slowSoil; SLOW[ASH] = slowAsh; SLOW[DEADPLANT] = slowDead;
SLOW[ICE] = slowIce; SLOW[SNOW] = slowIce;

export function slowTick() {
  slowPhase = (slowPhase + 1) % SLOW_STRIDE;
  for (let i = slowPhase; i < N; i += SLOW_STRIDE) {
    const t = type[i];
    if (t === 0) { const a = aux[i]; if (a !== 0) aux[i] = a - 1; continue; }   // 空气慢慢换新
    const fn = SLOW[t], w = wet[i];
    if (fn === null && w === 0) continue;
    if (flags[i] & F_BODY) continue;
    const x = i % W, y = (i / W) | 0;
    if (w !== 0 && t !== PLANT) slowWet(x, y, i, t, w);
    if (fn !== null) fn(x, y, i);
  }
}

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function slowSave() { return { slowPhase }; }
export function slowLoad(s) { ({ slowPhase } = s); }
export function slowSet(name, v) {
  switch (name) {
    case 'slowPhase': slowPhase = v; break;
    default: throw new Error('slow.js 没有可写的状态 ' + name);
  }
}
