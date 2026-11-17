
/* =====================================================================
 * 2. 模拟
 * ===================================================================== */
const DX4 = [1, -1, 0, 0], DY4 = [0, 0, 1, -1];
const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

/* ---------------------------------------------------------------------
 * 2.1 运动：粉末 / 液体 / 气体。方向全部用重力向量 g 和侧向向量 l 表达，
 *     四个重力方向共用同一份代码。
 *     惯性的做法：连续下落会加速（每步最多 4 格）；高速砸到东西时，
 *     粒子（或被它挤开的液体）转成带浮点位置和速度的飞行粒子弹出去 → 飞溅、反弹。
 * ------------------------------------------------------------------- */
function windPush(x, y, i, t, k) {
  const wv = windX[(x >> 3) + (y >> 3) * GW];
  if (wv !== 0 && rnd() < (wv < 0 ? -wv : wv) * k) {
    const nx = x + (wv > 0 ? 1 : -1);
    if (nx >= 0 && nx < W && type[nx + y * W] === 0) { swapCells(i, nx + y * W, x, y, nx, y); return true; }
  }
  return false;
}

function foamAt(x, y) {
  for (let k = -1; k <= 1; k++) {
    const nx = x - gx + lx * k, ny = y - gy + ly * k;
    if (inb(nx, ny) && type[nx + ny * W] === 0) { put(nx + ny * W, FOAM, nx, ny); return; }
  }
}

// 高速砸进液面：被挤上来的那格液体变成水花飞出去，液面起涟漪和泡沫
function splash(x, y, i, liquid) {
  addRipple(x, y);
  if (fpCount < FP_MAX - 200 && rnd() < 0.6) {
    spawnFree(liquid, x + 0.5, y + 0.5,
              lx * (rnd() - 0.5) * 2.6 - gx * (1 + rnd() * 1.6), ly * (rnd() - 0.5) * 2.6 - gy * (1 + rnd() * 1.6),
              temp[i], seed[i]);
    clearCell(i, x, y);
  }
  if (liquid !== LAVA && liquid !== OIL && rnd() < 0.3) foamAt(x, y);
}

function movePowder(x, y, i, t) {
  let sp = flags[i] >> 6;                    // 连续下落帧数 → 每步多走几格
  if (t === SNOW) { sp = 0; if (rnd() < 0.45) { wake(x, y); return; } }   // 雪飘得慢
  let cx = x, cy = y, ci = i, moved = 0;
  const base = t * NT;
  for (let s = 0; s <= sp; s++) {
    const nx = cx + gx, ny = cy + gy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
    const j = nx + ny * W, o = type[j];
    if (o !== 0) {
      const so = M_STATE[o];
      if (so < S_LIQUID) break;
      if (so === S_LIQUID) {                 // 沉降速度看密度差和粘度；比液体轻就浮着
        const p = SINKP[base + o];
        if (p > 0) {
          if (rnd() < p) {
            swapCells(ci, j, cx, cy, nx, ny);
            if (sp >= 2) splash(cx, cy, ci, o);
            ci = j; cx = nx; cy = ny; moved = 2;
          } else wake(cx, cy);
        }
        break;
      }
    }
    swapCells(ci, j, cx, cy, nx, ny); ci = j; cx = nx; cy = ny; moved = 1;
  }
  if (moved) {
    flags[ci] = (flags[ci] & ~F_FALL) | (moved === 1 ? (sp < 3 ? sp + 1 : 3) << 6 : 0);
    st.powder++;
    const ux = x - gx, uy = y - gy;          // 原来压在它上面的如果是刚性固体，支撑关系可能变了
    if (ux >= 0 && ux < W && uy >= 0 && uy < H && M_RIGID[type[ux + uy * W]]) structDirty = true;
    if (moved === 1 && M_WIND[t] > 0) windPush(cx, cy, ci, t, M_WIND[t]);
    return;
  }
  if (sp) {
    flags[i] &= ~F_FALL;
    const ux = x - gx, uy = y - gy;
    if (sp === 3 && wet[i] <= 60 && fpCount < FP_MAX - 400 && rnd() < 0.12 &&
        ux >= 0 && ux < W && uy >= 0 && uy < H && type[ux + uy * W] === 0) {       // 高速落地、头顶是空的：弹起来
      const d = rnd() < 0.5 ? 1 : -1, v = 0.5 + rnd();
      spawnFree(t, x + 0.5, y + 0.5, lx * d * v - gx * (0.6 + rnd() * 0.8), ly * d * v - gy * (0.6 + rnd() * 0.8), temp[i], seed[i]);
      clearCell(i, x, y);
      return;
    }
  }
  // 滑落：侧下方要有 need 格深的落差才滑。松散粉末 1 格（约 45°），土 2 格（更陡），湿沙 4 格（近乎直立）
  const need = wet[i] > 60 ? 4 : M_SLIDE[t];
  const d = rnd() < 0.5 ? 1 : -1;
  for (let s = 0; s < 2; s++) {
    const dd = s ? -d : d;
    let ok = true, j1 = -1, x1 = 0, y1 = 0;
    for (let k = 1; k <= need; k++) {
      const nx = x + gx * k + lx * dd, ny = y + gy * k + ly * dd;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) { ok = false; break; }
      const j = nx + ny * W, o = type[j];
      if (k === 1) {
        if (!(o === 0 || M_STATE[o] >= S_GAS || rnd() < SINKP[base + o] * 0.7)) { ok = false; break; }
        j1 = j; x1 = nx; y1 = ny;
      } else if (!(o === 0 || M_STATE[o] >= S_LIQUID)) { ok = false; break; }
    }
    if (ok) { swapCells(i, j1, x, y, x1, y1); st.powder++; return; }
  }
}

// 液体能否沿重力方向挤进 o：空气、气体、更轻的液体、更轻的粉末（让灰浮上来）
function liquidCanSink(t, o) {
  if (o === 0) return true;
  const so = M_STATE[o];
  if (so >= S_GAS) return true;
  if (so === S_LIQUID) return M_DENS[t] > M_DENS[o] && rnd() < 0.6;
  if (so === S_POWDER) return M_DENS[t] > M_DENS[o] && rnd() < 0.3;
  return false;
}

function moveLiquid(x, y, i, t) {
  const sp = flags[i] >> 6, visc = M_VISC[t];
  if (visc > 0.5 && rnd() < visc * 0.3) { wake(x, y); return; }       // 很粘：这一帧整个不动
  let cx = x, cy = y, ci = i, moved = 0;
  for (let s = 0; s <= sp; s++) {
    const nx = cx + gx, ny = cy + gy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
    const j = nx + ny * W, o = type[j];
    if (!liquidCanSink(t, o)) break;
    const dense = o !== 0 && M_STATE[o] < S_GAS;
    swapCells(ci, j, cx, cy, nx, ny); ci = j; cx = nx; cy = ny;
    if (dense) { moved = 2; break; }
    moved = 1;
  }
  if (moved) {
    flags[ci] = (flags[ci] & ~F_FALL) | (moved === 1 ? (sp < 3 ? sp + 1 : 3) << 6 : 0);
    st.liquid++;
    if (moved === 1 && sp > 0 && visc < 0.3) windPush(cx, cy, ci, t, 0.5);   // 雨被风吹斜
    return;
  }
  if (sp) {
    flags[i] &= ~F_FALL;
    if (sp === 3 && visc < 0.5) {            // 高速落地
      const bx = x + gx, by = y + gy;
      const b = bx >= 0 && bx < W && by >= 0 && by < H ? type[bx + by * W] : STONE;
      if (M_STATE[b] === S_LIQUID) { addRipple(x, y); if (rnd() < 0.35) foamAt(x, y); }
      else if (fpCount < FP_MAX - 400 && rnd() < 0.25) {             // 砸在硬东西上：溅开
        const d = rnd() < 0.5 ? 1 : -1, v = 0.6 + rnd() * 1.2;
        spawnFree(t, x + 0.5, y + 0.5, lx * d * v - gx * (0.4 + rnd() * 0.9), ly * d * v - gy * (0.4 + rnd() * 0.9), temp[i], seed[i]);
        clearCell(i, x, y);
        return;
      }
    }
  }
  if (visc > 0 && rnd() < visc) return;      // 粘：这一帧不侧流

  const d = rnd() < 0.5 ? 1 : -1;
  for (let s = 0; s < 2; s++) {              // 斜下
    const dd = s ? -d : d;
    const nx = x + gx + lx * dd, ny = y + gy + ly * dd;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W;
    if (liquidCanSink(t, type[j])) { swapCells(i, j, x, y, nx, ny); st.liquid++; return; }
  }
  const disp = M_DISP[t];
  for (let s = 0; s < 2; s++) {              // 侧向扩散：找得到落差才一定流，否则只是偶尔漂一下（水面能静下来）
    const dd = s ? -d : d;
    let best = -1, bx = 0, by = 0, drop = false;
    for (let k = 1; k <= disp; k++) {
      const nx = x + lx * dd * k, ny = y + ly * dd * k;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
      const j = nx + ny * W, o = type[j];
      if (o !== 0 && M_STATE[o] < S_GAS) break;
      best = j; bx = nx; by = ny;
      const ux = nx + gx, uy = ny + gy;
      if (ux >= 0 && ux < W && uy >= 0 && uy < H) {
        const u = type[ux + uy * W];
        if (u === 0 || M_STATE[u] >= S_GAS || (M_STATE[u] === S_LIQUID && M_DENS[u] < M_DENS[t])) { drop = true; break; }
      }
    }
    if (best >= 0 && (drop || rnd() < 0.2)) { swapCells(i, best, x, y, bx, by); st.liquid++; return; }
  }
}

// 气体永远逆着重力走；会被风吹斜；能从液体里冒泡上去
function moveGas(x, y, i, t) {
  if (t === SMOKE && rnd() < 0.3) return;
  if (windPush(x, y, i, t, M_WIND[t] * 0.9)) return;
  const r = rndi(3) - 1;
  let nx = x - gx + lx * r, ny = y - gy + ly * r;
  if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
    const j = nx + ny * W, o = type[j];
    if (o === 0 || (M_STATE[o] === S_LIQUID && rnd() < 0.3) ||
        (M_STATE[o] === S_GAS && M_DENS[o] > M_DENS[t] && rnd() < 0.3)) {
      swapCells(i, j, x, y, nx, ny);
      return;
    }
  }
  const d = rnd() < 0.5 ? 1 : -1;
  nx = x + lx * d; ny = y + ly * d;
  if (nx >= 0 && nx < W && ny >= 0 && ny < H && type[nx + ny * W] === 0) swapCells(i, nx + ny * W, x, y, nx, ny);
}

/* ---------------------------------------------------------------------
 * 2.2 燃烧：燃料 + 热量 + 氧气
 * ------------------------------------------------------------------- */
// 逆着重力往上走 48 格，路上只有空气 / 气体就算「通着天」
function openSky(x, y) {
  for (let k = 1; k <= 48; k++) {
    const nx = x - gx * k, ny = y - gy * k;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) return true;
    const o = type[nx + ny * W];
    if (o !== 0 && M_STATE[o] < S_GAS) return false;
  }
  return true;
}

// 旁边有没有还能支持燃烧的空气
function hasOxygen(x, y) {
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W;
    if (AIRLIKE[type[j]] && aux[j] < STALE_MAX) return true;
  }
  return false;
}

function ignite(i, t, x, y) {
  flags[i] = (flags[i] | F_BURN) & ~F_TIP;
  if (M_BLAST[t]) life[i] = M_BURNTIME[t];           // 引信
  else if (fuel[i] === 0) fuel[i] = initFuel(t);     // 只有从没装过燃料的才装；熄灭后剩多少就是多少
  wake(x, y);
}

function emitFlame(x, y, t) {
  const r = rndi(3) - 1;
  let nx = x - gx + lx * r, ny = y - gy + ly * r;
  if (!(inb(nx, ny) && type[nx + ny * W] === 0)) {
    const k = rndi(4);
    nx = x + DX4[k]; ny = y + DY4[k];
    if (!(inb(nx, ny) && type[nx + ny * W] === 0)) return;
  }
  const j = nx + ny * W;
  put(j, FIRE, nx, ny);
  if (M_FLAME[t] > 0.3) life[j] += 18;       // 油：火焰更大
}

// kind：0 白烟（湿的东西 / 刚被浇灭），1 灰烟，2 黑烟（缺氧）
function emitSmoke(x, y, kind) {
  let nx = x - gx, ny = y - gy;
  if (!(inb(nx, ny) && type[nx + ny * W] === 0)) {
    const k = rndi(4);
    nx = x + DX4[k]; ny = y + DY4[k];
    if (!(inb(nx, ny) && type[nx + ny * W] === 0)) return;
  }
  const j = nx + ny * W;
  put(j, SMOKE, nx, ny);
  seed[j] = kind === 0 ? rndi(50) : kind === 1 ? 90 + rndi(60) : 200 + rndi(56);
}

// 返回 true 表示这一格已经变成别的东西
function burnStep(x, y, i, t, T) {
  wake(x, y);
  if (M_BLAST[t]) {                          // 爆炸物：F_BURN 表示引信在烧
    const L = life[i];
    if (L > 1) { life[i] = L - 1; return false; }
    clearCell(i, x, y); startExplosion(x, y, M_BLAST[t], M_BPOW[t]);
    return true;
  }
  let airJ = -1, airStale = 255, wetJ = -1, wx = 0, wy = 0;
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W, o = type[j];
    if (AIRLIKE[o]) { const s = aux[j]; if (s < airStale) { airStale = s; airJ = j; } }      // 空气，或者被火苗 / 烟占着的空气
    else if (o === WATER || o === SALTWATER) { wetJ = j; wx = nx; wy = ny; }
  }
  if (wetJ >= 0) {
    st.hiss++;
    if (t === OIL) {                         // 油火遇水：水瞬间汽化，把燃烧的油崩成飞溅的火滴
      if (rnd() < 0.25) {
        morph(wetJ, STEAM, wx, wy); temp[wetJ] = 160;
        if (fpCount < FP_MAX - 100) {
          spawnFree(OIL, x + 0.5, y + 0.5, lx * (rnd() - 0.5) * 3.2 - gx * (1.5 + rnd() * 2), ly * (rnd() - 0.5) * 3.2 - gy * (1.5 + rnd() * 2), 700, seed[i]);
          clearCell(i, x, y);
          return true;
        }
      }
    } else {                                 // 水吸热、汽化；降到燃点以下就熄灭
      T -= 150; temp[i] = T;
      if (rnd() < 0.5) { morph(wetJ, STEAM, wx, wy); temp[wetJ] = 160; }
      else temp[wetJ] += 25;
      if (T < M_IGN[t]) {
        flags[i] = (flags[i] & ~F_BURN) | F_SCORCH;
        emitSmoke(x, y, 0);
        return false;
      }
    }
  }
  if (airJ < 0 || airStale >= STALE_MAX) {          // 缺氧：不放热、不耗燃料，很快闷熄
    if (rnd() < 0.12) { flags[i] = (flags[i] & ~F_BURN) | F_SCORCH; if (rnd() < 0.5) emitSmoke(x, y, 2); }
    return false;
  }
  aux[airJ] = airStale + 3 > 255 ? 255 : airStale + 3;                    // 消耗氧气
  for (let k = 0; k < 4; k++) {                                           // 火焰直接烘烤贴着的可燃物
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W;
    if (M_FLAM[type[j]] > 0 && !(flags[j] & F_BURN)) { temp[j] += 6; wake(nx, ny); }
  }
  const bt = M_BURNTEMP[t];
  if (T < bt) temp[i] = T + (bt - T) * 0.25;           // 燃烧放热
  if (rnd() < M_FLAME[t]) emitFlame(x, y, t);
  if (rnd() < 0.012) {                                 // 偶尔迸出一粒余烬，随风飘去点燃别处
    const ex = x - gx, ey = y - gy;
    if (ex >= 0 && ex < W && ey >= 0 && ey < H && type[ex + ey * W] === 0) put(ex + ey * W, EMBER, ex, ey);
  }
  if (rnd() < (airStale > 90 ? 0.06 : 0.012)) emitSmoke(x, y, airStale > 90 ? 2 : 1);   // 越缺氧烟越黑越浓
  const a = aux[i];
  if (M_RIGID[t] && a > 0) {                           // 烧焦的木头越来越不结实
    aux[i] = a > 2 ? a - 2 : 0;
    if (a >= 70 && a - 2 < 70) structDirty = true;
  }
  const F = fuel[i];
  if (F > 1) { fuel[i] = F - 1; return false; }
  // 燃料烧完
  if (rnd() < M_RESIDUE[t]) morph(i, M_BURNINTO[t], x, y);
  else put(i, FIRE, x, y);
  return true;
}

/* ---------------------------------------------------------------------
 * 2.3 植物：基因来自 seed 字节，整株共用
 *     低 4 位：株高上限 8~32 格；4-5 位：分叉概率；6-7 位：叶片密度
 * ------------------------------------------------------------------- */
function plantLifespan(g) { return 520 + (g & 15) * 48; }   // 寿命（慢速过程的轮次，约等于秒）
function geneHeight(g) { return 8 + (((g & 15) * 1.6) | 0); }
function geneBranch(g) { return 0.05 + ((g >> 4) & 3) * 0.05; }
function geneLeaf(g) { return 0.3 + ((g >> 6) & 3) * 0.13; }

// 头顶 14 格内有没有被固体挡住，或者被别的枝叶遮得太厉害
function skyOpen(x, y) {
  let leaves = 0;
  for (let k = 1; k <= 14; k++) {
    const nx = x - gx * k, ny = y - gy * k;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) return true;
    const o = type[nx + ny * W];
    if (o === PLANT || o === FLOWER) { if (++leaves > 7) return false; }
    else if (o !== 0 && M_STATE[o] < S_LIQUID) return false;
  }
  return true;
}

function biomass(x, y, r) {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < W && ny >= 0 && ny < H && type[nx + ny * W] === PLANT) n++;
  }
  return n;
}

// 离地多高：顺着重力往下数，穿过空气和枝叶，直到碰到别的东西
function stemHeight(x, y) {
  let n = 0;
  for (let k = 1; k <= 48; k++) {
    const nx = x + gx * k, ny = y + gy * k;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
    const o = type[nx + ny * W];
    if (o !== 0 && o !== PLANT && o !== FLOWER) break;
    n++;
  }
  return n;
}

// 生长要用水：先从茎里的水分取，取不到就顺着茎往下找到根，从脚下的湿土或旁边的水里取。取不到就不长。
function drawSap(x, y, need) {
  let cx = x, cy = y;
  for (let n = 0; n < 50; n++) {
    const c = cx + cy * W;
    if (wet[c] >= need) { wet[c] -= need; env.waterSink += need / 100; WL.plantUse += need / 100; return true; }
    const nx = cx + gx, ny = cy + gy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) return false;
    if (type[nx + ny * W] === PLANT) { cx = nx; cy = ny; continue; }
    let found = false;
    for (let d = -1; d <= 1; d += 2) {
      const ax = nx + lx * d, ay = ny + ly * d;
      if (ax >= 0 && ax < W && ay >= 0 && ay < H && type[ax + ay * W] === PLANT) { cx = ax; cy = ay; found = true; break; }
    }
    if (found) continue;
    const b = nx + ny * W, o = type[b];
    if ((o === SOIL || o === SAND) && wet[b] >= need) { wet[b] -= need; env.waterSink += need / 100; WL.plantUse += need / 100; return true; }
    for (let k = 0; k < 4; k++) {
      const wx = cx + DX4[k], wy = cy + DY4[k];
      if (wx < 0 || wx >= W || wy < 0 || wy >= H || type[wx + wy * W] !== WATER) continue;
      if (rnd() * 100 < need) clearCell(wx + wy * W, wx, wy);
      env.waterSink += need / 100; WL.plantUse += need / 100;
      return true;
    }
    return false;
  }
  return false;
}

function bloom(x, y, i) {
  flags[i] &= ~F_TIP;
  const g = seed[i], dens = geneLeaf(g);
  for (let k = 0; k < 8; k++) {                      // 展叶：每片叶子也要水
    const nx = x + DX8[k], ny = y + DY8[k];
    if (!inb(nx, ny) || type[nx + ny * W] !== 0 || rnd() > dens) continue;
    if (!drawSap(x, y, 6)) break;
    const j = nx + ny * W;
    put(j, PLANT, nx, ny); seed[j] = g; wet[j] = 10;
  }
}

function growTip(x, y, i) {
  const e = life[i];
  if (e <= 0) { bloom(x, y, i); return; }
  if (env.sun < 0.12 || !skyOpen(x, y)) return;       // 没光不长
  const g = seed[i];
  if (stemHeight(x, y) >= geneHeight(g)) { life[i] = 0; return; }   // 到株高上限了：停止长高，展叶
  const side = rnd() < 0.3 ? (rnd() < 0.5 ? 1 : -1) : 0;
  const alt = rnd() < 0.5 ? 1 : -1;
  for (let a = 0; a < 3; a++) {
    const sd = a === 0 ? side : a === 1 ? (side === 0 ? alt : 0) : (side === 0 ? -alt : -side);
    const nx = x - gx + lx * sd, ny = y - gy + ly * sd;
    if (!inb(nx, ny)) continue;
    const j = nx + ny * W, o = type[j];
    if (!(o === 0 || M_STATE[o] === S_GAS)) continue;
    if (biomass(nx, ny, 3) > 26) { life[i] = 0; return; }   // 太挤：不再长高
    if (!drawSap(x, y, 14)) return;                         // 没水：等着
    put(j, PLANT, nx, ny); flags[j] |= F_TIP; life[j] = e - 1; seed[j] = g; wet[j] = 10;
    flags[i] &= ~F_TIP; life[i] = 0;
    if (e > 4 && rnd() < geneBranch(g)) {                   // 分叉
      const bs = rnd() < 0.5 ? 1 : -1;
      const bx = x + lx * bs - gx, by = y + ly * bs - gy;
      if (inb(bx, by) && type[bx + by * W] === 0 && drawSap(x, y, 14)) {
        const bj = bx + by * W;
        put(bj, PLANT, bx, by); flags[bj] |= F_TIP; life[bj] = (e >> 1) + 1; seed[bj] = g; wet[bj] = 10;
      }
    }
    return;
  }
  life[i] = 0;                                              // 被挡住：直接展叶
}

function sprout(i, x, y) {
  if (M_RIGID[type[i]]) structDirty = true;
  type[i] = PLANT; flags[i] = parity | F_TIP; life[i] = geneHeight(seed[i]); wet[i] = 30; fuel[i] = initFuel(PLANT); aux[i] = 0;
  wake(x, y);
}

/* ---------------------------------------------------------------------
 * 2.4 特殊材料钩子（返回 true 表示这一格已经处理完）
 * ------------------------------------------------------------------- */
// 火焰和余烬舔到可燃物会把它烤热：火苗被风吹到哪边，火就往哪边蔓延
function scorchNeighbors(x, y, heat) {
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W;
    if (M_FLAM[type[j]] > 0 && !(flags[j] & (F_BURN | F_BODY))) { temp[j] += heat; wake(nx, ny); }
  }
}
function hookFire(x, y, i) { if (temp[i] < 700) temp[i] = 700; st.fire++; scorchNeighbors(x, y, 16); return false; }
function hookEmber(x, y, i) { if (temp[i] < 600) temp[i] = 600; scorchNeighbors(x, y, 22); return false; }

function hookLava(x, y, i) {
  if (rnd() < 0.002) {                               // 偶尔迸出余烬
    const nx = x - gx, ny = y - gy;
    if (inb(nx, ny) && type[nx + ny * W] === 0) put(nx + ny * W, EMBER, nx, ny);
  }
  return false;
}

// 水把贴着的吸水材料打湿，自己按量减少（100 单位含水量 = 一格水）
function hookWater(x, y, i) {
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W, o = type[j];
    if (o === 0) continue;
    if (temp[j] > 120 && M_STATE[o] < S_LIQUID) { temp[j] -= 30; temp[i] += 8; wake(x, y); wake(nx, ny); }   // 水贴着高温的东西：把热量带走（自己会被烧开）
    const cap = M_ABSORB[o];
    if (cap === 0) continue;
    const w = wet[j];
    if (w >= cap || (flags[j] & F_BODY)) continue;
    wake(x, y);
    if (rnd() < 0.2) {
      const add = cap - w < 34 ? cap - w : 34;
      wet[j] = w + add;
      if (w <= 60 && w + add > 60) wake(nx, ny);
      if (rnd() * 100 < add) { clearCell(i, x, y); return true; }
    }
  }
  return false;
}

// 蒸汽碰到冷的表面直接凝成水珠
function hookSteam(x, y, i) {
  if (rnd() > 0.25) return false;
  const k = rndi(4), nx = x + DX4[k], ny = y + DY4[k];
  if (nx < 0 || nx >= W || ny < 0 || ny >= H) return false;
  const j = nx + ny * W, o = type[j];
  if (o !== 0 && M_STATE[o] < S_LIQUID && temp[j] < 50 && rnd() < 0.3) {
    type[i] = WATER; life[i] = 0; flags[i] = parity; temp[i] = 60; WL.wallCondense++;
    wake(x, y);
    return true;
  }
  return false;
}

// 泡沫：浮在液面上不动，脚下空了才往下掉
function hookFoam(x, y, i) {
  const bx = x + gx, by = y + gy;
  if (bx >= 0 && bx < W && by >= 0 && by < H && type[bx + by * W] === 0) swapCells(i, bx + by * W, x, y, bx, by);
  return true;
}

function hookPlant(x, y, i) {
  if (flags[i] & F_TIP) { wake(x, y); if (rnd() < 0.06) growTip(x, y, i); return false; }
  const bx = x + gx, by = y + gy;
  if (bx >= 0 && bx < W && by >= 0 && by < H && type[bx + by * W] === 0) {
    for (let k = 0; k < 8; k++) {                    // 周围没有任何支撑才会落下
      const nx = x + DX8[k], ny = y + DY8[k];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const o = type[nx + ny * W];
      if (o !== 0 && M_STATE[o] < S_LIQUID) return false;
    }
    swapCells(i, bx + by * W, x, y, bx, by);
    return true;
  }
  return false;
}

function hookClone(x, y, i) {
  let src = life[i];
  const k0 = rndi(4);
  if (!src) {                                          // 还没记住任何材料：锁定第一个碰到的
    for (let k = 0; k < 4; k++) {
      const kk = (k0 + k) & 3, nx = x + DX4[kk], ny = y + DY4[kk];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const o = type[nx + ny * W];
      if (o !== 0 && o !== CLONE && o !== VOID && o !== ANCHOR && !(flags[nx + ny * W] & F_BODY)) { src = o; break; }
    }
    if (!src) return false;
    life[i] = src;
  }
  wake(x, y);
  if (rnd() >= 0.1) return false;
  for (let k = 0; k < 4; k++) {
    const kk = (k0 + k) & 3, nx = x + DX4[kk], ny = y + DY4[kk];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    if (type[nx + ny * W] === 0) { put(nx + ny * W, src, nx, ny); if (src === WATER || src === SALTWATER || src === STEAM || src === SNOW || src === ICE) WL.cloneIn++; return false; }
  }
  return false;
}

function hookVoid(x, y, i) {
  wake(x, y);
  for (let n = 0; n < 10; n++) {
    const dx = rndi(11) - 5, dy = rndi(11) - 5, d2 = dx * dx + dy * dy;
    if (d2 === 0 || d2 > 25) continue;
    const px = x + dx, py = y + dy;
    if (px < 0 || px >= W || py < 0 || py >= H) continue;
    const j = px + py * W, o = type[j];
    if (o === 0 || o === VOID || o === ANCHOR || (flags[j] & F_BODY)) continue;
    if (d2 <= 2) { if (o === WATER || o === SALTWATER || o === SNOW || o === ICE || o === STEAM) WL.voidOut++; clearCell(j, px, py); continue; }
    if (rnd() < 0.6) {
      let sx = dx > 0 ? -1 : dx < 0 ? 1 : 0, sy = dy > 0 ? -1 : dy < 0 ? 1 : 0;
      const adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
      if (adx > 2 * ady) sy = 0; else if (ady > 2 * adx) sx = 0;
      const qx = px + sx, qy = py + sy, q = qx + qy * W, qt = type[q];
      if (qt === 0) { if (M_RIGID[o]) structDirty = true; swapCells(j, q, px, py, qx, qy); }
      else if (qt === VOID) { if (o === WATER || o === SALTWATER || o === SNOW || o === ICE || o === STEAM) WL.voidOut++; clearCell(j, px, py); }
    }
  }
  return false;
}

function hookSpark(x, y, i) {
  st.elec++;
  for (let k = 0; k < 4; k++) {
    const nx = x + DX4[k], ny = y + DY4[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = nx + ny * W, o = type[j];
    if (o === 0) continue;
    if (M_ELEC[o]) addCharge(j, 255);
    else if (M_FLAM[o] > 0) { temp[j] += 260; wake(nx, ny); }
  }
  const f = flags[i];
  if (f & F_TIP) {                                   // 只有「头」会继续向前窜并分叉，后面的留下来当亮线
    flags[i] = f & ~F_TIP;
    const L = life[i];
    if (L > 3) {
      const n = rnd() < 0.3 ? 2 : 1;
      for (let b = 0; b < n; b++) {
        const k = rndi(8), nx = x + DX8[k], ny = y + DY8[k];
        if (inb(nx, ny) && type[nx + ny * W] === 0) {
          const j = nx + ny * W;
          put(j, SPARK, nx, ny);
          life[j] = L - 1 - rndi(2);
        }
      }
    }
  }
  return false;
}

const HOOK = new Array(NT).fill(null);
HOOK[FIRE] = hookFire; HOOK[EMBER] = hookEmber; HOOK[LAVA] = hookLava; HOOK[PLANT] = hookPlant;
HOOK[CLONE] = hookClone; HOOK[VOID] = hookVoid; HOOK[SPARK] = hookSpark;
HOOK[WATER] = hookWater; HOOK[SALTWATER] = hookWater; HOOK[STEAM] = hookSteam; HOOK[FOAM] = hookFoam;

/* ---------------------------------------------------------------------
 * 2.5 接触规则执行（规则本身在 1.3 的 RULES 表里）
 * ------------------------------------------------------------------- */
function applyRule(r, i, j, x, y, nx, ny) {
  if (r.tag === 'hiss') st.hiss++;
  if (r.b2 !== r.b) {
    morph(j, r.b2, nx, ny);
    if (r.bT !== undefined) temp[j] = r.bT;
  }
  if (r.bDT !== undefined) { temp[j] += r.bDT; wake(nx, ny); }
  if (r.use && rnd() < r.use) { clearCell(i, x, y); return true; }
  if (r.aDT !== undefined) temp[i] += r.aDT;
  if (r.a2 !== r.a) {
    morph(i, r.a2, x, y);
    if (r.aT !== undefined) temp[i] = r.aT;
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------------
 * 2.6 单格更新：烘干 → 相变 → 燃烧 → 寿命 → 钩子 → 接触规则 → 运动
 * ------------------------------------------------------------------- */
function updateCell(x, y, i) {
  const t = type[i];
  let f = flags[i];
  if ((f & F_PAR) === parity) return;        // 本帧已经处理过（刚移动进来的）
  f ^= F_PAR; flags[i] = f;
  if (f & F_BODY) return;                    // 刚体盖的章，由刚体系统管
  let T = temp[i];

  // 湿的东西过了 100°C 先烘干：吸热、放出水汽，烘干之前点不着
  const w = wet[i];
  if (w > M_SAP[t] && T > 100) {
    wet[i] = w - 1; T -= 120; temp[i] = T;   // 汽化潜热很大：每烘掉 1 单位水分要吃掉 120°C，一个燃烧的邻格烤不干一块湿透的木头
    const d = 1;
    vaporAdd(x, y, d / 100); WL.evapWet += d / 100;
    wake(x, y);
    if (rnd() < 0.04) emitSmoke(x, y, 0);
  }

  // 温度相变
  if (T > M_MELT[t]) {
    const lat = M_LATENT[t];
    if (lat > 0) {                           // 有潜热的（冰、雪）：多出来的热量先攒着，攒够才融化
      const add = ((T - M_MELT[t]) * M_LATK[t]) | 0;
      temp[i] = M_MELT[t];
      if (add > 0) {
        const L = life[i] + add;
        if (L >= lat) { morph(i, M_MELTINTO[t], x, y); return; }
        life[i] = L; wake(x, y);
      }
    } else { morph(i, M_MELTINTO[t], x, y); return; }
  } else if (T > M_BOIL[t]) {
    morph(i, M_BOILINTO[t], x, y); temp[i] = T < 135 ? 160 : T + 25; st.boil++;
    return;
  } else if (T < M_FREEZE[t]) {
    if (t === STEAM) {
      if (openSky(x, y)) { clearCell(i, x, y); vaporAdd(x, y, 1); WL.steamToVapor++; }   // 头顶通着天：变成看不见的水汽升上去
      else { type[i] = WATER; life[i] = 0; flags[i] = parity; temp[i] = 60; WL.wallCondense++; wake(x, y); }   // 关在容器里：就地凝成水珠
      return;
    }
    const lat = M_FLATENT[t];
    if (lat > 0) {                           // 结冰要放出潜热：温度钉在冰点，放够了才变成冰
      const add = ((M_FREEZE[t] - T) * 4) | 0;
      temp[i] = M_FREEZE[t];
      if (add > 0) {
        const L = life[i] + add;
        if (L >= lat) { morph(i, M_FREEZEINTO[t], x, y); temp[i] = M_FREEZE[t] - 0.5; return; }
        life[i] = L; wake(x, y);
      }
    } else { morph(i, M_FREEZEINTO[t], x, y); return; }
  } else if (M_FLATENT[t] > 0 && life[i] > 0) life[i] = 0;    // 回暖了：结冰进度清零

  // 燃烧
  if (M_FLAM[t] > 0) {
    if (f & F_BURN) { if (burnStep(x, y, i, t, T)) return; }
    else if (T >= M_IGN[t] && wet[i] <= M_SAP[t] && (M_BLAST[t] || hasOxygen(x, y))) { if (rnd() < M_FLAM[t]) ignite(i, t, x, y); else wake(x, y); }
  }

  // 有寿命的（火、烟、余烬、电火花、泡沫）
  if (M_LIFE0[t] > 0) {
    const L = life[i];
    if (L <= 1) {
      if (rnd() < M_DECAYP[t]) { morph(i, M_DECAY[t], x, y); seed[i] = 90 + rndi(60); if (temp[i] > 200) temp[i] = 200; }
      else clearCell(i, x, y);
      return;
    }
    life[i] = L - 1;
    wake(x, y);
  }

  const hk = HOOK[t];
  if (hk !== null && hk(x, y, i)) return;

  if (HASRX[t]) {
    const base = t * NT;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k], ny = y + DY4[k];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const j = nx + ny * W, o = type[j];
      if (o === 0) continue;
      const r = RX[base + o];
      if (r === null || (flags[j] & F_BODY)) continue;
      wake(x, y);                            // 只要身边有能反应的对象，这一块就保持清醒
      if ((r.maxT === undefined || T < r.maxT) && rnd() < r.p) {     // 温度条件按这一步开始时的温度判断
        if (applyRule(r, i, j, x, y, nx, ny)) return;
      }
    }
  }

  switch (M_STATE[t]) {
    case S_POWDER: movePowder(x, y, i, t); break;
    case S_LIQUID: moveLiquid(x, y, i, t); break;
    case S_GAS: moveGas(x, y, i, t); break;
  }
}

/* ---------------------------------------------------------------------
 * 2.7 爆炸：从爆心放出一圈射线，分 3 帧由内向外推进。
 *     每条射线带能量，随距离衰减；碰到硬度低于能量的材料就炸碎并继续，
 *     碰到更硬的就被挡住 → 石头和金属后面是安全的，弹坑边缘天然不规则。
 *     冲击波还会震松范围内刚性固体的连接（完整度下降），给刚体一个冲量。
 * ------------------------------------------------------------------- */
const EX_MAX = 48, EX_RAYS = 200;
const exA = new Uint8Array(EX_MAX), exX = new Float32Array(EX_MAX), exY = new Float32Array(EX_MAX),
      exR = new Float32Array(EX_MAX), exP = new Float32Array(EX_MAX), exCur = new Float32Array(EX_MAX),
      exN = new Uint16Array(EX_MAX), exPhase = new Float32Array(EX_MAX),
      exRays = new Float32Array(EX_MAX * EX_RAYS);
let exActive = 0;

function exClear() { exA.fill(0); exActive = 0; }

function startExplosion(x, y, R, P) {
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
      if (!(flags[j] & (F_BURN | F_BODY))) { flags[j] |= F_BURN; life[j] = 3 + ((d * 0.5) | 0) + rndi(9); wake(px, py); }
      continue;
    }
    if (!M_RIGID[o] || M_HARD[o] > 1) continue;
    const dmg = (1 - d / RR) * 110 * P / M_BOND[o];
    const a = aux[j];
    aux[j] = a > dmg ? a - dmg : 0;
  }
  structDirty = true;
  clearPins();
  st.boom++;
  if (onBoom) onBoom(x, y, R, P);
}

function stepExplosion(k) {
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
      if (flags[j] & F_BODY) {                       // 打在刚体上：推它一把
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

function stepExplosions() {
  if (exActive === 0) return;
  for (let k = 0; k < EX_MAX; k++) if (exA[k]) stepExplosion(k);
}

/* ---------------------------------------------------------------------
 * 2.8 飞行粒子：对象池（上限 4000，满了覆盖最旧的），不占网格，
 *     带浮点位置和速度，落地后写回网格。爆炸碎片、水花、反弹的沙粒都走这里。
 * ------------------------------------------------------------------- */
const FP_MAX = 4000;
const fpAlive = new Uint8Array(FP_MAX), fpType = new Uint8Array(FP_MAX), fpSeed = new Uint8Array(FP_MAX),
      fpAge = new Uint16Array(FP_MAX), fpTemp = new Float32Array(FP_MAX),
      fpX = new Float32Array(FP_MAX), fpY = new Float32Array(FP_MAX),
      fpVX = new Float32Array(FP_MAX), fpVY = new Float32Array(FP_MAX),
      fpPX = new Float32Array(FP_MAX), fpPY = new Float32Array(FP_MAX),     // 上一帧位置（拖尾）
      fpQX = new Float32Array(FP_MAX), fpQY = new Float32Array(FP_MAX);     // 上上帧位置
let fpHead = 0, fpCount = 0;

function fpClear() { fpAlive.fill(0); fpCount = 0; fpHead = 0; }

function spawnFree(t, x, y, vx, vy, T, sd) {
  const k = fpHead;
  fpHead = (k + 1) % FP_MAX;
  if (!fpAlive[k]) fpCount++;
  fpAlive[k] = 1; fpType[k] = t; fpSeed[k] = sd; fpAge[k] = 0; fpTemp[k] = T;
  fpX[k] = fpPX[k] = fpQX[k] = x; fpY[k] = fpPY[k] = fpQY[k] = y;
  fpVX[k] = vx; fpVY[k] = vy;
}

function fpSolidAt(cx, cy) {
  if (cx < 0 || cx >= W || cy < 0 || cy >= H) return true;
  const o = type[cx + cy * W];
  return o !== 0 && M_STATE[o] < S_GAS;
}

function landFree(k, x, y) {
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

function stepFree() {
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

/* ---------------------------------------------------------------------
 * 2.9 电：带电格子列表逐帧向相邻导体传导（金属几乎无损，水每格衰减 6/255 ≈ 传 40 格）
 * ------------------------------------------------------------------- */
let elecCur = null, elecNext = null, elecCount = 0;

function addCharge(j, e) {
  if (charge[j] !== 0) return;
  if (elecCur === null || elecCur.length !== N) { elecCur = new Int32Array(N); elecNext = new Int32Array(N); elecCount = 0; }
  charge[j] = 6; chargeE[j] = e;
  elecCur[elecCount++] = j;
}

function stepElectric() {
  const cnt = elecCount;
  if (cnt === 0) return;
  let nn = 0;
  const cur = elecCur, next = elecNext;
  for (let q = 0; q < cnt; q++) {
    const i = cur[q];
    let c = charge[i];
    if (c === 0) continue;
    const t = type[i];
    if (!M_ELEC[t]) { charge[i] = 0; continue; }
    const x = i % W, y = (i / W) | 0;
    wake(x, y);
    if (c === 6) {                           // 刚带上电：这一帧向四周传
      st.elec++;
      const e = chargeE[i], loss = t === METAL || t === STEEL ? 1 : 6;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k], ny = y + DY4[k];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const j = nx + ny * W, o = type[j];
        if (o === 0) continue;
        if (M_ELEC[o]) {
          if (e > loss && charge[j] === 0 && (o === METAL || o === STEEL || rnd() < 0.8)) {
            charge[j] = 6; chargeE[j] = e - loss; next[nn++] = j;
          }
        } else if (M_FLAM[o] > 0) { temp[j] += 300; wake(nx, ny); }
      }
    }
    c--;
    charge[i] = c;
    if (c > 0) next[nn++] = i;               // 余下几帧是不应期，防止电往回传
  }
  elecCur = next; elecNext = cur; elecCount = nn;
}

/* ---------------------------------------------------------------------
 * 2.10 温度场 + 空气含氧：只在清醒的块里做成对交换（守恒、原地），
 *      再向环境气温缓慢回落。空气格之间还交换「浑浊度」，网格边缘是开阔大气（恒为新鲜）。
 * ------------------------------------------------------------------- */
let hotRigid = false;      // 有刚性固体被烧到 900°C 以上：金属可能软化了，过一会儿要重算支撑
function stepThermal() {
  const NTn = NT, K = KTAB, IHC = M_IHC, RLX = M_RELAX, amb = env.ambient;
  for (let cy = 0; cy < CHN; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      const c = cx + cy * CW;
      if (chunkTTL[c] === 0) continue;
      const x0 = cx << 5, x1 = Math.min(W, x0 + CHUNK), y0 = cy << 5, y1 = Math.min(H, y0 + CHUNK);
      let active = false, right = false, down = false;
      for (let y = y0; y < y1; y++) {
        const hasDown = y + 1 < H, edgeY = y === 0 || y === H - 1;
        for (let x = x0, i = y * W + x0; x < x1; x++, i++) {
          const a = type[i];
          let Ti = temp[i];
          if (AIRLIKE[a]) {                  // 空气（含火焰 / 烟占着的）：浑浊度扩散
            if (edgeY || x === 0 || x === W - 1) aux[i] = 0;
            else {
              if (AIRLIKE[type[i + 1]]) { const d = aux[i + 1] - aux[i]; if (d > 3 || d < -3) { const q = d >> 2; aux[i] += q; aux[i + 1] -= q; } }
              if (AIRLIKE[type[i + W]]) { const d = aux[i + W] - aux[i]; if (d > 3 || d < -3) { const q = d >> 2; aux[i] += q; aux[i + W] -= q; } }
            }
          } else if (Ti > 900 && M_RIGID[a]) hotRigid = true;
          if (x + 1 < W) {
            const d = temp[i + 1] - Ti;
            if (d > 0.5 || d < -0.5) {
              const b = type[i + 1], fl = d * K[a * NTn + b];
              Ti += fl * IHC[a]; temp[i + 1] -= fl * IHC[b];
              if (fl > 0.3 || fl < -0.3) { active = true; if (x + 1 === x1) right = true; }
            }
          }
          if (hasDown) {
            const j = i + W, d = temp[j] - Ti;
            if (d > 0.5 || d < -0.5) {
              const b = type[j], fl = d * K[a * NTn + b];
              Ti += fl * IHC[a]; temp[j] -= fl * IHC[b];
              if (fl > 0.3 || fl < -0.3) { active = true; if (y + 1 === y1) down = true; }
            }
          }
          const r = RLX[a];
          if (r > 0) {
            const d = (amb - Ti) * r;
            Ti += d;
            if (d > 0.08 || d < -0.08) active = true;
          }
          temp[i] = Ti;
        }
      }
      if (active) chunkTTL[c] = WAKE_TTL;
      if (right && cx + 1 < CW) chunkTTL[c + 1] = WAKE_TTL;
      if (down && cy + 1 < CHN) chunkTTL[c + CW] = WAKE_TTL;
    }
  }
}

/* ---------------------------------------------------------------------
 * 2.11 慢速环境过程：每步只处理 1/61 的格子（每格约每秒轮到一次），与分块休眠无关。
 *      蒸发、晾干、渗水、植物的吸水 / 老化 / 开花 / 落种 / 枯萎、腐烂、融雪、演替都在这里。
 * ------------------------------------------------------------------- */
const SLOW_STRIDE = 61;
let slowPhase = 0;

function slowWet(x, y, i, t, w) {
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

function slowWater(x, y, i) {
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
    }
  }
  const ux = x - gx, uy = y - gy;
  if (ux < 0 || ux >= W || uy < 0 || uy >= H || type[ux + uy * W] !== 0) return;
  // 水面蒸发：白天快、夜里慢，越热越快，有风更快
  let k = 1 + (env.ambient - 20) / 25;
  k = k < 0.2 ? 0.2 : k > 3 ? 3 : k;
  const wv = windX[(x >> 3) + (y >> 3) * GW];
  if (rnd() < 0.0012 * (0.4 + 1.6 * env.sun) * k * (1 + (wv < 0 ? -wv : wv))) { clearCell(i, x, y); vaporAdd(x, y, 1); WL.evapSurface++; }
}

function slowPlant(x, y, i) {
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
  let age = life[i] + (w === 0 ? 2 : 1);               // 缺水老得快
  if (age > 60000) age = 60000;
  life[i] = age;
  if (age > plantLifespan(g) && rnd() < 0.15) {        // 寿终（约 9~21 分钟）：枯萎成枯枝
    type[i] = DEADPLANT; life[i] = 0; flags[i] = (f & F_SCORCH) | parity; fuel[i] = initFuel(DEADPLANT);
    wake(x, y);
    return;
  }
  if (env.sun < 0.12) return;
  const ux = x - gx, uy = y - gy;
  if (ux < 0 || ux >= W || uy < 0 || uy >= H || type[ux + uy * W] !== 0) return;
  if (age < 160 && w >= 50 && rnd() < 0.02 && skyOpen(x, y) && stemHeight(x, y) < geneHeight(g) && biomass(x, y, 3) < 24) {
    flags[i] |= F_TIP; life[i] = Math.min(2 + rndi(4), geneHeight(g) - stemHeight(x, y));   // 水分充足的幼株顶端再抽一小段，不超过株高上限
    wake(x, y);
  } else if (age > 30 && w >= 30 && rnd() < 0.006 && skyOpen(x, y)) {
    const j = ux + uy * W;                             // 成株开花
    put(j, FLOWER, ux, uy); seed[j] = rndi(5) * 51 + 8 + rndi(34);
    wet[i] = w - 20; env.waterSink += 0.2; WL.plantUse += 0.2;
  }
}

function slowFlower(x, y, i) {
  const age = life[i] + 1;
  life[i] = age;
  if (age > 35 && rnd() < 0.2) {                       // 谢了：六成落下一粒种子，基因来自母株并略有变异
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

function slowSeed(x, y, i) {
  const age = life[i] + 1;
  life[i] = age;
  if (age > 240 && rnd() < 0.05) { clearCell(i, x, y); return; }      // 一直没发芽：烂掉
  const bx = x + gx, by = y + gy;
  if (bx < 0 || bx >= W || by < 0 || by >= H) return;
  const bj = bx + by * W, b = type[bj];
  if (b === SOIL) { if (wet[bj] < 30 || aux[bj] < 20) return; }
  else if (b === SAND) { if (wet[bj] < 60) return; }
  else return;
  if (env.sun < 0.12 || !skyOpen(x, y) || biomass(x, y, 4) > 10 || rnd() > 0.25) return;
  wet[bj] -= 30; env.waterSink += 0.3; WL.plantUse += 0.3;
  if (b === SOIL) aux[bj] -= 20;                        // 消耗养分
  sprout(i, x, y);
}

function slowSoil(x, y, i) {
  // 植被演替：湿润、有养分、见得到光、周围还空着的土面，偶尔自己冒出新芽（土里的种子库）
  if (wet[i] < 80 || aux[i] < 40 || env.sun < 0.12 || rnd() > 0.0006) return;
  const ux = x - gx, uy = y - gy;
  if (ux < 0 || ux >= W || uy < 0 || uy >= H || type[ux + uy * W] !== 0) return;
  if (!skyOpen(x, y) || biomass(x, y, 4) > 0) return;
  const j = ux + uy * W;
  put(j, PLANT, ux, uy);
  flags[j] |= F_TIP; life[j] = geneHeight(seed[j]); wet[j] = 30;
  wet[i] -= 30; aux[i] -= 20; env.waterSink += 0.3; WL.plantUse += 0.3;
}

function slowAsh(x, y, i) {
  if (wet[i] > 40 && rnd() < 0.03) { morph(i, SOIL, x, y); aux[i] = 255; }     // 灰受潮后变成肥土
}

function slowDead(x, y, i) {
  // 枯枝分解：越湿越快（干的约 4 分钟，湿透的约 25 秒）；一小部分变成肥土，其余分解掉
  const w = wet[i];
  if (rnd() < 0.004 + 0.036 * (w > 60 ? 1 : w / 60)) {
    if (rnd() < 0.15) { morph(i, SOIL, x, y); aux[i] = 255; } else { env.waterOut += w / 100; WL.decayOut += w / 100; clearCell(i, x, y); }
  }
}

function slowIce(x, y, i) {
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
  structDirty = true;
  wake(x, y);
}

const SLOW = new Array(NT).fill(null);
SLOW[WATER] = slowWater; SLOW[SALTWATER] = slowWater; SLOW[PLANT] = slowPlant; SLOW[FLOWER] = slowFlower;
SLOW[SEED] = slowSeed; SLOW[SOIL] = slowSoil; SLOW[ASH] = slowAsh; SLOW[DEADPLANT] = slowDead;
SLOW[ICE] = slowIce; SLOW[SNOW] = slowIce;

function slowTick() {
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

/* ---------------------------------------------------------------------
 * 2.12 主步进：60Hz 固定步长。扫描顺序从「重力下游」开始，逐行（或逐列）
 *      跳过休眠的块，每行随机左右方向。
 * ------------------------------------------------------------------- */
const perf = { cells: 0, thermal: 0, misc: 0, struct: 0, weather: 0, slow: 0, pack: 0, draw: 0, post: 0, gpu: 0,
               steps: 0, frames: 0, activeChunks: 0 };
let simStepsTotal = 0;

function sweepCells() {
  if (gy !== 0) {
    const start = gy > 0 ? H - 1 : 0, end = gy > 0 ? -1 : H, inc = gy > 0 ? -1 : 1;
    for (let y = start; y !== end; y += inc) {
      const crow = (y >> 5) * CW, row = y * W;
      if (rnd() < 0.5) {
        for (let cx = 0; cx < CW; cx++) {
          if (chunkTTL[crow + cx] === 0) continue;
          const x0 = cx << 5, x1 = Math.min(W, x0 + CHUNK);
          for (let x = x0; x < x1; x++) if (type[row + x] !== 0) updateCell(x, y, row + x);
        }
      } else {
        for (let cx = CW - 1; cx >= 0; cx--) {
          if (chunkTTL[crow + cx] === 0) continue;
          const x0 = cx << 5, x1 = Math.min(W, x0 + CHUNK);
          for (let x = x1 - 1; x >= x0; x--) if (type[row + x] !== 0) updateCell(x, y, row + x);
        }
      }
    }
  } else {
    const start = gx > 0 ? W - 1 : 0, end = gx > 0 ? -1 : W, inc = gx > 0 ? -1 : 1;
    for (let x = start; x !== end; x += inc) {
      const ccol = x >> 5;
      if (rnd() < 0.5) {
        for (let cy = 0; cy < CHN; cy++) {
          if (chunkTTL[ccol + cy * CW] === 0) continue;
          const y0 = cy << 5, y1 = Math.min(H, y0 + CHUNK);
          for (let y = y0; y < y1; y++) if (type[x + y * W] !== 0) updateCell(x, y, x + y * W);
        }
      } else {
        for (let cy = CHN - 1; cy >= 0; cy--) {
          if (chunkTTL[ccol + cy * CW] === 0) continue;
          const y0 = cy << 5, y1 = Math.min(H, y0 + CHUNK);
          for (let y = y1 - 1; y >= y0; y--) if (type[x + y * W] !== 0) updateCell(x, y, x + y * W);
        }
      }
    }
  }
}

// 分析用的计时器由宿主注入（页面里是 performance.now）。模拟代码自己不读任何时钟
let simClock = null;
function setSimClock(fn) { simClock = fn; }

function simStep() {
  parity ^= 1; tick++; simStepsTotal++;
  const clk = simClock;
  const t0 = clk ? clk() : 0;
  let act = 0;
  for (let c = 0, n = chunkTTL.length; c < n; c++) {
    const v = chunkTTL[c];
    if (v > 0) { chunkTTL[c] = v - 1; if (v > 1) act++; }
  }
  perf.activeChunks = act;
  stepScene();
  stepWeather();
  const t1 = clk ? clk() : 0;
  stepExplosions();
  stepElectric();
  const t2 = clk ? clk() : 0;
  stepStructure();
  const t3 = clk ? clk() : 0;
  sweepCells();
  const t4 = clk ? clk() : 0;
  stepThermal();
  const t5 = clk ? clk() : 0;
  stepFree();
  const t6 = clk ? clk() : 0;
  slowTick();
  const t7 = clk ? clk() : 0;
  perf.weather += t1 - t0; perf.misc += (t2 - t1) + (t6 - t5); perf.struct += t3 - t2;
  perf.cells += t4 - t3; perf.thermal += t5 - t4; perf.slow += t7 - t6; perf.steps++;
}

/* ---------------------------------------------------------------------
 * 2.13 绘制到网格（笔刷、预设、测试共用）与统计
 * ------------------------------------------------------------------- */
function paintCell(x, y, t, replace) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = x + y * W;
  if (flags[i] & F_BODY) return;
  if (t === TOOL_ERASE) { if (type[i] !== 0) clearCell(i, x, y); return; }
  if (t === TOOL_HEAT) { temp[i] = Math.min(2500, temp[i] + 60); wake(x, y); return; }
  if (t === TOOL_COOL) { temp[i] = Math.max(-200, temp[i] - 60); wake(x, y); return; }
  if (t >= 100) return;
  const o = type[i];
  if (o === t) return;
  if (o !== 0 && !replace) return;
  put(i, t, x, y);
}

function fillRect(t, x0, y0, x1, y1) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(W - 1, x1 | 0); y1 = Math.min(H - 1, y1 | 0);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = x + y * W;
    if (t === EMPTY) clearCell(i, x, y); else put(i, t, x, y);
  }
}

function fillCircle(t, cx, cy, r, chance) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    if (!inb(x, y)) continue;
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy > r2) continue;
    if (chance !== undefined && rnd() > chance) continue;
    if (t === EMPTY) clearCell(x + y * W, x, y); else put(x + y * W, t, x, y);
  }
}

function countType(t, x0, y0, x1, y1) {
  if (x0 === undefined) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (type[x + y * W] === t) n++;
  return n;
}

// 水量账本：所有形态的水加起来（单位：格水）。没有外部输入输出时应当守恒。
function totalWater() {
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
