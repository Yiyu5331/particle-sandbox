
/* ---------------------------------------------------------------------
 * 6.9 浏览器端：逐条跑用例并显示在页面角落，最后做性能测试
 * ------------------------------------------------------------------- */
// 性能场景：全部新系统一起上 —— 约 5 万粒子（沙 + 水）+ 埋在里面的 10 个 TNT + 上面一栋会被炸塌的楼 + 雷暴天气
function buildPerfScene() {
  env.dayNight = true; env.time = 0.9; env.timeScale = 1; env.structure = true; env.temp = AMBIENT; sceneState = null;
  setWeather('storm'); env.wind = 0.6;
  clearGrid(); setGravity('down'); seedRng(4242); updateSun();
  const rows = Math.max(20, Math.min(Math.floor(H * 0.45), Math.ceil(50000 / W)));
  const floor = H - rows - 6;
  buildDemolition(true, floor);
  fillRect(SAND, 0, floor + 6 + (rows >> 1), W - 1, H - 1);
  fillRect(WATER, 0, floor + 6, W - 1, floor + 5 + (rows >> 1));
  for (let k = 0; k < 10; k++) {                         // 10 个 TNT 埋在沙层里，依次点燃
    const x = Math.floor(W * (k + 0.5) / 10), y = H - 2 - (rows >> 2), i = x + y * W;
    put(i, TNT, x, y); flags[i] |= F_BURN; life[i] = 40 + k * 8;
  }
  for (let c = 0; c < GW * GH; c++) if (altitudeOf((c / GW) | 0) > 0.7) cloud[c] = 2.4;      // 开场就是厚云：马上下雨、打雷
  env.charge = 0.9;
  let n = 0;
  for (let i = 0; i < N; i++) if (type[i] !== 0) n++;
  return n;
}

function perfTest() {
  return new Promise(resolve => {
    // 先把同一个场景完整跑一遍热身（不计时），让 JIT 把爆炸、刚体、闪电这些路径都编译好，再重建场景正式测。
    // 也就是说这里测的是稳定状态；真实使用中第一次大爆炸可能有一帧卡顿。
    buildPerfScene();
    for (let s = 0; s < 420; s++) { simStep(); if ((s & 3) === 0) renderFrame(performance.now(), 16.7); }
    audioFrame();
    const count = buildPerfScene();
    const frames = [];
    let booms = 0, lastBoomFrame = -1, firstBoomFrame = -1, last = performance.now(), peakBodies = 0;
    const strikes0 = env.strikes, made0 = structStats.made;
    let worst = { work: 0 };
    // 对照组：每帧顺带跑一段固定的小计算（正常约 0.1ms）。它要是也出现十几毫秒的峰值，说明是机器在抖，不是模拟慢
    const ctl = new Float64Array(60000);
    let ctlMax = 0, ctlSum = 0;
    const prevBoom = onBoom;
    onBoom = (x, y, R, P) => { booms++; lastBoomFrame = frames.length; if (firstBoomFrame < 0) firstBoomFrame = frames.length; if (prevBoom) prevBoom(x, y, R, P); };
    // 驱动：正常走 rAF；如果 rAF 被降频（面板被遮挡等），30ms 后由 MessageChannel 兜底，
    // 它不受后台定时器节流影响。每帧固定 1 个模拟步 + 1 次渲染，统计的是这一帧的实际工作耗时。
    let rafFrames = 0, fallbackFrames = 0, token = 0;
    const ch = new MessageChannel();
    let armedAt = 0, armedToken = 0, pending = null;
    ch.port1.onmessage = () => {
      if (armedToken !== token || !pending) return;
      if (performance.now() - armedAt < 30) { ch.port2.postMessage(0); return; }
      const cb = pending; pending = null; token++; fallbackFrames++;
      cb(performance.now());
    };
    const nextFrame = cb => {
      const my = ++token;
      pending = cb; armedAt = performance.now(); armedToken = my;
      requestAnimationFrame(() => { if (token === my && pending) { pending = null; token++; rafFrames++; cb(performance.now()); } });
      ch.port2.postMessage(0);
    };
    function fr(now) {
      const dt = Math.min(100, now - last); last = now;
      const t0 = performance.now();
      const p0 = [perf.cells, perf.thermal, perf.struct, perf.weather, perf.slow, perf.misc];
      simStep();
      const t1 = performance.now();
      renderFrame(now, 16.7);
      if (gl) gl.finish();                               // 把 GPU 时间也算进来
      const work = performance.now() - t0;
      if (work > worst.work) worst = { work, frame: frames.length, sim: t1 - t0, render: performance.now() - t1, cells: perf.cells - p0[0], thermal: perf.thermal - p0[1],
                                       struct: perf.struct - p0[2], weather: perf.weather - p0[3], slow: perf.slow - p0[4], misc: perf.misc - p0[5], bodies: bodyCount, free: fpCount };
      const c0 = performance.now();
      for (let i = 0; i < 60000; i++) ctl[i] = ctl[i] * 0.5 + i;
      const cd = performance.now() - c0;
      ctlSum += cd; if (cd > ctlMax) ctlMax = cd;
      frames.push({ dt, work, free: fpCount, chunks: perf.activeChunks });
      if (bodyCount > peakBodies) peakBodies = bodyCount;
      audioFrame();
      const n = frames.length;
      const done = (booms >= 10 && n - lastBoomFrame > 300 && bodyCount === 0) || n > 2400;
      if (!done) { nextFrame(fr); return; }
      onBoom = prevBoom;
      const during = frames.slice(Math.max(0, firstBoomFrame), lastBoomFrame + 24);
      const after = frames.slice(lastBoomFrame + 120);               // 最后一次爆炸 2 秒（120 步）之后
      const all = frames.slice(5);
      const avg = a => a.reduce((s, f) => s + f.work, 0) / Math.max(1, a.length);
      const maxW = a => a.reduce((m, f) => Math.max(m, f.work), 0);
      const v = all.map(f => f.dt).sort((p, q) => p - q);
      resolve({
        count, grid: W + 'x' + H, booms, frames: n, displayHz: 1000 / (v[v.length >> 1] || 16.7),
        throttled: fallbackFrames > rafFrames, rafFrames, fallbackFrames,
        avgWork: avg(all), duringAvg: avg(during), duringMax: maxW(during), duringFrames: during.length,
        duringMinFps: 1000 / Math.max(0.01, maxW(during)),
        afterAvg: avg(after), afterMax: maxW(after), afterFps: 1000 / Math.max(0.01, maxW(after)),
        peakFree: frames.reduce((m, f) => Math.max(m, f.free), 0), peakChunks: frames.reduce((m, f) => Math.max(m, f.chunks), 0),
        peakBodies, bodiesMade: structStats.made - made0, strikes: env.strikes - strikes0, rain: env.rainCount,
        allMax: maxW(all), over16: all.filter(f => f.work > 16).length, worst,
        p99: all.map(f => f.work).sort((a, b) => a - b)[Math.floor(all.length * 0.99)], p50: all.map(f => f.work).sort((a, b) => a - b)[all.length >> 1],
        ctlMax, ctlAvg: ctlSum / n,
      });
    }
    nextFrame(fr);
  });
}

async function runAllTests() {
  testRunning = true;
  const box = $('testbox');
  box.style.display = 'block';
  const rows = [];
  let pass = 0;
  const draw = extra => {
    box.innerHTML = '<h4>自测 ' + pass + ' / ' + rows.length + ' 通过' + (rows.length <= TESTS.length ? '（共 ' + (TESTS.length + 1) + ' 项）' : '') + '</h4>' +
      (extra || '') + rows.map(r => '<div class="' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? '通过' : '失败') + '　' + r.name + ' <span class="dim">' + r.info + '</span></div>').join('');
  };
  const yieldCh = new MessageChannel();
  const tick0 = () => new Promise(r => { yieldCh.port1.onmessage = () => r(); yieldCh.port2.postMessage(0); });
  const only = QS.get('only');
  for (const t of TESTS) {
    if (only && !t.name.includes(only)) continue;
    await tick0();
    let r;
    try { r = await t.fn(); } catch (e) { r = { ok: false, info: '异常：' + e.message }; console.error(e); }
    rows.push({ name: t.name, ok: r.ok, info: r.info });
    if (r.ok) pass++;
    console.log((r.ok ? '通过' : '失败') + '  ' + t.name + ' — ' + r.info);
    sceneDirty = true; renderFrame(performance.now(), 16.7);
    draw();
  }
  fpClear(); exClear();
  const p = await perfTest();
  // 判定只看「每帧工作耗时」（模拟一步 + 渲染一帧 + gl.finish）：全程最慢一帧 ≤ 16ms
  const perfOk = p.allMax <= 16 && p.booms >= 10 && p.bodiesMade >= 3 && p.rain > 0;
  const w = p.worst;
  rows.push({ name: '性能：' + p.count + ' 粒子 + TNT 连爆 + 建筑倒塌 + 雷暴，全部新系统开启（' + p.grid + '）', ok: perfOk,
    info: '全程最慢一帧 ' + p.allMax.toFixed(1) + 'ms（其中模拟 ' + w.sim.toFixed(1) + '：粒子 ' + w.cells.toFixed(1) + ' / 温度 ' + w.thermal.toFixed(1) + ' / 结构 ' + w.struct.toFixed(1) +
          ' / 天气 ' + w.weather.toFixed(1) + '；渲染 ' + w.render.toFixed(1) + '），超过 16ms 的有 ' + p.over16 + ' / ' + p.frames + ' 帧；中位数 ' + p.p50.toFixed(1) + 'ms，99% 的帧 ≤ ' + p.p99.toFixed(1) +
          'ms，平均 ' + p.avgWork.toFixed(1) + 'ms；固定负载对照：平均 ' + p.ctlAvg.toFixed(2) + 'ms、最慢 ' + p.ctlMax.toFixed(1) + 'ms' + (p.ctlMax > 6 ? '（对照组自己都抖到这么高，说明机器当时有别的负载，峰值不可信）' : '') +
          '；' + p.booms + ' 次爆炸，刚体 ' + p.bodiesMade + ' 个（同时最多 ' + p.peakBodies + '），闪电 ' + p.strikes + ' 道，雨 ' + p.rain + ' 滴，飞行粒子峰值 ' + p.peakFree +
          (p.throttled ? '；rAF 被浏览器降频，测试由消息通道驱动' : '；rAF ' + p.displayHz.toFixed(0) + 'Hz') });
  if (perfOk) pass++;
  console.log((perfOk ? '通过' : '失败') + '  ' + rows[rows.length - 1].name + ' — ' + rows[rows.length - 1].info);
  const all = pass === rows.length;
  draw('<div class="' + (all ? 'ok' : 'bad') + '">' + (all ? '全部通过' : '有 ' + (rows.length - pass) + ' 项失败') + ' · 渲染 ' + renderMode + '</div>');
  console.log('自测结果：' + pass + '/' + rows.length + (all ? ' 全部通过' : ' 有失败'));
  window.__testResults = { pass, total: rows.length, rows, perf: p, renderMode };
  testRunning = false;
}

/* =====================================================================
 * 7. 主循环：固定 60Hz 模拟步长，与渲染帧率解耦
 * ===================================================================== */
let lastFrameT = 0, simAcc = 0, frameNo = 0, slowGpu = 0;
perf.frames = 0;

function loop(now) {
  requestAnimationFrame(loop);
  let dt = now - lastFrameT;
  lastFrameT = now;
  if (dt > 0 && dt < 5000) hud.interval += (dt - hud.interval) * 0.15;     // 真实 rAF 间隔（不截断，用来识别降频）
  if (dt > 250 || dt <= 0) dt = 16.7;
  hud.frames++; perf.frames++;
  if (testRunning) { updateHud(now); return; }

  const t0 = performance.now();
  if (pointer.down && !pointer.line) stamp(pointer.x, pointer.y, pointer.erase);     // 按住不动也持续出料
  if (!paused) {
    const stepMs = 1000 / SIM_HZ, maxSteps = Math.max(2, Math.ceil(speed * 2));
    simAcc += Math.min(dt, 100) * speed;
    let n = 0;
    while (simAcc >= stepMs && n < maxSteps) { playbackTick(); simStep(); simAcc -= stepMs; n++; }
    if (simAcc > stepMs * 2) simAcc = 0;               // 跟不上就丢步，不追帧
  } else if (stepOnce) { playbackTick(); simStep(); }
  stepOnce = false;

  renderFrame(now, Math.min(dt, 100));
  if (gl && frameNo % 30 === 0) {                      // 每 30 帧抽样一次真实 GPU 耗时
    const g0 = performance.now();
    gl.finish();
    perf.gpu += (performance.now() - g0 - perf.gpu) * 0.5;
    if (settings.hd && pixelRatio > 1 && perf.gpu > 13 && !document.hidden) {
      if (++slowGpu >= 6) {                            // GPU 持续吃紧：自动降到 1x 渲染
        settings.hd = false; slowGpu = 0;
        resizeRenderer();
        if (settingBoxes.hd) settingBoxes.hd.checked = false;
        toast('已自动关闭高清渲染以保持帧率');
      }
    } else slowGpu = 0;
  }
  frameNo++;
  hud.work += (performance.now() - t0 - hud.work) * 0.1;
  audioFrame();
  updateHud(now);
}

/* ---------------------------------------------------------------------
 * 7.1 冷启动热身：加载时在一个看不见的小世界里先跑一遍爆炸、倒塌、闪电，
 *     让 JIT 把这些代码路径都编译好；着色器在这之后的真实画布上各画几帧。
 *     热身完全在 resetWorld 之前，不影响这一局的确定性。
 * ------------------------------------------------------------------- */
let warmMs = 0;
function warmUp() {
  const t0 = performance.now();
  const keepRec = cmdRecording;
  cmdRecording = false;
  allocGrid(200, 130);
  resetWorld(7);
  env.structure = true; env.time = 0.9; setWeather('storm'); updateSun();
  buildDemolition(true, 100);
  fillRect(WATER, 0, 106, W - 1, 112);
  fillRect(SAND, 0, 113, W - 1, H - 1);
  for (let k = 0; k < 4; k++) { const x = 30 + k * 40, i = x + 118 * W; put(i, TNT, x, 118); flags[i] |= F_BURN; life[i] = 10 + k * 6; }
  for (let c = 0; c < GW * 4; c++) cloud[c] = 2.4;
  for (let s = 0; s < 360; s++) { simStep(); if (s % 90 === 30) lightning(); }
  worldHash(); serializeWorld();
  cmdRecording = keepRec;
  warmMs = performance.now() - t0;
}
function warmRender() { for (let k = 0; k < 3; k++) renderFrame(performance.now(), 16.7); if (gl) gl.finish(); }

/* ---- ?coldboom=1：刷新后第一次大爆炸的耗时（加 &nowarm=1 对比不热身） ---- */
function coldBoom() {
  const box = $('testbox');
  box.style.display = 'block';
  testRunning = true;
  const count = buildPerfScene();
  const frames = [];
  let firstBoom = -1, booms = 0;
  const prev = onBoom;
  onBoom = (x, y, R, P) => { booms++; if (firstBoom < 0) firstBoom = frames.length; if (prev) prev(x, y, R, P); };
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    const t0 = performance.now();
    simStep(); renderFrame(performance.now(), 16.7); if (gl) gl.finish();
    frames.push(performance.now() - t0);
    if (frames.length < 260) { ch.port2.postMessage(0); return; }
    onBoom = prev;
    const win = frames.slice(Math.max(0, firstBoom), firstBoom + 60);
    const r = { warm: !QS.has('nowarm'), warmMs: +warmMs.toFixed(0), count, booms, firstBoomFrame: firstBoom,
                firstBoomMax: +Math.max.apply(null, win).toFixed(1), allMax: +Math.max.apply(null, frames).toFixed(1),
                avg: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2) };
    window.__coldBoom = r;
    box.innerHTML = '<h4>冷启动第一次大爆炸</h4><div class="' + (r.firstBoomMax <= 16 ? 'ok' : 'bad') + '">' + (r.warm ? '已热身（' + r.warmMs + 'ms）' : '未热身') +
      '：第一次爆炸后 60 帧里最慢 ' + r.firstBoomMax + 'ms，全程最慢 ' + r.allMax + 'ms，平均 ' + r.avg + 'ms</div>';
    console.log('冷启动', JSON.stringify(r));
    testRunning = false;
  };
  ch.port2.postMessage(0);
}

/* ---- ?soak=1：10 个场景各跑 10 分钟模拟时间，页面里显示结果表 ---- */
async function soakInPage() {
  testRunning = true;
  const box = $('testbox');
  box.style.display = 'block';
  const yieldCh = new MessageChannel();
  const tick0 = () => new Promise(r => { yieldCh.port1.onmessage = () => r(); yieldCh.port2.postMessage(0); });
  const steps = +(QS.get('steps') || 36000), rows = [];
  const draw = cur => {
    box.innerHTML = '<h4>soak：每个场景 ' + steps + ' 步' + (cur ? '（进行中：' + cur + '）' : '') + '</h4>' + rows.map(r =>
      '<div class="' + (r.unstable.length ? 'bad' : 'ok') + '">' + r.name + ' <span class="dim">总量 ' + r.first.total + '→' + r.last.total +
      '，末段活跃块 ' + r.lateChunks.toFixed(1) + '，末段燃烧 ' + r.lateBurn.toFixed(0) + (r.unstable.length ? '；不稳定：' + r.unstable.join('，') : '；最后 2 分钟各材料变化都 < 2%') + '</span></div>').join('');
  };
  for (let k = 0; k < SCENES.length; k++) {
    resetWorld(1000 + k); buildScene(k);
    const samples = [soakSample()];
    for (let s = 1; s <= steps; s++) {
      simStep();
      if (s % 600 === 0) { samples.push(soakSample()); draw(SCENES[k].name + ' ' + Math.round(s / steps * 100) + '%'); sceneDirty = true; renderFrame(performance.now(), 16.7); await tick0(); }
    }
    rows.push(soakVerdict(k, samples));
    draw();
  }
  window.__soakResults = rows.map(r => ({ name: r.name, unstable: r.unstable, drift: r.drift }));
  console.log('soak', JSON.stringify(window.__soakResults));
  testRunning = false;
}

/* ---- ?bench=1：只跑性能测试 ---- */
async function benchInPage() {
  testRunning = true;
  const box = $('testbox');
  box.style.display = 'block';
  box.innerHTML = '<h4>性能测试进行中……</h4>';
  const p = await perfTest();
  window.__bench = p;
  box.innerHTML = '<h4>性能测试</h4><div>' + p.count + ' 粒子，最慢一帧 ' + p.allMax.toFixed(1) + 'ms，99% ≤ ' + p.p99.toFixed(1) + 'ms，中位数 ' + p.p50.toFixed(1) + 'ms，平均 ' + p.avgWork.toFixed(1) + 'ms</div>';
  testRunning = false;
}

function main() {
  buildPalette();
  selectTool(SAND);
  createRenderer(viewport);
  setSimClock(() => performance.now());                  // 只给调试面板计时用，模拟本身不读时钟
  if (!QS.has('nowarm')) warmUp();
  onBoom = (x, y, R, P) => { fxBoom(x, y, R, P); audioBoom(P * R / 15); };
  onThunder = (x, y) => { fxThunder(); audioThunder(thunderDelay(x, y)); };      // 先闪后响，离得越远响得越晚
  N = 0;
  fitGrid(true);
  // 这一局的种子：地址栏 ?seed= 指定，否则随机。种子 + 录制下来的命令 = 能逐格复现的一局
  resetWorld(QS.has('seed') ? (+QS.get('seed') | 0) : ((Math.random() * 2147483647) | 0) || 1);
  if (!QS.has('nowarm')) warmRender();
  buildControls(); buildEnvPanel(); bindPointer(); bindKeys(); bindResize();
  document.addEventListener('visibilitychange', () => { lastFrameT = performance.now(); simAcc = 0; });
  if (QS.has('test')) setTimeout(runAllTests, 400);
  else if (QS.has('coldboom')) setTimeout(coldBoom, 50);
  else if (QS.has('soak')) setTimeout(soakInPage, 400);
  else if (QS.has('bench')) setTimeout(benchInPage, 400);
  else if (QS.has('scene')) loadScene(Math.max(0, Math.min(SCENES.length - 1, (+QS.get('scene') || 1) - 1)));
  else toast('左键绘制 · 右键擦除 · 「场景」里有 10 个预设');
  requestAnimationFrame(loop);
}
main();
