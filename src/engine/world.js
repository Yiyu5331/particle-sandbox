'use strict';
import { cmdRecording, commandsLoad, commandsSave, commandsSet, execCmd, recordingOf, replay, resetWorld, worldSeed } from './commands.js';
import { electricLoad, electricSave } from './electric.js';
import { ENV_DEFAULTS, env, envLoad, envSave } from './env.js';
import { eventsCollect, eventsLoad, eventsSave, scanNewMaterials } from './events.js';
import { explosionLoad, explosionSave } from './explosion.js';
import { F_BODY, F_BURN, H, W, allocGrid, aux, charge, flags, fuel, gridLoad, gridSave, life, seed, temp, tick, type, wet } from './grid.js';
import { MATERIALS, NT, TOOL_ERASE } from './materials.js';
import { particlesLoad, particlesSave } from './particles.js';
import { rngLoad, rngSave } from './rng.js';
import { scenesLoad, scenesSave } from './scenes.js';
import { deserializeWorld, serializeLoad, serializeSave, serializeWorld, worldHash } from './serialize.js';
import { slowLoad, slowSave } from './slow.js';
import { simStep, stepLoad, stepSave } from './step.js';
import { structureLoad, structureSave } from './structure.js';
import { GH, GW, cloud, heatC, vapor, weatherLoad, weatherSave, windX } from './weather.js';
/* =====================================================================
 * 公开世界 API（docs/API.md）。
 *
 * 引擎内部是“模块级状态”（每个模块自己的 let 变量，见 *Save/*Load）。
 * 多个世界的做法：同一时刻只有一个世界“在台上”，调用某个世界的方法时，
 * 先把台上世界的全部模块状态（只是引用，不复制）收起来，再把这个世界的装上去。
 * 所以切换很便宜（几十个引用赋值），但不能在两个世界之间交错地“同时”跑一步。
 *
 * 没有调用过 createWorld 时，模块状态就是“宿主默认世界”（老测试、沙盘直接用）。
 * ===================================================================== */

const MODULES = [
  ['grid', gridSave, gridLoad], ['env', envSave, envLoad], ['rng', rngSave, rngLoad], ['serialize', serializeSave, serializeLoad],
  ['slow', slowSave, slowLoad], ['particles', particlesSave, particlesLoad], ['explosion', explosionSave, explosionLoad],
  ['electric', electricSave, electricLoad], ['structure', structureSave, structureLoad], ['weather', weatherSave, weatherLoad],
  ['scenes', scenesSave, scenesLoad], ['commands', commandsSave, commandsLoad], ['step', stepSave, stepLoad], ['events', eventsSave, eventsLoad],
];
function captureAll() { const s = {}; for (const [k, save] of MODULES) s[k] = save(); return s; }
function loadAll(s) { for (const [k, , load] of MODULES) load(s[k]); }

// 深拷贝：类型数组按 buffer 复制（共享 buffer 的视图拷完仍然共享），对象按身份去重，函数保留原引用
export function cloneState(v, memo = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (memo.has(v)) return memo.get(v);
  let out;
  if (ArrayBuffer.isView(v)) {
    let buf = memo.get(v.buffer);
    if (!buf) { buf = v.buffer.slice(0); memo.set(v.buffer, buf); }
    out = new v.constructor(buf, v.byteOffset, v.length);
  } else if (Array.isArray(v)) {
    out = new Array(v.length); memo.set(v, out);
    for (let i = 0; i < v.length; i++) out[i] = cloneState(v[i], memo);
    return out;
  } else if (v instanceof Map) {
    out = new Map(); memo.set(v, out);
    for (const [k, x] of v) out.set(k, cloneState(x, memo));
    return out;
  } else {
    out = {}; memo.set(v, out);
    for (const k of Object.keys(v)) out[k] = cloneState(v[k], memo);
    return out;
  }
  memo.set(v, out);
  return out;
}

const PRISTINE = cloneState(captureAll());   // 模块刚加载时的状态：新世界从它开始
let active = null;                           // 台上的世界；null = 宿主默认世界
let hostState = null;                        // 宿主默认世界被收起来时的状态

function activate(w) {
  if (active === w) return;
  if (w !== null && w.disposed) throw new Error('这个世界已经 dispose 了');
  const cur = captureAll();
  if (active === null) hostState = cur; else active._state = cur;
  if (w === null) { loadAll(hostState); hostState = null; } else { loadAll(w._state); w._state = null; }
  active = w;
}
// 让宿主默认世界回到台上（老测试、直接调用模块函数的代码之前调用）
export function activateHostWorld() { activate(null); }
export function activeWorld() { return active; }

// 事件类型的固定顺序（docs/API.md）
export const EVENT_TYPES = ['reaction', 'materialFirstCreated', 'ignite', 'extinguish', 'explosion', 'collapse', 'lightning', 'regionChanged'];
export const FIELDS = ['type', 'temp', 'flags', 'seed', 'life', 'fuel', 'wet', 'aux', 'charge', 'vapor', 'cloud', 'windX', 'heat'];

function regionContains(r, x, y) {
  const qx = x - r.x, qy = y - r.y;
  if (qx < 0 || qy < 0 || qx >= r.w || qy >= r.h) return false;
  return r.mask ? r.mask[qx + qy * r.w] !== 0 : true;
}
function normArea(a) {
  const r = { x: a.x | 0, y: a.y | 0, w: a.w | 0, h: a.h | 0, mask: a.mask || null };
  if (r.mask && r.mask.length < r.w * r.h) throw new Error('mask 长度不够 w*h');
  return r;
}

/**
 * 新建一个世界。
 * @param {{width:number,height:number,seed?:number}} opts
 */
export function createWorld(opts) {
  const o = opts || {};
  const width = o.width | 0, height = o.height | 0, seedValue = o.seed === undefined ? 1 : o.seed >>> 0;
  if (width < 16 || height < 16) throw new Error('世界至少 16×16');
  const w = new World();
  w._state = cloneState(PRISTINE);
  const prev = active;
  activate(w);
  Object.assign(env, JSON.parse(JSON.stringify(ENV_DEFAULTS)));
  allocGrid(width, height);
  resetWorld(seedValue);
  commandsSet('cmdRecording', true);
  if (prev !== w) { /* 留在台上：下一次调用别的世界时自动换下 */ }
  return w;
}

class World {
  constructor() {
    this._state = null; this.disposed = false;
    this._regions = []; this._nextRegion = 1;
    this._handlers = new Map(); this._dispatching = false;
  }
  get width() { activate(this); return W; }
  get height() { activate(this); return H; }
  /** 当前步数 */
  get tick() { activate(this); return tick; }
  get seed() { activate(this); return worldSeed; }

  /** 往前走 n 步（默认 1）。每步结束按固定顺序派发事件。返回本次调用产生的全部事件。 */
  step(n = 1) {
    if (this._dispatching) throw new Error('事件处理函数里不能调用 world.step（不能改变本步结果）');
    activate(this);
    const all = this._handlers.size > 0 || this._collectAll ? [] : null;
    for (let k = 0; k < n; k++) {
      simStep();
      scanNewMaterials(type, W, H);
      const evs = eventsCollect(tick);
      this._regionEvents(evs);
      if (evs.length > 0) {
        if (all !== null) for (const e of evs) all.push(e);
        this._dispatch(evs);
        activate(this);                   // 处理函数可能切到了别的世界
      }
    }
    return all || [];
  }
  _regionEvents(evs) {
    for (const r of this._regions) {
      if (!r.track) continue;
      let h = 0x811c9dc5 | 0;
      for (let y = Math.max(0, r.y), y1 = Math.min(H, r.y + r.h); y < y1; y++) {
        for (let x = Math.max(0, r.x), x1 = Math.min(W, r.x + r.w); x < x1; x++) {
          if (r.mask && r.mask[(x - r.x) + (y - r.y) * r.w] === 0) continue;
          h = Math.imul(h ^ type[x + y * W], 16777619);
        }
      }
      if (h !== r._sum) {
        const first = r._sum === undefined;
        r._sum = h;
        if (!first) evs.push({ type: 'regionChanged', step: tick, region: r.id, tag: r.tag, counts: this._countsOf(r) });
      }
    }
  }
  _dispatch(evs) {
    this._dispatching = true;
    let err = null;
    try {
      for (const e of evs) {
        const hs = this._handlers.get(e.type), hs2 = this._handlers.get('*');
        if (hs) for (const fn of hs.slice()) { try { fn(e, this); } catch (x) { if (!err) err = x; } }
        if (hs2) for (const fn of hs2.slice()) { try { fn(e, this); } catch (x) { if (!err) err = x; } }
      }
    } finally { this._dispatching = false; }
    if (err) throw err;
  }
  /** 订阅事件：type 为 EVENT_TYPES 之一或 '*'。返回取消订阅函数。 */
  on(t, fn) {
    if (t !== '*' && EVENT_TYPES.indexOf(t) < 0) throw new Error('未知事件类型：' + t);
    if (!this._handlers.has(t)) this._handlers.set(t, []);
    this._handlers.get(t).push(fn);
    return () => this.off(t, fn);
  }
  off(t, fn) {
    const hs = this._handlers.get(t); if (!hs) return;
    const i = hs.indexOf(fn); if (i >= 0) hs.splice(i, 1);
    if (hs.length === 0) this._handlers.delete(t);
  }

  /** 世界状态哈希（16 位十六进制）。 */
  hash() { activate(this); return worldHash(); }

  /** 读一格。越界返回 null。 */
  getCell(x, y) {
    activate(this);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const i = x + y * W, t = type[i];
    return { x, y, type: t, key: MATERIALS[t].key, name: MATERIALS[t].name, temp: temp[i], flags: flags[i], seed: seed[i],
      life: life[i], fuel: fuel[i], wet: wet[i], aux: aux[i], charge: charge[i],
      burning: (flags[i] & F_BURN) !== 0, inBody: (flags[i] & F_BODY) !== 0 };
  }
  /**
   * 整张场的只读视图（活的类型数组，不要写！要写请用 exec）。粗网格场（vapor/cloud/windX/heat）尺寸是 fieldSize().
   * @param {string} name FIELDS 之一
   * @param {{copy?:boolean}} [opt] copy:true 返回副本
   */
  getField(name, opt) {
    activate(this);
    let a;
    switch (name) {
      case 'type': a = type; break; case 'temp': a = temp; break; case 'flags': a = flags; break; case 'seed': a = seed; break;
      case 'life': a = life; break; case 'fuel': a = fuel; break; case 'wet': a = wet; break; case 'aux': a = aux; break;
      case 'charge': a = charge; break; case 'vapor': a = vapor; break; case 'cloud': a = cloud; break;
      case 'windX': a = windX; break; case 'heat': a = heatC; break;
      default: throw new Error('未知场：' + name);
    }
    return opt && opt.copy ? a.slice() : a;
  }
  /** 粗网格（天气场）尺寸 */
  fieldSize(name) { activate(this); return ['vapor', 'cloud', 'windX', 'heat'].indexOf(name) >= 0 ? { w: GW, h: GH } : { w: W, h: H }; }
  /** 所有场的只读视图（活的）。世界换尺寸（resize）后要重新取。 */
  views() { const v = {}; for (const f of FIELDS) v[f] = this.getField(f); v.width = W; v.height = H; return Object.freeze(v); }
  /** 环境参数（只读副本） */
  getEnv() { activate(this); const e = {}; for (const k of Object.keys(env)) if (typeof env[k] !== 'function') e[k] = env[k]; return e; }

  /**
   * 统计一块区域。area 是 {x,y,w,h}、{x,y,w,h,mask}（mask[w*h] 非 0 的格算在内）或区域 id。
   * @returns {{cells:number,counts:Uint32Array,byKey:Object<string,number>,burning:number,avgTemp:number,maxTemp:number,minTemp:number}}
   */
  queryRegion(area) {
    activate(this);
    const r = typeof area === 'number' ? this._region(area) : normArea(area);
    return this._countsOf(r, true);
  }
  _countsOf(r, full) {
    const counts = new Uint32Array(NT);
    let cells = 0, burning = 0, sumT = 0, maxT = -Infinity, minT = Infinity;
    for (let y = Math.max(0, r.y), y1 = Math.min(H, r.y + r.h); y < y1; y++) {
      for (let x = Math.max(0, r.x), x1 = Math.min(W, r.x + r.w); x < x1; x++) {
        if (r.mask && r.mask[(x - r.x) + (y - r.y) * r.w] === 0) continue;
        const i = x + y * W;
        counts[type[i]]++; cells++;
        if (full) { if (flags[i] & F_BURN) burning++; const t = temp[i]; sumT += t; if (t > maxT) maxT = t; if (t < minT) minT = t; }
      }
    }
    const byKey = {};
    for (let t = 0; t < NT; t++) if (counts[t] > 0 && MATERIALS[t]) byKey[MATERIALS[t].key] = counts[t];
    if (!full) return byKey;
    return { cells, counts, byKey, burning, avgTemp: cells ? sumT / cells : 0, maxTemp: cells ? maxT : 0, minTemp: cells ? minT : 0 };
  }

  /**
   * 执行一条命令（所有写操作都走这里，会被录制）。
   * 命令形如 {command:'stroke', args:{...}} 或 exec('stroke', {...})。
   * stroke 返回 {placed, removed}（预算系统用）；args.limit 限制最多放几格。
   * 落在 protect 区域里的点命令（ignite/explode/spawn）被拒绝：返回 {rejected:'protected', region}，不执行也不录制。
   */
  exec(command, args) {
    activate(this);
    if (command && typeof command === 'object') { args = command.args; command = command.command; }
    const a = args || {};
    if (command === 'ignite' || command === 'explode' || command === 'spawn') {
      for (const r of this._regions) if (r.rules.protect && regionContains(r, a.x | 0, a.y | 0)) return { rejected: 'protected', region: r.id };
    }
    return execCmd(command, a);
  }

  /** 内存快照（深拷贝全部模块状态 + 区域），比 serialize 快得多。 */
  snapshot() {
    activate(this);
    return { kind: 'world-snapshot', state: cloneState(captureAll()), regions: cloneState(this._regionsOut()), nextRegion: this._nextRegion };
  }
  restore(snap) {
    if (!snap || snap.kind !== 'world-snapshot') throw new Error('不是 world.snapshot() 的结果');
    activate(this);
    loadAll(cloneState(snap.state));
    this._setRegions(cloneState(snap.regions)); this._nextRegion = snap.nextRegion;
  }
  /** 完整存档（JSON 字符串）：引擎全部模拟状态 + 区域。 */
  serialize() {
    activate(this);
    return JSON.stringify({ app: 'particle-sandbox', kind: 'world', v: 1, seed: worldSeed, engine: JSON.parse(serializeWorld()), regions: this._regionsOut(true), nextRegion: this._nextRegion });
  }
  deserialize(str) {
    const o = typeof str === 'string' ? JSON.parse(str) : str;
    if (!o || o.app !== 'particle-sandbox') throw new Error('不是存档');
    activate(this);
    if (o.kind === 'full') { deserializeWorld(o); return; }    // 也接受老的完整存档
    if (o.kind !== 'world') throw new Error('不是世界存档');
    deserializeWorld(o.engine);
    commandsSet('worldSeed', o.seed);
    this._setRegions(o.regions.map(r => Object.assign({}, r, { mask: r.mask ? Uint8Array.from(r.mask) : null })));
    this._nextRegion = o.nextRegion;
  }

  /** 录制：从 seed 开始的全部命令（含区域定义）。 */
  recording() { activate(this); return Object.assign(recordingOf(worldSeed, W, H), { regions: this._regionsOut(true) }); }
  /** 回放录制，跑到 steps 步（默认录制的步数），返回哈希。回放时不派发事件。 */
  replay(rec, steps) {
    activate(this);
    if (rec.regions) this._setRegions(rec.regions.map(r => Object.assign({}, r, { mask: r.mask ? Uint8Array.from(r.mask) : null })));
    const h = replay(rec, steps);
    commandsSet('worldSeed', rec.seed);
    return h;
  }
  /** 重新开始：清空网格、步数归零、换种子（区域保留） */
  reset(seedValue) { activate(this); resetWorld(seedValue === undefined ? worldSeed : seedValue >>> 0); }
  setRecording(on) { activate(this); commandsSet('cmdRecording', !!on); }
  get recordingOn() { activate(this); return cmdRecording; }

  /* ---------- 区域 ---------- */
  /**
   * 加一个带标签的区域。
   * @param {{tag?:string,x:number,y:number,w:number,h:number,mask?:Uint8Array,track?:boolean,
   *          rules?:{protect?:boolean,paint?:boolean,erase?:boolean,allow?:number[]}}} def
   * rules.protect：玩家笔刷完全不能改这里的格，点命令（点火/爆炸/生成）也被拒绝
   * rules.paint=false：不能放材料；rules.erase=false：不能擦；rules.allow：只允许放这些材料
   * track:true：区域内容变化时发 regionChanged 事件
   * @returns {number} 区域 id
   */
  addRegion(def) {
    activate(this);
    const r = normArea(def);
    r.id = this._nextRegion++; r.tag = def.tag || ''; r.track = !!def.track; r.rules = Object.assign({}, def.rules || {});
    this._regions.push(r);
    this._applyFilter();
    return r.id;
  }
  removeRegion(id) { activate(this); this._regions = this._regions.filter(r => r.id !== id); this._applyFilter(); }
  regions() { return this._regionsOut(); }
  regionAt(x, y) { return this._regions.filter(r => regionContains(r, x, y)).map(r => r.id); }
  _region(id) { const r = this._regions.find(q => q.id === id); if (!r) throw new Error('没有区域 ' + id); return r; }
  _regionsOut(plain) {
    return this._regions.map(r => ({ id: r.id, tag: r.tag, x: r.x, y: r.y, w: r.w, h: r.h, track: r.track, rules: Object.assign({}, r.rules),
      mask: r.mask ? (plain ? Array.from(r.mask) : r.mask) : null }));
  }
  _setRegions(list) {
    this._regions = list.map(r => ({ id: r.id, tag: r.tag, x: r.x, y: r.y, w: r.w, h: r.h, track: !!r.track, rules: Object.assign({}, r.rules), mask: r.mask || null }));
    this._applyFilter();
  }
  _applyFilter() {
    const rs = this._regions.filter(r => { const q = r.rules; return q.protect || q.paint === false || q.erase === false || q.allow; });
    if (rs.length === 0) { commandsSet('cmdCellFilter', null); return; }
    commandsSet('cmdCellFilter', (x, y, t) => {
      for (const r of rs) {
        if (!regionContains(r, x, y)) continue;
        const q = r.rules;
        if (q.protect) return false;
        if (t === TOOL_ERASE) { if (q.erase === false) return false; }
        else { if (q.paint === false) return false; if (q.allow && q.allow.indexOf(t) < 0) return false; }
      }
      return true;
    });
  }

  /** 释放：之后不能再用。若它在台上，宿主默认世界回到台上。 */
  dispose() {
    if (this.disposed) return;
    if (active === this) activate(null);
    this._state = null; this._handlers.clear(); this._regions = []; this.disposed = true;
  }
}
