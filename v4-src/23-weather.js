
/* =====================================================================
 * 2w. 天气与环境（都算在 1/8 分辨率的粗网格上，每格 8x8 个粒子格）
 *   风场    = 全局风（越高越大，带阵风）+ 热对流（空气被吸向更热的一侧 → 大火自己招风）
 *   湿度场  = 水面蒸发、晾干、蒸腾、蒸汽冷却放出的水汽；会上升、被风吹、扩散
 *   云      = 水汽超过饱和量（越高、越冷饱和量越小）的部分；够厚就降水，每一滴都从云里扣掉
 *   闪电    = 雷暴时厚云积累电荷，到阈值后沿分形折线劈向「最高 + 最导电」的地方
 *   昼夜    = 太阳高度决定光照、气温（±4°C）、蒸发速度和植物能不能长
 * ===================================================================== */
const RAIN_THR = 2.0;
let GW = 1, GH = 1;
let windX = new Float32Array(1), heatC = new Float32Array(1);
let vapor = new Float32Array(1), vaporB = new Float32Array(1), cloud = new Float32Array(1), cloudB = new Float32Array(1);
let solidC = new Float32Array(1);   // 每个粗格里被固体 / 粉末 / 液体占住的比例：挡水汽、挡风
let windShade = new Float32Array(1); // 上风方向有障碍物挡着的程度（0 = 开阔，1 = 完全挡住）
let solidRow = 0;
let lastBolt = null;       // 最近一次闪电（渲染用来整屏闪一下）

function allocWeather() {
  GW = Math.ceil(W / 8); GH = Math.ceil(H / 8);
  const n = GW * GH;
  windX = new Float32Array(n); heatC = new Float32Array(n);
  vapor = new Float32Array(n); vaporB = new Float32Array(n); cloud = new Float32Array(n); cloudB = new Float32Array(n);
  solidC = new Float32Array(n); windShade = new Float32Array(n); solidRow = 0;
}

function clearWeather() { windX.fill(0); heatC.fill(0); vapor.fill(0); cloud.fill(0); solidC.fill(0); windShade.fill(0); solidRow = 0; env.atmos = 0; }

// 每次只重算四分之一的粗格行（每 16 步全部刷新一遍）
function refreshSolid() {
  for (let cy = solidRow; cy < GH; cy += 4) {
    const y0 = cy << 3, y1 = Math.min(H, y0 + 8);
    for (let cx = 0; cx < GW; cx++) {
      const x0 = cx << 3, x1 = Math.min(W, x0 + 8);
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0, i = y * W + x0; x < x1; x++, i++) { const o = type[i]; if (o !== 0 && M_STATE[o] < S_GAS) n++; }
      solidC[cx + cy * GW] = n / ((x1 - x0) * (y1 - y0));
    }
  }
  solidRow = (solidRow + 1) & 3;
}

function vaporAdd(x, y, amount) { vapor[(x >> 3) + (y >> 3) * GW] += amount; }

function weatherWater() {
  let s = 0;
  for (let c = 0, n = GW * GH; c < n; c++) s += vapor[c] + cloud[c];
  return s;
}

function updateSun() {
  if (!env.dayNight) { env.el = 1; env.sun = 1; env.ambient = env.temp; return; }
  const el = dsin((env.time - 0.25) * 6.2832);
  env.el = el;
  env.sun = el > 0 ? Math.min(1, el * 1.6) : 0;
  env.ambient = env.temp + el * 4 - 1;
}

function altitudeOf(cy) { return gy > 0 ? 1 - (cy + 0.5) / GH : gy < 0 ? (cy + 0.5) / GH : 0.5; }

function spawnPrecip(cx, cy, alt) {
  const x = Math.min(W - 1, (cx << 3) + rndi(8)), y = Math.min(H - 1, gy < 0 ? (cy << 3) : (cy << 3) + 7);
  const i = x + y * W;
  if (type[i] !== 0) return false;
  if (env.ambient - alt * 6 <= 0.5) { put(i, SNOW, x, y); env.snowCount++; }
  else { put(i, WATER, x, y); temp[i] = Math.max(1, Math.min(env.ambient, 15)); env.rainCount++; }
  st.rain++; WL.precip++;
  return true;
}

function stepVapor() {
  const n = GW * GH, amb = env.ambient;
  let tf = 1 + (amb - 20) / 40;
  tf = tf < 0.3 ? 0.3 : tf > 2 ? 2 : tf;
  refreshSolid();
  vaporB.fill(0); cloudB.fill(0);
  const upOff = gy > 0 ? -GW : gy < 0 ? GW : 0;
  // 天气是「有预算的源」：每分钟最多注入 moistPerMin 格水（按 400 格宽的画面折算），
  // 大气里已有的水汽 + 云越接近容量 atmosCap（每个粗格列），注入越少；到容量就停
  let topCells = 0;
  for (let cy = 0; cy < GH; cy++) if (altitudeOf(cy) > 0.8) topCells += GW;
  let inject = 0;
  if (env.moistPerMin > 0 && topCells > 0) {
    const room = 1 - env.atmos / (env.atmosCap * GW);
    if (room > 0) inject = env.moistPerMin / 900 * (W / 400) * room / topCells;
  }
  let atmos = 0;
  for (let cy = 0; cy < GH; cy++) {
    const alt = altitudeOf(cy), lo = 1 - alt, sat = (0.35 + 5.6 * lo * Math.sqrt(lo)) * tf;
    for (let cx = 0; cx < GW; cx++) {
      const c = cx + cy * GW;
      let v = vapor[c], cl = cloud[c];
      if (v > sat) { const d = (v - sat) * 0.25; v -= d; cl += d; WL.condense += d; }                      // 过饱和 → 凝成云
      else if (cl > 0 && v < sat * 0.6) { const d = Math.min(cl, (sat * 0.6 - v) * 0.03); cl -= d; v += d; WL.cloudEvap += d; }   // 太干 → 云散
      if (alt > 0.8) {                                                                 // 高空：天气预设的外部输入 / 输出
        if (inject > 0) { v += inject; env.waterIn += inject; WL.weatherIn += inject; }
        if (env.cloudFade > 0) { const d = cl * env.cloudFade + v * env.cloudFade; cl -= cl * env.cloudFade; v -= v * env.cloudFade; env.waterOut += d; WL.cloudFade += d; }
      }
      // 云够厚就降水：超过一半阈值开始零星落雨，超过阈值越厚下得越急；每一滴都从云里扣掉
      if (cl > RAIN_THR * 0.5 && rnd() < Math.min(0.6, (cl - RAIN_THR * 0.5) * 0.06 + (cl > RAIN_THR ? (cl - RAIN_THR) * 0.2 : 0))) { if (spawnPrecip(cx, cy, alt)) cl -= 1; }
      if (env.storm > 0 && cl > RAIN_THR * 0.8) env.charge += env.storm * 0.0006 * cl;
      if (v < 1e-6) v = 0;
      if (cl < 1e-6) cl = 0;
      atmos += v + cl;
      // 输运：水汽上升 + 随风 + 扩散；云只随风和少量扩散。往哪个粗格走，都要按那个粗格的空隙比例打折（水汽不穿墙）
      const w = windX[c], aw = w < 0 ? -w : w, fw = aw * 0.15 > 0.3 ? 0.3 : aw * 0.15;
      const side = w > 0 ? (cx < GW - 1 ? c + 1 : -1) : (cx > 0 ? c - 1 : -1);
      const up = upOff !== 0 && c + upOff >= 0 && c + upOff < n ? c + upOff : -1;
      const openHere = 1 - solidC[c];
      let keep = v;
      if (up >= 0) { const d = v * 0.08 * (1 - solidC[up]) * openHere; vaporB[up] += d; keep -= d; }
      if (side >= 0) { const d = v * fw * (1 - solidC[side]) * openHere; vaporB[side] += d; keep -= d; }
      const dv = v * 0.02 * openHere;
      if (cx > 0) { const d = dv * (1 - solidC[c - 1]); vaporB[c - 1] += d; keep -= d; }
      if (cx < GW - 1) { const d = dv * (1 - solidC[c + 1]); vaporB[c + 1] += d; keep -= d; }
      if (cy > 0) { const d = dv * (1 - solidC[c - GW]); vaporB[c - GW] += d; keep -= d; }
      if (cy < GH - 1) { const d = dv * (1 - solidC[c + GW]); vaporB[c + GW] += d; keep -= d; }
      vaporB[c] += keep;
      let keepC = cl;
      if (side >= 0) { const d = cl * fw * 0.7 * (1 - solidC[side]); cloudB[side] += d; keepC -= d; }
      const dc = cl * 0.008;
      if (cx > 0) { const d = dc * (1 - solidC[c - 1]); cloudB[c - 1] += d; keepC -= d; }
      if (cx < GW - 1) { const d = dc * (1 - solidC[c + 1]); cloudB[c + 1] += d; keepC -= d; }
      cloudB[c] += keepC;
    }
  }
  env.atmos = atmos;
  let t = vapor; vapor = vaporB; vaporB = t;
  t = cloud; cloud = cloudB; cloudB = t;
  if (env.charge > 1) { env.charge = 0; lightning(); }
}

function stepWeather() {
  if (env.dayNight && env.timeScale > 0) { env.time += env.timeScale / DAY_STEPS; if (env.time >= 1) env.time -= 1; }
  updateSun();
  const ph = tick & 3, n = GW * GH;
  // 每步抽样 1/4 的粗格，估计它比环境热多少
  for (let c = ph; c < n; c += 4) {
    const x = ((c % GW) << 3) + rndi(8), y = (((c / GW) | 0) << 3) + rndi(8);
    if (x >= W || y >= H) continue;
    let ex = temp[x + y * W] - env.ambient;
    ex = ex < 0 ? 0 : ex > 900 ? 900 : ex;
    heatC[c] += (ex - heatC[c]) * 0.2;
  }
  if (ph === 0) {
    const gust = dsin(tick * 0.004), pw = env.windPower;
    for (let cy = 0; cy < GH; cy++) {
      const alt = altitudeOf(cy);
      const base = env.wind * pw * 1.4 * (0.5 + 0.7 * alt) + dsin(tick * 0.011 + cy * 0.7) * 0.1 * pw + gust * 0.08 * pw;
      // 风影：从上风一侧扫过去，碰到固体就被挡住，挡住的程度往下风方向每个粗格衰减一成半。墙后面形成一片风影区，
      // 墙顶上面那几行照样有风（风从建筑上面绕过去）
      const dir = base >= 0 ? 1 : -1;
      let sh = 0;
      for (let k = 0; k < GW; k++) {
        const cx = dir > 0 ? k : GW - 1 - k, c = cx + cy * GW;
        const blk = solidC[c] * 2 > 1 ? 1 : solidC[c] * 2;      // 半个粗格被墙占住就基本挡死了
        sh = blk > sh * 0.85 ? blk : sh * 0.85;
        windShade[c] = sh;
        let d = ((cx < GW - 1 ? heatC[c + 1] : 0) - (cx > 0 ? heatC[c - 1] : 0)) * 0.003;   // 往热的一侧吸
        d = d > 0.6 ? 0.6 : d < -0.6 ? -0.6 : d;
        windX[c] += (base * (1 - sh) + d - windX[c]) * 0.15;
      }
    }
  } else if (ph === 2) stepVapor();
}

/* ---- 闪电 ---- */
function boltPath(x0, y0, x1, y1, disp, out) {
  if (disp < 1.5) { out.push(x1, y1); return; }
  const mx = (x0 + x1) / 2 + (rnd() - 0.5) * disp, my = (y0 + y1) / 2 + (rnd() - 0.5) * disp * 0.35;
  boltPath(x0, y0, mx, my, disp / 2, out);
  boltPath(mx, my, x1, y1, disp / 2, out);
}

function drawBolt(pts) {
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const x0 = pts[k], y0 = pts[k + 1], x1 = pts[k + 2], y1 = pts[k + 3];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let s = 0; s <= n; s++) {
      const x = Math.round(x0 + (x1 - x0) * s / n), y = Math.round(y0 + (y1 - y0) * s / n);
      if (!inb(x, y)) continue;
      const j = x + y * W;
      if (type[j] !== 0 && M_STATE[type[j]] !== S_GAS) continue;
      put(j, SPARK, x, y);
      flags[j] &= ~F_TIP; life[j] = 5 + rndi(5);
    }
  }
}

// tx 给了就是「召唤闪电」：劈向这一列附近；不给就由云自己找目标
function lightning(tx) {
  const manual = tx !== undefined;
  let best = -1, bv = 0;
  for (let c = 0, n = GW * GH; c < n; c++) {
    if (cloud[c] < 0.3) continue;
    const v = cloud[c] + rnd() * 0.3 - (manual ? Math.abs(((c % GW) << 3) - tx) * 0.02 : 0);
    if (v > bv) { bv = v; best = c; }
  }
  let sx, sy;
  if (best >= 0) {                                    // 从这片云的云底起劈：顺着这一列往下找到云的最下沿
    let c = best;
    while (c + GW < GW * GH && cloud[c + GW] >= 0.3) c += GW;
    sx = ((c % GW) << 3) + 4; sy = Math.min(H - 2, (((c / GW) | 0) << 3) + 7);
  }
  else { sx = manual ? tx + rndi(21) - 10 : rndi(W); sy = 1; }
  if (!manual) tx = sx + rndi(41) - 20;
  const span = manual ? 5 : 40;
  // 选落点：越高越好，导体加分（金属 > 水），离云太远扣分
  let bx = -1, by = H - 1, bs = -1e9;
  for (let x = Math.max(0, tx - span); x <= Math.min(W - 1, tx + span); x++) {
    let y = Math.min(H - 1, sy + 1), o = 0;
    for (; y < H; y++) { o = type[x + y * W]; if (o !== 0 && M_STATE[o] < S_GAS) break; }
    if (y >= H) { y = H - 1; o = 0; }
    const score = (H - y) + (M_ELEC[o] ? (o === WATER || o === SALTWATER ? 12 : 45) : 0) - Math.abs(x - sx) * 0.4 + rnd() * 6;
    if (score > bs) { bs = score; bx = x; by = y; }
  }
  if (bx < 0) return;
  const pts = [sx, sy];
  boltPath(sx, sy, bx, by - 1, Math.min(28, Math.abs(by - sy) * 0.35 + 4), pts);
  drawBolt(pts);
  for (let b = 0; b < 3; b++) {                        // 分叉
    const k = (2 + rndi(Math.max(1, (pts.length >> 1) - 4))) << 1;
    if (k + 1 >= pts.length) continue;
    const ex = pts[k] + (rnd() - 0.5) * 40, ey = pts[k + 1] + 8 + rnd() * 22, br = [pts[k], pts[k + 1]];
    boltPath(pts[k], pts[k + 1], ex, ey, 10, br);
    drawBolt(br);
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {   // 落点：高温 + 给导体注入电荷
    const x = bx + dx, y = by + dy;
    if (!inb(x, y) || dx * dx + dy * dy > 5) continue;
    const j = x + y * W;
    temp[j] = Math.min(1100, temp[j] + 1500);          // 封顶 1100°C：点得着树，但熔不了石头
    if (M_ELEC[type[j]]) addCharge(j, 255);
    wake(x, y);
  }
  env.strikes++;
  lastBolt = { x: bx, y: by, sx, sy, tick };
  if (onThunder) onThunder(bx, by);
}

// 雷声延迟：按落点到「听者」（画面底边中点）的距离算，越远越晚
function thunderDelay(x, y) { const dx = x - W / 2, dy = y - (H - 1); return 0.15 + Math.sqrt(dx * dx + dy * dy) / W * 2.2; }

// moistPerMin：每分钟最多注入多少格水（按 400 格宽的画面折算）；atmosCap：每个粗格列的大气含水容量，到了就停止注入
const WEATHER_PRESETS = {
  clear:  { name: '晴',   moistPerMin: 0,   atmosCap: 0,   cloudFade: 0.004, storm: 0, windPower: 0.2 },
  cloudy: { name: '多云', moistPerMin: 40,  atmosCap: 1.2, cloudFade: 0,     storm: 0, windPower: 0.3 },
  rain:   { name: '雨',   moistPerMin: 260, atmosCap: 3.0, cloudFade: 0,     storm: 0, windPower: 0.45 },
  storm:  { name: '雷暴', moistPerMin: 420, atmosCap: 4.0, cloudFade: 0,     storm: 1, windPower: 0.8 },
  snow:   { name: '雪',   moistPerMin: 120, atmosCap: 2.0, cloudFade: 0,     storm: 0, windPower: 0.35, temp: -6 },
};

function setWeather(key) {
  const p = WEATHER_PRESETS[key];
  if (!p) return;
  env.weather = key; env.moistPerMin = p.moistPerMin; env.atmosCap = p.atmosCap; env.cloudFade = p.cloudFade; env.storm = p.storm; env.windPower = p.windPower;
  if (p.temp !== undefined) env.temp = p.temp; else if (env.temp < 5) env.temp = AMBIENT;
}
