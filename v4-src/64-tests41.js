
/* =====================================================================
 * 6e. v4.1 新增用例：平衡、确定性、存档完整性、风影、刚体炸药、增量支撑
 * ===================================================================== */
function groupCentroidX(t, xFrom, xTo) {
  let s = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = Math.max(0, xFrom); x <= Math.min(W - 1, xTo); x++) if (type[x + y * W] === t) { s += x; n++; }
  return n ? s / n : NaN;
}

defTest('风影：墙后面的烟飘得明显比开阔地慢', () => {
  const { cx, cy } = tArena();
  env.wind = 1; env.windPower = 1;
  fillRect(STONE, cx - 3, cy - 24, cx + 4, H - 1);           // 一堵 8 格厚、比烟高的墙
  runSteps(200);                                             // 让粗网格的固体比例和风场都稳定下来
  const put5 = x0 => { for (let y = cy - 4; y <= cy + 4; y++) for (let x = x0; x < x0 + 3; x++) { const i = x + y * W; put(i, SMOKE, x, y); life[i] = 600; } };
  put5(cx - 70); put5(cx + 8);
  const open0 = groupCentroidX(SMOKE, 0, cx - 4), lee0 = groupCentroidX(SMOKE, cx + 5, W - 1);
  runSteps(40);
  const open1 = groupCentroidX(SMOKE, 0, cx - 4), lee1 = groupCentroidX(SMOKE, cx + 5, W - 1);
  const dOpen = open1 - open0, dLee = lee1 - lee0;
  const shade = windShade[((cx + 10) >> 3) + (cy >> 3) * GW];
  return { ok: dOpen > 4 && dLee < dOpen * 0.5, info: '40 步里开阔地的烟飘了 ' + dOpen.toFixed(1) + ' 格，墙后 ' + dLee.toFixed(1) + ' 格（墙后风影 ' + shade.toFixed(2) + '）' };
});

defTest('刚体里的炸药：下落途中被爆炸波及、被火点着，都会照样引爆', () => {
  const run = how => {
    const { cx, cy } = tArena();
    env.structure = true;
    const fy = Math.min(H - 3, cy + 45);
    tFloor(fy, STONE);
    for (let x = 0; x < W; x += 30) put(x + (fy + 1) * W, ANCHOR, x, fy + 1);
    fillRect(STONE, cx - 6, cy - 40, cx + 6, cy - 33);
    fillRect(TNT, cx - 1, cy - 37, cx + 1, cy - 36);
    if (how === 'fire') fillRect(TNT, cx + 7, cy - 37, cx + 7, cy - 36);   // 露在外面的一小块炸药，好让火碰到
    let booms = 0, inBody = 0, lit = false;
    const prev = onBoom;
    onBoom = () => { booms++; if (bodyCount > 0) inBody++; };
    for (let s = 0; s < 600; s++) {
      simStep();
      if (s === 6 && bodyCount > 0) {
        if (how === 'blast') startExplosion(cx - 12, cy - 33, 12, 0.8);
        else {
          let tx = -1, ty = -1;                               // 找到刚体里那块外露炸药现在的位置，在它旁边点火
          for (let i = 0; i < N; i++) if (type[i] === TNT && (flags[i] & F_BODY) && (i % W) > cx + 4) { tx = i % W; ty = (i / W) | 0; }
          if (tx >= 0) for (let dy = -1; dy <= 1; dy++) if (inb(tx + 1, ty + dy) && type[tx + 1 + (ty + dy) * W] === 0) put(tx + 1 + (ty + dy) * W, FIRE, tx + 1, ty + dy);
        }
      }
      for (let k = 0; k < BODY_MAX; k++) if (bodies[k] && bodies[k].fuses.length > 0) lit = true;
    }
    onBoom = prev;
    return { booms, inBody, lit, tnt: countType(TNT) };
  };
  const a = run('blast'), b = run('fire');
  return { ok: a.lit && a.booms >= 2 && b.lit && b.booms >= 1 && a.tnt === 0,
           info: '被爆炸波及：引信点着 ' + a.lit + '，共 ' + a.booms + ' 次爆炸（刚体还在时 ' + a.inBody + ' 次），剩余炸药 ' + a.tnt +
                 '；被火点着：引信点着 ' + b.lit + '，共 ' + b.booms + ' 次爆炸，剩余炸药 ' + b.tnt };
});

defTest('闪电从云的实际位置（云底）劈下来，不是从画面顶部', () => {
  const { cx, cy } = tArena();
  fillRect(STONE, 0, H - 3, W - 1, H - 1);
  const row = (cy >> 3) - 2;                                 // 云放在画面中间偏上，不在顶部
  for (let c = 0; c < GW; c++) { cloud[c + row * GW] = 2; cloud[c + (row + 1) * GW] = 2; }
  lightning();
  const sy = lastBolt.sy, expect = ((row + 1) << 3) + 7;
  return { ok: sy === expect && sy > 20, info: '云底在 y = ' + expect + '，闪电起点 y = ' + sy };
});

defTest('增量支撑检测：200 栋独立小楼，拆掉一栋只做局部搜索（< 1ms）', () => {
  tArena();
  env.structure = true;
  const rows = 10, cols = 20, hw = 4, hh = 5, gap = 2, shelfGap = hh + 4;
  let houses = 0;
  for (let r = 0; r < rows; r++) {
    const sy = H - 2 - r * shelfGap;
    if (sy - hh < 2) break;
    fillRect(STONE, 0, sy, W - 1, sy);                       // 一层隔板，两端钉锚点
    put(sy * W, ANCHOR, 0, sy); put(W - 1 + sy * W, ANCHOR, W - 1, sy);
    for (let c = 0; c < cols; c++) {
      const x0 = 2 + c * (hw + gap + 4);
      if (x0 + hw >= W - 1) break;
      fillRect(BRICK, x0, sy - hh, x0 + hw - 1, sy - 1);
      houses++;
    }
  }
  runSteps(30);
  const settled = bodyCount === 0;
  // 先拆一栋热身，再拆一栋计时：把楼的中间一层挖掉，上半截失去支撑
  const cut = (r, c) => { const sy = H - 2 - r * shelfGap, x0 = 2 + c * (hw + gap + 4); fillRect(EMPTY, x0, sy - 3, x0 + hw - 1, sy - 3); };
  cut(3, 5); structCooldown = 0; stepStructure();
  runSteps(10);
  cut(6, 11);
  const marked = sdCount;
  const t0 = performance.now();
  checkLocal();
  const ms = performance.now() - t0;
  const made = bodyCount;
  const t1 = performance.now();
  markStructAll(); checkStructure();
  const fullMs = performance.now() - t1;
  return { ok: settled && houses >= 150 && ms < 1 && made >= 1,
           info: houses + ' 栋楼，拆一栋后脏格 ' + marked + ' 个，局部检测 ' + ms.toFixed(3) + 'ms（全图检测 ' + fullMs.toFixed(2) + 'ms），上半截变成刚体 ' + made + ' 个' };
});

defTest('冬季湖泊：冰层隔热、结冰放潜热，10 分钟只冻住表面，冻不实', () => {
  seedRng(77);
  buildScene(8);
  const water0 = countType(WATER), ice0 = countType(ICE);
  runSteps(36000);
  const water1 = countType(WATER), ice1 = countType(ICE);
  return { ok: water1 >= water0 * 0.6 && ice1 >= ice0 * 0.8,
           info: '湖水 ' + water0 + ' → ' + water1 + ' 格，冰 ' + ice0 + ' → ' + ice1 + ' 格（10 分钟模拟时间）' };
});

defTest('水汽不穿墙：密闭玻璃箱里的蒸汽在箱子里凝结，不会漏到外面成云', () => {
  const { cx, cy } = tArena();
  tBox(cx - 10, cy - 10, cx + 10, cy + 10, GLASS);
  fillRect(STEAM, cx - 6, cy - 6, cx + 6, cy + 2);
  const steam0 = countType(STEAM);
  const w0 = totalWater();
  runSteps(4000);
  const inside = countType(WATER, cx - 9, cy - 9, cx + 9, cy + 9) + countType(STEAM, cx - 9, cy - 9, cx + 9, cy + 9);
  let air = 0;
  for (let c = 0; c < GW * GH; c++) air += vapor[c] + cloud[c];
  return { ok: inside >= steam0 * 0.85 && air < steam0 * 0.15 && Math.abs(totalWater() - w0) / w0 < 0.02,
           info: steam0 + ' 格蒸汽，4000 步后箱内剩 ' + inside + ' 格水 / 蒸汽，箱外水汽 + 云 ' + air.toFixed(1) };
});

defTest('确定性：同一种子跑两遍逐格一致，换种子结果不同', () => {
  const run = s => {
    allocGrid(W, H); resetWorld(s);
    buildScene(6);
    runSteps(3000);
    return worldHash();
  };
  const a = run(1234), b = run(1234), c = run(4321);
  return { ok: a === b && a !== c, info: '种子 1234：' + a + ' / ' + b + '；种子 4321：' + c };
});

defTest('输入录制：录一段操作再回放，哈希逐位一致', () => {
  allocGrid(W, H);
  resetWorld(2024);
  const cx = W >> 1, cy = H >> 1;
  execCmd('loadScene', { index: 1 });
  runSteps(60);
  execCmd('strokeBegin', {});
  execCmd('stroke', { tool: WATER, x0: cx - 30, y0: cy - 20, x1: cx + 30, y1: cy - 20, size: 4, shape: 'spray', replace: false, erase: false });
  execCmd('stroke', { tool: SAND, x0: cx, y0: cy - 30, x1: cx, y1: cy - 30, size: 6, shape: 'circle', replace: false, erase: false });
  execCmd('strokeEnd', {});
  runSteps(100);
  execCmd('setWeather', { key: 'storm' });
  execCmd('explode', { x: cx + 20, y: cy, r: 10, p: 0.8 });
  runSteps(40);
  execCmd('lightning', { x: cx - 40 });
  execCmd('setEnv', { key: 'wind', value: -0.7 });
  execCmd('setGravity', { dir: 'left' });
  runSteps(300);
  const live = worldHash(), rec = recordingOf(2024, W, H);
  const replayed = replay(JSON.parse(JSON.stringify(rec)));
  return { ok: live === replayed && rec.log.length === 10, info: rec.log.length + ' 条命令、' + rec.steps + ' 步；实时 ' + live + '，回放 ' + replayed };
});

defTest('存档完整：爆炸进行中、刚体正在下落时存档，读档后哈希一致，继续跑 1000 步也一致', () => {
  allocGrid(W, H);
  resetWorld(99);
  env.structure = true;
  buildDemolition(true);
  let s = 0;
  while (s < 2000 && !(bodyCount >= 3 && (exActive > 0 || fpCount > 50))) { simStep(); s++; }
  const during = { bodies: bodyCount, ex: exActive, fp: fpCount, step: s };
  const json = serializeWorld();
  const h0 = worldHash();
  runSteps(1000);
  const h1 = worldHash();
  resetWorld(1); buildScene(3); runSteps(20);                // 先弄乱
  deserializeWorld(json);
  const r0 = worldHash();
  runSteps(1000);
  const r1 = worldHash();
  return { ok: during.bodies >= 3 && h0 === r0 && h1 === r1,
           info: '第 ' + during.step + ' 步存档（刚体 ' + during.bodies + '、爆炸 ' + during.ex + '、飞行粒子 ' + during.fp + '，存档 ' + (json.length / 1024).toFixed(0) +
                 ' KB）；读档 ' + (h0 === r0 ? '一致' : h0 + '≠' + r0) + '，再跑 1000 步 ' + (h1 === r1 ? '一致' : h1 + '≠' + r1) };
});

defTest('静态扫描：模拟代码里没有 Math.random / 超越函数 / 时钟', () => {
  if (typeof require !== 'function' || !globalThis.__SRC_DIR) return { ok: true, info: '浏览器里没有源码文件，跳过（Node 端已检查）' };
  const fs = require('fs'), path = require('path');
  const files = ['10-core.js', '20-sim.js', '22-struct.js', '23-weather.js', '25-codec.js', '26-state.js', '27-scenes.js'];
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(globalThis.__SRC_DIR, f), 'utf8').split('\n');
    src.forEach((line, k) => {
      if (/^\s*(\*|\/\*)/.test(line)) return;                // 块注释
      const code = line.replace(/\/\/.*$/, '').replace(/'[^']*'/g, "''");
      if (/Math\.(random|sin|cos|tan|asin|acos|atan2?|exp|expm1|pow|log|log2|log10|log1p|hypot|cbrt|sinh|cosh|tanh)\b|Date\.|performance\.now|new Date/.test(code)) bad.push(f + ':' + (k + 1));
    });
  }
  return { ok: bad.length === 0, info: bad.length ? '发现 ' + bad.join(', ') : files.length + ' 个模拟源文件都干净' };
});
