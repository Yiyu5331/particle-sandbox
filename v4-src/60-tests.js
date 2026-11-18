
/* =====================================================================
 * 6. 自测（?test=1）。模拟类用例不依赖 DOM，在 Node 里也能跑。
 * ===================================================================== */
const TESTS = [];
function defTest(name, fn) { TESTS.push({ name, fn }); }
function runSteps(n) { for (let k = 0; k < n; k++) simStep(); }

function tArena() {
  // 自测默认环境：恒为正午、20°C、无风、晴，结构力学关闭（很多用例把容器悬在半空）。需要的用例自己打开。
  env.dayNight = false; env.temp = AMBIENT; env.wind = 0; env.windPower = 0; env.structure = false; env.plantAging = 1; sceneState = null;
  setWeather('clear'); env.windPower = 0; env.cloudFade = 0; updateSun();
  clearGrid(); setGravity('down'); seedRng(20240607);
  return { cx: W >> 1, cy: H >> 1 };
}

function tBox(x0, y0, x1, y1, m) {
  for (let x = x0; x <= x1; x++) { put(x + y0 * W, m, x, y0); put(x + y1 * W, m, x, y1); }
  for (let y = y0; y <= y1; y++) { put(x0 + y * W, m, x0, y); put(x1 + y * W, m, x1, y); }
}

function tFloor(y, m) { for (let x = 0; x < W; x++) put(x + y * W, m || GLASS, x, y); }

// 跑到条件成立为止；返回用了多少步，超时返回 -1
function tUntil(maxSteps, every, cond) {
  for (let s = 0; s < maxSteps; s++) {
    simStep();
    if (s % every === 0 && cond()) return s + 1;
  }
  return cond() ? maxSteps : -1;
}

/* ---- 6.1 反应矩阵里的每一条接触规则 ---- */
for (const r of RULES) {
  defTest('规则 ' + MATERIALS[r.a].name + ' × ' + MATERIALS[r.b].name, () => {
    const { cx, cy } = tArena();
    const x0 = cx - 4, x1 = cx + 3, y0 = cy - 3, y1 = cy + 2;
    tBox(x0, y0, x1, y1, GLASS);
    for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) {
      const i = x + y * W, top = y < y0 + 3;
      put(i, top ? r.a : r.b, x, y);
      if (top && r.maxT !== undefined) temp[i] = r.maxT - 3;
    }
    const a0 = countType(r.a), b0 = countType(r.b);
    const a20 = countType(r.a2), b20 = countType(r.b2);
    const cond = () =>
      (r.a2 !== r.a && r.a2 !== EMPTY && countType(r.a2) > a20) ||
      (r.b2 !== r.b && r.b2 !== EMPTY && countType(r.b2) > b20) ||
      (r.b2 === EMPTY && countType(r.b) < b0) ||
      (r.a2 === EMPTY && countType(r.a) < a0);
    // 带温度条件的规则：全程把主动方维持在条件温度以下（比如过冷水），否则潜热会把它钉回冰点
    const hold = r.maxT === undefined ? null : () => { for (let y = y0 + 1; y < y0 + 3; y++) for (let x = x0 + 1; x < x1; x++) { const i = x + y * W; if (type[i] === r.a) temp[i] = r.maxT - 3; } };
    const n = tUntil(Math.min(8000, Math.ceil(60 / r.p)), 2, () => { if (hold) hold(); return cond(); });
    return { ok: n > 0, info: n > 0 ? n + ' 步出现产物' : '超时未出现产物' };
  });
}

/* ---- 6.2 温度相变 ---- */
defTest('冰受热融化成水', () => {
  const { cx, cy } = tArena();
  tBox(cx - 4, cy - 3, cx + 4, cy + 3, GLASS);
  fillRect(ICE, cx - 2, cy, cx + 2, cy + 2);
  const n = tUntil(600, 1, () => {      // 持续供热（相当于按住加热工具）
    for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy; y <= cy + 2; y++) if (type[x + y * W] === ICE) temp[x + y * W] = 60;
    return countType(WATER) >= 10;
  });
  return { ok: n > 0, info: n + ' 步' };
});

defTest('冰：零下不化；常温下慢慢融化（不会瞬间消失），融化时给周围降温', () => {
  const { cx, cy } = tArena();
  env.temp = -5; updateSun(); temp.fill(-5);
  tFloor(cy + 3);
  fillRect(ICE, cx - 3, cy, cx + 3, cy + 2);
  const before = countType(ICE);
  runSteps(900);
  const cold = countType(ICE);
  env.temp = 20; updateSun();
  runSteps(600);
  const after10s = countType(ICE);
  let minT = 99;
  tUntil(40000, 50, () => { for (let x = cx - 3; x <= cx + 3; x++) minT = Math.min(minT, temp[x + (cy - 1) * W]); return countType(ICE) === 0; });
  const end = countType(ICE);
  return { ok: cold === before && after10s >= before * 0.6 && after10s <= before && end === 0,
           info: '-5°C 时 ' + before + ' → ' + cold + '；20°C 下 10 秒后剩 ' + after10s + '，最终剩 ' + end };
});

defTest('水烧开变蒸汽', () => {
  const { cx, cy } = tArena();
  tBox(cx - 4, cy - 6, cx + 4, cy + 3, GLASS);
  fillRect(WATER, cx - 3, cy, cx + 3, cy + 2);
  for (let x = cx - 3; x <= cx + 3; x++) for (let y = cy; y <= cy + 2; y++) temp[x + y * W] = 160;
  const n = tUntil(200, 1, () => countType(STEAM) > 0);
  return { ok: n > 0, info: n + ' 步' };
});

defTest('蒸汽冷却凝结成水（下雨）', () => {
  const { cx, cy } = tArena();
  tBox(cx - 10, cy - 12, cx + 10, cy + 12, GLASS);
  fillRect(STEAM, cx - 8, cy - 2, cx + 8, cy + 2);
  const n = tUntil(6000, 5, () => countType(WATER) >= 20);
  return { ok: n > 0, info: n + ' 步后水汽成云再降回 ' + countType(WATER) + ' 格水（共 ' + env.rainCount + ' 滴雨）' };
});

defTest('沙子高温熔成玻璃', () => {
  const { cx, cy } = tArena();
  tFloor(cy + 3, STONE);
  fillRect(SAND, cx - 2, cy + 1, cx + 2, cy + 2);
  for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy + 1; y <= cy + 2; y++) temp[x + y * W] = 1700;
  runSteps(3);
  return { ok: countType(GLASS) > 0, info: countType(GLASS) + ' 格玻璃' };
});

defTest('石头高温熔成熔岩，冷却后变回石头', () => {
  const { cx, cy } = tArena();
  fillRect(STONE, cx - 3, cy, cx + 3, cy + 3);
  for (let x = cx - 1; x <= cx + 1; x++) temp[x + (cy + 1) * W] = 1600;
  runSteps(2);
  const melted = countType(LAVA);
  const n = tUntil(6000, 20, () => countType(LAVA) === 0);
  return { ok: melted > 0 && n > 0, info: '熔了 ' + melted + ' 格，' + n + ' 步后全部凝固' };
});

/* ---- 6.3 燃烧链 ---- */
defTest('燃烧链：木头 → 火 + 炭 → 灰', () => {
  const { cx, cy } = tArena();
  tFloor(cy + 4, STONE);
  fillRect(WOOD, cx - 4, cy + 1, cx + 4, cy + 3);
  temp[cx + (cy + 1) * W] = 500; temp[cx + 1 + (cy + 1) * W] = 500;
  let sawFire = false, sawCoal = false, sawAsh = false;
  tUntil(6000, 4, () => {
    if (countType(FIRE) > 0) sawFire = true;
    if (countType(CHARCOAL) > 0) sawCoal = true;
    if (countType(ASH) > 0) sawAsh = true;
    return sawFire && sawCoal && sawAsh;
  });
  return { ok: sawFire && sawCoal && sawAsh, info: '火' + sawFire + ' 炭' + sawCoal + ' 灰' + sawAsh };
});

defTest('火没有燃料很快熄灭', () => {
  const { cx, cy } = tArena();
  fillCircle(FIRE, cx, cy, 4);
  runSteps(120);
  return { ok: countType(FIRE) === 0, info: '120 步后剩 ' + countType(FIRE) + ' 格火' };
});

defTest('油被点燃并烧掉', () => {
  const { cx, cy } = tArena();
  tBox(cx - 8, cy - 2, cx + 8, cy + 4, STONE);
  fillRect(EMPTY, cx - 7, cy - 2, cx + 7, cy - 2);
  fillRect(OIL, cx - 7, cy + 2, cx + 7, cy + 3);
  const before = countType(OIL);
  temp[cx + (cy + 2) * W] = 400;
  let sawFire = false;
  tUntil(1500, 4, () => { if (countType(FIRE) > 3) sawFire = true; return sawFire && countType(OIL) < before * 0.5; });
  return { ok: sawFire && countType(OIL) < before * 0.5, info: '油 ' + before + ' → ' + countType(OIL) };
});

defTest('火药连锁燃爆', () => {
  const { cx, cy } = tArena();
  tFloor(cy + 3, STONE);
  fillRect(GUNPOWDER, cx - 15, cy + 2, cx + 15, cy + 2);
  const before = countType(GUNPOWDER);
  temp[cx - 15 + (cy + 2) * W] = 400;
  const n = tUntil(600, 2, () => countType(GUNPOWDER) === 0);
  return { ok: n > 0, info: before + ' 格火药 ' + n + ' 步烧完' };
});

/* ---- 6.4 TNT ---- */
defTest('TNT：冲击波分帧传播，石墙能挡住', () => {
  const { cx, cy } = tArena();
  tFloor(cy + 16, METAL);
  fillRect(STONE, cx + 5, cy - 14, cx + 8, cy + 15);          // 右边一堵 4 格厚的石墙
  fillRect(GLASS, cx + 10, cy + 6, cx + 13, cy + 15);         // 墙后的玻璃块
  fillRect(GLASS, cx - 10, cy + 6, cx - 7, cy + 15);          // 另一侧没有遮挡的玻璃块
  const i = cx + (cy + 10) * W;
  put(i, TNT, cx, cy + 10); flags[i] |= F_BURN; life[i] = 1;
  simStep();
  const midway = exActive > 0;
  let steps = 1;
  while (exActive > 0 && steps < 20) { simStep(); steps++; }
  const shielded = countType(GLASS, cx + 10, cy + 6, cx + 13, cy + 15);
  const exposed = countType(GLASS, cx - 10, cy + 6, cx - 7, cy + 15);
  const wall = countType(STONE, cx + 5, cy - 14, cx + 8, cy + 15);
  runSteps(240);
  return { ok: midway && steps >= 3 && shielded === 40 && exposed <= 28 && wall < 120,
           info: '传播 ' + steps + ' 帧；墙后玻璃剩 ' + shielded + '/40，无遮挡侧剩 ' + exposed + '/40，石墙剩 ' + wall + '/120' };
});

defTest('TNT：连锁引爆错开时间，碎片池不超上限', () => {
  const { cx, cy } = tArena();
  tFloor(cy + 12, METAL);
  fillRect(SAND, cx - 30, cy + 4, cx + 30, cy + 11);
  fillRect(TNT, cx - 5, cy + 8, cx + 4, cy + 8);              // 10 个 TNT 排成一排
  const i = cx - 5 + (cy + 8) * W;
  flags[i] |= F_BURN; life[i] = 1;
  let maxPerStep = 0, total = 0, maxFree = 0;
  for (let s = 0; s < 200; s++) {
    st.boom = 0;
    simStep();
    if (st.boom > maxPerStep) maxPerStep = st.boom;
    total += st.boom;
    if (fpCount > maxFree) maxFree = fpCount;
  }
  runSteps(400);
  return { ok: total === 10 && maxPerStep <= 4 && maxFree <= FP_MAX && fpCount === 0,
           info: '共 ' + total + ' 次爆炸，单帧最多 ' + maxPerStep + ' 次，飞行粒子峰值 ' + maxFree + '，结束后剩 ' + fpCount };
});

defTest('飞行粒子池：超出上限丢弃最旧的', () => {
  tArena();
  for (let k = 0; k < 6000; k++) spawnFree(SAND, W / 2, H / 2, 0, 0, 20, 1);
  const ok = fpCount === FP_MAX;
  fpClear();
  return { ok, info: '生成 6000 个，池内 ' + FP_MAX };
});

/* ---- 6.5 液体与密度 ---- */
defTest('液体按密度分层：油 > 水 > 盐水 > 酸（自上而下）', () => {
  const { cx, cy } = tArena();
  const x0 = cx - 3, x1 = cx + 3, y0 = cy - 20, y1 = cy + 20;
  tBox(x0, y0, x1, y1, GLASS);
  const kinds = [ACID, SALTWATER, WATER, OIL];
  for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) put(x + y * W, kinds[rndi(4)], x, y);
  runSteps(3000);
  const mean = {};
  for (const k of [OIL, WATER, SALTWATER, ACID]) {
    let s = 0, n = 0;
    for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) if (type[x + y * W] === k) { s += y; n++; }
    mean[k] = n ? s / n : -1;
  }
  const ok = mean[OIL] < mean[WATER] && mean[WATER] < mean[SALTWATER] && mean[SALTWATER] < mean[ACID] &&
             M_DENS[LAVA] > M_DENS[ACID];
  return { ok, info: '平均高度 油' + mean[OIL].toFixed(1) + ' 水' + mean[WATER].toFixed(1) +
                     ' 盐水' + mean[SALTWATER].toFixed(1) + ' 酸' + mean[ACID].toFixed(1) };
});

defTest('水下落有加速度，水面能静止并休眠', () => {
  const { cx, cy } = tArena();
  const floorY = Math.min(H - 2, cy + 40);
  tBox(cx - 20, floorY - 30, cx + 20, floorY, GLASS);
  fillRect(EMPTY, cx - 19, floorY - 30, cx + 19, floorY - 30);
  const top = floorY - 70 > 1 ? floorY - 70 : 1;
  put(cx + top * W, WATER, cx, top);
  const fallSteps = tUntil(200, 1, () => type[cx + (floorY - 1) * W] === WATER || countType(WATER, cx - 19, floorY - 2, cx + 19, floorY - 1) > 0);
  fillRect(WATER, cx - 19, floorY - 6, cx + 19, floorY - 1);
  runSteps(600);
  const asleep = perf.activeChunks === 0;
  return { ok: fallSteps > 0 && fallSteps < 30 && asleep,
           info: '下落 ' + (floorY - 1 - top) + ' 格用 ' + fallSteps + ' 步；静止后活跃块 ' + perf.activeChunks };
});

defTest('沙沉进水里，交界处没有空腔', () => {
  const { cx, cy } = tArena();
  tBox(cx - 12, cy - 14, cx + 12, cy + 12, GLASS);
  fillRect(WATER, cx - 11, cy, cx + 11, cy + 11);
  fillRect(SAND, cx - 6, cy - 12, cx + 6, cy - 6);
  runSteps(900);
  // 水面以下、容器之内不应该有被封住的空气格
  let holes = 0;
  for (let y = cy + 4; y <= cy + 11; y++) for (let x = cx - 11; x <= cx + 11; x++) if (type[x + y * W] === 0) holes++;
  return { ok: holes === 0, info: '水线以下空格数 ' + holes };
});

/* ---- 6.6 电、植物、工具 ---- */
defTest('电火花沿金属导线引爆火药', () => {
  const { cx, cy } = tArena();
  tFloor(cy + 3, GLASS);
  fillRect(METAL, cx - 20, cy + 2, cx + 20, cy + 2);
  fillRect(GUNPOWDER, cx + 21, cy + 1, cx + 24, cy + 2);
  put(cx - 21 + (cy + 2) * W, SPARK, cx - 21, cy + 2);
  const n = tUntil(400, 1, () => countType(GUNPOWDER) <= 2);
  return { ok: n > 0, info: n + ' 步后火药被引爆，剩 ' + countType(GUNPOWDER) + ' 格' };
});

defTest('电在水里传导', () => {
  const { cx, cy } = tArena();
  tBox(cx - 15, cy, cx + 15, cy + 4, GLASS);
  fillRect(EMPTY, cx - 14, cy, cx + 14, cy);
  fillRect(WATER, cx - 14, cy + 1, cx + 14, cy + 3);
  runSteps(30);
  put(cx - 14 + cy * W, SPARK, cx - 14, cy);
  let reached = false;
  for (let s = 0; s < 60 && !reached; s++) {
    simStep();
    for (let x = cx - 5; x <= cx + 5; x++) if (charge[x + (cy + 2) * W] > 0) reached = true;
  }
  return { ok: reached, info: reached ? '电荷传到了 10 格以外' : '没有传到' };
});

defTest('种子在土上发芽、长高、开花', () => {
  const { cx, cy } = tArena();
  tFloor(cy + 20, STONE);
  fillRect(SOIL, cx - 30, cy + 17, cx + 30, cy + 19);
  soakSoil(150);
  for (let x = cx - 28; x <= cx + 28; x += 4) put(x + (cy + 10) * W, SEED, x, cy + 10);
  runSteps(9000);
  let minY = H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (type[x + y * W] === PLANT && y < minY) minY = y;
  const height = cy + 17 - minY;
  return { ok: countType(PLANT) > 40 && height >= 8 && countType(FLOWER) + countType(SEED) > 0,
           info: '植物 ' + countType(PLANT) + ' 格，最高 ' + height + ' 格，花 ' + countType(FLOWER) + ' 格，新种子 ' + countType(SEED) + ' 粒' };
});

defTest('克隆体复制、黑洞吞噬', () => {
  const { cx, cy } = tArena();
  tFloor(cy + 10, STONE);
  put(cx + cy * W, CLONE, cx, cy);
  put(cx + (cy - 1) * W, SAND, cx, cy - 1);
  runSteps(600);
  const cloned = countType(SAND);
  put(cx + (cy + 8) * W, VOID, cx, cy + 8);
  put(cx + 1 + (cy + 8) * W, VOID, cx + 1, cy + 8);
  clearCell(cx + cy * W, cx, cy);
  runSteps(2500);
  const left = countType(SAND);
  return { ok: cloned > 20 && left <= cloned - 15, info: '复制出 ' + cloned + ' 格沙，黑洞吞到剩 ' + left };
});

defTest('酸不腐蚀玻璃和金属', () => {
  const { cx, cy } = tArena();
  tBox(cx - 5, cy - 3, cx + 5, cy + 3, GLASS);
  fillRect(METAL, cx - 4, cy + 2, cx + 4, cy + 2);
  fillRect(ACID, cx - 4, cy - 1, cx + 4, cy + 1);
  const g0 = countType(GLASS), m0 = countType(METAL);
  runSteps(1200);
  return { ok: countType(GLASS) === g0 && countType(METAL) === m0, info: '玻璃 ' + g0 + '，金属 ' + m0 + '，均未减少' };
});

/* ---- 6.7 重力四向 ---- */
defTest('四个重力方向：粉末下沉、气体反向、休止角一致', () => {
  const ratios = [], notes = [];
  let ok = true;
  for (const dir of ['down', 'up', 'left', 'right']) {
    tArena(); setGravity(dir); seedRng(99);
    const cx = W >> 1, cy = H >> 1;
    // 在重力下游 20 格处放一块金属板，沙落在板上堆成堆
    const px = cx + gx * 20, py = cy + gy * 20;
    for (let k = -45; k <= 45; k++) { const x = px + lx * k, y = py + ly * k; if (inb(x, y)) put(x + y * W, METAL, x, y); }
    fillRect(SAND, cx - 10, cy - 10, cx + 10, cy + 10);
    const sx = cx - gx * 16, sy = cy - gy * 16;
    fillCircle(SMOKE, sx, sy, 3);
    let moved = 0;
    for (let s = 0; s < 40; s++) simStep();
    // 烟的质心应该逆着重力移动
    let gsx = 0, gsy = 0, gn = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (type[x + y * W] === SMOKE) { gsx += x; gsy += y; gn++; }
    if (gn > 0) moved = -((gsx / gn - sx) * gx + (gsy / gn - sy) * gy);
    runSteps(500);
    // 沙堆：沿重力方向的高度 vs 侧向宽度
    let hMax = 0, lMin = 1e9, lMax = -1e9, n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (type[x + y * W] !== SAND) continue;
      n++;
      const dh = (px - x) * gx + (py - y) * gy, dl = (x - px) * lx + (y - py) * ly;
      if (dh > hMax) hMax = dh;
      if (dl < lMin) lMin = dl;
      if (dl > lMax) lMax = dl;
    }
    const ratio = (lMax - lMin + 1) / hMax;
    ratios.push(ratio);
    notes.push(dir + ' 宽高比 ' + ratio.toFixed(2) + ' 气体逆行 ' + moved.toFixed(1));
    if (n < 430 || n > 441 || moved < 4 || hMax < 6) ok = false;
  }
  const mn = Math.min.apply(null, ratios), mx = Math.max.apply(null, ratios);
  if (mx / mn > 1.6 || mn < 1.2 || mx > 4.5) ok = false;      // v4 里沙粒落地会弹开，堆的宽度比 v3 更随机，容差放宽到 1.6 倍
  setGravity('down');
  return { ok, info: notes.join('；') };
});

/* ---- 6.8 架构 ---- */
defTest('颜色种子跟着粒子走（移动时不闪）', () => {
  const { cx } = tArena();
  tFloor(H - 2, STONE);
  const i = cx + 5 * W;
  put(i, SAND, cx, 5); seed[i] = 177;
  runSteps(20);
  let found = -1;
  for (let k = 0; k < N; k++) if (type[k] === SAND) found = seed[k];
  return { ok: found === 177 && type[i] !== SAND, info: '下落后 seed = ' + found };
});

defTest('分块休眠：静止后活跃块归零，扰动后唤醒', () => {
  const { cx, cy } = tArena();
  tFloor(cy + 10, STONE);
  fillRect(SAND, cx - 8, cy - 5, cx + 8, cy + 5);
  runSteps(400);
  const asleep = perf.activeChunks;
  put(cx + (cy - 20) * W, SAND, cx, cy - 20);
  simStep(); simStep();
  const awake = perf.activeChunks;
  return { ok: asleep === 0 && awake > 0, info: '静止时 ' + asleep + ' 块，扰动后 ' + awake + ' 块' };
});

defTest('存档往返：导出 → 清空 → 导入，逐格一致', () => {
  const { cx, cy } = tArena();
  tFloor(cy + 12, STONE);
  const kinds = [SAND, WATER, WOOD, OIL, PLANT, METAL, ICE, SALT, GUNPOWDER, GLASS, LAVA, TNT];
  for (let y = cy - 10; y < cy + 12; y++) for (let x = cx - 30; x < cx + 30; x++) if (rnd() < 0.6) put(x + y * W, kinds[rndi(kinds.length)], x, y);
  runSteps(40);
  setGravity('left');
  const json1 = sceneToJSON(captureScene());
  const t0 = type.slice(), s0 = seed.slice(), l0 = life.slice(), f0 = flags.slice(), T0 = temp.slice(), w0 = wet.slice(), a0 = aux.slice(), u0 = fuel.slice();
  clearGrid(); setGravity('down');
  const empty = countType(EMPTY) === N;
  restoreScene(sceneFromJSON(json1));
  let diff = 0;
  for (let i = 0; i < N; i++) {
    if (type[i] !== t0[i]) { diff++; continue; }
    if (type[i] === 0) continue;
    if (seed[i] !== s0[i] || life[i] !== l0[i] || (flags[i] & F_SAVE) !== (f0[i] & F_SAVE) || Math.abs(temp[i] - T0[i]) > 0.51 ||
        wet[i] !== w0[i] || aux[i] !== a0[i] || fuel[i] !== u0[i]) diff++;
  }
  const json2 = sceneToJSON(captureScene());
  const ok = empty && diff === 0 && json1 === json2 && gravity === 'left';
  setGravity('down');
  return { ok, info: '差异 ' + diff + ' 格，JSON ' + (json1.length / 1024).toFixed(1) + ' KB，二次导出' + (json1 === json2 ? '完全相同' : '不同') };
});

// 同步跑完全部模拟用例（Node 用）
function runSimTestsSync(log) {
  let pass = 0;
  const results = [];
  for (const t of TESTS) {
    if (t.browser) continue;
    let r;
    try { r = t.fn(); } catch (e) { r = { ok: false, info: '异常：' + (e && e.stack || e) }; }
    results.push({ name: t.name, ok: r.ok, info: r.info });
    if (r.ok) pass++;
    if (log) log((r.ok ? '通过  ' : '失败  ') + t.name + ' — ' + r.info);
  }
  return { pass, total: results.length, results };
}
