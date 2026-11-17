
/* =====================================================================
 * 6d. 只能在浏览器里跑的用例：读像素验证渲染效果、离线渲染验证音效、Blob 往返验证导入导出
 * ===================================================================== */
function defBrowserTest(name, fn) { TESTS.push({ name, fn, browser: true }); }

// 读画布上一块区域的像素（格子坐标），必须紧跟在 renderFrame 之后、同一个任务里读
function readCells(x0, y0, w, h) {
  const k = canvas.width / W;
  const px = Math.round(x0 * k), py = Math.round(canvas.height - (y0 + h) * k), pw = Math.round(w * k), ph = Math.round(h * k);
  const buf = new Uint8Array(pw * ph * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(px, py, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return buf;
}

function meanDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return s / (a.length / 4 * 3);
}

if (typeof document !== 'undefined') {
  defBrowserTest('热扭曲：熔岩上方两帧之间有空间偏移，远处和关掉扭曲时没有', () => {
    if (!gl) return { ok: true, info: '当前是 Canvas2D 退路，没有热扭曲，跳过' };
    const { cx, cy } = tArena();
    const keep = Object.assign({}, settings);
    Object.assign(settings, { grain: false, shake: false, clouds: false, shadows: false, vignette: false });
    const by = Math.min(H - 3, cy + 40);
    fillRect(STONE, 0, by, W - 1, H - 1);
    fillRect(LAVA, cx - 40, by - 5, cx - 10, by - 1);                      // 左边一池熔岩
    for (let x = cx - 40; x < cx + 60; x += 4) fillRect(METAL, x, by - 26, x + 1, by - 10);   // 上方一排竖条当参照物（左半在熔岩上方，右半不在）
    const frame = t => { sceneDirty = true; renderFrame(t, 16.7); };
    const measure = () => {
      for (let k = 0; k < 14; k++) frame(1000 + k * 16.7);                 // 先渲染十几帧，让辉光 / 热量缓冲建立起来
      frame(2000); const a1 = readCells(cx - 38, by - 24, 26, 12), b1 = readCells(cx + 30, by - 24, 26, 12);
      frame(2400); const a2 = readCells(cx - 38, by - 24, 26, 12), b2 = readCells(cx + 30, by - 24, 26, 12);
      return { hot: meanDiff(a1, a2), far: meanDiff(b1, b2) };
    };
    settings.distort = true;
    const on = measure();
    settings.distort = false;
    const off = measure();
    Object.assign(settings, keep);
    sceneDirty = true;
    return { ok: on.hot > 2 && on.hot > on.far * 4 + 0.5 && off.hot < on.hot * 0.3,
             info: '两帧像素差（0-255）：熔岩上方 ' + on.hot.toFixed(2) + '，远处 ' + on.far.toFixed(2) + '；关掉扭曲后熔岩上方 ' + off.hot.toFixed(2) };
  });

  defBrowserTest('发光缓冲：热金属和阴燃的炭都有输出，普通石头没有', () => {
    if (!gl) return { ok: true, info: '当前是 Canvas2D 退路，没有发光缓冲，跳过' };
    const { cx, cy } = tArena();
    fillRect(METAL, cx - 30, cy, cx - 21, cy + 9);
    fillRect(CHARCOAL, cx - 5, cy, cx + 4, cy + 9);
    fillRect(STONE, cx + 20, cy, cx + 29, cy + 9);
    for (let y = cy; y <= cy + 9; y++) for (let x = cx - 30; x <= cx - 21; x++) temp[x + y * W] = 1200;
    for (let y = cy; y <= cy + 9; y++) for (let x = cx - 5; x <= cx + 4; x++) { const i = x + y * W; flags[i] |= F_BURN; temp[i] = 400; }
    sceneDirty = true; renderFrame(1000, 16.7);
    const emis = (gx0, gy0) => {
      const k = canvas.width / W, px = Math.round((gx0 + 5) * k), py = Math.round(canvas.height - (gy0 + 5) * k);
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.scene.fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      let v;
      if (R.hdr) { const b = new Float32Array(4); gl.readPixels(px, py, 1, 1, gl.RGBA, gl.FLOAT, b); v = Math.max(b[0], b[1], b[2]); }
      else { const b = new Uint8Array(4); gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); v = Math.max(b[0], b[1], b[2]) / 255; }
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return v;
    };
    const m = emis(cx - 30, cy), c = emis(cx - 5, cy), s = emis(cx + 20, cy);
    // 再看最终画面：发光体周围的空气应该被 bloom 照亮
    for (let k = 0; k < 10; k++) renderFrame(1000 + k * 16, 16.7);
    const halo = readCells(cx - 19, cy + 3, 3, 3), dark = readCells(cx + 31, cy + 3, 3, 3);
    let hs = 0, ds = 0;
    for (let i = 0; i < halo.length; i += 4) { hs += halo[i]; ds += dark[i]; }
    return { ok: m > 0.2 && c > 0.2 && s < 0.02 && hs > ds * 1.3,
             info: '发光强度：热金属 ' + m.toFixed(2) + '，阴燃的炭 ' + c.toFixed(2) + '，石头 ' + s.toFixed(3) + '；热金属旁的空气红色通道 ' +
                   (hs / (halo.length / 4)).toFixed(0) + '，石头旁 ' + (ds / (dark.length / 4)).toFixed(0) };
  });

  defBrowserTest('音效：离线渲染每一种声音，都不削波（峰值 < 0dBFS），也都不是静音', async () => {
    if (!(window.OfflineAudioContext || window.webkitOfflineAudioContext)) return { ok: false, info: '浏览器没有 OfflineAudioContext' };
    const parts = [];
    let ok = true;
    for (const name of SFX_TESTS) {
      const r = await renderSfx(name);
      const db = 20 * Math.log10(Math.max(1e-9, r.peak));
      if (!(r.peak < 0.999 && r.rms > 1e-4)) ok = false;
      parts.push(name + ' ' + db.toFixed(1) + 'dB');
    }
    return { ok, info: '峰值：' + parts.join('，') + '（all = 所有声床开到最大 + 4 声爆炸 + 雷）' };
  });

  defBrowserTest('导入导出：导出的 Blob 当作文件选进来，走完整往返，逐格一致', async () => {
    const { cx, cy } = tArena();
    tFloor(cy + 12, STONE);
    const kinds = [SAND, WATER, WOOD, OIL, PLANT, METAL, ICE, SALT, BRICK, GLASS, LAVA, TNT, SOIL, ROPE];
    for (let y = cy - 10; y < cy + 12; y++) for (let x = cx - 30; x < cx + 30; x++) if (rnd() < 0.6) put(x + y * W, kinds[rndi(kinds.length)], x, y);
    runSteps(30);
    const t0 = type.slice(), s0 = seed.slice(), w0 = wet.slice(), a0 = aux.slice(), u0 = fuel.slice();
    let blob = null, fname = '';
    const realDownload = downloadBlob;
    downloadBlob = (b, n) => { blob = b; fname = n; };       // 截住下载：拿到导出按钮真正产出的 Blob
    exportJSON();
    downloadBlob = realDownload;
    if (!blob) return { ok: false, info: '导出没有产出 Blob' };
    clearGrid();
    const emptied = countType(EMPTY) === N;
    const okImport = await importJSON(new File([blob], fname, { type: 'application/json' }));   // 和文件选择框选中文件走同一条路
    let diff = 0;
    for (let i = 0; i < N; i++) if (type[i] !== t0[i] || (type[i] !== 0 && (seed[i] !== s0[i] || wet[i] !== w0[i] || aux[i] !== a0[i] || fuel[i] !== u0[i]))) diff++;
    undoLen = 0;
    return { ok: emptied && okImport && diff === 0 && /\.json$/.test(fname), info: '文件 ' + fname + '，' + (blob.size / 1024).toFixed(1) + ' KB；清空后导入，差异 ' + diff + ' 格' };
  });
}
