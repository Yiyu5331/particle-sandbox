
/* =====================================================================
 * 2.16 世界状态：哈希、完整存档、命令录制与回放
 *   · worldHash()        对所有会影响后续模拟的状态算一个 64 位哈希（16 位十六进制）
 *   · serializeWorld()   完整存档：格子、温度、含水量、湿度场、云、风场、刚体、飞行粒子、
 *                        爆炸池、带电列表、随机数状态、天气和时间……读档后继续跑，结果逐格一致
 *   · execCmd()          玩家的每一次操作都走这里，记成 {step, command, args}，可以回放
 *   诊断用的计数（水量账本、结构统计、渲染涟漪）进存档，但不进哈希。
 * ===================================================================== */

// ---- 哈希 ----
let _h1 = 0, _h2 = 0;
function hashReset() { _h1 = 0x811c9dc5 | 0; _h2 = 0x01000193 ^ 0x5bd1e995; }
function hashWord(w) {
  _h1 = Math.imul(_h1 ^ w, 0x01000193);
  _h2 = Math.imul(_h2 ^ w, 0x5bd1e995); _h2 ^= _h2 >>> 15;
}
const _hf = new Float64Array(1), _hu = new Uint32Array(_hf.buffer);
function hashNum(v) { _hf[0] = v; hashWord(_hu[0]); hashWord(_hu[1]); }
function hashStr(s) { hashWord(s.length); for (let i = 0; i < s.length; i++) hashWord(s.charCodeAt(i)); }
function hashBytes(ta, len) {
  const u8 = new Uint8Array(ta.buffer, ta.byteOffset, len === undefined ? ta.byteLength : len * ta.BYTES_PER_ELEMENT);
  const n4 = u8.byteLength >> 2;
  hashWord(u8.byteLength);
  if ((u8.byteOffset & 3) === 0) {
    const u32 = new Uint32Array(u8.buffer, u8.byteOffset, n4);
    for (let i = 0; i < n4; i++) hashWord(u32[i]);
  } else for (let i = 0; i < n4; i++) hashWord(u8[i * 4] | (u8[i * 4 + 1] << 8) | (u8[i * 4 + 2] << 16) | (u8[i * 4 + 3] << 24));
  for (let i = n4 << 2; i < u8.byteLength; i++) hashWord(u8[i]);
}
function hashValue(v) {
  if (v === null || v === undefined) { hashWord(0x7f7f7f7f); return; }
  if (typeof v === 'number') { hashNum(v); return; }
  if (typeof v === 'boolean') { hashWord(v ? 1 : 2); return; }
  if (typeof v === 'string') { hashStr(v); return; }
  if (ArrayBuffer.isView(v)) { hashBytes(v); return; }
  if (Array.isArray(v)) { hashWord(v.length); for (const x of v) hashValue(x); return; }
  const keys = Object.keys(v).sort();
  for (const k of keys) { hashStr(k); hashValue(v[k]); }
}
function hex8(x) { return ('0000000' + (x >>> 0).toString(16)).slice(-8); }

// 参与哈希和存档的数组（顺序固定）。新增模拟状态时，在这里登记一行。
function stateArrays() {
  return [
    ['type', type], ['seed', seed], ['flags', flags], ['charge', charge], ['chargeE', chargeE], ['wet', wet], ['aux', aux],
    ['fuel', fuel], ['life', life], ['temp', temp], ['chunkTTL', chunkTTL],
    ['windX', windX], ['heatC', heatC], ['vapor', vapor], ['cloud', cloud], ['solidC', solidC], ['windShade', windShade],
    ['fpAlive', fpAlive], ['fpType', fpType], ['fpSeed', fpSeed], ['fpAge', fpAge], ['fpTemp', fpTemp], ['fpX', fpX], ['fpY', fpY],
    ['fpVX', fpVX], ['fpVY', fpVY], ['fpPX', fpPX], ['fpPY', fpPY], ['fpQX', fpQX], ['fpQY', fpQY],
    ['exA', exA], ['exX', exX], ['exY', exY], ['exR', exR], ['exP', exP], ['exCur', exCur], ['exN', exN], ['exPhase', exPhase], ['exRays', exRays],
    ['sdList', sdList.subarray(0, sdCount)],
  ];
}

// 参与哈希和存档的标量
function stateScalars() {
  return {
    W, H, tick, parity, gravity, rng: _rs, fpHead, fpCount, exActive, elecCount, slowPhase,
    structDirty, structFull, structCooldown, structHold, bodyCount, fracVX, fracVY, fracTick, pinTick, solidRow, sdCount,
  };
}

function bodyState(b) {
  const o = {};
  for (const k of Object.keys(b).sort()) o[k] = b[k];
  return o;
}

function worldHash() {
  hashReset();
  hashValue(stateScalars());
  for (const [name, arr] of stateArrays()) { hashStr(name); hashBytes(arr); }
  hashBytes(elecCur === null ? new Int32Array(0) : elecCur.subarray(0, elecCount));
  for (let k = 0; k < BODY_MAX; k++) { const b = bodies[k]; if (b) { hashWord(k); hashValue(bodyState(b)); } }
  const e = {};
  for (const k of Object.keys(env)) e[k] = env[k];
  hashValue(e);
  hashValue(sceneState);
  return hex8(_h1) + hex8(_h2);
}

// ---- 完整存档 ----
function taToB64(ta) { return bytesToB64(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)); }
function b64ToTA(b64, Ctor) {
  const u8 = b64ToBytes(b64);
  const copy = new Uint8Array(u8.length); copy.set(u8);
  return new Ctor(copy.buffer, 0, copy.length / Ctor.BYTES_PER_ELEMENT);
}
function encodeValue(v) {
  if (ArrayBuffer.isView(v)) return { $ta: v.constructor.name, b: taToB64(v) };
  return v;
}
const TA_CTORS = { Uint8Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, Int16Array, Int8Array };
function decodeValue(v) {
  if (v && typeof v === 'object' && v.$ta) return b64ToTA(v.b, TA_CTORS[v.$ta]);
  return v;
}

function serializeWorld() {
  const arrays = {};
  for (const [name, arr] of stateArrays()) arrays[name] = taToB64(arr);
  arrays.elec = taToB64(elecCur === null ? new Int32Array(0) : elecCur.subarray(0, elecCount));
  arrays.ripples = taToB64(ripples);
  const bs = [];
  for (let k = 0; k < BODY_MAX; k++) {
    const b = bodies[k];
    if (!b) { bs.push(null); continue; }
    const o = {};
    for (const key of Object.keys(b)) o[key] = encodeValue(b[key]);
    bs.push(o);
  }
  return JSON.stringify({
    app: 'particle-sandbox', v: 41, kind: 'full', scalars: stateScalars(), env: Object.assign({}, env), sceneState,
    arrays, bodies: bs, ledger: Object.assign({}, WL), structStats: Object.assign({}, structStats), rippleHead,
    lastBolt, cmdLogLen: cmdLog.length,
  });
}

function deserializeWorld(str) {
  const o = typeof str === 'string' ? JSON.parse(str) : str;
  if (!o || o.app !== 'particle-sandbox' || o.kind !== 'full') throw new Error('不是完整存档');
  const sc = o.scalars;
  allocGrid(sc.W, sc.H);
  setGravity(sc.gravity);                 // 先设重力：它会唤醒所有分块，必须在恢复分块状态之前
  const setArr = (dst, b64) => { const src = b64ToBytes(b64); new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength).set(src.subarray(0, dst.byteLength)); };
  for (const [name, arr] of stateArrays()) if (name !== 'sdList') setArr(arr, o.arrays[name]);
  const sd = b64ToTA(o.arrays.sdList, Int32Array);
  sdList.set(sd); sdCount = sd.length;
  for (let k = 0; k < sdCount; k++) sdSeen[sdList[k]] = 1;
  const el = b64ToTA(o.arrays.elec, Int32Array);
  if (el.length > 0) { elecCur = new Int32Array(N); elecNext = new Int32Array(N); elecCur.set(el); }
  setArr(ripples, o.arrays.ripples);
  bodiesClear();
  for (let k = 0; k < o.bodies.length; k++) {
    const src = o.bodies[k];
    if (!src) continue;
    const b = {};
    for (const key of Object.keys(src)) b[key] = decodeValue(src[key]);
    bodies[k] = b;
  }
  tick = sc.tick; parity = sc.parity; _rs = sc.rng;
  fpHead = sc.fpHead; fpCount = sc.fpCount; exActive = sc.exActive; elecCount = el.length; slowPhase = sc.slowPhase;
  structDirty = sc.structDirty; structFull = sc.structFull; structCooldown = sc.structCooldown; structHold = sc.structHold;
  bodyCount = sc.bodyCount; fracVX = sc.fracVX; fracVY = sc.fracVY; fracTick = sc.fracTick; pinTick = sc.pinTick;
  solidRow = sc.solidRow;
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, o.env);
  sceneState = o.sceneState;
  Object.assign(WL, o.ledger); Object.assign(structStats, o.structStats);
  rippleHead = o.rippleHead; lastBolt = o.lastBolt;
  sceneDirty = true;
}

/* ---------------------------------------------------------------------
 * 命令：所有改变世界的玩家操作都走 execCmd，按 {step, command, args} 记下来
 * ------------------------------------------------------------------- */
let cmdLog = [];
let cmdRecording = true;
let cmdHook = null;        // 宿主可以挂一个回调：命令执行后通知（区域规则、预算、UI 同步）

// 一个笔刷印章：返回 {placed, removed}（实际改动了多少格），给预算系统用
function stampCells(cx, cy, a, res) {
  const t = a.erase ? TOOL_ERASE : a.tool;
  const r = a.size - 1, r2 = r * r + r * 0.8;
  const round = a.shape !== 'square', spray = a.shape === 'spray' && r > 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (round && dx * dx + dy * dy > r2) continue;
    if (spray && rnd() > 0.1) continue;
    const x = cx + dx, y = cy + dy;
    if (cmdCellFilter !== null && !cmdCellFilter(x, y, t)) continue;
    const k = paintCell(x, y, t, a.replace);
    if (k > 0) res.placed++; else if (k < 0) res.removed++;
  }
}
let cmdCellFilter = null;  // 区域规则：返回 false 的格子笔刷不能动

const COMMANDS = {
  // 笔刷：从 (x0,y0) 画到 (x1,y1)，两点相同就是点一下
  stroke(a) {
    const res = { placed: 0, removed: 0 };
    const dx = a.x1 - a.x0, dy = a.y1 - a.y0, dist = Math.max(Math.abs(dx), Math.abs(dy));
    const stepLen = Math.max(1, a.size >> 1);
    if (dist > 0) for (let s = 0; s <= dist; s += stepLen) { const k = s / dist; stampCells(Math.round(a.x0 + dx * k), Math.round(a.y0 + dy * k), a, res); }
    stampCells(a.x1, a.y1, a, res);
    return res;
  },
  strokeBegin() { structHold = true; return null; },
  strokeEnd() { if (structHold) { structHold = false; clearPins(); markStructAll(); } return null; },
  fillRect(a) { fillRect(a.mat, a.x0, a.y0, a.x1, a.y1); return null; },
  fillCircle(a) { fillCircle(a.mat, a.cx, a.cy, a.r); return null; },
  clear() { clearGrid(); return null; },
  ignite(a) { setBurning(a.x, a.y); return null; },
  explode(a) { startExplosion(a.x, a.y, a.r || 15, a.p || 1); return null; },
  lightning(a) { lightning(a.x); return null; },
  setWeather(a) { setWeather(a.key); updateSun(); return null; },
  setEnv(a) {
    const allowed = ['wind', 'windPower', 'temp', 'time', 'timeScale', 'dayNight', 'structure', 'moistPerMin', 'atmosCap'];
    if (allowed.indexOf(a.key) < 0) throw new Error('setEnv 不允许修改 ' + a.key);
    env[a.key] = a.value;
    if (a.key === 'structure') markStructAll();
    updateSun();
    return null;
  },
  setGravity(a) { setGravity(a.dir); return null; },
  loadScene(a) { buildScene(a.index); return null; },
  restoreScene(a) { restoreScene(sceneFromJSON(a.json)); return null; },     // 撤销 / 读档（v3 风格的紧凑快照）
  restoreFull(a) { deserializeWorld(a.json); return null; },               // 读完整存档
  resize(a) {                                                             // 窗口变化：换网格尺寸，内容按底边居中保留
    const snap = N > 0 ? captureScene() : null;
    const keepTick = tick, keepPar = parity, keepRng = _rs;
    allocGrid(a.w, a.h);
    tick = keepTick; parity = keepPar; _rs = keepRng;
    if (snap && snap.n > 0) restoreScene(snap);
    return null;
  },
  spawn(a) { fillCircle(a.mat, a.x, a.y, a.r || 2); return null; },          // 生成灾难源（熔岩、火、克隆体……）
};

function execCmd(command, args) {
  const fn = COMMANDS[command];
  if (!fn) throw new Error('未知命令：' + command);
  const a = args || {};
  if (cmdRecording) cmdLog.push({ step: tick, command, args: a });
  const res = fn(a);
  if (cmdHook !== null) cmdHook(command, a, res);
  return res;
}

// 新开一个世界：清空网格、步数归零、设定种子、清空录制
function resetWorld(seedValue) {
  clearGrid();
  tick = 0; parity = 0; slowPhase = 0; pinTick = -100; fracTick = -100; structCooldown = 0; structHold = false;
  seedRng(seedValue);
  cmdLog = [];
}

// 回放：从 resetWorld(seed) 开始，按记录的步数执行命令，一直跑到 steps 步
function replay(rec, steps) {
  if (rec.w !== W || rec.h !== H) allocGrid(rec.w, rec.h);
  const saveRec = cmdRecording;
  cmdRecording = false;
  resetWorld(rec.seed);
  const log = rec.log;
  let p = 0;
  const end = steps === undefined ? rec.steps : steps;
  while (tick < end || (p < log.length && log[p].step === tick)) {
    while (p < log.length && log[p].step === tick) { const c = log[p++]; COMMANDS[c.command](c.args); }
    if (tick >= end) break;
    simStep();
  }
  cmdRecording = saveRec;
  return worldHash();
}

function recordingOf(seedValue, w, h) { return { app: 'particle-sandbox', kind: 'recording', v: 41, seed: seedValue, w, h, steps: tick, log: cmdLog.slice() }; }
