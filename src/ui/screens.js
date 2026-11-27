import { uiButton, uiCardGrid, uiElement, uiIcon, uiList, uiModal, uiPanel, uiProgress, uiSelect, uiSlider, uiTabs } from './components.js';
import { uiLanguage, uiOnLanguage, uiT } from './i18n.js';

export const uiModes = [
  ['sandbox','自由沙盒','自由组合元素，观察它们的相互作用。','已发现 · {n} 种元素'],
  ['defense','灾难守护','用材料搭建防线，抵御一波波灾害。','最高波次 · {n}'],
  ['puzzle','物理解谜','用有限的材料，把世界变成解法。','已完成 · {n} 关'],
  ['civ','文明模拟','塑造地形，引导聚落生长。','存档 · {n}'],
  ['eco','生态进化','观察水循环、植物与种群的变化。','存档 · {n}'],
];
const uiShortcuts = [
  ['Esc','返回或暂停'],['M','主菜单'],['Space','暂停或继续模拟'],['.','单步'],['0 – 9','选择材料'],
  ['[ / ]','改变笔刷大小'],['G','切换重力'],['V','切换视图（V）'],['Ctrl / ⌘ Z','撤销'],['C','清空'],['方向键','移动笔刷'],['Enter / Delete','绘制或擦除'],['`','显示调试信息'],
];

export function uiScreens(root, app, port) {
  let route = 'loading', current = null, mode = 'home', modal = null, pausedBefore = false;
  let outcome = null, settingsTab = 0, loadValue = 0, loadText = '初始化画布';
  const history = [], focuses = new Map();
  const btn = (key, fn, icon) => uiButton(uiT(key), fn, icon);
  const controls = el => [...el.querySelectorAll('button,input,select')];
  function dismiss() {
    modal?.close(); modal = null; root.hidden = true;
  }
  function visit(next) {
    history.push(route); route = next; draw();
  }
  function goPlay(id, fresh = false) {
    port.start(id, fresh ? {fresh:true} : {});
  }
  function back() {
    if (route === 'loading' || route === 'home') return;
    if (route === 'result') { goPlay('home'); return; }
    if (route === 'modes' && port.menuOpen()) { port.closeMenu(); return; }
    if (history.length) { route = history.pop(); draw(); return; }
    route = 'playing'; draw(); port.pause(pausedBefore);
  }
  function pauseScreen(next = 'pause') {
    if (route !== 'playing') return;
    pausedBefore = port.paused(); port.pause(true); port.closePops();
    history.length = 0; route = next; draw();
  }
  function enter(id) {
    mode = id; history.length = 0; focuses.clear(); outcome = null;
    route = id === 'home' ? 'home' : 'playing';
    if (id === 'home' && port.reducedMotion()) port.pause(true);
    draw();
    if (route === 'playing') port.focusGame();
  }
  function home() {
    const body = uiElement('div','ui-home');
    const nav = uiElement('nav','ui-home-nav');
    nav.append(btn('材料图鉴', () => visit('codex'),'book'), btn('设置', () => visit('settings'),'settings'));
    if (port.developer) nav.append(btn('开发者',()=>visit('developer'),'settings'));
    const hero = uiElement('div','ui-hero'), title = uiElement('h1','',uiT('粒子沙盘'));
    const actions = uiElement('div','ui-actions');
    const choose = btn('选择模式', () => visit('modes'),'sandbox'); choose.classList.add('primary');
    actions.append(choose,btn('自由沙盒', () => goPlay('sandbox'),'play'));
    hero.append(title,uiElement('p','',uiT(uiModes[0][2])),actions);
    const live = uiElement('div','ui-live');
    const toggle = btn(port.paused() ? '继续演示' : '暂停演示', () => { port.pause(!port.paused()); draw(); },port.paused()?'play':'pause');
    live.append(uiElement('strong','',uiT('火山岛')),uiElement('span','',uiT('实时演示')),toggle);
    body.append(nav,hero,live); return body;
  }
  function cardSummary(id,key) {
    const n = port.progress(id);
    return n == null ? uiT('进度暂不可用') : uiT(key,{n});
  }
  function modes() {
    const cards = uiModes.map(([id,name,desc,summary]) => {
      const b = btn(name, () => goPlay(id),id);
      b.classList.add('ui-card'); b.dataset.mode = id;
      b.append(uiElement('p','',uiT(desc)), uiElement('small','',cardSummary(id,summary)));
      return b;
    });
    const guide = btn('材料图鉴', () => visit('codex'),'book'); guide.classList.add('ui-card','ui-guide-card');
    return uiPanel(uiT('选择模式'),uiCardGrid([...cards,guide]));
  }
  function settings() {
    const p = port.preferences();
    const prefs = uiElement('div','ui-fields');
    prefs.append(
      uiSelect(uiT('画质'), ['low','mid','high','ultra'].map((v,i)=>[v,uiT(['低','中','高','极致'][i])]),p.quality,v=>port.setPreference('quality',v)),
      uiSlider(uiT('总音量'),0,100,p.volume,v=>port.setPreference('volume',v)),
      uiSelect(uiT('网格精度'),[2,3,4].map(v=>[v,uiT(['每格 2 像素','每格 3 像素','每格 4 像素'][v-2])]),p.cell,v=>port.setPreference('cell',+v)),
      uiSelect(uiT('语言'),[['zh-CN',uiT('简体中文')],['en','English']],uiLanguage(),v=>port.setPreference('language',v)),
    );
    const keys = uiList(uiShortcuts.map(([k,label]) => {
      const row = uiElement('div','ui-key'); row.append(uiElement('span','',uiT(label)),uiElement('kbd','',uiT(k))); return row;
    }));
    const tabs = uiTabs([{label:uiT('偏好设置'),panel:prefs},{label:uiT('快捷键'),panel:keys}],settingsTab,uiT('设置'));
    return uiPanel(uiT('设置'),tabs);
  }
  function codex() {
    return uiPanel(uiT('材料图鉴'),uiElement('p','',uiT('图鉴将在后续版本开放。')));
  }
  function developer() {
    const link = uiElement('a','ui-button',uiT('地图生成器'));
    link.href = '?dev=1&mapgen=1'; link.target = '_blank'; link.rel = 'noopener';
    return uiPanel(uiT('开发者'),link);
  }
  function result() {
    const stats = [{label:'得分',value:outcome.score ?? 0},{label:'模拟步数',value:port.tick()}, ...(outcome.stats || [])];
    const list = uiList(stats.map(s => {
      const row = uiElement('div','ui-key'); row.append(uiElement('span','',uiT(s.label)),uiElement('b','',s.value)); return row;
    }));
    const actions = uiElement('div','ui-actions');
    for (const action of outcome.actions || []) actions.append(btn(action.label,action.onClick,action.icon));
    actions.append(btn('再来一局',()=>goPlay(mode,true),'restart'),btn('返回主菜单',()=>goPlay('home'),'home'));
    return uiPanel(uiT(outcome.state === 'won' ? '胜利' : '失败'),uiElement('p','',uiT(outcome.detail || '')),list,actions);
  }
  function draw() {
    if (modal) {
      const at = controls(modal.el).indexOf(document.activeElement);
      if (at >= 0) focuses.set(current,at);
      if (current === 'settings') settingsTab = Math.max(0,[...modal.el.querySelectorAll('[role=tab]')].findIndex(t=>t.getAttribute('aria-selected')==='true'));
    }
    dismiss(); current = route; root.dataset.screen = route;
    if (route === 'playing') return;
    let body, title;
    if (route === 'loading') {
      title = '引擎热身';
      const phase = uiElement('p','ui-phase',uiT(loadText)); phase.setAttribute('role','status');
      body = uiPanel(uiT(title),uiProgress(uiT(title),loadValue),phase);
    } else if (route === 'home') { title = '主菜单'; body = home(); }
    else if (route === 'modes') { title = '选择模式'; body = modes(); }
    else if (route === 'settings') { title = '设置'; body = settings(); }
    else if (route === 'codex') { title = '材料图鉴'; body = codex(); }
    else if (route === 'developer' && port.developer) { title = '开发者'; body = developer(); }
    else if (route === 'result') { title = outcome.state === 'won' ? '胜利' : '失败'; body = result(); }
    else {
      title = '已暂停';
      body = uiPanel(uiT(title),uiList([btn('继续',back,'play'),btn('重新开始',()=>goPlay(mode,true),'restart'),
        btn('设置',()=>visit('settings'),'settings'),btn('返回主菜单',()=>goPlay('home'),'home')]));
    }
    if (['modes','settings','codex','developer'].includes(route)) {
      const b = btn('返回',back,'back'); b.classList.add('ui-back'); body.prepend(b);
    }
    modal = uiModal(uiT(title),body,back,[app]); root.hidden = false;
    const remembered = controls(modal.el)[focuses.get(route)];
    modal.open(root, remembered && !remembered.closest('[hidden]') ? remembered : body.querySelector('.primary'));
  }
  const off = uiOnLanguage(draw);
  return {
    enter, back, pause:pauseScreen, draw,
    refreshProgress() {
      if (route !== 'modes') return;
      for (const [id,,,summary] of uiModes) {
        const el = root.querySelector('[data-mode="'+id+'"] small');
        if (el) el.textContent = cardSummary(id,summary);
      }
    },
    managerMenu(open) {
      if (open && (route === 'playing' || route === 'home')) {
        port.closePops(); visit('modes');
      } else if (!open && history.length && (history.includes('modes') || route === 'modes')) {
        route = history[0]; history.length = 0; draw();
      }
    },
    loading(value,text) { route = 'loading'; loadValue = value; loadText = text; draw(); },
    settings() { if (route === 'playing') pauseScreen('settings'); else visit('settings'); },
    outcome(o) { port.closePops(); outcome = o; history.length = 0; route = 'result'; draw(); },
    dispose() { off(); dismiss(); },
  };
}
