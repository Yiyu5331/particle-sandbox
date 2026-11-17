
/* =====================================================================
 * 6b. v4 新增用例
 * ===================================================================== */
function countBurning() { let n = 0; for (let i = 0; i < N; i++) if (type[i] !== 0 && (flags[i] & F_BURN)) n++; return n; }
function sumCloud() { let s = 0; for (let c = 0; c < GW * GH; c++) s += cloud[c]; return s; }
function centroid(t) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (type[x + y * W] === t) { sx += x; sy += y; n++; }
  return n ? { x: sx / n, y: sy / n, n } : null;
}

/* ---- 燃烧：燃料 + 热量 + 氧气 ---- */
defTest('大量水扑灭大火并留下焦黑残骸；少量水只能压一下', () => {
  const run = rows => {
    const { cx, cy } = tArena();
    tFloor(cy + 20, STONE);
    fillRect(WOOD, cx - 12, cy + 8, cx + 12, cy + 19);
    for (let x = cx - 12; x <= cx + 12; x++) setBurning(x, cy + 8);
    for (let y = cy + 8; y <= cy + 19; y++) { setBurning(cx - 12, y); setBurning(cx + 12, y); }
    runSteps(120);
    const before = countBurning();
    if (rows > 0) fillRect(WATER, cx - 16, cy - 2 - rows, cx + 16, cy - 3);
    let steam = 0, white = 0, mid = 0;
    for (let s = 0; s < 900; s++) {
      simStep();
      if (s % 10 === 0) { steam = Math.max(steam, countType(STEAM)); for (let i = 0; i < N; i++) if (type[i] === SMOKE && seed[i] < 50) { white++; break; } }
      if (s === 200) mid = countBurning();
    }
    let scorched = 0;
    for (let i = 0; i < N; i++) if ((type[i] === WOOD || type[i] === CHARCOAL) && (flags[i] & F_SCORCH)) scorched++;
    return { before, mid, end: countBurning(), fuelLeft: countType(WOOD) + countType(CHARCOAL), steam, white, scorched };
  };
  const big = run(14), small = run(1);
  const ok = big.before > 30 && big.end === 0 && big.fuelLeft > 100 && (big.white > 0 || big.steam > 20) && big.scorched > 0 && small.mid > 0;
  return { ok, info: '大量水：燃烧格 ' + big.before + ' → ' + big.end + '，剩 ' + big.fuelLeft + ' 格木/炭（焦黑 ' + big.scorched + '），蒸汽峰值 ' + big.steam +
                     '；少量水：泼水 200 步后仍有 ' + small.mid + ' 格在烧' };
});

defTest('湿木头难点燃；泼过水的一段形成防火带', () => {
  // 同样的火把烤两块木头，一块是湿的
  let { cx, cy } = tArena();
  tFloor(cy + 3, STONE);
  fillRect(WOOD, cx - 30, cy + 1, cx - 10, cy + 2);
  fillRect(WOOD, cx + 10, cy + 1, cx + 30, cy + 2);
  for (let x = cx + 10; x <= cx + 30; x++) for (let y = cy + 1; y <= cy + 2; y++) wet[x + y * W] = 100;
  let dryAt = -1, wetAt = -1;
  for (let s = 0; s < 200; s++) {
    for (let k = 0; k < 3; k++) { temp[cx - 30 + k + (cy + 1) * W] = 420; temp[cx + 10 + k + (cy + 1) * W] = 420; }
    simStep();
    if (dryAt < 0 && (flags[cx - 30 + (cy + 1) * W] & F_BURN)) dryAt = s;
    if (wetAt < 0 && (flags[cx + 10 + (cy + 1) * W] & F_BURN)) wetAt = s;
  }
  // 一条长木板中间一段打湿：火从左端烧过来，过不去
  const plank = wetBand => {
    const a = tArena();
    tFloor(a.cy + 3, STONE);
    fillRect(WOOD, a.cx - 30, a.cy + 2, a.cx + 30, a.cy + 2);
    if (wetBand) for (let x = a.cx - 6; x <= a.cx + 6; x++) wet[x + (a.cy + 2) * W] = 100;
    setBurning(a.cx - 14, a.cy + 2); setBurning(a.cx - 13, a.cy + 2);
    runSteps(6000);
    return type[a.cx + 28 + (a.cy + 2) * W] === WOOD && !(flags[a.cx + 28 + (a.cy + 2) * W] & F_BURN);
  };
  const stopped = plank(true), control = plank(false);
  return { ok: dryAt >= 0 && (wetAt < 0 || wetAt > dryAt + 25) && stopped && !control,
           info: '干木头第 ' + dryAt + ' 步点着，湿木头' + (wetAt < 0 ? ' 200 步内没点着' : '第 ' + wetAt + ' 步') +
                 '；防火带后面的木头' + (stopped ? '完好' : '被烧') + '，没有防火带的对照组' + (control ? '没烧到' : '烧过去了') };
});

defTest('密闭空间里的火把氧气烧光后自己熄灭，燃料有剩', () => {
  const run = sealed => {
    const { cx, cy } = tArena();
    tBox(cx - 4, cy - 3, cx + 3, cy + 2, STONE);
    if (!sealed) fillRect(EMPTY, cx - 3, cy - 3, cx + 2, cy - 3);
    fillRect(WOOD, cx - 2, cy, cx + 1, cy + 1);
    for (let x = cx - 2; x <= cx + 1; x++) setBurning(x, cy);
    let out = -1;
    for (let s = 0; s < 9000; s++) { simStep(); if (s % 20 === 0 && countBurning() === 0 && countType(FIRE) === 0) { out = s; break; } }
    return { out, fuelLeft: countType(WOOD) + countType(CHARCOAL) };
  };
  const a = run(true), b = run(false);
  return { ok: a.out > 0 && a.fuelLeft >= 4 && b.fuelLeft <= 2,
           info: '密闭：' + a.out + ' 步熄灭，剩 ' + a.fuelLeft + ' 格木/炭；敞口对照：烧到剩 ' + b.fuelLeft + ' 格' };
});

defTest('燃料不会再生；所有可燃物都会烧完，火必然熄灭', () => {
  let { cx, cy } = tArena();
  tFloor(cy + 3, STONE);
  const i = cx + (cy + 2) * W;
  put(i, WOOD, cx, cy + 2);
  const f0 = fuel[i];
  setBurning(cx, cy + 2);
  runSteps(40);
  const f1 = fuel[i];
  for (let s = 0; s < 12; s++) {                         // 三面持续浇水
    for (const j of [i + 1, i - 1, i - W]) if (type[j] === 0 || type[j] === STEAM) put(j, WATER, j % W, (j / W) | 0);
    simStep();
  }
  const doused = !(flags[i] & F_BURN);
  for (let k = 0; k < N; k++) if (type[k] === WATER || type[k] === STEAM) clearCell(k, k % W, (k / W) | 0);   // 把水全部拿走、晾干
  wet[i] = 0;
  let relit = false;
  for (let s = 0; s < 12 && !relit; s++) { temp[i] = 500; wet[i] = 0; simStep(); relit = !!(flags[i] & F_BURN); }
  const f2 = fuel[i];
  // 一堆各种可燃物
  ({ cx, cy } = tArena());
  tFloor(cy + 20, STONE);
  fillRect(WOOD, cx - 20, cy + 14, cx - 8, cy + 19);
  fillRect(DEADPLANT, cx - 7, cy + 14, cx, cy + 19);
  fillRect(PLANT, cx + 1, cy + 12, cx + 8, cy + 19);
  fillRect(ROPE, cx + 9, cy + 10, cx + 9, cy + 19);
  fillRect(CHARCOAL, cx + 10, cy + 16, cx + 16, cy + 19);
  fillRect(SEED, cx - 20, cy + 11, cx - 10, cy + 13);
  for (let x = cx - 20; x <= cx + 16; x += 2) setBurning(x, cy + 13 + (x < cx - 8 ? 1 : 0));
  setBurning(cx - 7, cy + 14); setBurning(cx + 1, cy + 12); setBurning(cx + 9, cy + 10); setBurning(cx + 10, cy + 16);
  const n = tUntil(40000, 50, () => countBurning() === 0 && countType(FIRE) === 0 && countType(EMBER) === 0);
  const left = countType(WOOD) + countType(DEADPLANT) + countType(PLANT) + countType(ROPE) + countType(CHARCOAL) + countType(SEED);
  return { ok: f1 < f0 && doused && relit && f2 <= f1 && n > 0,
           info: '燃料 ' + f0 + ' → 烧 40 步剩 ' + f1 + ' → 浇灭再点燃后 ' + f2 + '；混合可燃物 ' + n + ' 步后火全灭，剩 ' + left + ' 格没烧到' };
});

defTest('油火遇水不灭，被汽化的水崩开；熔岩入水先结壳', () => {
  let { cx, cy } = tArena();
  tBox(cx - 12, cy, cx + 12, cy + 8, STONE);
  fillRect(EMPTY, cx - 11, cy, cx + 11, cy);
  fillRect(OIL, cx - 11, cy + 5, cx + 11, cy + 7);
  for (let x = cx - 11; x <= cx + 11; x++) setBurning(x, cy + 5);
  runSteps(20);
  fillRect(WATER, cx - 4, cy - 12, cx + 4, cy - 9);
  let flying = 0, burnAfter = 0;
  for (let s = 0; s < 90; s++) {
    simStep();
    for (let k = 0; k < FP_MAX; k++) if (fpAlive[k] && fpType[k] === OIL) { flying++; break; }
    if (s === 60) burnAfter = countBurning();
  }
  ({ cx, cy } = tArena());
  tBox(cx - 14, cy, cx + 14, cy + 16, GLASS);
  fillRect(EMPTY, cx - 13, cy, cx + 13, cy);
  fillRect(WATER, cx - 13, cy + 4, cx + 13, cy + 15);
  fillRect(LAVA, cx - 3, cy - 14, cx + 3, cy - 8);
  let both = 0, steam = 0;
  for (let s = 0; s < 400; s++) {
    simStep();
    if (countType(LAVA) > 5 && countType(STONE) > 0) both++;
    steam = Math.max(steam, countType(STEAM));
  }
  const n = tUntil(8000, 20, () => countType(LAVA) === 0);
  return { ok: flying > 0 && burnAfter > 0 && both > 20 && steam > 0 && n > 0,
           info: '油：有 ' + flying + ' 步看到飞溅的火滴，泼水 60 步后仍有 ' + burnAfter + ' 格在烧；熔岩：硬壳与液态并存 ' + both + ' 步，最终全部凝固' };
});

/* ---- 植物 ---- */
defTest('植物：没水不长、没光不长', () => {
  const run = mode => {
    const { cx, cy } = tArena();
    tFloor(cy + 20, STONE);
    fillRect(SOIL, cx - 30, cy + 17, cx + 30, cy + 19);
    if (mode !== 'dry') soakSoil(150);
    if (mode === 'roof') fillRect(STONE, cx - 34, cy + 9, cx + 34, cy + 10);
    if (mode === 'night') { env.dayNight = true; env.time = 0; env.timeScale = 0; updateSun(); }
    for (let x = cx - 28; x <= cx + 28; x += 4) put(x + (cy + 16) * W, SEED, x, cy + 16);
    runSteps(4000);
    return countType(PLANT);
  };
  const dry = run('dry'), roof = run('roof'), night = run('night'), good = run('ok');
  return { ok: dry === 0 && roof === 0 && night === 0 && good > 20,
           info: '干土 ' + dry + ' 格，被挡住光 ' + roof + ' 格，夜里 ' + night + ' 格，有水有光 ' + good + ' 格' };
});

defTest('植物：有株高上限、生物量有上限、走完整个生命周期', () => {
  const { cx, cy } = tArena();
  const gy0 = Math.min(H - 6, cy + 40);
  tFloor(gy0 + 3, STONE);
  fillRect(SOIL, cx - 40, gy0, cx + 40, gy0 + 2);
  for (let x = cx - 36; x <= cx + 36; x += 6) put(x + (gy0 - 1) * W, SEED, x, gy0 - 1);
  let maxPlant = 0, maxH = 0, sawFlower = false, sawSeed = false, sawDead = false, sawSoilFromDead = false;
  const hist = [];
  const soil0 = countType(SOIL);
  for (let round = 0; round < 160; round++) {
    soakSoil(150);                                       // 持续灌溉（外部输入）
    runSteps(600);
    const p = countType(PLANT);
    hist.push(p);
    if (p > maxPlant) maxPlant = p;
    // 每一格植物离它脚下地面的高度（地面会因为枯枝腐烂成土而慢慢抬高，所以不能按最初的地面量）
    for (let y = 0; y < gy0; y++) for (let x = cx - 44; x <= cx + 44; x++) if (type[x + y * W] === PLANT) { const h = stemHeight(x, y) + 1; if (h > maxH) maxH = h; }
    if (countType(FLOWER) > 0) sawFlower = true;
    if (round > 3 && countType(SEED) > 0) sawSeed = true;
    if (countType(DEADPLANT) > 0) sawDead = true;
    if (countType(SOIL) > soil0) sawSoilFromDead = true;
  }
  const tail = hist.slice(-20), tailMax = Math.max.apply(null, tail), tailMin = Math.min.apply(null, tail);
  const area = 81 * 40;
  const ok = maxH >= 8 && maxH <= 36 && maxPlant < area * 0.5 && sawFlower && sawSeed && sawDead && sawSoilFromDead && tailMax <= maxPlant;
  return { ok, info: '最高 ' + maxH + ' 格（基因上限 32），生物量峰值 ' + maxPlant + ' 格（区域 ' + area + ' 格），末段在 ' + tailMin + '~' + tailMax +
                     ' 之间；开花 ' + sawFlower + '，落种 ' + sawSeed + '，枯萎 ' + sawDead + '，腐烂成土 ' + sawSoilFromDead };
});

/* ---- 水循环 ---- */
defTest('连续循环：冰 → 水 → 蒸汽 → 云 → 雨，水量守恒（误差 ≤ 5%）', () => {
  const { cx, cy } = tArena();
  const by = Math.min(H - 4, cy + 40);
  fillRect(METAL, cx - 10, by, cx + 10, by + 1);
  for (let y = by - 12; y < by; y++) { put(cx - 10 + y * W, GLASS, cx - 10, y); put(cx + 10 + y * W, GLASS, cx + 10, y); }
  fillRect(ICE, cx - 6, by - 6, cx + 6, by - 1);
  const w0 = totalWater();
  const seen = { ice: true, water: false, steam: false, cloud: false, rain: false };
  for (let s = 0; s < 2400; s++) {                       // 阶段一：底下的金属板持续加热
    for (let x = cx - 10; x <= cx + 10; x++) temp[x + by * W] = 420;
    simStep();
    if (s % 10 === 0) { if (countType(WATER) > 0) seen.water = true; if (countType(STEAM) > 0) seen.steam = true; }
  }
  for (let x = cx - 10; x <= cx + 10; x++) for (let y = by; y <= by + 1; y++) temp[x + y * W] = 20;
  for (let s = 0; s < 12000 && !(seen.rain && seen.cloud && env.rainCount > 15); s++) {   // 阶段二：停火，等云和雨
    simStep();
    if (s % 20 === 0) { if (sumCloud() > 0.5) seen.cloud = true; if (env.rainCount > 0) seen.rain = true; }
  }
  const w1 = totalWater(), err = Math.abs(w1 - w0) / w0;
  const ok = seen.water && seen.steam && seen.cloud && seen.rain && err <= 0.05;
  return { ok, info: '出现过：水 ' + seen.water + '、蒸汽 ' + seen.steam + '、云 ' + seen.cloud + '、雨 ' + seen.rain + '（' + env.rainCount + ' 滴）；水量 ' +
                     w0.toFixed(1) + ' → ' + w1.toFixed(1) + '，误差 ' + (err * 100).toFixed(2) + '%' };
});

defTest('水会被土吸收、会蒸发，账面守恒；云由蒸发的水汽自然形成并下雨', () => {
  const { cx, cy } = tArena();
  const by = Math.min(H - 4, cy + 40);
  tFloor(by + 1, STONE);
  fillRect(SOIL, cx - 60, by - 3, cx - 20, by);
  fillRect(STONE, cx - 19, by - 6, cx - 18, by);
  fillRect(STONE, cx + 70, by - 6, cx + 71, by);
  fillRect(WATER, cx - 17, by - 4, cx + 69, by);
  fillRect(WATER, cx - 60, by - 6, cx - 21, by - 4);
  const w0 = totalWater();
  runSteps(600);
  let wetSum = 0;
  for (let i = 0; i < N; i++) if (type[i] === SOIL) wetSum += wet[i];
  const n = tUntil(60000, 100, () => env.rainCount > 3);
  const w1 = totalWater(), err = Math.abs(w1 - w0) / w0;
  return { ok: wetSum > 2000 && n > 0 && env.waterIn === 0 && err <= 0.05,
           info: '土吸了 ' + (wetSum / 100).toFixed(0) + ' 格水；没有任何外来水汽，' + n + ' 步后云里落下 ' + env.rainCount + ' 滴雨；水量 ' +
                 w0.toFixed(0) + ' → ' + w1.toFixed(0) + '，误差 ' + (err * 100).toFixed(2) + '%' };
});

/* ---- 粒子精细度 ---- */
defTest('沉降看密度和粘度：沙在水里比在油里沉得快，灰浮在水面', () => {
  const sink = liquid => {
    const { cx, cy } = tArena();
    tBox(cx - 2, cy - 30, cx + 2, cy + 30, GLASS);
    fillRect(liquid, cx - 1, cy - 28, cx + 1, cy + 29);
    put(cx + (cy - 29) * W, SAND, cx, cy - 29);
    return tUntil(4000, 1, () => { const c = centroid(SAND); return c && c.y >= cy + 28; });
  };
  const inWater = sink(WATER), inOil = sink(OIL);
  const { cx, cy } = tArena();
  tBox(cx - 6, cy - 6, cx + 6, cy + 10, GLASS);
  fillRect(EMPTY, cx - 5, cy - 6, cx + 5, cy - 6);
  fillRect(WATER, cx - 5, cy, cx + 5, cy + 9);
  fillRect(ASH, cx - 3, cy - 4, cx + 3, cy - 3);
  runSteps(500);
  const ash = centroid(ASH);
  return { ok: inWater > 0 && inOil > inWater * 1.5 && ash && ash.y < cy + 2,
           info: '沙沉 57 格：水里 ' + inWater + ' 步，油里 ' + inOil + ' 步；灰的重心在水面以上 ' + (cy - ash.y).toFixed(1) + ' 格' };
});

defTest('休止角各不相同：土比沙堆得陡，湿沙能立住', () => {
  const pile = (t, wetness) => {
    const { cx, cy } = tArena();
    const fy = Math.min(H - 3, cy + 40);
    tFloor(fy, STONE);
    for (let y = fy - 60; y < fy - 10; y++) for (let x = cx - 3; x <= cx + 3; x++) { const i = x + y * W; put(i, t, x, y); wet[i] = wetness; }
    runSteps(900);
    let top = fy, l = W, r = 0;
    for (let y = 0; y < fy; y++) for (let x = 0; x < W; x++) if (type[x + y * W] === t) { if (y < top) top = y; if (x < l) l = x; if (x > r) r = x; }
    return { h: fy - top, w: r - l + 1 };
  };
  const sand = pile(SAND, 0), soil = pile(SOIL, 0), wetSand = pile(SAND, 110);
  const rs = sand.w / sand.h, ro = soil.w / soil.h, rw = wetSand.w / wetSand.h;
  return { ok: ro < rs * 0.8 && rw < rs * 0.45 && wetSand.h > sand.h * 1.6,
           info: '宽/高：沙 ' + rs.toFixed(2) + '，土 ' + ro.toFixed(2) + '，湿沙 ' + rw.toFixed(2) + '（湿沙堆高 ' + wetSand.h + ' 格，干沙 ' + sand.h + ' 格）' };
});

defTest('惯性与飞溅：重物砸进水里溅起水花和涟漪，水砸水起泡沫，气泡会浮上来', () => {
  let { cx, cy } = tArena();
  const by = Math.min(H - 3, cy + 30);
  tBox(cx - 30, by - 20, cx + 30, by, GLASS);
  fillRect(EMPTY, cx - 29, by - 20, cx + 29, by - 20);
  fillRect(WATER, cx - 29, by - 12, cx + 29, by - 1);
  runSteps(20);
  const r0 = rippleHead;
  fillRect(SAND, cx - 2, by - 70, cx + 2, by - 60);
  let waterFlying = 0, maxUp = 0, ripples = 0;
  for (let s = 0; s < 120; s++) {
    simStep();
    for (let k = 0; k < FP_MAX; k++) if (fpAlive[k] && fpType[k] === WATER) { waterFlying++; maxUp = Math.max(maxUp, (by - 12) - fpY[k]); }
    if (rippleHead !== r0) ripples++;
  }
  fillRect(WATER, cx + 14, by - 70, cx + 18, by - 55);
  let foam = 0;
  for (let s = 0; s < 120; s++) { simStep(); foam = Math.max(foam, countType(FOAM)); }
  runSteps(300);
  const foamGone = countType(FOAM);
  // 气泡
  ({ cx, cy } = tArena());
  tBox(cx - 6, cy - 20, cx + 6, cy + 10, GLASS);
  fillRect(EMPTY, cx - 5, cy - 20, cx + 5, cy - 20);
  fillRect(WATER, cx - 5, cy - 8, cx + 5, cy + 9);
  for (let x = cx - 1; x <= cx + 1; x++) { const i = x + (cy + 9) * W; put(i, SMOKE, x, cy + 9); life[i] = 400; }
  const up = tUntil(600, 1, () => { const c = centroid(SMOKE); return c && c.y < cy - 9; });
  return { ok: waterFlying > 0 && maxUp > 2 && ripples > 0 && foam > 0 && foamGone < foam && up > 0,
           info: '水花粒子出现 ' + waterFlying + ' 次，最高溅起 ' + maxUp.toFixed(1) + ' 格；涟漪事件 ' + (ripples > 0) + '；泡沫峰值 ' + foam + ' → ' + foamGone +
                 '；气泡 ' + up + ' 步浮出水面' };
});

/* ---- 结构力学 ---- */
defTest('结构：悬空的固体会掉下来落到地面；连着锚点的不掉', () => {
  const { cx, cy } = tArena();
  env.structure = true;
  const fy = Math.min(H - 3, cy + 40);
  tFloor(fy, STONE);
  for (let x = 0; x < W; x += 30) put(x + (fy + 1) * W, ANCHOR, x, fy + 1);
  fillRect(METAL, cx - 30, cy - 10, cx - 23, cy - 5);          // 金属块摔不碎，方便数格子
  fillRect(STONE, cx + 20, cy - 10, cx + 27, cy - 5);
  put(cx + 28 + (cy - 8) * W, ANCHOR, cx + 28, cy - 8);
  const n0 = countType(METAL, cx - 30, cy - 10, cx - 23, cy - 5);
  let sawBody = false;
  for (let s = 0; s < 400; s++) { simStep(); if (bodyCount > 0) sawBody = true; }
  const leftGone = countType(METAL, cx - 30, cy - 10, cx - 23, cy - 5) === 0;
  const landed = countType(METAL, cx - 40, fy - 12, cx - 14, fy - 1);
  const rightStays = countType(STONE, cx + 20, cy - 10, cx + 27, cy - 5) === 48;
  return { ok: sawBody && leftGone && landed >= n0 * 0.95 && rightStays && bodyCount === 0,
           info: '悬空金属块' + (leftGone ? '掉下' : '没掉') + '，地面附近找到 ' + landed + '/' + n0 + ' 格；带锚点的' + (rightStays ? '纹丝不动' : '也掉了') + '；最后刚体数 ' + bodyCount };
});

defTest('结构：绳子吊得住重物，烧断后重物掉落', () => {
  const { cx, cy } = tArena();
  env.structure = true;
  const fy = Math.min(H - 3, cy + 40);
  tFloor(fy, STONE);
  for (let x = 0; x < W; x += 30) put(x + (fy + 1) * W, ANCHOR, x, fy + 1);
  put(cx + (cy - 30) * W, ANCHOR, cx, cy - 30);
  fillRect(ROPE, cx, cy - 29, cx, cy - 12);
  fillRect(STONE, cx - 3, cy - 11, cx + 3, cy - 6);
  runSteps(300);
  const hangs = countType(STONE, cx - 3, cy - 11, cx + 3, cy - 6) === 42 && bodyCount === 0;
  setBurning(cx, cy - 20); setBurning(cx, cy - 21);
  runSteps(500);
  const fell = countType(STONE, cx - 3, cy - 11, cx + 3, cy - 6) === 0 && countType(STONE, cx - 12, fy - 12, cx + 12, fy - 1) >= 30;
  return { ok: hangs && fell, info: '挂了 300 步' + (hangs ? '没掉' : '掉了') + '；绳子烧断后' + (fell ? '重物落地' : '重物没落下') };
});

defTest('结构：玻璃一摔就碎，木头浮在水上，烧红的金属撑不住', () => {
  let { cx, cy } = tArena();
  env.structure = true;
  let fy = Math.min(H - 3, cy + 40);
  tFloor(fy, STONE);
  for (let x = 0; x < W; x += 30) put(x + (fy + 1) * W, ANCHOR, x, fy + 1);
  fillRect(GLASS, cx - 8, cy - 30, cx + 8, cy - 27);
  const f0 = structStats.fractured;
  let flying = 0;
  for (let s = 0; s < 300; s++) { simStep(); let g = 0; for (let k = 0; k < FP_MAX; k++) if (fpAlive[k] && fpType[k] === GLASS) g++; flying = Math.max(flying, g); }
  const shattered = structStats.fractured > f0 && flying > 10;
  // 木头入水
  ({ cx, cy } = tArena());
  env.structure = true;
  fy = Math.min(H - 3, cy + 40);
  tBox(cx - 20, fy - 34, cx + 20, fy, STONE);
  fillRect(EMPTY, cx - 19, fy - 34, cx + 19, fy - 34);
  for (let x = cx - 20; x <= cx + 20; x += 8) put(x + fy * W, ANCHOR, x, fy);
  put(cx - 20 + (fy - 20) * W, ANCHOR, cx - 20, fy - 20); put(cx + 20 + (fy - 20) * W, ANCHOR, cx + 20, fy - 20);
  fillRect(WATER, cx - 19, fy - 22, cx + 19, fy - 1);
  fillRect(WOOD, cx - 10, fy - 50, cx - 3, fy - 47);
  fillRect(STONE, cx + 3, fy - 50, cx + 10, fy - 47);
  runSteps(900);
  const wood = centroid(WOOD), stone = centroid(STONE, 0);
  let sy = 0, sn = 0;
  for (let y = fy - 33; y < fy; y++) for (let x = cx - 19; x <= cx + 19; x++) if (type[x + y * W] === STONE) { sy += y; sn++; }
  const floats = wood && wood.y < fy - 14 && sn > 0 && sy / sn > fy - 8;
  // 金属悬臂梁中间烧红
  ({ cx, cy } = tArena());
  env.structure = true;
  fy = Math.min(H - 3, cy + 40);
  tFloor(fy, STONE);
  for (let x = 0; x < W; x += 30) put(x + (fy + 1) * W, ANCHOR, x, fy + 1);
  fillRect(ANCHOR, cx - 20, cy - 2, cx - 19, cy + 1);
  fillRect(METAL, cx - 18, cy, cx + 10, cy + 1);
  runSteps(100);
  const holds = countType(METAL, cx - 18, cy, cx + 10, cy + 1) === 58;
  for (let s = 0; s < 200; s++) { for (let x = cx - 10; x <= cx - 8; x++) for (let y = cy; y <= cy + 1; y++) { temp[x + y * W] = 1100; wake(x, y); } simStep(); }
  const sagged = countType(METAL, cx - 4, cy, cx + 10, cy + 1) === 0;
  return { ok: shattered && floats && holds && sagged,
           info: '玻璃板落地' + (shattered ? '碎成 ' + flying + ' 片' : '没碎') + '；木头重心离池底 ' + (wood ? (fy - wood.y).toFixed(0) : '?') + ' 格（水深 22），石头' +
                 (floats ? '沉底' : '没沉底') + '；金属梁常温' + (holds ? '稳住' : '掉了') + '，烧到 1100°C 后' + (sagged ? '前端掉落' : '没掉') };
});

defTest('爆破拆除：柱脚炸断后整栋楼塌下来，碎块互相撞击、碎裂', () => {
  tArena();
  env.structure = true;
  const b = buildDemolition(true);
  // 屋顶线：从上往下第一行「建筑宽度里有三成以上是静止的刚性格」的位置。塌了之后它至少要下降六成层高（碎块堆起来比原来蓬松）
  const width = b.x1 - b.x0 + 1;
  const roofLine = () => {
    for (let y = 0; y < H; y++) { let n = 0; for (let x = b.x0; x <= b.x1; x++) if (M_RIGID[type[x + y * W]] && !(flags[x + y * W] & F_BODY)) n++; if (n >= width * 0.3) return y; }
    return H;
  };
  const top0 = roofLine();
  const made0 = structStats.made, frac0 = structStats.fractured;
  let maxBodies = 0, booms = 0, dust = 0;
  for (let s = 0; s < 3000; s++) {
    st.boom = 0;
    simStep();
    booms += st.boom;
    if (bodyCount > maxBodies) maxBodies = bodyCount;
    if (s % 20 === 0) dust = Math.max(dust, countType(SMOKE));
  }
  const drop = roofLine() - top0;
  const ok = booms >= 10 && drop >= b.sh * 0.6 && structStats.made - made0 >= 4 && structStats.fractured - frac0 >= 3 && maxBodies >= 3 && bodyCount === 0;
  return { ok, info: booms + ' 次爆炸；屋顶线下降了 ' + drop + ' 格（一层楼高 ' + b.sh + ' 格，整栋 ' + b.storeys + ' 层）；先后生成 ' + (structStats.made - made0) + ' 个刚体（同时最多 ' + maxBodies +
                     ' 个），碎裂 ' + (structStats.fractured - frac0) + ' 次，烟尘峰值 ' + dust + ' 格，最后还在动的刚体 ' + bodyCount + ' 个' };
});

/* ---- 天气 ---- */
defTest('风：烟、雨滴、灰都被吹向下风方向；大火把两侧空气往里吸', () => {
  const drift = (t, dir) => {
    const { cx, cy } = tArena();
    env.wind = dir; env.windPower = 1;
    runSteps(120);
    for (let y = cy - 20; y < cy - 14; y++) for (let x = cx - 2; x <= cx + 2; x++) { const i = x + y * W; put(i, t, x, y); if (t === SMOKE) life[i] = 400; }
    if (t === ASH || t === WATER) for (let x = 0; x < W; x++) put(x + (H - 2) * W, STONE, x, H - 2);
    runSteps(t === SMOKE ? 20 : 45);
    const c = centroid(t);
    return c ? c.x - cx : 0;
  };
  const sR = drift(SMOKE, 1), sL = drift(SMOKE, -1), wR = drift(WATER, 1), aR = drift(ASH, 1), calm = drift(ASH, 0);
  // 火旋风：一大片火，量它两侧的风向
  const { cx, cy } = tArena();
  env.wind = 0; env.windPower = 0;
  for (let s = 0; s < 400; s++) { for (let y = cy; y < cy + 16; y++) for (let x = cx - 12; x <= cx + 12; x++) temp[x + y * W] = 800; simStep(); }
  const row = (cy + 8) >> 3;
  const left = windX[((cx - 18) >> 3) + row * GW], right = windX[((cx + 18) >> 3) + row * GW];
  return { ok: sR > 2 && sL < -2 && wR > 1 && aR > 2 && Math.abs(calm) < 3 && left > 0.05 && right < -0.05,
           info: '向右的风：烟 ' + sR.toFixed(1) + '，雨 ' + wR.toFixed(1) + '，灰 ' + aR.toFixed(1) + ' 格；向左的风：烟 ' + sL.toFixed(1) + '；无风时灰偏 ' + calm.toFixed(1) +
                 '；火堆左侧风 ' + left.toFixed(2) + '（向右），右侧风 ' + right.toFixed(2) + '（向左）' };
});

defTest('降水：下雨打湿地面；气温低于零度下雪并堆积，回暖后融化', () => {
  let { cx, cy } = tArena();
  fillRect(SOIL, 0, H - 6, W - 1, H - 1);
  setWeather('rain'); env.windPower = 0.2; env.wind = 0.3;
  runSteps(6000);
  const rain = env.rainCount, clouds = sumCloud();
  let wetSoil = 0;
  for (let i = 0; i < N; i++) if (type[i] === SOIL && wet[i] > 20) wetSoil++;
  ({ cx, cy } = tArena());
  fillRect(STONE, 0, H - 3, W - 1, H - 1);
  setWeather('snow'); updateSun(); temp.fill(env.temp);
  runSteps(7000);
  const snowFall = env.snowCount, snowPile = countType(SNOW);
  setWeather('clear'); env.cloudFade = 0.05; env.temp = 20; updateSun();
  const melted = tUntil(20000, 50, () => countType(SNOW) === 0);
  return { ok: rain > 20 && clouds > 1 && wetSoil > 30 && snowFall > 20 && snowPile > 10 && melted > 0 && countType(WATER) + countType(ICE) >= 0,
           info: '雨：' + rain + ' 滴，云量 ' + clouds.toFixed(1) + '，打湿 ' + wetSoil + ' 格土；雪：下了 ' + snowFall + ' 片，积雪 ' + snowPile + ' 格，回暖 ' + melted + ' 步后化完' };
});

defTest('闪电：优先劈最高点和导体，劈中会点燃树；雷声延迟随距离增加', () => {
  const trial = (leftMat, leftH, rightMat, rightH) => {
    const { cx } = tArena();
    fillRect(STONE, 0, H - 3, W - 1, H - 1);
    fillRect(leftMat, cx - 12, H - 3 - leftH, cx - 11, H - 4);
    fillRect(rightMat, cx + 11, H - 3 - rightH, cx + 12, H - 4);
    for (let c = 0; c < GW; c++) cloud[c + GW] = Math.abs((c << 3) - cx) < 12 ? 2 : 0;
    let l = 0, r = 0;
    for (let k = 0; k < 40; k++) {
      lightning();
      if (lastBolt.x < cx - 6) l++; else if (lastBolt.x > cx + 6) r++;
      for (let i = 0; i < N; i++) if (type[i] === SPARK) clearCell(i, i % W, (i / W) | 0);
      charge.fill(0); elecCount = 0;
    }
    return [l, r];
  };
  const metal = trial(METAL, 30, STONE, 30), tall = trial(STONE, 20, STONE, 48);
  // 劈树
  const { cx } = tArena();
  fillRect(SOIL, 0, H - 6, W - 1, H - 1);
  drawTree(cx, H - 6, 30, 8);
  for (let i = 0; i < N; i++) wet[i] = 0;
  for (let c = 0; c < GW; c++) cloud[c + GW] = 2;
  let burned = false;
  for (let k = 0; k < 6 && !burned; k++) { lightning(cx); runSteps(40); if (countBurning() > 0) burned = true; }
  const near = thunderDelay(W / 2, H - 10), far = thunderDelay(4, 10);
  return { ok: metal[0] > metal[1] * 3 && tall[1] > tall[0] * 3 && burned && far > near + 0.5 && env.strikes > 0,
           info: '等高的金属杆 / 石柱：' + metal[0] + ' : ' + metal[1] + '；矮石柱 / 高石柱：' + tall[0] + ' : ' + tall[1] + '；树' + (burned ? '被劈着了' : '没着') +
                 '；雷声延迟 近 ' + near.toFixed(2) + 's，远 ' + far.toFixed(2) + 's' };
});

defTest('昼夜：夜里更冷、蒸发更慢；时间流速可调', () => {
  const evap = time => {
    const { cx, cy } = tArena();
    env.dayNight = true; env.time = time; env.timeScale = 0; updateSun();
    fillRect(STONE, 0, H - 3, W - 1, H - 1);
    fillRect(WATER, 2, H - 8, W - 3, H - 4);
    const n0 = countType(WATER);
    runSteps(6000);
    return { lost: n0 - countType(WATER), amb: env.ambient, sun: env.sun };
  };
  const day = evap(0.5), night = evap(0);
  tArena();
  env.dayNight = true; env.time = 0.5; env.timeScale = 60;
  runSteps(DAY_STEPS / 60 / 2);
  const half = env.time;
  return { ok: day.amb > night.amb + 4 && day.sun === 1 && night.sun === 0 && day.lost > night.lost * 2 && day.lost > 5 && Math.abs(half - 0) < 0.02 || Math.abs(half - 1) < 0.02,
           info: '正午 ' + day.amb.toFixed(0) + '°C，蒸发 ' + day.lost + ' 格；午夜 ' + night.amb.toFixed(0) + '°C，蒸发 ' + night.lost + ' 格；60 倍速下半天后时间 = ' + half.toFixed(2) };
});

/* ---- 四个重力方向 × 每一种材料 ---- */
(function gravityMatrix() {
  const DIRS = ['down', 'up', 'left', 'right'];
  const expectOf = t => {
    const m = MATERIALS[t];
    if (m.hardness > 1) return 'fixed';
    if (t === SPARK || t === FLOWER) return 'stay';
    if (t === FOAM) return 'fall';
    if (m.state === S_GAS) return 'rise';
    return 'fall';                       // 粉末、液体、失去支撑的刚性固体、孤立的植物
  };
  for (let t = 1; t < NT; t++) {
    defTest('重力四向：' + MATERIALS[t].name, () => {
      const exp = expectOf(t), notes = [];
      let ok = true;
      for (const dir of DIRS) {
        tArena();
        env.structure = true;
        setGravity(dir);
        const cx = W >> 1, cy = H >> 1;
        const single = t === PLANT || M_STATE[t] === S_GAS || t === SPARK;
        const r = single ? 0 : 1;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx, y = cy + dy, i = x + y * W;
          put(i, t, x, y);
          if (M_LIFE0[t]) life[i] = 200;
          if (t === ICE || t === SNOW) temp[i] = -30;
        }
        if (t === ICE || t === SNOW) { env.temp = -10; updateSun(); temp.fill(-10); }
        let along = 0, found = false;
        const steps = exp === 'rise' ? 14 : t === LAVA ? 40 : 70;      // 熔岩小液滴在空气里飞久了会冷凝成石头，所以量得早一点
        for (let s = 0; s < steps; s++) simStep();
        let sx = 0, sy = 0, n = 0;
        for (let i = 0; i < N; i++) if (type[i] === t) { sx += i % W; sy += (i / W) | 0; n++; }
        for (let k = 0; k < FP_MAX; k++) if (fpAlive[k] && fpType[k] === t) { sx += fpX[k]; sy += fpY[k]; n++; }
        if (n > 0) { found = true; along = (sx / n - cx) * gx + (sy / n - cy) * gy; }
        let pass;
        if (exp === 'fixed') pass = found && Math.abs(along) < 0.01;
        else if (exp === 'stay') pass = !found || Math.abs(along) < 4;
        else if (exp === 'rise') pass = !found || along < -2;
        else pass = found && along > 3;
        if (!pass) ok = false;
        notes.push(dir + ' ' + (found ? along.toFixed(1) : '消失'));
      }
      setGravity('down');
      const label = { fixed: '应当不动', stay: '不受重力', rise: '应当逆着重力', fall: '应当顺着重力' }[exp];
      return { ok, info: label + '；沿重力方向位移：' + notes.join('，') };
    });
  }
})();

/* =====================================================================
 * 6c. 长时间稳定性测试（soak）：每个预设跑 10 分钟模拟时间（36000 步），每 10 秒记一次
 * ===================================================================== */
const SOAK_TRANSIENT = [FIRE, SMOKE, STEAM, EMBER, SPARK, FOAM];
const SOAK_MATS = [WATER, PLANT, DEADPLANT, WOOD, CHARCOAL, ASH, SOIL, LAVA, STONE, SEED, FLOWER, SNOW, ICE, SMOKE, STEAM];

function soakSample() {
  const cnt = new Uint32Array(NT);
  let tsum = 0, n = 0, burning = 0;
  for (let i = 0; i < N; i++) {
    const t = type[i];
    if (t === 0) continue;
    cnt[t]++; n++; tsum += temp[i];
    if (flags[i] & F_BURN) burning++;
  }
  return { cnt, total: n, avgT: n ? tsum / n : 0, burning, fire: cnt[FIRE], chunks: perf.activeChunks, bodies: bodyCount, free: fpCount,
           cloud: sumCloud(), heap: (typeof process !== 'undefined' && process.memoryUsage) ? process.memoryUsage().heapUsed / 1048576
                 : (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0) };
}

// 同步跑一个场景；onSample(k, sample) 每 10 秒模拟时间回调一次。返回结论。
function soakScene(k, steps, onSample) {
  seedRng(1000 + k);
  buildScene(k);
  const samples = [soakSample()];
  for (let s = 1; s <= steps; s++) {
    simStep();
    if (s % 600 === 0) { const sm = soakSample(); samples.push(sm); if (onSample) onSample(s / 600, sm); }
  }
  return soakVerdict(k, samples);
}

function soakVerdict(k, samples) {
  const first = samples[0], last = samples[samples.length - 1], n = samples.length;
  const late = samples.slice(Math.floor(n * 0.75)), mid = samples.slice(Math.floor(n * 0.5), Math.floor(n * 0.75));
  const avg = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
  // 「无限增长」判定：最后四分之一的平均值比前一个四分之一还高出 15% 以上，且绝对增量不小
  const growing = [];
  for (const t of SOAK_MATS) {
    const a = avg(mid, s => s.cnt[t]), b = avg(late, s => s.cnt[t]);
    if (b > a * 1.15 && b - a > 150) growing.push(MATERIALS[t].name + ' ' + Math.round(a) + '→' + Math.round(b));
  }
  const totalA = avg(mid, s => s.total), totalB = avg(late, s => s.total);
  if (totalB > totalA * 1.1 && totalB - totalA > 400) growing.push('总量 ' + Math.round(totalA) + '→' + Math.round(totalB));
  const peakChunks = samples.reduce((m, s) => Math.max(m, s.chunks), 0);
  const peakBurn = samples.reduce((m, s) => Math.max(m, s.burning + s.fire), 0);
  const heapGrowth = avg(late, s => s.heap) - avg(samples.slice(1, Math.max(2, Math.floor(n * 0.25))), s => s.heap);
  // v4.1 判定：最后 2 分钟（最后 13 个采样点，相隔 10 秒）里，每种材料首尾数量的变化 < 2%。
  // 数量很少的材料允许 ±2 格的抖动；火、烟、蒸汽、余烬、电火花、泡沫这类转瞬即逝的东西只记录不判定。
  const win = samples.slice(Math.max(0, n - 13));
  const unstable = [], drift = {};
  for (let t = 1; t < NT; t++) {
    if (SOAK_TRANSIENT.indexOf(t) >= 0) continue;
    const a = win[0].cnt[t], b = win[win.length - 1].cnt[t];
    const mean = win.reduce((s, x) => s + x.cnt[t], 0) / win.length;
    if (mean === 0) continue;
    const d = Math.abs(b - a), pct = d / mean;
    drift[MATERIALS[t].name] = +(pct * 100).toFixed(2);
    if (pct >= 0.02 && d > 2) unstable.push(MATERIALS[t].name + ' ' + a + '→' + b + '（' + (pct * 100).toFixed(1) + '%）');
  }
  return { name: SCENES[k].name, first, last, samples, growing, peakChunks, peakBurn, heapGrowth, unstable, drift,
           lateChunks: avg(late, s => s.chunks), lateBurn: avg(late, s => s.burning + s.fire) };
}
