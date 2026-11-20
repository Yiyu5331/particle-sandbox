'use strict';
import { audioFrame, setAudioWorld } from '../audio/audio.js';
import { SIM_HZ, createWorld } from '../engine/index.js';
import { createBus } from './bus.js';
import { OUTCOME_PLAYING } from './mode.js';
import { canvas, invalidate, renderFrame, resizeRenderer, setRenderWorld } from '../render/renderer.js';
import { $, QS, toast } from '../ui/host.js';
/* =====================================================================
 * 模式管理器：主菜单、模式切换、暂停、主循环、事件分发。
 * 主循环：固定 60Hz 模拟步长，与渲染帧率解耦（和 v4 一样）。
 * ===================================================================== */

export const game = {
  modes: [], modeDef: null, mode: null, world: null,
  paused: false, speed: 1, stepOnce: false,
  busy: false,               // 浏览器自测 / soak / 性能测试进行中：主循环不碰模式和它的世界
  menuOpen: false, outcome: OUTCOME_PLAYING,
  bus: createBus(), profile: null,
};

export function registerMode(def) { game.modes.push(def); }
export function setPaused(v) { game.paused = !!v; game.bus.emit('pause', { paused: game.paused }); }
export const gameSetPaused = setPaused;   // 给沙盘界面用的别名（它自己也有个 setPaused）

let unsubWorld = null, overlay = null, overlayCtx = null, stepsSinceCheck = 0, hudAt = 0;

function setWorld(w) {
  if (unsubWorld) { unsubWorld(); unsubWorld = null; }
  game.world = w;
  setRenderWorld(w); setAudioWorld(w);
  if (w) unsubWorld = w.on('*', e => {
    const m = game.mode;
    if (m && m.onEvent) m.onEvent(e);
    game.bus.emit('world:' + e.type, e);
  });
}

function getOverlay() {
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.id = 'overlay';
    $('viewport').appendChild(overlay);
    overlayCtx = overlay.getContext('2d');
  }
  if (canvas && (overlay.width !== canvas.clientWidth || overlay.height !== canvas.clientHeight)) {
    overlay.width = canvas.clientWidth; overlay.height = canvas.clientHeight;
    overlay.style.width = canvas.style.width; overlay.style.height = canvas.style.height;
  }
  return overlayCtx;
}

const ctx = {
  game, get profile() { return game.profile; }, get bus() { return game.bus; }, QS, toast,
  createWorld: o => createWorld(o),
  setWorld(w) { setWorld(w); if (w) resizeRenderer(); },
  renderer: { invalidate, resize: () => resizeRenderer() },
  overlay: getOverlay,
  showPlaceholder(name, desc) {
    const el = $('modeOverlay');
    el.querySelector('h2').textContent = name;
    el.querySelector('p').textContent = desc;
    el.style.display = 'flex';
  },
  hidePlaceholder() { $('modeOverlay').style.display = 'none'; },
};

/** 进入某个模式（会先退出当前模式） */
export function startMode(id, params) {
  const def = game.modes.find(m => m.id === id) || game.modes[0];
  if (game.mode) {
    const old = game.modeDef.id;
    try { game.mode.dispose(); } catch (e) { console.error('退出模式出错', e); }
    setWorld(null);
    game.mode = null;
    if (overlayCtx) overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    game.bus.emit('mode:exit', { id: old });
  }
  closeMenu();
  game.modeDef = def; game.outcome = OUTCOME_PLAYING; game.stepOnce = false; stepsSinceCheck = 0;
  document.body.dataset.mode = def.id;
  $('stModeHud').textContent = '';
  game.mode = def.create();
  setPaused(false);
  game.mode.init(ctx, params || {});
  game.bus.emit('mode:enter', { id: def.id });
  // 已结算的存档不会再走模拟步，进入后即同步其胜负。
  if (game.paused) gameCheckOutcome(game.mode);
  syncMenu();
}

/* ---------- 主菜单 ---------- */
let pausedBeforeMenu = false;
export function buildMenu() {
  const list = $('menuList');
  for (const def of game.modes) {
    const b = document.createElement('button');
    b.dataset.mode = def.id;
    b.innerHTML = '<span></span><small></small>';
    b.firstChild.textContent = def.name + (def.placeholder ? '（开发中）' : '');
    b.lastChild.textContent = def.desc || '';
    b.addEventListener('click', () => startMode(def.id));
    list.appendChild(b);
  }
  $('btnMenu').addEventListener('click', e => { e.stopPropagation(); game.menuOpen ? closeMenu() : openMenu(); });
  $('btnMenuBack').addEventListener('click', () => closeMenu());
  $('btnModeExit').addEventListener('click', () => openMenu());
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && game.menuOpen) { e.stopImmediatePropagation(); closeMenu(); }
    else if ((e.key === 'm' || e.key === 'M') && !e.target.closest?.('input, textarea, select, [contenteditable=true]') && !e.ctrlKey && !e.metaKey && !e.altKey) { game.menuOpen ? closeMenu() : openMenu(); }
  }, true);
}
function syncMenu() { document.querySelectorAll('#menuList button').forEach(b => b.classList.toggle('on', game.modeDef && b.dataset.mode === game.modeDef.id)); }
export function openMenu() {
  if (game.menuOpen) return;
  game.menuOpen = true; pausedBeforeMenu = game.paused;
  setPaused(true);
  syncMenu();
  $('menu').classList.add('show');
}
export function closeMenu() {
  if (!game.menuOpen) return;
  game.menuOpen = false;
  $('menu').classList.remove('show');
  setPaused(pausedBeforeMenu);
}

/* ---------- 主循环 ---------- */
let lastFrameT = 0, simAcc = 0;
export function gameCheckOutcome(m) {
  if (m !== game.mode) return;
  const o = m.checkOutcome();
  if (o && o.state !== 'playing' && game.outcome.state === 'playing') {
    game.outcome = o; if (!game.paused) setPaused(true);
    game.bus.emit('outcome', o);
    toast((o.state === 'won' ? '胜利' : '失败') + (o.detail ? '：' + o.detail : '') + (o.score ? '（' + o.score + ' 分）' : ''));
  }
}
function stepOne(m, w) {
  if (m.beforeStep) m.beforeStep();
  w.step(1);
  m.update(w.tick);
  if (++stepsSinceCheck >= 30 || game.paused) {
    stepsSinceCheck = 0;
    gameCheckOutcome(m);
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  let dt = now - lastFrameT;
  lastFrameT = now;
  const m = game.mode, w = game.world;
  if (game.busy || !m || !w) return;                     // 自测进行中：画面由测试自己画，主循环不碰模式和它的世界
  if (m.frameTiming) m.frameTiming(dt);                  // 沙盘：统计真实 rAF 间隔（不截断，用来识别降频）
  if (dt > 250 || dt <= 0) dt = 16.7;
  if (m.preFrame) m.preFrame(now, dt);
  if (!game.paused) {
    const stepMs = 1000 / SIM_HZ, maxSteps = Math.max(2, Math.ceil(game.speed * 2));
    simAcc += Math.min(dt, 100) * game.speed;
    let n = 0;
    while (!game.paused && simAcc >= stepMs && n < maxSteps) { stepOne(m, w); simAcc -= stepMs; n++; }
    if (simAcc > stepMs * 2) simAcc = 0;                 // 跟不上就丢步，不追帧
  } else if (game.stepOnce) stepOne(m, w);
  game.stepOnce = false;
  renderFrame(now, Math.min(dt, 100));
  if (m.wantsOverlay && m.renderOverlay) m.renderOverlay(getOverlay(), w.view);   // 模式自己的 2D 叠加层（塔防的路径、解谜的目标框……）
  if (m.postRender) m.postRender(now);
  audioFrame();
  if (m.postFrame) m.postFrame(now, dt);
  if (now - hudAt > 250) {
    hudAt = now;
    const text = m.getHUD?.();
    if (text != null) $('stModeHud').textContent = text;
  }
}

export function startLoop() {
  document.addEventListener('visibilitychange', () => { lastFrameT = performance.now(); simAcc = 0; });
  requestAnimationFrame(loop);
}
