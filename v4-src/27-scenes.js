
/* =====================================================================
 * 2.15 预设场景（不依赖 DOM，自测和 soak 测试也用它）
 * ===================================================================== */
// 场景状态：场景自带的持续过程（比如火山喷发），每个模拟步由 stepScene 推进。
// 它是纯数据，可以存档、可以算进哈希；不要在这里放函数或闭包。
let sceneState = null;

function stepScene() {
  const s = sceneState;
  if (s === null) return;
  if (s.kind === 'eruption') {
    if (s.armed) { if (env.el < -0.05) s.armed = false; else return; }
    if (s.budget <= 0) return;
    const cx = s.cx, mouth = s.mouth;
    for (let x = cx - 2; x <= cx + 2; x++) {          // 火山口底下涌出新的熔岩，凝住的口子会被重新顶开
      const y = mouth + 5, i = x + y * W, t = type[i];
      if (t === LAVA) { if (temp[i] < 1400) temp[i] = 1500; wake(x, y); }
      else if (t === 0 || t === STONE) { put(i, LAVA, x, y); s.budget--; }
    }
    for (let n = 0; n < 2; n++) {                     // 把岩浆柱往上顶
      const tx = cx - 2 + rndi(5), ty = mouth + 4;
      for (let y = ty; y > 2; y--) {
        const j = tx + y * W;
        if (type[j] === 0) { put(j, LAVA, tx, y); s.budget--; break; }
        if (type[j] === STONE) { put(j, LAVA, tx, y); break; }
        if (type[j] !== LAVA) break;
      }
    }
  }
}

function setBurning(x, y) {
  if (!inb(x, y)) return;
  const i = x + y * W, t = type[i];
  if (M_FLAM[t] > 0) { temp[i] = M_IGN[t] + 150; wet[i] = 0; ignite(i, t, x, y); }
}

function soakSoil(amount) {
  for (let i = 0; i < N; i++) if (type[i] === SOIL || type[i] === SAND) wet[i] = Math.min(M_ABSORB[type[i]], amount);
}

function cloneSource(x, y, mat) {
  if (!inb(x, y)) return;
  const i = x + y * W;
  put(i, CLONE, x, y); life[i] = mat;
}

function drawTree(x, ground, h, r) {
  for (let y = ground - h; y < ground; y++) for (let dx = 0; dx < 2; dx++) if (inb(x + dx, y)) put(x + dx + y * W, WOOD, x + dx, y);
  const gene = rndi(256);
  for (let k = 0; k < 3; k++) {
    const ox = x + rndi(7) - 3, oy = ground - h - rndi(4);
    for (let y = Math.floor(oy - r); y <= oy + r; y++) for (let xx = Math.floor(ox - r); xx <= ox + r; xx++) {
      const dx = xx - ox, dy = (y - oy) * 1.25;
      if (!inb(xx, y) || dx * dx + dy * dy > r * r || type[xx + y * W] !== 0 || rnd() < 0.12) continue;
      put(xx + y * W, PLANT, xx, y); seed[xx + y * W] = gene;
    }
  }
}

function groundLine(amp, k1, k2, baseY) {
  const g = new Int32Array(W);
  for (let x = 0; x < W; x++) g[x] = Math.floor(baseY + dsin(x * k1) * amp + dsin(x * k2 + 1.7) * amp * 0.6);
  return g;
}

function buildVolcano(withSource) {
  const cx = W >> 1, base = H - 5, peak = Math.floor(H * 0.56), half = Math.floor(W * 0.3), sea = Math.floor(H * 0.74);
  fillRect(STONE, 0, base, W - 1, H - 1);
  const top = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const k = Math.max(0, 1 - Math.abs(x - cx) / half);
    const h = Math.floor((k * Math.sqrt(Math.sqrt(k))) * peak + (k > 0 ? dsin(x * 0.31) * 2 + dsin(x * 0.11) * 3 : 0));
    top[x] = base - Math.max(0, h);
    for (let y = top[x]; y < base; y++) put(x + y * W, STONE, x, y);
    if (top[x] > sea - 4 && top[x] < base) for (let y = top[x] - 2; y < top[x]; y++) if (inb(x, y)) put(x + y * W, SAND, x, y);   // 海滩
  }
  for (let y = sea; y < base; y++) for (let x = 0; x < W; x++) if (type[x + y * W] === 0) put(x + y * W, WATER, x, y);
  const mouth = top[cx], depth = Math.floor(peak * 0.42);
  fillRect(LAVA, cx - 2, mouth + 4, cx + 2, mouth + depth);
  fillCircle(LAVA, cx, mouth + depth, 7);
  fillRect(EMPTY, cx - 2, mouth - 6, cx + 2, mouth + 3);
  // 岩浆供给交给场景状态（可存档）：budget 格岩浆喷完就停；armed = 等太阳落山才开始
  sceneState = { kind: 'eruption', cx, mouth, budget: withSource || 6000, armed: !withSource };
  for (let k = 0; k < 26; k++) {                        // 山腰点几丛植物
    const x = cx + (rnd() < 0.5 ? -1 : 1) * Math.floor(half * (0.45 + rnd() * 0.4));
    if (x < 1 || x >= W - 1 || top[x] >= sea) continue;
    for (let h = 1; h <= 2 + rndi(4); h++) if (inb(x, top[x] - h)) put(x + (top[x] - h) * W, PLANT, x, top[x] - h);
  }
}

function sceneVolcano() {
  env.time = 0.85; env.timeScale = 1; setWeather('clear'); env.wind = 0.3;
  buildVolcano(5000);       // 一次喷发的岩浆总量有限，喷完火山就安静下来
}

function sceneVolcanoDayNight() {
  // 从下午开始，时间流速 10x（一昼夜 1 分钟）；太阳落山的那一刻火山口才打开
  env.time = 0.6; env.timeScale = 10; setWeather('clear'); env.wind = -0.3;
  buildVolcano(0);                                    // 太阳落山的那一刻才开始喷
}

function buildForest(density) {
  const g = groundLine(3, 0.035, 0.09, H - 16);
  for (let x = 0; x < W; x++) {
    for (let y = g[x]; y < H; y++) put(x + y * W, y > H - 4 ? STONE : SOIL, x, y);
    if (rnd() < 0.8) for (let h = 1; h <= 1 + rndi(3); h++) put(x + (g[x] - h) * W, PLANT, x, g[x] - h);       // 草
  }
  for (let x = 14; x < W - 12; x += Math.floor((17 + rndi(10)) / density)) drawTree(x, g[x], 16 + rndi(Math.max(4, Math.floor(H * 0.16))), 6 + rndi(4));
  for (let k = 0; k < W / 9; k++) {                       // 零星的花
    const x = 2 + rndi(W - 4), y = g[x] - 2 - rndi(2), c = rndi(5) * 51 + 8;
    if (inb(x, y) && type[x + y * W] === PLANT) { put(x + y * W, FLOWER, x, y); seed[x + y * W] = c + rndi(34); }
  }
  soakSoil(70);
  return g;
}

function sceneForest() {
  env.time = 0.86; env.timeScale = 1; setWeather('clear'); env.wind = 0.5; env.windPower = 0.4;
  const g = buildForest(1);
  for (let x = 12; x < 20; x++) for (let y = g[14] - 6; y < g[14]; y++) setBurning(x, y);   // 左边第一棵树的树根处点火
}

function sceneStormForest() {
  // 雷暴：闪电自己劈下来点着树，雨再把火浇灭；两侧各有一个排水口，积水不会无限涨
  env.time = 0.9; env.timeScale = 1; setWeather('storm'); env.wind = 0.6;
  const g = buildForest(1.3);
  for (const x of [0, W - 1]) for (let y = g[x] - 4; y < g[x] + 2; y++) if (inb(x, y)) { const i = x + y * W; put(i, VOID, x, y); }
  for (let c = 0; c < GW * GH; c++) if (altitudeOf((c / GW) | 0) > 0.75) cloud[c] = 1.6;      // 开场就有云
  env.waterIn += weatherWater();
}

function sceneHourglass() {
  env.time = 0.45; env.timeScale = 0; setWeather('clear'); env.wind = 0;
  const cx = W >> 1, cy = H >> 1, b = Math.floor(H * 0.42), a = Math.floor(Math.min(W * 0.2, b * 0.75));
  const inner = (x, y) => {
    const dy = Math.abs(y - cy);
    return dy <= b - 3 && Math.abs(x - cx) <= 1 + (a - 4) * dy / b;
  };
  for (let y = cy - b; y <= cy + b; y++) for (let x = cx - a - 3; x <= cx + a + 3; x++) {
    if (!inb(x, y)) continue;
    if (inner(x, y)) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (inner(x + dx, y + dy)) { near = true; break; }
    if (near) put(x + y * W, GLASS, x, y);
  }
  for (let y = cy - b + 3 + Math.floor(b * 0.12); y < cy - 2; y++) for (let x = cx - a; x <= cx + a; x++) if (inner(x, y)) put(x + y * W, SAND, x, y);
  fillRect(WOOD, cx - a - 6, cy - b - 3, cx + a + 6, cy - b - 1);
  fillRect(WOOD, cx - a - 6, cy + b + 1, cx + a + 6, cy + b + 3);
  for (const sx of [cx - a - 6, cx + a + 5]) fillRect(WOOD, sx, cy - b - 1, sx + 1, cy + b + 1);
  // 四个角钉上锚点：整个架子悬在画面中间，翻转重力也不会掉
  for (const ax of [cx - a - 6, cx + a + 5]) for (const ay of [cy - b - 3, cy + b + 2]) fillRect(ANCHOR, ax, ay, ax + 1, ay + 1);
}

function drawBeaker(x0, y1, w, h, liquid, fill) {
  for (let y = y1 - h; y <= y1; y++) for (let x = x0; x <= x0 + w; x++) {
    if (x <= x0 + 1 || x >= x0 + w - 1 || y >= y1 - 1) put(x + y * W, GLASS, x, y);
    else if (liquid && y > y1 - 1 - h * fill) put(x + y * W, Array.isArray(liquid) ? liquid[rndi(liquid.length)] : liquid, x, y);
  }
}

function sceneLab() {
  env.time = 0.92; env.timeScale = 0; setWeather('clear'); env.wind = 0; env.windPower = 0;
  const floor = H - 4, table = Math.floor(H * 0.74);
  fillRect(STONE, 0, floor, W - 1, H - 1);
  fillRect(WOOD, 6, table, W - 7, table + 2);
  for (const lx0 of [10, W - 13]) fillRect(WOOD, lx0, table + 3, lx0 + 2, floor - 1);
  const n = 5, gap = Math.floor((W - 24) / n), bw = Math.min(gap - 8, Math.floor(W * 0.13)), bh = Math.floor(H * 0.3);
  const liquids = [OIL, WATER, ACID, SALTWATER, [OIL, WATER, SALTWATER]];
  for (let k = 0; k < n; k++) {
    const x0 = 14 + k * gap + ((gap - bw) >> 1);
    drawBeaker(x0, table - 1, bw, k === 4 ? Math.floor(bh * 1.5) : bh, liquids[k], k === 4 ? 0.8 : 0.62);
  }
  // 电路：左侧的电火花源（克隆体记住了电火花）→ 顶部金属导线 → 插进水槽的电极。导线两头用锚点固定
  const wy = Math.floor(table - bh * 1.5 - 12), waterX = 14 + gap + (gap >> 1), srcX = 8;
  fillRect(METAL, srcX + 2, wy, waterX, wy);
  fillRect(METAL, waterX, wy, waterX, table - 1 - Math.floor(bh * 0.35));
  cloneSource(srcX, wy, SPARK);
  fillRect(ANCHOR, srcX + 2, wy - 1, srcX + 3, wy - 1);
  fillRect(ANCHOR, waterX - 1, wy - 1, waterX + 1, wy - 1);
  // 右侧：一小堆火药，导线故意留了 3 格缺口，补上金属就会引爆
  const gpX = W - 26;
  fillRect(METAL, waterX + 4, wy, gpX - 4, wy);
  fillRect(EMPTY, waterX + 1, wy, waterX + 3, wy);
  fillRect(ANCHOR, waterX + 4, wy - 1, waterX + 5, wy - 1);
  fillRect(ANCHOR, gpX - 5, wy - 1, gpX - 3, wy - 1);
  fillRect(GLASS, gpX - 8, wy + 11, gpX + 8, wy + 12);
  fillRect(ANCHOR, gpX - 9, wy + 11, gpX - 9, wy + 12);
  fillRect(ANCHOR, gpX + 9, wy + 11, gpX + 9, wy + 12);
  fillCircle(GUNPOWDER, gpX - 1, wy + 8, 3.2);
  fillRect(METAL, gpX - 4, wy, gpX - 4, wy + 10);
}

// 爆破拆除：底层架空的混凝土柱 + 每层一道钢梁 + 砖墙玻璃窗。柱脚整段换成 TNT，用火药导爆索串起来。
// 返回建筑的范围，自测用它来判断塌没塌。
function buildDemolition(lit, floorY) {
  const floor = floorY === undefined ? H - 6 : floorY;
  fillRect(STONE, 0, floor, W - 1, Math.min(H - 1, floor + 5));
  const bw = Math.floor(W * 0.36), x0 = Math.floor(W * 0.46), sh = 20;
  const storeys = Math.max(3, Math.min(5, Math.floor((floor - 14) / sh)));
  const cols = 4, colW = 3;
  const colX = k => x0 + Math.round((bw - colW) * k / cols);
  for (let s = 0; s < storeys; s++) {
    const yb = floor - 1 - s * sh, yt = yb - sh + 1;
    for (let k = 0; k <= cols; k++) fillRect(CONCRETE, colX(k), yt + 2, colX(k) + colW - 1, yb);     // 柱
    fillRect(STEEL, x0, yt, x0 + bw - 1, yt + 1);                                                    // 钢梁
    if (s === 0) continue;                                                                           // 底层架空
    for (let k = 0; k < cols; k++) {                                                                 // 砖墙 + 窗
      const xa = colX(k) + colW, xb = colX(k + 1) - 1;
      fillRect(BRICK, xa, yt + 2, xb, yb);
      fillRect(GLASS, xa + 3, yt + 6, xb - 3, yb - 6);
    }
  }
  const roof = floor - storeys * sh;
  fillRect(CONCRETE, x0 - 1, roof - 2, x0 + bw, roof - 1);
  // 炸药：最下面两层的每根柱子各三包，上下间隔不超过 8 格，一包炸了会殉爆相邻的 → 自下而上连锁。地面一条火药导爆索
  for (let st2 = 0; st2 < Math.min(2, storeys - 1); st2++) {
    const f = floor - 1 - st2 * sh;
    for (let k = 0; k <= cols; k++) for (const dy of [3, 9, 15]) fillRect(TNT, colX(k), f - dy - 1, colX(k) + colW - 1, f - dy + 1);
  }
  fillRect(GUNPOWDER, 6, floor - 1, x0 + bw - 1, floor - 1);
  if (lit) { setBurning(6, floor - 1); setBurning(7, floor - 1); }
  return { x0, x1: x0 + bw - 1, floor, roof, sh, storeys };
}

function sceneDemolition() {
  env.time = 0.42; env.timeScale = 0; setWeather('clear'); env.wind = 0.3; env.windPower = 0.3;
  buildDemolition(true);
}

function buildGarden() {
  const g = groundLine(4, 0.03, 0.075, H - 20);
  const pondX = Math.floor(W * 0.68), pondR = Math.floor(W * 0.09);
  for (let x = 0; x < W; x++) {
    const d = Math.abs(x - pondX);
    if (d < pondR) g[x] += Math.floor(dcos(d / pondR * 1.5708) * 9);       // 挖一个池塘
    for (let y = g[x]; y < H; y++) put(x + y * W, y > H - 4 ? STONE : SOIL, x, y);
  }
  const level = Math.min(g[Math.max(0, pondX - pondR)], g[Math.min(W - 1, pondX + pondR)]) + 1;
  for (let x = pondX - pondR; x <= pondX + pondR; x++) for (let y = level; y < g[x]; y++) if (inb(x, y)) put(x + y * W, WATER, x, y);
  put(pondX + level * W, VOID, pondX, level);            // 水面高度处的溢流口：池塘满了才排水
  for (let x = 10; x < W - 8; x += 21 + rndi(12)) if (Math.abs(x - pondX) > pondR + 6) drawTree(x, g[x], 12 + rndi(12), 5 + rndi(3));
  for (let x = 2; x < W - 2; x++) {
    if (Math.abs(x - pondX) <= pondR) continue;
    const q = rnd();
    if (q < 0.5) for (let h = 1; h <= 1 + rndi(3); h++) put(x + (g[x] - h) * W, PLANT, x, g[x] - h);
    else if (q < 0.62) put(x + (g[x] - 1) * W, SEED, x, g[x] - 1);
    if (q < 0.07) { const y = g[x] - 3, c = rndi(5) * 51 + 8; if (type[x + y * W] === 0) { put(x + y * W, FLOWER, x, y); seed[x + y * W] = c + rndi(34); } }
  }
  for (const x of [0, W - 1]) for (let y = g[x] - 3; y < g[x] + 1; y++) if (inb(x, y)) put(x + y * W, VOID, x, y);   // 两侧排水口
  soakSoil(60);
}

function sceneRain() {
  env.time = 0.92; env.timeScale = 1; setWeather('rain'); env.wind = -0.4;
  buildGarden();
  for (let c = 0; c < GW * GH; c++) if (altitudeOf((c / GW) | 0) > 0.75) cloud[c] = 1.8;
  env.waterIn += weatherWater();
}

function sceneWaterfall() {
  env.time = 0.4; env.timeScale = 1; setWeather('clear'); env.wind = 0.15;
  const base = H - 5;
  fillRect(STONE, 0, base, W - 1, H - 1);
  // 左高右低的三级石阶
  const steps = [[0, 0.30, 0.34], [0.30, 0.52, 0.56], [0.52, 0.70, 0.76]];
  for (const [a, b, top] of steps) {
    const xa = Math.floor(W * a), xb = Math.floor(W * b), yt = Math.floor(H * top);
    for (let x = xa; x < xb; x++) for (let y = yt + Math.floor(dsin(x * 0.4) * 1.5); y < base; y++) if (inb(x, y)) put(x + y * W, STONE, x, y);
  }
  // 每级台阶上凿一个浅水槽，让水先蓄再溢
  for (const [a, b, top] of steps) {
    const xa = Math.floor(W * a) + 6, xb = Math.floor(W * b) - 3, yt = Math.floor(H * top);
    fillRect(EMPTY, xa, yt - 2, xb, yt + 3);
    fillRect(WATER, xa, yt + 1, xb, yt + 3);
    fillRect(EMPTY, xb + 1, yt - 3, Math.floor(W * b) - 1, yt + 1);          // 右侧的槽沿削低：水一满就从这里跌下去
  }
  // 最高处的水源（克隆体）和最右下角的排水口（黑洞）：流进来多少流出去多少
  const sy = Math.floor(H * 0.34) - 3;
  for (let k = 0; k < 8; k++) cloneSource(2 + k * 2, sy - (k & 1) * 2, WATER);
  // 谷底：水潭 + 右岸的土和植物
  const poolTop = Math.floor(H * 0.86), bankX = Math.floor(W * 0.84);
  fillRect(WATER, Math.floor(W * 0.70), poolTop, bankX - 1, base - 1);
  for (let x = bankX; x < W; x++) for (let y = poolTop - 3 - Math.floor((x - bankX) * 0.12); y < base; y++) if (inb(x, y)) put(x + y * W, SOIL, x, y);
  for (let y = poolTop - 1; y <= poolTop; y++) put(bankX - 1 + y * W, VOID, bankX - 1, y);      // 水面处的溢流口
  for (let x = bankX + 3; x < W - 3; x += 9 + rndi(6)) { let y = 0; while (y < H && type[x + y * W] === 0) y++; drawTree(x, y, 8 + rndi(8), 4 + rndi(3)); }
  for (let x = bankX + 1; x < W - 1; x++) { let y = 0; while (y < H && type[x + y * W] === 0) y++; if (type[x + y * W] === SOIL && rnd() < 0.6) put(x + (y - 1) * W, PLANT, x, y - 1); }
  soakSoil(90);
}

function sceneWinterLake() {
  // 冬日午后，时间停住：日照升华恒定。大气含水到了容量天气就停止注入，降雪 = 升华，积雪量自己稳住
  env.time = 0.42; env.timeScale = 0; setWeather('snow'); env.wind = 0.4;
  temp.fill(env.temp);
  const g = groundLine(3, 0.028, 0.07, H - 30);
  const lakeX = W >> 1, lakeR = Math.floor(W * 0.3);
  for (let x = 0; x < W; x++) {
    const d = Math.abs(x - lakeX);
    if (d < lakeR) g[x] += Math.floor(dcos(d / lakeR * 1.5708) * 18);
    for (let y = g[x]; y < H; y++) { const i = x + y * W; put(i, y > H - 4 ? STONE : SOIL, x, y); temp[i] = -2; }
  }
  const level = Math.min(g[lakeX - lakeR], g[lakeX + lakeR]) + 2;
  for (let x = lakeX - lakeR; x <= lakeX + lakeR; x++) for (let y = level; y < g[x]; y++) {
    if (!inb(x, y)) continue;
    const i = x + y * W;
    if (y < level + 3) { put(i, ICE, x, y); temp[i] = -8; } else { put(i, WATER, x, y); temp[i] = 6; }     // 冰盖下面是 6°C 的水
  }
  for (let x = 0; x < W; x++) {                           // 岸上积雪 + 几棵落光叶子的树
    if (Math.abs(x - lakeX) < lakeR) continue;
    for (let h = 1; h <= 2 + rndi(2); h++) if (inb(x, g[x] - h)) put(x + (g[x] - h) * W, SNOW, x, g[x] - h);
  }
  for (let x = 12; x < W - 10; x += 26 + rndi(14)) {
    if (Math.abs(x - lakeX) < lakeR + 4) continue;
    const h = 14 + rndi(10);
    for (let y = g[x] - h; y < g[x]; y++) for (let dx = 0; dx < 2; dx++) put(x + dx + y * W, WOOD, x + dx, y);
    for (let k = 1; k <= 4; k++) for (const d of [-1, 1]) { const bx = x + d * k + (d > 0 ? 1 : 0), by = g[x] - h + 2 + k; if (inb(bx, by)) put(bx + by * W, WOOD, bx, by); }
  }
  soakSoil(145);                                         // 湖底和地面早就湿透了，不会把湖水吸干
  for (let c = 0; c < GW * GH; c++) if (altitudeOf((c / GW) | 0) > 0.75) cloud[c] = 1.5;
  env.waterIn += weatherWater();
}

const SCENES = [
  { name: '火山岛', note: '熔岩流进海里，先结壳再凝固', fn: sceneVolcano },
  { name: '森林大火', note: '左边已经点着了，风往右吹', fn: sceneForest },
  { name: '沙漏', note: '按 G 翻转重力', fn: sceneHourglass },
  { name: '化学实验室', note: '分层、通电、火药', fn: sceneLab },
  { name: '爆破拆除', note: '导爆索在烧，柱脚一断整栋楼塌下来', fn: sceneDemolition },
  { name: '雨夜', note: '云里下雨，浇灌花园', fn: sceneRain },
  { name: '雷暴森林', note: '闪电点火，大雨灭火，烧过的地方慢慢长回来', fn: sceneStormForest },
  { name: '瀑布峡谷', note: '三级跌水，水花、泡沫和涟漪', fn: sceneWaterfall },
  { name: '冬季湖泊', note: '冰盖上下着雪，用加热笔刷融个冰洞', fn: sceneWinterLake },
  { name: '火山爆发 + 昼夜', note: '时间 10 倍速，太阳一落山就喷发', fn: sceneVolcanoDayNight },
];

// 清空并搭建第 k 个预设；每个场景自己设定时间、天气和风
function buildScene(k) {
  env.temp = AMBIENT; env.dayNight = true; env.structure = true; env.plantAging = 1; env.wind = 0.2; env.windPower = 0.3;
  sceneState = null;
  setWeather('clear');
  clearGrid();
  setGravity('down');
  updateSun();
  SCENES[k].fn();
  // 场景里一开始就有的植物年龄随机铺满整个寿命：之后陆续老死、陆续长新的，不会同一时间整片枯掉
  for (let i = 0; i < N; i++) if (type[i] === PLANT && !(flags[i] & F_TIP)) life[i] = rndi((plantLifespan(seed[i]) * 0.2) | 0);
  updateSun();
  temp.forEach((v, i) => { if (type[i] === 0) temp[i] = env.ambient; });
  markStructAll();
  wakeAll();
}
