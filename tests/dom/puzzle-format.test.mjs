import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { puzzleView } from '../../src/modes/puzzle/view.js';
import { uiSetLanguage } from '../../src/ui/i18n.js';

test('解谜选关从关卡文件读取双语章名、关名和目标，旧例继续用原有词条', async () => {
  const page = new Window(), controller = new AbortController();
  const doc = globalThis.document = page.document;
  doc.body.innerHTML = '<aside id="palette"></aside><main id="stage"><canvas id="canvas"></canvas></main>';
  const view = puzzleView({},controller.signal);
  try {
    uiSetLanguage('zh-CN');
    const levels = [{id:'legacy',name:'冷却桥墩',chapter:'第二章 · 守护'},{
      id:'localized',name:'一捧落沙',chapter:'本地文件',
      nameI18n:{'zh-CN':'关卡标题',en:'Level file title'},
      chapterI18n:{'zh-CN':'关卡章节',en:'Level file chapter'},
      desc:{'zh-CN':'关卡目标',en:'Level file objective'},
    }];
    view.picking(levels,new Map());
    const picker = doc.querySelector('#puzzle-picker');
    for (const word of ['关卡章节','关卡标题','关卡目标','冷却桥墩']) assert.ok(picker.textContent.includes(word));
    uiSetLanguage('en');
    for (const word of ['Level file chapter','Level file title','Level file objective','Cool the pier']) assert.ok(picker.textContent.includes(word));
    assert.doesNotMatch(picker.textContent,/A handful of sand/);
  } finally {
    controller.abort();
    view.dispose();
    uiSetLanguage('zh-CN');
    delete globalThis.document;
    await page.happyDOM.close();
  }
});
