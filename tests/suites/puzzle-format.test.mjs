import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWorld, FIRE, STONE, WATER } from '../../src/engine/index.js';
import { puzzleBlank, puzzleEditRect } from '../../src/modes/puzzle/editor.js';
import { puzzleText, puzzleValidateLevel } from '../../src/modes/puzzle/format.js';
import { puzzleConditions, puzzleRestore, puzzleSession, puzzleVerify } from '../../src/modes/puzzle/session.js';
import { discoverPuzzleLevels } from '../../tools/puzzle-catalog.mjs';
import { migrateC3Text } from '../../tools/migrate/c3-text.mjs';

const survive = steps => ({op:'survive',steps});
const hold = (steps,condition) => ({op:'hold',steps,condition});
const timed = (step,command,args) => ({step,action:{command,args}});
const stroke = (tool,x,y) => ({tool,x0:x,y0:y,x1:x,y1:y,size:1});
const zone = {id:'target',type:'zone',x:1,y:6,w:8,h:10};

test('解谜定时事件：存档偏移、同一步先笔画后事件、双播与引擎回放一致', () => {
  const l = puzzleBlank();
  const source = createWorld(l.world), engineReplay = createWorld(l.world);
  source.step(17);
  l.world.serialized = source.serialize();
  delete l.world.commands;
  l.type = 'realtime';
  l.regions = [zone];
  l.materials = {WATER:2};
  l.goal = hold(2,{op:'count',region:'target',material:'STONE',compare:'>=',value:1});
  l.events = [
    timed(5,'setEnv',{key:'wind',value:1}),
    timed(3,'fillRect',{mat:'STONE',x0:3,y0:8,x1:3,y1:8}),
    timed(3,'setEnv',{key:'wind',value:-0.5}),
    timed(3,'setEnv',{key:'wind',value:0.5}),
  ];
  const s = puzzleSession(l);
  try {
    s.advance(); s.advance();
    s.stroke(stroke('WATER',3,8));
    assert.equal(s.world.getCell(3,8).type,WATER);
    const resumed = puzzleRestore(l,s.progress(),'running');
    try {
      s.beforeStep(); s.beforeStep();
      s.world.step(); s.afterStep(); // 游戏循环使用同样的前后钩子。
      assert.equal(s.world.getCell(3,8).type,STONE);
      assert.equal(s.world.getEnv().wind,0.5);
      assert.equal(s.phase,'running');
      s.advance(); s.advance();
      resumed.advance(); resumed.advance();
      assert.equal(s.elapsed,4); assert.equal(s.world.tick,21);
      assert.equal(s.phase,'won'); assert.equal(s.used,1);
      assert.equal(resumed.world.hash(),s.world.hash());
      const rec = s.world.recording();
      assert.deepEqual(rec.log.filter(e=>e.step === 19).map(e=>e.command),['stroke','fillRect','setEnv','setEnv']);
      assert.equal(rec.log.length,5);
      assert.equal(engineReplay.replay(rec),s.world.hash());
      l.reference = s.recording();
      assert.deepEqual(puzzleVerify(JSON.parse(JSON.stringify(l))),{hash:s.world.hash(),steps:4,used:1,stars:3});
    } finally { resumed.dispose(); }
  } finally { s.dispose(); source.dispose(); engineReplay.dispose(); }
});

test('解谜定时事件：规划开始前不触发，点火、闪电和生成命令进入录制', () => {
  const l = puzzleBlank();
  l.goal = {op:'burning',region:'target',compare:'>=',value:1};
  l.regions = [zone];
  l.world.commands = [
    {command:'fillRect',args:{mat:'WOOD',x0:3,y0:8,x1:4,y1:9}},
    {command:'setEnv',args:{key:'structure',value:false}},
    {command:'lightning',args:{x:16}},
    {command:'spawn',args:{mat:'WATER',x:24,y:12,r:1}},
  ];
  l.events = [timed(1,'ignite',{x:3,y:8}),timed(1,'lightning',{x:16}),timed(1,'spawn',{mat:'WATER',x:24,y:12,r:1})];
  const s = puzzleSession(l);
  try {
    const before = s.world.recording().log.length;
    s.beforeStep(); s.advance();
    assert.equal(s.world.tick,0);
    assert.equal(s.world.recording().log.length,before);
    s.run(); s.advance();
    assert.equal(s.phase,'won');
    assert.deepEqual(s.world.recording().log.slice(before).map(e=>e.command),['ignite','lightning','spawn']);
    assert.equal(s.used,0);
  } finally { s.dispose(); }
});

test('解谜持续条件：组合、重复读取、清零与燃烧标志上下界', () => {
  const stats = {counts:new Uint32Array(64),burning:0,maxTemp:10};
  const burning = (compare,value) => ({op:'burning',region:'target',compare,value});
  const l = {
    regions:[zone],
    goal:{op:'or',conditions:[{op:'not',condition:survive(3)},hold(2,{op:'and',conditions:[burning('>=',1),{op:'cooler',region:'target',temperature:20}]})]},
    fail:hold(2,burning('<=',0)),
  };
  const get = puzzleConditions(l,{queryRegion:()=>stats},new Map([['target',1]]));
  stats.counts[FIRE] = 4;
  assert.deepEqual(get(1),{won:true,lost:false});
  assert.deepEqual(get(1),{won:true,lost:false});
  assert.deepEqual(get(2),{won:true,lost:true});
  stats.burning = 1;
  assert.deepEqual(get(3),{won:false,lost:false});
  stats.maxTemp = 20;
  assert.deepEqual(get(4),{won:false,lost:false});
  stats.maxTemp = 10;
  assert.deepEqual(get(5),{won:false,lost:false});
  assert.deepEqual(get(6),{won:true,lost:false});
});

test('解谜环境：预设后覆写已选字段；定格时间；天气事件保留指定气温和风力', () => {
  const l = puzzleBlank();
  l.type = 'realtime';
  l.goal = survive(3);
  l.world.commands = [{command:'setEnv',args:{key:'dayNight',value:false}}];
  l.environment = {time:0.5,weather:'snow',temp:-12,wind:-0.7,windPower:0.15};
  l.events = [
    timed(1,'setEnv',{key:'wind',value:0.8}),
    timed(2,'setEnv',{key:'windPower',value:0.25}),
    timed(2,'setWeather',{key:'storm'}),
  ];
  const fields = ['time','timeScale','dayNight','weather','temp','wind','windPower'];
  const s = puzzleSession(l);
  try {
    const env = () => fields.map(key=>s.world.getEnv()[key]);
    assert.deepEqual(env(),[0.5,0,true,'snow',-12,-0.7,0.15]);
    while (s.phase === 'running') s.advance();
    assert.deepEqual(env(),[0.5,0,true,'storm',-12,0.8,0.25]);
    const playback = createWorld(l.world);
    try { assert.equal(playback.replay(s.world.recording()),s.world.hash()); }
    finally { playback.dispose(); }
  } finally { s.dispose(); }
});

test('解谜统计区：默认可绘制，材料限制与禁建叠加，搭建笔画可按引擎录制复现', () => {
  let l = puzzleBlank();
  l.materials = {SAND:4,WATER:4};
  l.world.commands = [{command:'stroke',args:stroke('STONE',2,7)}];
  l = puzzleEditRect(l,'zone',{x:1,y:6},{x:5,y:9},null,'target',['WATER']);
  l.regions.push({...zone,id:'open',x:10},{...zone,id:'mask',type:'noBuild',x:4,w:1});
  const s = puzzleSession(l), playback = createWorld(l.world);
  try {
    assert.equal(s.world.getCell(2,7).type,STONE);
    assert.equal(s.stroke(stroke('SAND',3,8)).placed,0);
    assert.equal(s.stroke(stroke('WATER',3,8)).placed,1);
    assert.equal(s.stroke(stroke('WATER',4,8)).placed,0);
    assert.equal(s.stroke(stroke('SAND',10,8)).placed,1);
    s.run(); s.advance();
    assert.equal(s.used,2);
    assert.equal(playback.replay(s.world.recording()),s.world.hash());
  } finally { s.dispose(); playback.dispose(); }
});

test('解谜双语与提示：回退原文，逐级查看写入进度，参考与星级独立', () => {
  const l = puzzleBlank();
  l.nameI18n = {'zh-CN':'试验关',en:'Trial'};
  l.desc = {en:'Description'};
  l.hints = [{'zh-CN':'提示一',en:'First'},{'zh-CN':'提示二'},{en:'Third'}];
  delete l.hint;
  l.goal = survive(1);
  puzzleValidateLevel(l);
  assert.equal(puzzleText(l.nameI18n,false,'en'),'Trial');
  assert.equal(puzzleText(l.desc,false,'zh-CN'),'Description');
  assert.equal(puzzleText(l.hints[1],false,'en'),'提示二');
  assert.equal(puzzleText('原文',false,'en'),'原文');
  const s = puzzleSession(l);
  try {
    const hash = s.world.hash();
    assert.equal(s.revealHint(),1); assert.equal(s.revealHint(),2);
    assert.equal(s.world.hash(),hash);
    const restored = puzzleRestore(l,s.progress(),'planning');
    try {
      assert.equal(restored.hintsUsed,2);
      assert.equal(restored.revealHint(),3); assert.equal(restored.revealHint(),3);
      restored.run(); restored.advance();
      assert.equal(restored.outcome.score,3);
      assert.deepEqual(restored.recording(),{steps:1,log:[]});
    } finally { restored.dispose(); }
    assert.throws(()=>puzzleRestore(l,{...s.progress(),hintsUsed:4},'planning'),/无效/);
  } finally { s.dispose(); }
});

test('解谜扩展校验：关卡边界、命令参数、条件树、允许材料和本地化字段', () => {
  for (const extra of [
    {events:[timed(0,'clear',{})]}, {events:[timed(181,'clear',{})]},
    {events:[timed(1,'lightning',{x:80})]}, {events:[timed(1,'spawn',{mat:'UNKNOWN',x:1,y:1})]},
    {events:[timed(1,'explode',{x:1,y:1,p:0})]}, {events:[timed(1,'loadScene',{index:0})]},
    {events:[timed(1,'setEnv',{key:'wind',value:'left'})]},
    {goal:hold(0,survive(1))}, {goal:hold(2,{op:'burning',region:'absent',compare:'>=',value:1})},
    {regions:[{...zone,allow:['UNKNOWN']}]},
    {environment:{time:1}}, {environment:{windPower:2}}, {environment:{weather:'unknown'}},
    {nameI18n:{}}, {desc:{fr:'Texte'}}, {hints:[{en:' '}]}, {hints:Array(4).fill({en:'Hint'})},
  ]) assert.throws(()=>puzzleValidateLevel({...puzzleBlank(),...extra}));
});

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(),'puzzle-format-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return dir;
}
const writeJson = (dir,file,data) => writeFileSync(join(dir,file),JSON.stringify(data));

test('解谜内置目录：保留显式顺序，发现子目录和 C3 顺序，拒绝全局重名', t => {
  const root = tempDir(t), child = join(root,'c3');
  mkdirSync(child);
  for (const id of ['first','second','third']) writeJson(root,id+'.json',{id});
  for (const id of ['c3-2','c3-10']) writeJson(child,id+'.json',{id});
  writeJson(root,'order.json',['second','first']);
  writeJson(child,'meta.json',{order:['c3-2','c3-10']});
  assert.deepEqual(discoverPuzzleLevels(root).map(({level})=>level.id),['second','first','third','c3-2','c3-10']);
  writeJson(child,'duplicate.json',{id:'third'});
  assert.throws(()=>discoverPuzzleLevels(root),/重复/);
});

test('解谜 C3 文本迁移：默认预览，写前校验所有文件，只改文本且可重复运行', t => {
  const dir = tempDir(t);
  const a = {...puzzleBlank(),id:'fixture-a'}, b = {...a,id:'fixture-b'};
  const data = {chapter:['测试章节','Fixture chapter'],name:['测试关','Fixture'],desc:['说明','Description'],hints:[['一','One'],['二','Two'],['三','Three']],solutions:[]};
  writeJson(dir,'fixture-a.json',a); writeJson(dir,'fixture-b.json',b);
  const meta = {version:1,chapters:{1:data.chapter},order:[a.id,b.id],levels:{[a.id]:data,[b.id]:{...data,hints:[]}}};
  writeJson(dir,'meta.json',meta);
  assert.throws(()=>migrateC3Text(dir,{write:true}),/fixture-b.*三级提示/);
  const check = file => readFileSync(join(dir,file),'utf8');
  assert.equal(check('fixture-a.json'),JSON.stringify(a));
  meta.levels[b.id] = data;
  writeJson(dir,'meta.json',meta);
  assert.deepEqual(migrateC3Text(dir),[a.id,b.id]);
  assert.equal(check('fixture-a.json'),JSON.stringify(a));
  assert.deepEqual(migrateC3Text(dir,{write:true}),[a.id,b.id]);
  const {chapterI18n,nameI18n,desc,hints,...rest} = JSON.parse(check('fixture-a.json'));
  assert.deepEqual(rest,a);
  assert.equal(chapterI18n.en,'Fixture chapter');
  assert.equal(nameI18n.en,'Fixture'); assert.equal(desc['zh-CN'],'说明'); assert.equal(hints[2].en,'Three');
  assert.equal(check('meta.json'),JSON.stringify(meta));
  assert.deepEqual(migrateC3Text(dir,{write:true}),[]);
});
