
/* =====================================================================
 * 5. UI
 * ===================================================================== */
const $ = id => document.getElementById(id);
const stage = $('stage'), viewport = $('viewport'), cursorEl = $('cursor'), linePrev = $('lineprev');

let tool = SAND;
let paused = false, speed = 1, stepOnce = false;
let testRunning = false;
const brush = { size: 4, shape: 'circle', replace: false };
const pointer = { down: false, erase: false, x: 0, y: 0, hx: -1, hy: -1, line: false, lx0: 0, ly0: 0, inside: false };

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------------------------------------------------------------
 * 5.1 元素面板 + 悬停提示
 * ------------------------------------------------------------------- */
const TOOLS = {
  [TOOL_ERASE]: { name: '橡皮', palette: ['#30303a', '#c8c8d8', '#50505c'], note: '擦除粒子（右键也是橡皮）' },
  [TOOL_HEAT]: { name: '加热', palette: ['#ff5a1e', '#ffd23f', '#ff2d00'], note: '每帧给笔刷范围升温 60°C，上限 2500°C' },
  [TOOL_COOL]: { name: '冷却', palette: ['#5ab4ff', '#d6f0ff', '#2a6cff'], note: '每帧给笔刷范围降温 60°C，下限 -200°C' },
  [TOOL_LIGHTNING]: { name: '闪电', palette: ['#bfe8ff', '#ffffff', '#7fa8ff'], note: '点一下，从云里（没有云就从天顶）劈向这一列附近最高、最导电的地方' },
};
const CATEGORIES = [
  { name: '粉末', ids: [SAND, SOIL, SALT, GUNPOWDER, ASH, SEED, SNOW, DEADPLANT] },
  { name: '液体', ids: [WATER, SALTWATER, OIL, ACID, LAVA] },
  { name: '固体', ids: [STONE, WOOD, METAL, GLASS, ICE, PLANT, FLOWER, CHARCOAL, TNT] },
  { name: '建筑', ids: [BRICK, CONCRETE, STEEL, ROPE, ANCHOR] },
  { name: '气体', ids: [SMOKE, STEAM, FOAM] },
  { name: '能量', ids: [FIRE, EMBER, SPARK] },
  { name: '工具', ids: [TOOL_ERASE, TOOL_HEAT, TOOL_COOL, TOOL_LIGHTNING, CLONE, VOID] },
];
const HOTKEYS = { '1': SAND, '2': WATER, '3': STONE, '4': WOOD, '5': FIRE, '6': LAVA, '7': OIL, '8': TNT, '9': METAL, '0': TOOL_ERASE };
const toolButtons = new Map();

function toolInfo(id) { return id >= 100 ? TOOLS[id] : MATERIALS[id]; }

function buildPalette() {
  const host = $('palette');
  const keyOf = {};
  for (const k in HOTKEYS) keyOf[HOTKEYS[k]] = k;
  for (const cat of CATEGORIES) {
    const box = document.createElement('div');
    box.className = 'cat';
    const h = document.createElement('h3');
    h.textContent = cat.name;
    const items = document.createElement('div');
    items.className = 'items';
    for (const id of cat.ids) {
      const info = toolInfo(id), p = info.palette;
      const b = document.createElement('button');
      b.className = 'el' + (id < 100 && (MATERIALS[id].emissive > 0 || id === SPARK) ? ' glow' : '');
      b.style.setProperty('--c1', id === VOID ? '#7a35c8' : p[0]);
      b.style.setProperty('--c2', p[1] || p[0]);
      b.style.setProperty('--c3', p[2] || p[0]);
      b.innerHTML = '<span class="sw"></span><span class="nm"></span>' + (keyOf[id] ? '<kbd>' + keyOf[id] + '</kbd>' : '');
      b.querySelector('.nm').textContent = info.name;
      b.addEventListener('click', () => selectTool(id));
      b.addEventListener('mouseenter', () => showTip(id, b));
      b.addEventListener('mouseleave', hideTip);
      b.addEventListener('focus', () => showTip(id, b));
      b.addEventListener('blur', hideTip);
      items.appendChild(b);
      toolButtons.set(id, b);
    }
    box.appendChild(h); box.appendChild(items);
    host.appendChild(box);
  }
}

function selectTool(id) {
  tool = id;
  for (const [k, b] of toolButtons) b.classList.toggle('on', k === id);
}

function fmtT(v) { return Math.round(v) + '°C'; }

function showTip(id, anchor) {
  const tip = $('tip');
  let html;
  if (id >= 100) {
    html = '<h4>' + TOOLS[id].name + '</h4><div class="sub">工具</div><div>' + TOOLS[id].note + '</div>';
  } else {
    const m = MATERIALS[id], rows = [];
    rows.push(['密度', m.density >= 10 ? Math.round(m.density) + ' kg/m³' : m.density + ' kg/m³']);
    rows.push(['导热', m.conductivity.toFixed(2)]);
    rows.push(['比热', m.heatCapacity.toFixed(1)]);
    if (m.state !== S_GAS && m.state !== S_ENERGY) rows.push(['硬度', m.hardness > 1 ? '不可破坏' : m.hardness.toFixed(2)]);
    if (m.spawnTemp !== AMBIENT) rows.push(['初始温度', fmtT(m.spawnTemp)]);
    if (m.flammability > 0) rows.push(['燃点', fmtT(m.ignitionTemp) + '，烧成' + (m.blastRadius ? '爆炸' : MATERIALS[m.burnInto].name)]);
    if (isFinite(m.meltTemp)) rows.push(['熔点', fmtT(m.meltTemp) + ' → ' + MATERIALS[m.meltInto].name]);
    if (isFinite(m.boilTemp)) rows.push(['沸点', fmtT(m.boilTemp) + ' → ' + MATERIALS[m.boilInto].name]);
    if (isFinite(m.freezeTemp)) rows.push([m.state === S_GAS ? '凝结' : '凝固', '低于 ' + fmtT(m.freezeTemp) + ' → ' + MATERIALS[m.freezeInto].name]);
    if (m.blastRadius) rows.push(['爆炸', '半径 ' + m.blastRadius + ' 格，威力 ' + m.blastPower]);
    if (m.life) rows.push(['寿命', m.life[0] + '–' + m.life[1] + ' 帧']);
    if (m.electric) rows.push(['导电', '是']);
    // 反应列表直接从规则表生成
    const rx = [];
    const nm = t => t === EMPTY ? '消失' : MATERIALS[t].name;
    for (const r of RULES) {
      if (r.a !== id && r.b !== id) continue;
      const other = r.a === id ? r.b : r.a, self2 = r.a === id ? r.a2 : r.b2, other2 = r.a === id ? r.b2 : r.a2;
      let s;
      if (r.tag === 'grow') s = id === PLANT ? '吸水后生长' : '被植物吸收';
      else if (r.use) s = r.a === id ? '溶解它' : '被溶解';
      else {
        const parts = [];
        if (self2 !== id) parts.push('自己→' + nm(self2));
        if (other2 !== other) parts.push('对方→' + nm(other2));
        s = parts.join('，') || '无变化';
      }
      rx.push('<li>碰到<b>' + MATERIALS[other].name + '</b>：' + s + '</li>');
    }
    if (id === SPARK) rx.push('<li>碰到<b>金属 / 水</b>：注入电荷并传导</li><li>碰到<b>可燃物</b>：加热到燃点</li>');
    html = '<h4>' + m.name + '</h4><div class="sub">' + STATE_NAMES[m.state] + (m.note ? ' · ' + m.note : '') + '</div><dl>' +
      rows.map(r => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>' +
      (rx.length ? '<ul>' + rx.slice(0, 9).join('') + (rx.length > 9 ? '<li>……共 ' + rx.length + ' 条</li>' : '') + '</ul>' : '');
  }
  tip.innerHTML = html;
  tip.style.display = 'block';
  const r = anchor.getBoundingClientRect(), th = tip.offsetHeight;
  const side = $('palette').getBoundingClientRect().right + 8;
  tip.style.left = Math.min(window.innerWidth - 260, side) + 'px';
  tip.style.top = Math.max(8, Math.min(window.innerHeight - th - 8, r.top - 6)) + 'px';
}
function hideTip() { $('tip').style.display = 'none'; }

/* ---------------------------------------------------------------------
 * 5.2 笔刷
 * ------------------------------------------------------------------- */
// 笔刷：所有落笔都变成 stroke 命令（记进录制，可以回放）
function brushArgs(x0, y0, x1, y1, erase) {
  return { tool, x0, y0, x1, y1, size: brush.size, shape: brush.shape, replace: brush.replace, erase: !!erase };
}
function stamp(cx, cy, erase) { if (!uiLocked()) execCmd('stroke', brushArgs(cx, cy, cx, cy, erase)); }
function stampLine(x0, y0, x1, y1, erase) { if (!uiLocked()) execCmd('stroke', brushArgs(x0, y0, x1, y1, erase)); }
// 回放录制时不接受玩家输入
function uiLocked() { return playback !== null; }

function toCell(e) {
  const r = canvas.getBoundingClientRect();
  return { x: Math.floor((e.clientX - r.left) / r.width * W), y: Math.floor((e.clientY - r.top) / r.height * H) };
}

function updateCursor() {
  if (!pointer.inside || pointer.hx < 0) { cursorEl.style.display = 'none'; linePrev.style.display = 'none'; return; }
  const r = brush.size - 1, d = (2 * r + 1) * CELL;
  cursorEl.style.display = 'block';
  cursorEl.className = brush.shape === 'circle' ? 'round' : brush.shape === 'spray' ? 'spray' : '';
  cursorEl.style.width = cursorEl.style.height = d + 'px';
  cursorEl.style.left = (pointer.hx - r) * CELL + 'px';
  cursorEl.style.top = (pointer.hy - r) * CELL + 'px';
  if (pointer.down && pointer.line) {
    const ax = (pointer.lx0 + 0.5) * CELL, ay = (pointer.ly0 + 0.5) * CELL;
    const bx = (pointer.hx + 0.5) * CELL, by = (pointer.hy + 0.5) * CELL;
    linePrev.style.display = 'block';
    linePrev.style.left = ax + 'px'; linePrev.style.top = ay + 'px';
    linePrev.style.width = Math.hypot(bx - ax, by - ay) + 'px';
    linePrev.style.transform = 'rotate(' + Math.atan2(by - ay, bx - ax) + 'rad)';
  } else linePrev.style.display = 'none';
}

function bindPointer() {
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    audioStart();
    closePops();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件没有活动指针 */ }
    const p = toCell(e);
    if (uiLocked()) { toast('正在回放录制，按「停止回放」再操作'); return; }
    if (tool === TOOL_LIGHTNING && e.button === 0) { execCmd('lightning', { x: p.x }); return; }      // 召唤闪电：点一下劈一道
    pushUndo();
    execCmd('strokeBegin', {});                          // 画的时候先不判定支撑，松手再算（否则画到一半就掉了）
    pointer.down = true; pointer.erase = e.button === 2; pointer.inside = true;
    pointer.x = pointer.hx = p.x; pointer.y = pointer.hy = p.y;
    pointer.line = e.shiftKey; pointer.lx0 = p.x; pointer.ly0 = p.y;
    if (!pointer.line) stamp(p.x, p.y, pointer.erase);
    updateCursor();
  });
  canvas.addEventListener('pointermove', e => {
    const p = toCell(e);
    pointer.inside = true; pointer.hx = p.x; pointer.hy = p.y;
    if (pointer.down && !pointer.line) {
      stampLine(pointer.x, pointer.y, p.x, p.y, pointer.erase);
      pointer.x = p.x; pointer.y = p.y;
    }
    updateCursor();
  });
  const end = e => {
    if (pointer.down && pointer.line) stampLine(pointer.lx0, pointer.ly0, pointer.hx, pointer.hy, pointer.erase);   // Shift 直线：松手时落笔
    pointer.down = false; pointer.line = false;
    if (structHold && !uiLocked()) execCmd('strokeEnd', {});
    if (e.pointerType === 'touch') { pointer.inside = false; pointer.hx = -1; }
    updateCursor();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!pointer.down) { pointer.inside = false; pointer.hx = -1; updateCursor(); } });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('blur', () => { pointer.down = false; pointer.line = false; if (structHold && !uiLocked()) execCmd('strokeEnd', {}); });
}

/* ---------------------------------------------------------------------
 * 5.3 撤销：环形缓冲 20 个 RLE 快照，每次落笔（或清空/载入）前记一次
 * ------------------------------------------------------------------- */
const UNDO_MAX = 20;
const undoRing = new Array(UNDO_MAX).fill(null);
let undoHead = 0, undoLen = 0;

function pushUndo() {
  undoRing[undoHead] = captureScene();
  undoHead = (undoHead + 1) % UNDO_MAX;
  if (undoLen < UNDO_MAX) undoLen++;
}

function undo() {
  if (uiLocked()) return;
  if (undoLen === 0) { toast('没有可撤销的操作'); return; }
  undoHead = (undoHead + UNDO_MAX - 1) % UNDO_MAX;
  undoLen--;
  const s = undoRing[undoHead];
  undoRing[undoHead] = null;
  execCmd('restoreScene', { json: sceneToJSON(s) });
  syncGravityUI(); syncEnvUI();
  toast('已撤销（还可撤销 ' + undoLen + ' 步）');
}

/* ---------------------------------------------------------------------
 * 5.4 存档 / 导入导出 / 截图 / 录制
 * ------------------------------------------------------------------- */
const SLOT_KEY = 'particle-sandbox-v41-slots';

function readSlots() {
  try { return JSON.parse(localStorage.getItem(SLOT_KEY) || '{}') || {}; } catch (e) { return {}; }
}

// 完整存档有几百 KB，存进 localStorage 之前用浏览器自带的 gzip 压一下（没有 CompressionStream 就存原文）
async function gzipToB64(str) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  return bytesToB64(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function gunzipB64(b64) {
  const stream = new Blob([b64ToBytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
async function slotText(v) { return typeof v === 'string' ? v : await gunzipB64(v.z); }

// 读入任何一种存档文本：完整存档、v3/v4 的紧凑存档、录制文件
function loadAnySave(text, label) {
  const o = JSON.parse(text);
  if (o && o.kind === 'recording') { startPlayback(o); return; }
  pushUndo();
  if (o && o.kind === 'full') execCmd('restoreFull', { json: text });
  else execCmd('restoreScene', { json: text });
  syncGravityUI(); syncEnvUI();
  toast('已读取「' + label + '」');
}

function renderSlots() {
  const host = $('slotList'), slots = readSlots(), names = Object.keys(slots);
  host.textContent = '';
  if (!names.length) { const d = document.createElement('div'); d.className = 'note'; d.style.marginTop = '0'; d.textContent = '还没有存档'; host.appendChild(d); return; }
  for (const name of names) {
    const row = document.createElement('div');
    row.className = 'slot';
    const nm = document.createElement('span');
    nm.className = 'nm'; nm.textContent = name;
    const load = document.createElement('button');
    load.textContent = '读取';
    load.addEventListener('click', async () => {
      if (uiLocked()) return;
      try { loadAnySave(await slotText(slots[name]), name); closePops(); }
      catch (e) { toast('读取失败：' + e.message); }
    });
    const del = document.createElement('button');
    del.textContent = '删除'; del.className = 'danger';
    del.addEventListener('click', () => {
      const s = readSlots();
      delete s[name];
      localStorage.setItem(SLOT_KEY, JSON.stringify(s));
      renderSlots();
    });
    row.appendChild(nm); row.appendChild(load); row.appendChild(del);
    host.appendChild(row);
  }
}

async function saveSlot() {
  const name = $('slotName').value.trim() || '存档 ' + new Date().toLocaleTimeString();
  const slots = readSlots();
  const text = serializeWorld();
  const z = await gzipToB64(text);
  slots[name] = z ? { z } : text;
  try { localStorage.setItem(SLOT_KEY, JSON.stringify(slots)); toast('已保存到「' + name + '」（' + ((z ? z.length : text.length) / 1024).toFixed(0) + ' KB）'); }
  catch (e) { toast('保存失败：浏览器本地存储空间不足，请改用导出 JSON'); }
  $('slotName').value = '';
  renderSlots();
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function stampName(ext) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return 'sandbox-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.' + ext;
}

function exportJSON() { downloadBlob(new Blob([serializeWorld()], { type: 'application/json' }), stampName('json')); }

// 录制：从这次开局（或上一次「新开局」）到现在的全部玩家操作
function exportRecording() {
  const rec = recordingOf(worldSeed, W, H);
  downloadBlob(new Blob([JSON.stringify(rec)], { type: 'application/json' }), stampName('rec.json'));
  toast('已导出录制：' + rec.log.length + ' 条命令、' + rec.steps + ' 步');
}

// 回放：从录制的种子重新开局，按步数把命令一条条喂进去；回放期间不接受玩家输入
let playback = null;
function startPlayback(rec) {
  if (rec.w !== W || rec.h !== H) allocGrid(rec.w, rec.h), resizeRenderer();
  cmdRecording = false;
  resetWorld(rec.seed);
  playback = { rec, p: 0 };
  setPaused(false);
  $('btnPlayStop').style.display = '';
  toast('开始回放：' + rec.log.length + ' 条命令、' + rec.steps + ' 步');
}
function stopPlayback(done) {
  if (!playback) return;
  const rec = playback.rec;
  playback = null;
  cmdRecording = true;
  cmdLog = rec.log.slice();                              // 回放完接着录：后面的操作接在原录制后面
  $('btnPlayStop').style.display = 'none';
  syncGravityUI(); syncEnvUI();
  toast(done ? '回放完成，哈希 ' + worldHash() : '已停止回放');
}
// 主循环里每个模拟步之前调用：把这一步该执行的命令喂进去
function playbackTick() {
  const pb = playback;
  if (!pb) return;
  const log = pb.rec.log;
  while (pb.p < log.length && log[pb.p].step === tick) { const c = log[pb.p++]; COMMANDS[c.command](c.args); }
  if (pb.p >= log.length && tick >= pb.rec.steps) stopPlayback(true);
}

function importJSON(file) {
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onload = () => {
      try { loadAnySave(String(fr.result), file.name); resolve(true); }
      catch (e) { toast('导入失败：' + e.message); resolve(false); }
    };
    fr.onerror = () => { toast('读取文件失败'); resolve(false); };
    fr.readAsText(file);
  });
}

function screenshot() {
  renderFrame(performance.now(), 16.7);                  // WebGL 画布必须在同一个任务里画完再读
  if (gl) canvas.toBlob(b => b && downloadBlob(b, stampName('png')), 'image/png');
  else {
    const out = document.createElement('canvas');
    out.width = W * CELL; out.height = H * CELL;
    const c = out.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(canvas, 0, 0, out.width, out.height);
    out.toBlob(b => b && downloadBlob(b, stampName('png')), 'image/png');
  }
}

const rec = { mr: null, chunks: [], timer: 0, endAt: 0 };

function toggleRecord() {
  if (rec.mr) { rec.mr.stop(); return; }
  if (!canvas.captureStream || !window.MediaRecorder) { toast('这个浏览器不支持录制'); return; }
  const secs = Math.min(30, Math.max(5, +$('selRec').value));
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  let mr;
  try { mr = new MediaRecorder(canvas.captureStream(60), mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined); }
  catch (e) { toast('无法开始录制：' + e.message); return; }
  rec.mr = mr; rec.chunks = []; rec.endAt = performance.now() + secs * 1000;
  mr.ondataavailable = e => { if (e.data && e.data.size) rec.chunks.push(e.data); };
  mr.onstop = () => {
    clearInterval(rec.timer);
    rec.mr = null;
    $('btnRec').textContent = '录制'; $('btnRec').classList.remove('warn'); $('recdot').style.display = 'none';
    if (rec.chunks.length) { downloadBlob(new Blob(rec.chunks, { type: 'video/webm' }), stampName('webm')); toast('录制完成，已下载 WebM'); }
  };
  mr.start(250);
  $('btnRec').textContent = '停止'; $('btnRec').classList.add('warn'); $('recdot').style.display = 'block';
  rec.timer = setInterval(() => {
    const left = Math.max(0, rec.endAt - performance.now());
    $('recdot').textContent = '录制中 ' + (left / 1000).toFixed(1) + ' 秒';
    if (left <= 0 && rec.mr) rec.mr.stop();
  }, 100);
}

/* ---------------------------------------------------------------------
 * 5.5 载入预设场景（场景本身在 2.15）
 * ------------------------------------------------------------------- */
function loadScene(k) {
  if (uiLocked()) return;
  pushUndo();
  execCmd('loadScene', { index: k });
  syncGravityUI(); syncEnvUI();
  if (paused) setPaused(false);
  toast('场景：' + SCENES[k].name + ' — ' + SCENES[k].note);
}

/* ---------------------------------------------------------------------
 * 5.6 控制条、弹层、快捷键
 * ------------------------------------------------------------------- */
function setPaused(v) {
  paused = v;
  $('btnPause').textContent = paused ? '▶ 继续' : '❚❚ 暂停';
  $('btnPause').classList.toggle('warn', paused);
}

function syncGravityUI() {
  document.querySelectorAll('#gravGrp button').forEach(b => b.classList.toggle('on', b.dataset.g === gravity));
}

function setBrushSize(v) {
  brush.size = Math.max(1, Math.min(30, v | 0));
  $('rngSize').value = brush.size; $('lblSize').textContent = brush.size;
  updateCursor();
}

function setView(v) {
  viewMode = v % VIEW_NAMES.length;
  $('btnView').textContent = '视图：' + VIEW_NAMES[viewMode];
  $('btnView').classList.toggle('on', viewMode !== 0);
  sceneDirty = true;
}

let clearArmed = 0;
function requestClear() {
  const b = $('btnClear');
  if (clearArmed) {
    clearTimeout(clearArmed); clearArmed = 0;
    b.textContent = '清空'; b.classList.remove('armed');
    if (uiLocked()) return;
    pushUndo(); execCmd('clear', {});
    toast('已清空（可撤销）');
    return;
  }
  b.textContent = '再按一次确认'; b.classList.add('armed');
  clearArmed = setTimeout(() => { clearArmed = 0; b.textContent = '清空'; b.classList.remove('armed'); }, 2500);
}

function closePops() { document.querySelectorAll('.pop.show').forEach(p => p.classList.remove('show')); }

function togglePop(btn) {
  const pop = $(btn.dataset.pop), was = pop.classList.contains('show');
  closePops();
  if (was) return;
  if (pop.id === 'popSave') renderSlots();
  pop.classList.add('show');
  const r = btn.getBoundingClientRect();
  pop.style.top = r.bottom + 8 + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
}

const SETTING_LABELS = [
  ['bloom', '发光（Bloom）'], ['light', '动态光照'], ['distort', '热扭曲 / 折射 / 冲击波'], ['shake', '屏幕震动'],
  ['aberration', '爆炸闪白与色差'], ['tonemap', '色调映射（ACES）'], ['vignette', '暗角'], ['grain', '胶片颗粒'],
  ['smooth', '液面平滑'], ['texture', '固体纹理与立体光照'], ['shadows', '方向光阴影'], ['clouds', '云'],
  ['gridLines', '背景网格'], ['hd', '高清渲染（按屏幕像素比）'],
];
const settingBoxes = {};
// 画质档位：一次开关一组效果
const QUALITY = {
  low:   { bloom: false, light: false, distort: false, smooth: false, texture: false, shadows: false, clouds: true, grain: false, hd: false },
  mid:   { bloom: true, light: true, distort: false, smooth: false, texture: true, shadows: false, clouds: true, grain: false, hd: false },
  high:  { bloom: true, light: true, distort: true, smooth: true, texture: true, shadows: true, clouds: true, grain: true, hd: false },
  ultra: { bloom: true, light: true, distort: true, smooth: true, texture: true, shadows: true, clouds: true, grain: true, hd: true },
};
function setQuality(q) {
  const p = QUALITY[q];
  if (!p) return;
  const hdWas = settings.hd;
  for (const k in p) { settings[k] = p[k]; if (settingBoxes[k]) settingBoxes[k].checked = p[k]; }
  if (settings.hd !== hdWas) resizeRenderer();
  sceneDirty = true;
}

/* ---- 环境面板 ---- */
function syncEnvUI() {
  if (!$('envWind')) return;
  $('envWind').value = Math.round(env.wind * 100); $('envPower').value = Math.round(env.windPower * 100);
  $('envTemp').value = Math.round(env.temp); $('envTempVal').textContent = Math.round(env.temp) + '°C';
  $('envTime').value = Math.round(env.time * 100); $('envSpeed').value = String(env.timeScale);
  $('envHumid').value = Math.round(Math.min(100, env.moistPerMin / 6));
  $('envDayNight').checked = env.dayNight; $('envStruct').checked = env.structure;
  document.querySelectorAll('#envWeather button').forEach(b => b.classList.toggle('on', b.dataset.w === env.weather));
}

function buildEnvPanel() {
  const host = $('envWeather');
  for (const key in WEATHER_PRESETS) {
    const b = document.createElement('button');
    b.textContent = WEATHER_PRESETS[key].name; b.dataset.w = key; b.style.textAlign = 'center';
    b.addEventListener('click', () => { if (uiLocked()) return; execCmd('setWeather', { key }); syncEnvUI(); toast('天气：' + WEATHER_PRESETS[key].name); });
    host.appendChild(b);
  }
  const setE = (key, value) => { if (!uiLocked()) execCmd('setEnv', { key, value }); };
  $('envWind').addEventListener('input', e => setE('wind', +e.target.value / 100));
  $('envPower').addEventListener('input', e => setE('windPower', +e.target.value / 100));
  $('envHumid').addEventListener('input', e => { setE('moistPerMin', +e.target.value * 6); if (env.atmosCap < 1.2) setE('atmosCap', 3); });
  $('envTemp').addEventListener('input', e => { setE('temp', +e.target.value); $('envTempVal').textContent = env.temp + '°C'; });
  $('envTime').addEventListener('input', e => { setE('time', Math.min(0.999, +e.target.value / 100)); sceneDirty = true; });
  $('envSpeed').addEventListener('change', e => setE('timeScale', +e.target.value));
  $('envDayNight').addEventListener('change', e => { setE('dayNight', e.target.checked); sceneDirty = true; });
  $('envStruct').addEventListener('change', e => setE('structure', e.target.checked));
  $('envBolt').addEventListener('click', () => { selectTool(TOOL_LIGHTNING); closePops(); toast('闪电工具：在画面上点一下'); });
  $('selQuality').addEventListener('change', e => setQuality(e.target.value));
  $('selScale').addEventListener('change', e => { CELL = +e.target.value; fitGrid(true); toast('每格 ' + CELL + ' 像素，网格 ' + W + '×' + H); });
  syncEnvUI();
}

function buildControls() {
  $('btnPause').addEventListener('click', () => setPaused(!paused));
  $('btnStep').addEventListener('click', () => { setPaused(true); stepOnce = true; });
  $('selSpeed').addEventListener('change', e => { speed = +e.target.value; });
  document.querySelectorAll('#gravGrp button').forEach(b => b.addEventListener('click', () => { if (uiLocked()) return; execCmd('setGravity', { dir: b.dataset.g }); syncGravityUI(); }));
  document.querySelectorAll('[data-shape]').forEach(b => b.addEventListener('click', () => {
    brush.shape = b.dataset.shape;
    document.querySelectorAll('[data-shape]').forEach(o => o.classList.toggle('on', o === b));
    updateCursor();
  }));
  $('btnMode').addEventListener('click', () => {
    brush.replace = !brush.replace;
    $('btnMode').textContent = brush.replace ? '覆盖' : '填空';
    $('btnMode').classList.toggle('on', brush.replace);
  });
  $('rngSize').addEventListener('input', e => setBrushSize(+e.target.value));
  $('btnView').addEventListener('click', () => setView(viewMode + 1));
  $('btnUndo').addEventListener('click', undo);
  $('btnClear').addEventListener('click', requestClear);
  $('btnShot').addEventListener('click', screenshot);
  $('btnRec').addEventListener('click', toggleRecord);
  $('btnMute').addEventListener('click', () => {
    audioStart();
    audio.muted = !audio.muted;
    $('btnMute').textContent = audio.muted ? '静音' : '声音';
    $('btnMute').classList.toggle('warn', audio.muted);
    audioSetVolume();
  });
  $('rngVol').addEventListener('input', e => { audioStart(); audio.volume = +e.target.value / 100; audioSetVolume(); });
  document.querySelectorAll('[data-pop]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); togglePop(b); }));
  document.querySelectorAll('.pop').forEach(p => p.addEventListener('pointerdown', e => e.stopPropagation()));
  window.addEventListener('pointerdown', e => { if (!e.target.closest('[data-pop]')) closePops(); });
  window.addEventListener('pointerdown', audioStart, { once: true });

  SCENES.forEach((s, k) => {
    const b = document.createElement('button');
    b.innerHTML = '<span></span><small></small>';
    b.firstChild.textContent = (k + 1) + '. ' + s.name; b.lastChild.textContent = s.note;
    b.addEventListener('click', () => { loadScene(k); closePops(); });
    $('sceneList').appendChild(b);
  });

  for (const [key, label] of SETTING_LABELS) {
    const l = document.createElement('label'), c = document.createElement('input');
    c.type = 'checkbox'; c.checked = settings[key];
    settingBoxes[key] = c;
    c.addEventListener('change', () => {
      settings[key] = c.checked;
      if (key === 'hd') resizeRenderer();
      sceneDirty = true;
    });
    l.appendChild(c); l.appendChild(document.createTextNode(label));
    $('settingList').appendChild(l);
  }
  $('renderInfo').textContent = renderMode === 'webgl2'
    ? '渲染：WebGL2' + (R.hdr ? '（HDR 浮点缓冲）' : '（8 位缓冲）') + '。按 ` 打开调试面板。'
    : '渲染：Canvas2D 退路（没有 WebGL2）。发光、光照、扭曲等后处理不可用。';

  $('btnSlotSave').addEventListener('click', saveSlot);
  $('slotName').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') saveSlot(); });
  $('btnExport').addEventListener('click', exportJSON);
  $('btnRecExport').addEventListener('click', exportRecording);
  $('btnPlayStop').addEventListener('click', () => stopPlayback(false));
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', e => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; });
}

const GRAV_CYCLE = ['down', 'left', 'up', 'right'];
let debugOn = false;

function bindKeys() {
  window.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' && e.target.type === 'text') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); if (e.target.blur && tag === 'BUTTON') e.target.blur(); setPaused(!paused); }
    else if (k === '.') { setPaused(true); stepOnce = true; }
    else if (k === 'g' || k === 'G') { if (!uiLocked()) { execCmd('setGravity', { dir: GRAV_CYCLE[(GRAV_CYCLE.indexOf(gravity) + 1) % 4] }); syncGravityUI(); } }
    else if (k === 'v' || k === 'V') setView(viewMode + 1);
    else if (k === 'c' || k === 'C') requestClear();
    else if (k === '[') setBrushSize(brush.size - 1);
    else if (k === ']') setBrushSize(brush.size + 1);
    else if (k === '`' || k === '~') { debugOn = !debugOn; $('debug').style.display = debugOn ? 'block' : 'none'; }
    else if (k === 'Escape') closePops();
    else if (HOTKEYS[k] !== undefined) selectTool(HOTKEYS[k]);
  });
}

/* ---------------------------------------------------------------------
 * 5.7 自适应：窗口变化时重建网格，但保留场景内容（按底边居中对齐）
 * ------------------------------------------------------------------- */
function fitGrid(force) {
  const w = Math.max(48, Math.floor(stage.clientWidth / CELL)), h = Math.max(48, Math.floor(stage.clientHeight / CELL));
  if (!force && w === W && h === H) return;
  if (N === 0) allocGrid(w, h);
  else execCmd('resize', { w, h });                      // 换网格尺寸也记进录制，回放时网格会跟着变
  resizeRenderer();
  undoLen = 0; undoHead = 0;
}

let resizeTimer = 0;
function bindResize() {
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!testRunning) fitGrid(false); }, 160);
  }).observe(stage);
}

/* ---------------------------------------------------------------------
 * 5.8 状态栏、检视器、调试面板
 * ------------------------------------------------------------------- */
function sumCloudUI() { let s = 0; for (let c = 0; c < GW * GH; c++) s += cloud[c]; return s; }
const hud = { frames: 0, last: 0, fps: 0, simRate: 0, lastSteps: 0, interval: 16.7, work: 0, throttled: false };

function updateHud(now) {
  const dt = now - hud.last;
  if (dt < 250) return;
  hud.fps = hud.frames * 1000 / dt;
  hud.simRate = (simStepsTotal - hud.lastSteps) * 1000 / dt;
  hud.frames = 0; hud.last = now; hud.lastSteps = simStepsTotal;
  $('stFps').textContent = Math.round(hud.fps);
  $('stSim').textContent = paused ? '暂停' : Math.round(hud.simRate);
  $('stCount').textContent = (particleCount + fpCount).toLocaleString();
  $('stMode').textContent = renderMode === 'webgl2' ? 'WebGL2' : 'Canvas2D';
  // rAF 间隔明显大于 16.7ms，而我们自己每帧的活儿（含 GPU）远小于间隔 → 是浏览器在降频，不是性能问题
  hud.throttled = document.hidden || (hud.fps < 50 && hud.work + perf.gpu < 8);
  $('stThrottle').classList.toggle('hide', !hud.throttled);
  $('stThrottle').textContent = 'rAF 被降频（实际 ' + (hud.fps < 10 ? hud.fps.toFixed(1) : Math.round(hud.fps)) + ' 帧/秒，每帧只需 ' + (hud.work + perf.gpu).toFixed(1) + 'ms）';

  // 检视器
  if (inb(pointer.hx, pointer.hy) && pointer.inside) {
    const i = pointer.hx + pointer.hy * W, t = type[i], f = flags[i], m = MATERIALS[t];
    let s = m.name + ' · ' + Math.round(temp[i]) + '°C · ' + STATE_NAMES[m.state];
    if ((t === METAL || t === STEEL) && temp[i] > 450) s = '热' + s;
    if (f & F_BODY) s += ' · 刚体（下落中）';
    else if (M_RIGID[t] && M_HARD[t] <= 1) s += ' · 完整度 ' + aux[i];
    if (wet[i] > 0 && t !== 0) s += ' · 含水 ' + wet[i];
    if (t === 0 && aux[i] > 20) s += ' · 空气浑浊 ' + aux[i];
    if (t === CLONE && life[i]) s += ' · 复制：' + MATERIALS[life[i]].name;
    else if (life[i] && t !== 0 && !(f & F_BODY)) s += ' · ' + (M_BLAST[t] && (f & F_BURN) ? '引信 ' : f & F_TIP ? '生长能量 ' : M_LATENT[t] ? '融化进度 ' : t === PLANT || t === FLOWER || t === SEED ? '年龄 ' : '寿命 ') + life[i];
    if (fuel[i] > 0 && (f & F_BURN)) s += ' · 剩余燃料 ' + fuel[i];
    if (f & F_BURN) s += ' · 燃烧中';
    if (f & F_SCORCH) s += ' · 焦黑';
    if (charge[i]) s += ' · 带电';
    $('stInspect').textContent = s + '  (' + pointer.hx + ', ' + pointer.hy + ')';
  } else $('stInspect').textContent = '—';

  if (debugOn) {
    const n = Math.max(1, perf.frames || 1), sN = Math.max(1, perf.steps);
    $('debug').textContent =
      '网格        ' + W + ' x ' + H + '  (' + CW * CHN + ' 块)\n' +
      '活跃块      ' + perf.activeChunks + ' / ' + CW * CHN + '\n' +
      '飞行粒子    ' + fpCount + ' / ' + FP_MAX + '\n' +
      '爆炸 / 带电 ' + exActive + ' / ' + elecCount + '\n' +
      '刚体        ' + bodyCount + ' / ' + BODY_MAX + '   (支撑检测 ' + structStats.checks + ' 次)\n' +
      '环境        ' + (env.time * 24).toFixed(1) + ' 时  ' + env.ambient.toFixed(0) + '°C  云 ' + sumCloudUI().toFixed(0) + '  雨 ' + env.rainCount + '  雪 ' + env.snowCount + '  闪电 ' + env.strikes + '\n' +
      '模拟步数    ' + (perf.steps / n).toFixed(2) + ' 步/帧  (' + Math.round(hud.simRate) + ' 步/秒)\n' +
      '── 每帧耗时 (ms) ──\n' +
      '模拟·粒子   ' + (perf.cells / n).toFixed(2) + '   (每步 ' + (perf.cells / sN).toFixed(2) + ')\n' +
      '模拟·温度   ' + (perf.thermal / n).toFixed(2) + '\n' +
      '模拟·结构   ' + (perf.struct / n).toFixed(2) + '   (支撑检测 + 刚体)\n' +
      '模拟·天气   ' + (perf.weather / n).toFixed(2) + '   (风 / 湿度 / 云 / 昼夜)\n' +
      '模拟·慢过程 ' + (perf.slow / n).toFixed(2) + '   (蒸发 / 植物 / 渗水)\n' +
      '模拟·其他   ' + (perf.misc / n).toFixed(2) + '   (爆炸 / 电 / 飞行粒子)\n' +
      '渲染·打包   ' + (perf.pack / n).toFixed(2) + '\n' +
      '渲染·场景   ' + (perf.draw / n).toFixed(2) + '\n' +
      '渲染·后处理 ' + (perf.post / n).toFixed(2) + '\n' +
      'GPU 完成    ' + perf.gpu.toFixed(2) + '  (抽样 gl.finish)\n' +
      'rAF 间隔    ' + hud.interval.toFixed(1) + '   CPU 合计 ' + hud.work.toFixed(2) + '\n' +
      '渲染后端    ' + renderMode + (gl ? ' ' + canvas.width + 'x' + canvas.height + (R.hdr ? ' HDR' : '') : '');
  }
  perf.cells = perf.thermal = perf.misc = perf.struct = perf.weather = perf.slow = perf.pack = perf.draw = perf.post = 0; perf.steps = 0; perf.frames = 0;
}
