'use strict';
import { ignite } from './combustion.js';
import { ENV_DEFAULTS, env } from './env.js';
import { eventsReset } from './events.js';
import { startExplosion } from './explosion.js';
import { H, N, W, allocGrid, clearGrid, gridSet, parity, setGravity, tick } from './grid.js';
import { TOOL_ERASE } from './materials.js';
import { fillCircle, fillRect, paintCell } from './paint.js';
import { _rs, rnd, seedRng, setRngState } from './rng.js';
import { buildScene, scenesSet, setBurning } from './scenes.js';
import { captureScene, deserializeWorld, restoreScene, sceneFromJSON, worldHash } from './serialize.js';
import { slowSet } from './slow.js';
import { simStep } from './step.js';
import { clearPins, markStructAll, resetStructState, structHold, structureSet } from './structure.js';
import { lightning, setWeather, updateSun } from './weather.js';

export let cmdLog = [];
export let cmdRecording = true;
export let worldSeed = 1;          // 这一局的种子（录制文件里要带上）
export let cmdHook = null;        // 宿主可以挂一个回调：命令执行后通知（区域规则、预算、UI 同步）

// 一个笔刷印章：返回 {placed, removed}（实际改动了多少格），给预算系统用
export function stampCells(cx, cy, a, res) {
  const t = a.erase ? TOOL_ERASE : a.tool;
  const r = a.size - 1, r2 = r * r + r * 0.8;
  const round = a.shape !== 'square', spray = a.shape === 'spray' && r > 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (a.limit !== undefined && res.placed >= a.limit) return;   // 预算：最多放这么多格（不传 limit 时行为不变）
    if (round && dx * dx + dy * dy > r2) continue;
    if (spray && rnd() > 0.1) continue;
    const x = cx + dx, y = cy + dy;
    if (cmdCellFilter !== null && !cmdCellFilter(x, y, t)) continue;
    const k = paintCell(x, y, t, a.replace);
    if (k > 0) res.placed++; else if (k < 0) res.removed++;
  }
}
export let cmdCellFilter = null;  // 区域规则：返回 false 的格子笔刷不能动

export const COMMANDS = {
  // 笔刷：从 (x0,y0) 画到 (x1,y1)，两点相同就是点一下
  stroke(a) {
    const res = { placed: 0, removed: 0 };
    const dx = a.x1 - a.x0, dy = a.y1 - a.y0, dist = Math.max(Math.abs(dx), Math.abs(dy));
    const stepLen = Math.max(1, a.size >> 1);
    if (dist > 0) for (let s = 0; s <= dist; s += stepLen) { const k = s / dist; stampCells(Math.round(a.x0 + dx * k), Math.round(a.y0 + dy * k), a, res); }
    stampCells(a.x1, a.y1, a, res);
    return res;
  },
  strokeBegin() { structureSet('structHold', true); return null; },
  strokeEnd() { if (structHold) { structureSet('structHold', false); clearPins(); markStructAll(); } return null; },
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
    gridSet('tick', keepTick); gridSet('parity', keepPar); setRngState(keepRng);
    if (snap && snap.n > 0) restoreScene(snap);
    return null;
  },
  spawn(a) { fillCircle(a.mat, a.x, a.y, a.r || 2); return null; },          // 生成灾难源（熔岩、火、克隆体……）
};

export function execCmd(command, args) {
  const fn = COMMANDS[command];
  if (!fn) throw new Error('未知命令：' + command);
  const a = args || {};
  if (cmdRecording) cmdLog.push({ step: tick, command, args: a });
  const res = fn(a);
  if (cmdHook !== null) cmdHook(command, a, res);
  return res;
}

// 新开一个世界：清空网格、步数归零、设定种子、清空录制
export function resetWorld(seedValue) {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, JSON.parse(JSON.stringify(ENV_DEFAULTS)));
  scenesSet('sceneState', null);
  setGravity('down');                                      // 重力方向也回到默认（上一局可能翻转过）
  clearGrid();
  updateSun();
  gridSet('tick', 0); gridSet('parity', 0); slowSet('slowPhase', 0);
  eventsReset();
  resetStructState();                                      // 上一局留下的结构力学状态全部清掉
  seedRng(seedValue);
  worldSeed = seedValue;
  cmdLog = [];
}

// 回放：从 resetWorld(seed) 开始，按记录的步数执行命令，一直跑到 steps 步
export function replay(rec, steps) {
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

export function recordingOf(seedValue, w, h) { return { app: 'particle-sandbox', kind: 'recording', v: 41, seed: seedValue, w, h, steps: tick, log: cmdLog.slice() }; }

/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function commandsSave() { return { cmdLog, cmdRecording, worldSeed, cmdHook, cmdCellFilter }; }
export function commandsLoad(s) { ({ cmdLog, cmdRecording, worldSeed, cmdHook, cmdCellFilter } = s); }
export function commandsSet(name, v) {
  switch (name) {
    case 'cmdLog': cmdLog = v; break;
    case 'cmdRecording': cmdRecording = v; break;
    case 'worldSeed': worldSeed = v; break;
    case 'cmdHook': cmdHook = v; break;
    case 'cmdCellFilter': cmdCellFilter = v; break;
    default: throw new Error('commands.js 没有可写的状态 ' + name);
  }
}
