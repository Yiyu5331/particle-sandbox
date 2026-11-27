import { closeMenu, game, openMenu, setPaused, startMode } from '../game/manager.js';
import { audio, audioSetVolume, audioStart } from '../audio/audio.js';
import { closePops, fitGrid, sbxReleaseInput, setQuality, sandboxPreference } from '../modes/sandbox/ui.js';
import { $, CELL, QS, setCell, toast } from './host.js';
import { uiLocalizeTemplate, uiOnLanguage, uiSetLanguage, uiT } from './i18n.js';
import { uiHudRenderer } from './hud.js';
import { uiModes, uiScreens } from './screens.js';

export function uiApplication() {
  const root = $('ui-screen'), app = $('app');
  root.replaceChildren();
  uiLocalizeTemplate(document.documentElement);
  let ready = false;
  const hud = uiHudRenderer($('ui-hud'));
  let launchParams = {};
  function launch(id, params = {}) {
    // 重开沿用本局的入口参数，场景直达链接也能回到同一初始场景。
    if (params.fresh && id === game.modeDef?.id && game.mode?.restart) { game.mode.restart(); return; }
    launchParams = params.fresh ? { ...launchParams, ...params } : { ...params };
    startMode(id,launchParams);
  }
  const port = {
    start:launch, pause:setPaused, paused:() => game.paused,
    closeMenu, menuOpen:() => game.menuOpen,
    closePops() { closePops(); sbxReleaseInput(); },
    progress:id => game.profile?.progress?.[id], developer:QS.get('dev') === '1', tick:() => game.world?.tick ?? 0,
    reducedMotion:() => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    focusGame() {
      const id = game.modeDef?.id === 'sandbox' ? 'canvas' : game.modeDef?.placeholder ? 'btnModeExit' : 'btnMenu';
      $(id).focus();
    },
    preferences:() => ({ quality:$('selQuality').value, cell:CELL, volume:Math.round(audio.volume * 100) }),
    setPreference(key,value) {
      if (key === 'language') uiSetLanguage(value);
      if (key === 'quality') { $('selQuality').value = value; setQuality(value); }
      if (key === 'cell') { setCell(value); $('selScale').value = String(value); if (game.modeDef?.id === 'sandbox') fitGrid(true); }
      if (key === 'volume') { audio.volume = value / 100; $('rngVol').value = String(value); audioSetVolume(); }
      sandboxPreference(key === 'cell' ? 'gridPrecision' : key, key === 'volume' ? audio.volume : value);
    },
  };
  const screens = uiScreens(root,app,port);
  function placeholder() {
    const def = game.modeDef;
    if (!def?.placeholder) return;
    const mode = uiModes.find(m => m[0] === def.id);
    $('modeOverlay').querySelector('h2').textContent = uiT(mode?.[1] ?? def.name);
    $('modeOverlay').querySelector('p').textContent = uiT(mode?.[2] ?? def.desc);
  }
  game.bus.on('mode:enter', ({id}) => { hud.render(null); if (ready) screens.enter(id); placeholder(); });
  let managerMenuOpen = false;
  game.bus.on('pause', () => {
    if (managerMenuOpen === game.menuOpen) return;
    managerMenuOpen = game.menuOpen; screens.managerMenu(managerMenuOpen);
  });
  game.bus.on('outcome', o => screens.outcome(o));
  uiOnLanguage(() => {
    $('btnMute').textContent = uiT(audio.muted ? '静音' : '声音');
    placeholder(); hud.refresh(); $('toast').classList.remove('show'); $('toast').textContent = '';
  });

  $('btnMenu').addEventListener('click',openMenu);
  // 沙盒自行绑定同一组音频控件；其他模式也能直接从地址栏进入。
  $('btnMute').addEventListener('click', e => {
    if (game.modeDef?.id === 'sandbox') return;
    e.stopImmediatePropagation(); audioStart(); audio.muted = !audio.muted; audioSetVolume();
    $('btnMute').textContent = uiT(audio.muted ? '静音' : '声音');
    $('btnMute').classList.toggle('warn',audio.muted);
  }, true);
  $('rngVol').addEventListener('input', e => {
    if (game.modeDef?.id === 'sandbox') return;
    e.stopImmediatePropagation(); audioStart(); port.setPreference('volume',+e.target.value);
  }, true);
  $('btnModeExit').addEventListener('click', () => launch('home'));
  $('btnSettings').addEventListener('click', e => {
    if (game.modeDef?.id !== 'sandbox') { e.stopImmediatePropagation(); screens.settings(); }
  }, true);
  window.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key.toLowerCase() === 'm' && game.menuOpen && !e.target.closest?.('input,select,textarea')) {
      e.preventDefault(); e.stopImmediatePropagation(); closeMenu(); return;
    }
    if (root.dataset.screen !== 'playing') return;
    if (e.key === 'Escape') {
      const pop = document.querySelector('.pop.show');
      if (pop) { closePops(); document.querySelector('[data-pop="' + pop.id + '"]')?.focus(); }
      else screens.pause();
    } else if (e.key.toLowerCase() === 'm' && !e.target.closest?.('input,select,textarea')) openMenu();
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  return { screens, hud, launch, ready() {
    ready = true; screens.enter(game.modeDef.id);
    game.profile?.onProgress(screens.refreshProgress);
    window.addEventListener('focus',()=>game.profile?.readProfile().catch(e=>toast(e.message)));
  } };
}
