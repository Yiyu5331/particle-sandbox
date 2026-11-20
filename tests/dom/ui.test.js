import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openUIPage } from '../lib/ui-page.mjs';
import { Window } from 'happy-dom';
import { uiButton,uiCardGrid,uiIcon,uiList,uiModal,uiPanel,uiProgress,uiSelect,uiSlider,uiTabs,uiToast,uiToggle,uiTooltip } from '../../src/ui/components.js';
import { uiHudRenderer } from '../../src/ui/hud.js';
import { uiSetLanguage } from '../../src/ui/i18n.js';

let win;
beforeEach(() => { win = new Window(); globalThis.document = win.document; uiSetLanguage('zh-CN'); });
afterEach(async () => { delete globalThis.document; await win.happyDOM.close(); });
const key = (el,k,shiftKey=false) => el.dispatchEvent(new win.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,shiftKey}));
const change = el => el.dispatchEvent(new win.Event('change',{bubbles:true}));

test('UI Button、图标、Panel、List、卡片网格的语义和点击动作', () => {
  let clicks = 0;
  const button = uiButton('继续',()=>clicks++,'play');
  button.click(); assert.equal(clicks,1); assert.equal(button.type,'button');
  assert.equal(button.querySelector('svg').getAttribute('aria-hidden'),'true');
  assert.equal(uiIcon('eco').namespaceURI,'http://www.w3.org/2000/svg');
  const panel = uiPanel('材料',uiList(['水','沙']),uiCardGrid([button]));
  assert.equal(panel.querySelector('h2').id,panel.getAttribute('aria-labelledby'));
  assert.deepEqual([...panel.querySelectorAll('ul')].map(l=>l.children.length),[2,1]);
  assert.ok(panel.querySelector('.ui-card-grid > li > button'));
});

test('UI Modal 捕获 Tab 和 Esc，关闭后恢复背景和焦点', () => {
  const app = document.createElement('main'), opener = uiButton('打开',()=>{});
  app.append(opener); document.body.append(app); opener.focus();
  const first = uiButton('继续',()=>{}), last = uiButton('关闭',()=>{});
  const modal = uiModal('设置',uiPanel('设置',first,last),()=>modal.close(),[app]);
  modal.open(document.body); assert.equal(document.activeElement,first); assert.equal(app.inert,true);
  key(first,'Tab',true); assert.equal(document.activeElement,last);
  key(last,'Tab'); assert.equal(document.activeElement,first);
  key(first,'Escape'); assert.equal(document.activeElement,opener); assert.ok(!app.inert);
});

test('UI Tabs 支持方向键、Home、End 并关联面板', () => {
  const tabs = uiTabs(['甲','乙','丙'].map(label=>({label,panel:document.createElement('section')})));
  document.body.append(tabs); const list = [...tabs.querySelectorAll('[role=tab]')];
  key(list[0],'ArrowLeft'); assert.equal(document.activeElement,list[2]);
  key(list[2],'Home'); key(list[0],'ArrowRight');
  assert.equal(list[1].getAttribute('aria-selected'),'true');
  key(list[1],'End'); assert.equal(document.getElementById(list[2].getAttribute('aria-controls')).hidden,false);
  assert.equal(list[1].tabIndex,-1);
});

test('UI Slider、Toggle、Select 和 ProgressBar 公开标签、值与变化事件', () => {
  const values = [];
  const slider = uiSlider('音量',0,100,60,v=>values.push(v));
  const input = slider.querySelector('input'); input.value = '45'; input.dispatchEvent(new win.Event('input'));
  assert.equal(slider.querySelector('output').value,'45');
  const toggle = uiToggle('云',false,v=>values.push(v)).querySelector('input');
  toggle.checked = true; change(toggle);
  const select = uiSelect('语言',[['zh','中文'],['en','English']],'zh',v=>values.push(v)).querySelector('select');
  select.value = 'en'; change(select); assert.deepEqual(values,[45,true,'en']);
  assert.equal(select.parentElement.tagName,'LABEL');
  const p = uiProgress('完成',3,4); assert.equal(p.value,3); assert.equal(p.max,4); assert.equal(p.getAttribute('aria-label'),'完成');
});

test('UI Tooltip 可由焦点打开或按 Esc 隐藏，Toast 通告后自动收起', async () => {
  const anchor = uiButton('帮助',()=>{}), tip = uiTooltip(anchor,'按 G 切换重力');
  document.body.append(anchor,tip); anchor.focus();
  assert.equal(tip.id,anchor.getAttribute('aria-describedby')); assert.ok(!tip.hidden);
  key(anchor,'Escape'); assert.ok(tip.hidden); anchor.blur();
  anchor.dispatchEvent(new win.Event('mouseenter')); assert.ok(!tip.hidden);
  anchor.dispatchEvent(new win.Event('mouseleave')); assert.ok(tip.hidden);
  const host = document.createElement('div'); uiToast(host,'完成',5);
  assert.equal(host.getAttribute('role'),'status'); assert.equal(host.textContent,'完成');
  await new Promise(r=>setTimeout(r,15)); assert.equal(host.textContent,'');
});

test('UI HUD 五种元素、旧文字模式、动作更新和键盘焦点', () => {
  const el = document.createElement('div'); document.body.append(el);
  const hud = uiHudRenderer(el); let score = 1, clicks = 0;
  const items = () => [{id:'v',type:'value',label:'得分',value:score},{id:'p',type:'progress',label:'进度',value:1,max:3},
    {id:'t',type:'countdown',label:'时间',seconds:60.2},{id:'h',type:'hint',label:'继续'},{id:'a',type:'button',label:'暂停',onClick:()=>clicks+=score}];
  const refresh=()=>hud.render({items:items()});
  refresh(); assert.equal(el.children.length,5); assert.match(el.textContent,/1:01/);
  const b = el.querySelector('button'); b.focus(); score = 2; refresh(); b.click();
  assert.equal(clicks,2); assert.equal(document.activeElement,b);
  hud.render('自由沙盒'); assert.equal(el.textContent,'自由沙盒'); hud.render(null); assert.ok(el.hidden);
});

test('UI 单文件端到端：主菜单、选择模式、沙盒、暂停、设置、重开、结算和返回', async () => {
  const {page,doc,manager,click,press,screen} = await openUIPage();
  try {
    assert.equal(screen(),'home'); assert.equal(doc.body.dataset.mode,'home');
    click('选择模式'); assert.equal(doc.querySelectorAll('.ui-card[data-mode]').length,5);
    click('自由沙盒'); assert.equal(screen(),'playing'); assert.equal(doc.body.dataset.mode,'sandbox');
    const original = manager.world;
    doc.querySelector('#btnMenu').click(); assert.equal(screen(),'modes'); assert.ok(manager.menuOpen);
    press('Escape'); assert.equal(screen(),'playing'); assert.ok(!manager.menuOpen);
    press('Escape'); assert.equal(screen(),'pause');
    click('设置'); const select = [...doc.querySelectorAll('#ui-screen select')].at(-1);
    select.value = 'en'; select.dispatchEvent(new page.Event('change'));
    assert.equal(doc.documentElement.lang,'en'); assert.equal(doc.title,'Particle Sandbox');
    assert.doesNotMatch(doc.querySelector('#palette').textContent,/\p{Script=Han}/u);
    click('Keyboard shortcuts'); assert.ok(doc.querySelector('[aria-selected=true]').textContent.includes('shortcuts'));
    press('Escape'); click('Resume'); assert.equal(manager.world,original);
    press('Escape'); click('Restart'); assert.notEqual(manager.world,original);
    press('Escape'); click('Main menu'); assert.equal(screen(),'home'); assert.equal(doc.body.dataset.mode,'home');
    click('Material field guide'); assert.doesNotMatch(doc.querySelector('#ui-screen').textContent,/\p{Script=Han}/u);
    press('Escape'); click('Choose a mode'); click('Physics puzzles');
    assert.ok(doc.querySelector('#puzzle-picker').textContent.includes('A handful of sand'));
    for (const state of ['won','lost']) {
      manager.bus.emit('outcome',{state,score:12,stats:[{label:'得分',value:42}]});
      assert.equal(screen(),'result'); assert.match(doc.querySelector('#ui-screen').textContent,/42/);
      click('Play again'); assert.equal(screen(),'playing'); assert.equal(doc.body.dataset.mode,'puzzle');
    }
  } finally { await page.happyDOM.close(); }
});

test('UI 演示与沙盒世界隔离，通用设置生效，键盘可在画布落笔', async () => {
  const {page,doc,manager,click,press,frames,phases} = await openUIPage();
  try {
    assert.deepEqual([...phases],[0,25,50,75,100]);
    const demo = manager.world, startTick = demo.tick;
    await frames(6); assert.ok(demo.tick > startTick);
    click('暂停演示'); const pausedAt = demo.tick; await frames(5); assert.equal(demo.tick,pausedAt);
    click('设置');
    const [quality,cell] = doc.querySelectorAll('#ui-screen select');
    quality.value = 'low'; quality.dispatchEvent(new page.Event('change'));
    cell.value = '2'; cell.dispatchEvent(new page.Event('change'));
    const volume = doc.querySelector('#ui-screen input[type=range]'); volume.value = '34'; volume.dispatchEvent(new page.Event('input'));
    press('Escape'); click('自由沙盒');
    assert.equal(doc.querySelector('#selQuality').value,'low'); assert.equal(doc.querySelector('#selScale').value,'2');
    assert.equal(doc.querySelector('#rngVol').value,'34'); assert.equal(demo.disposed,true);
    const w = manager.world, c = doc.querySelector('#canvas');
    const before = w.hash(); press('ArrowRight',c); press('Enter',c); assert.notEqual(w.hash(),before);
    press('Escape',c); const hash = w.hash(); await frames(6); assert.equal(w.hash(),hash);
    click('返回主菜单'); assert.notEqual(manager.world,w);
    click('自由沙盒'); assert.equal(manager.world,w);
  } finally { await page.happyDOM.close(); }
});

test('UI 切换语言时保留中文槽名和沙盒读档行为', async () => {
  const {page,doc,manager,click} = await openUIPage();
  try {
    click('自由沙盒');
    const slotName = '水边的家', w = manager.world, hash = w.hash();
    doc.querySelector('#btnSave').click(); doc.querySelector('#slotName').value = slotName;
    doc.querySelector('#btnSlotSave').click();
    for (let i=0;i<100 && !doc.querySelector('#slotList .slot');i++) await new Promise(r=>setTimeout(r,1));
    assert.equal(doc.querySelector('#slotList .nm').textContent,slotName);
    const lang = doc.querySelector('#selLanguage');
    lang.value = 'en'; lang.dispatchEvent(new page.Event('change'));
    for (let i=0;i<100 && doc.querySelector('#slotList button')?.textContent!=='Load';i++) await new Promise(r=>setTimeout(r,2));
    const buttons = doc.querySelectorAll('#slotList button'); assert.equal(buttons[0].textContent,'Load');
    assert.equal(doc.querySelector('#slotList .nm').textContent,slotName);
    w.exec('loadScene',{index:2}); assert.notEqual(w.hash(),hash);
    buttons[0].click(); for (let i=0;i<100 && w.hash()!==hash;i++) await new Promise(r=>setTimeout(r,2)); assert.equal(w.hash(),hash);
    lang.value = 'zh-CN'; lang.dispatchEvent(new page.Event('change'));
    assert.equal(doc.querySelector('#palette h3').textContent,'粉末');
    doc.querySelectorAll('#slotList button')[1].click(); for (let i=0;i<100 && doc.querySelector('#slotList .slot');i++) await new Promise(r=>setTimeout(r,2)); assert.equal(doc.querySelector('#slotList .slot'),null);
  } finally { await page.happyDOM.close(); }
});
