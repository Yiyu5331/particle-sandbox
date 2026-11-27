// 检查玩家界面的词条、模板属性、引擎公开展示数据与插值参数。
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { Window } from 'happy-dom';
import { uiEnglish } from '../src/ui/catalog.js';
import { MATERIALS, SCENES, STATE_NAMES, WEATHER_PRESETS } from '../src/engine/index.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path,root),'utf8');
const han = /\p{Script=Han}/u, errors = new Set();
function check(text, source) {
  if (typeof text === 'string' && han.test(text) && !Object.hasOwn(uiEnglish,text)) errors.add(source + ' → ' + text);
}
const slots = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
for (const [key,value] of Object.entries(uiEnglish)) {
  if (!value.trim() || han.test(value) || slots(value) !== slots(key)) errors.add('英文或参数无效 → ' + key);
}
const dom = new Window({settings:{disableJavaScriptEvaluation:true}});
dom.document.write(read('src/index.html').replace(/<script>[\s\S]*?<\/script>/g,''));
function scanElement(n) {
  if (n.nodeType === 3) { check(n.data.trim(),'HTML'); return; }
  if (n.tagName === 'STYLE') return;
  for (const a of n.attributes || []) if (['aria-label','alt','title','placeholder'].includes(a.name)) check(a.value,a.name);
  for (const c of n.childNodes) scanElement(c);
}
scanElement(dom.document.documentElement);
await dom.happyDOM.close();
function scanJS(n,file) {
  if (!n || typeof n !== 'object' || n.type === 'ThrowStatement') return;
  if (n.type === 'Literal') check(n.value,file);
  else if (n.type === 'TemplateElement') check(n.value.cooked,file);
  else for (const v of Object.values(n)) scanJS(v,file);
}
const files = ['src/main.js','src/ui/application.js','src/ui/components.js','src/ui/demo.js','src/ui/hud.js','src/ui/screens.js',
  'src/modes/sandbox/ui.js','src/modes/puzzle/view.js','src/modes/puzzle/format.js','src/modes/puzzle/session.js', ...['sandbox','puzzle','defense','civ','eco'].map(id=>'src/modes/'+id+'/index.js')];
for (const file of files) scanJS(parse(read(file),{sourceType:'module',ecmaVersion:'latest'}),file);
for (const item of [...MATERIALS,...SCENES,...Object.values(WEATHER_PRESETS)]) {
  check(item.name,'引擎名称'); check(item.note,'引擎说明');
}
STATE_NAMES.forEach(s=>check(s,'物态'));
if (errors.size) { console.error([...errors].join('\n')); process.exitCode = 1; }
else console.log('通过  中英文词表、参数、模板及玩家界面源码');

// 再检查真实渲染结果。即使硬编码字符串碰巧已在词表里，也能发现遗漏的调用。
if (!errors.size) {
  const { openUIPage } = await import('../tests/lib/ui-page.mjs');
  const {page,doc,frames,click,press} = await openUIPage();
  try {
    function audit(el) {
      if (el.nodeType === 3) {
        if (han.test(el.data)) errors.add('英文界面文本 → ' + el.data.trim());
        return;
      }
      if (['SCRIPT','STYLE'].includes(el.tagName)) return;
      for (const a of el.attributes || []) {
        if (['aria-label','title','placeholder','alt'].includes(a.name) && han.test(a.value)) errors.add('英文属性 → '+a.value);
      }
      for (const child of el.childNodes) audit(child);
    }
    const auditPage = () => audit(doc.documentElement);
    click('设置');
    const language = [...doc.querySelectorAll('#ui-screen select')].at(-1);
    language.value = 'en'; language.dispatchEvent(new page.Event('change'));
    auditPage(); click('Keyboard shortcuts'); auditPage(); press('Escape');
    click('Material field guide');
    auditPage();
    if (!doc.querySelector('#ui-screen').textContent.includes('The field guide will be available')) errors.add('图鉴占位缺少英文说明');
    press('Escape'); click('Choose a mode'); auditPage(); click('Free sandbox');
    await frames(2,300); auditPage();
    for (const b of doc.querySelectorAll('#palette button')) { b.focus(); audit(doc.querySelector('#tip')); }
    for (const id of ['btnScenes','btnEnv','btnSave','btnSettings']) {
      doc.getElementById(id).click(); auditPage(); press('Escape');
    }
    press('`',doc.querySelector('#canvas')); await frames(2,300); auditPage();
    press('Escape'); auditPage(); click('Main menu'); click('Choose a mode'); click('Physics puzzles');
    await frames(2,300); auditPage();
    const picker=doc.querySelector('#puzzle-picker');
    click('A handful of sand',picker); await frames(2,300); auditPage();
    click('Choose another level',doc.querySelector('#puzzle-tools')); click('New level',doc.querySelector('#puzzle-tools')); auditPage();
    if (errors.size) { console.error([...errors].join('\n')); process.exitCode = 1; }
    else console.log('通过  英文页面、属性、所有材料提示、选单、快捷键、调试与模式 HUD');
  } finally { await page.happyDOM.close(); }
}
