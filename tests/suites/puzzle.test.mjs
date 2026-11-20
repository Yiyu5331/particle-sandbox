import { createMemoryStorage } from '../../src/meta/profile/storage.js';
import { createProfileStore } from '../../src/meta/profile/index.js';
import { recordPuzzleStars } from '../../src/meta/profile/runtime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, BRICK, FIRE, F_BODY, SAND, WATER } from '../../src/engine/index.js';
import { puzzleLevels } from '../../src/modes/puzzle/catalog.js';
import { puzzleConditions, puzzleSession, puzzleRestore, puzzleVerify, puzzleVerifyAsync } from '../../src/modes/puzzle/session.js';
import { puzzleBlank, puzzleEditRect, puzzleUnlocked } from '../../src/modes/puzzle/editor.js';
import { puzzleValidateLevel } from '../../src/modes/puzzle/format.js';

const stroke = (tool='SAND',x0=2,x1=x0,y=2) => ({tool,x0,y0:y,x1,y1:y,size:1});
const region = {id:'r',type:'goal',x:0,y:0,w:2,h:1};
const count = (compare,value,material='SAND') => ({op:'count',region:'r',compare,value,material});
const survive = steps => ({op:'survive',steps});
const noFire = steps => ({op:'noFire',region:'r',steps});
const integrity = percent => ({op:'integrity',region:'r',material:'BRICK',percent});

function fixture(goal,fail = null) {
  const stats = {counts:new Uint32Array(64),burning:0,maxTemp:20};
  const fields = {type:[BRICK,BRICK],aux:[200,200],flags:[0,0]};
  let queries = 0;
  const world = { width:2,getField:k=>fields[k],queryRegion(id) { assert.equal(id,7); queries++; return stats; } };
  const evaluate = puzzleConditions({regions:[region],goal,fail},world,new Map([['r',7]]));
  return {stats,fields,evaluate,queries:()=>queries};
}

test('解谜数量：上下界含等号；同一帧不同子条件和胜败条件共享查询', () => {
  const f = fixture({op:'and',conditions:[count('>=',2),count('<=',2)]},count('>=',4));
  for (const [step,n,won,lost] of [[1,1,false,false],[2,2,true,false],[3,3,false,false],[4,4,false,true]]) {
    f.stats.counts[SAND] = n;
    assert.deepEqual(f.evaluate(step),{won,lost}); assert.equal(f.queries(),step);
  }
});

test('解谜无火：两种火源都会清零，重复读取同一步不累计', () => {
  const f = fixture(noFire(3));
  assert.equal(f.evaluate(1).won,false); assert.equal(f.evaluate(1).won,false);
  f.stats.counts[FIRE] = 1; assert.equal(f.evaluate(2).won,false);
  f.stats.counts[FIRE] = 0; assert.equal(f.evaluate(3).won,false);
  f.stats.burning = 1; assert.equal(f.evaluate(4).won,false);
  f.stats.burning = 0;
  assert.equal(f.evaluate(5).won,false); assert.equal(f.evaluate(6).won,false); assert.equal(f.evaluate(7).won,true);
  assert.throws(()=>f.evaluate(9),/连续/);
});

test('解谜温度：按区域最高温度严格比较', () => {
  const f = fixture({op:'cooler',region:'r',temperature:20});
  assert.equal(f.evaluate(1).won,false);
  f.stats.maxTemp = 19.9; assert.equal(f.evaluate(2).won,true);
  f.stats.maxTemp = 21; assert.equal(f.evaluate(3).won,false);
});

test('解谜结构：按初始位置和强度计算，排除下落刚体和替代材料', () => {
  const f = fixture(integrity(75)); f.stats.counts[BRICK] = 2;
  assert.equal(f.evaluate(1).won,true);
  f.fields.aux[0] = 100; assert.equal(f.evaluate(2).won,true);
  f.fields.aux[0] = 99; assert.equal(f.evaluate(3).won,false);
  f.fields.aux[0] = 255; f.fields.flags[1] = F_BODY; assert.equal(f.evaluate(4).won,false);
  f.fields.flags[1] = 0; f.fields.type[1] = SAND; assert.equal(f.evaluate(5).won,false);
  const l = puzzleBlank(); l.regions = [region]; l.goal = integrity(0);
  assert.throws(()=>puzzleSession(l),/初始承重格/);
});

test('解谜时间与逻辑：存活和时限边界、与或非、未决定结果的分支也连续采样', () => {
  const and = fixture({op:'and',conditions:[survive(3),noFire(3)]});
  assert.deepEqual([1,2,3].map(t=>and.evaluate(t).won),[false,false,true]);
  const or = fixture({op:'or',conditions:[{op:'not',condition:survive(3)},noFire(3)]});
  assert.deepEqual([1,2,3].map(t=>or.evaluate(t).won),[true,true,true]);
  const within = fixture({op:'within',steps:2,condition:survive(2)});
  assert.deepEqual([1,2,3].map(t=>within.evaluate(t).won),[false,true,false]);
});

test('解谜预算：按实际格扣款，单材和总额同时限量，重画、禁建和保护区不耗费', () => {
  const l = puzzleBlank(); l.budget = 5; l.materials = {SAND:3,WATER:6};
  l.regions = [{...region,type:'noBuild',x:0,y:2},{...region,id:'safe',type:'protected',x:2,y:2}];
  const s = puzzleSession(l);
  try {
    assert.equal(s.stroke(stroke('SAND',0,3)).placed,0);
    assert.equal(s.stroke(stroke('SAND',4,4)).placed,1);
    assert.equal(s.stroke(stroke('SAND',4,4)).placed,0);
    assert.equal(s.stroke(stroke('SAND',5,15)).placed,2);
    assert.equal(s.stroke(stroke('WATER',12,20)).placed,2);
    assert.equal(s.stroke(stroke('WATER',25)).placed,0);
    assert.equal(s.used,5); assert.equal(s.left('WATER'),4);
    assert.throws(()=>s.stroke(stroke('STONE')),/白名单/);
    assert.throws(()=>s.stroke({...stroke(),erase:true}),/字段/);
    s.run(); assert.throws(()=>s.stroke(stroke()),/阶段/);
  } finally { s.dispose(); }
});

test('解谜阶段：最后一步可通关，显式失败优先，超时失败，星级含阈值', () => {
  function play(goal,fail,maxSteps,stars) {
    const l = {...puzzleBlank(),goal,fail,maxSteps,stars}; const s = puzzleSession(l);
    try {
      s.stroke(stroke()); s.advance(); assert.equal(s.elapsed,0); s.run();
      while (s.phase === 'running') s.advance();
      const before = s.world.hash(); s.advance(); assert.equal(s.world.hash(),before);
      return s.outcome;
    } finally { s.dispose(); }
  }
  const stars = {two:{maxUsed:1,maxSteps:3},three:{maxUsed:1,maxSteps:2}};
  assert.equal(play(survive(2),null,2,stars).score,3);
  assert.equal(play(survive(3),null,3,stars).score,2);
  assert.equal(play(survive(4),null,4,stars).score,1);
  assert.equal(play(survive(2),survive(2),2,stars).state,'lost');
  assert.equal(play(survive(3),null,2,stars).state,'lost');
});

test('解谜存档：恢复规划布置及实时局的中途笔画、计数器、预算与最终哈希', () => {
  const first = puzzleSession(puzzleLevels[0]);
  first.stroke(puzzleLevels[0].reference.log[0].args);
  const plan = puzzleRestore(first.level,first.recording(),'planning');
  assert.equal(plan.world.hash(),first.world.hash()); assert.equal(plan.used,first.used);
  first.dispose(); plan.dispose();
  const l = structuredClone(puzzleLevels[1]); l.goal = {op:'and',conditions:[l.goal,noFire(30)]};
  l.goal.conditions[1].region = 'pool';
  const real = puzzleSession(l);
  for (let i=0;i<5;i++) real.advance();
  real.stroke(l.reference.log[0].args);
  const restored = puzzleRestore(l,real.recording(),'running');
  for (const s of [real,restored]) {
    while (s.elapsed < 14) s.advance();
    s.stroke(l.reference.log[1].args);
    while (s.phase === 'running') s.advance();
  }
  assert.equal(real.world.hash(),restored.world.hash()); assert.equal(restored.elapsed,30); assert.equal(restored.outcome.score,3);
  real.dispose(); restored.dispose();
});

test('解谜快照：以存档步为起点计时，保留原保护区，再注册关卡区域', () => {
  const source = createWorld({width:80,height:48,seed:1});
  source.addRegion({tag:'原保护区',x:0,y:0,w:8,h:8,rules:{protect:true}});
  source.step(17); const l = puzzleBlank(); delete l.world.commands; l.world.serialized = source.serialize();
  l.goal = survive(2); l.regions = [{...region,id:'extra',x:20,type:'protected'}];
  const s = puzzleSession(l);
  assert.equal(s.world.hash(),source.hash()); assert.equal(s.world.tick,17);
  assert.equal(s.stroke(stroke()).placed,0); assert.equal(s.world.regionAt(20,0).length,1);
  s.run(); s.advance(); s.advance(); assert.equal(s.elapsed,2); assert.equal(s.world.tick,19);
  s.dispose(); source.dispose();
});

test('解谜 schema 和引用：拒绝无效命令、材料、条件、区域、时间线及星级', () => {
  for (const change of [
    l=>{l.type='bad';},l=>{l.regions[0].w=1000;},l=>l.regions.push(l.regions[0]),l=>{l.goal.condition.region='missing';},
    l=>{l.goal={op:'and',conditions:[]};},l=>{l.goal={op:'survive',steps:0};},l=>{l.fail={op:'bad'};},
    l=>{l.budget=-1;},l=>{l.materials={UNKNOWN:1};},l=>{l.world.seed=0.8;},l=>{l.world.commands.push({command:'resize',args:{w:100,h:100}});},
    l=>{l.reference.log[0].step=3;},l=>{l.reference.log[0].command='fillRect';},l=>{l.reference.log[0].args.tool='STONE';},
    l=>{l.reference.log[0].args.limit=500;},l=>{l.stars.three.maxUsed=50;},
  ]) {
    const l = structuredClone(puzzleLevels[0]); change(l); assert.throws(()=>puzzleValidateLevel(l));
  }
});

test('解谜编辑器：从空白创建地形、目标区、数量目标及预算，录制后 JSON 往返通关', async () => {
  let l = puzzleEditRect(puzzleBlank(),'terrain',{x:0,y:47},{x:79,y:45},'STONE');
  l = puzzleEditRect(l,'goal',{x:40,y:44},{x:20,y:35},null,'bucket');
  l.goal = {op:'count',region:'bucket',material:'SAND',compare:'>=',value:4};
  l.budget = 6; l.materials.SAND = 5;
  const s = puzzleSession(l); s.stroke(stroke('SAND',25,35,26)); s.run();
  while (s.phase === 'running') s.advance();
  l.reference = s.recording(); const loaded = JSON.parse(JSON.stringify(l));
  const expected = {hash:s.world.hash(),used:5,stars:3,steps:s.elapsed}; s.dispose();
  assert.deepEqual(puzzleVerify(loaded),expected);
  assert.deepEqual(await puzzleVerifyAsync(loaded),expected);
  assert.throws(()=>puzzleVerify({...loaded,reference:{steps:40,log:[]}}),/未通关/);
  assert.throws(()=>puzzleVerify({...loaded,reference:{...loaded.reference,steps:loaded.reference.steps+1}}),/结算后/);
  const cancel = new AbortController(); cancel.abort(); await assert.rejects(puzzleVerifyAsync(l,cancel.signal),/取消/);
});

test('解谜示例：各关均可三星，空解失败；X2 保留最高星及跨章节解锁', async () => {
  const store=createProfileStore(createMemoryStorage());
  await store.readProfile();
  for (const [i,l] of puzzleLevels.entries()) {
    assert.equal(puzzleUnlocked(puzzleLevels,i,store.progress.stars),true);
    if (i+1<puzzleLevels.length) assert.equal(puzzleUnlocked(puzzleLevels,i+1,store.progress.stars),false);
    const r=puzzleVerify(l); assert.equal(r.stars,3);
    assert.throws(()=>puzzleVerify({...l,reference:{steps:l.maxSteps,log:[]}}),/未通关/);
    await recordPuzzleStars(store,l.id,r.stars); await recordPuzzleStars(store,l.id,1);
    assert.equal(store.progress.stars[l.id],3); assert.equal(store.progress.puzzle,i+1);
  }
});

test('解谜初始命令：环境和初始笔画与玩家预算分开，恢复快照也能继续画地形', () => {
  const l = puzzleBlank();
  l.world.commands = [{command:'clear',args:{}},{command:'setEnv',args:{key:'structure',value:false}},
    {command:'setEnv',args:{key:'temp',value:8}},{command:'stroke',args:stroke('WATER')}];
  const s = puzzleSession(l);
  assert.equal(s.world.getCell(2,2).type,WATER); assert.equal(s.used,0); assert.equal(s.world.getEnv().temp,8);
  l.world.serialized = s.world.serialize(); delete l.world.commands; s.dispose();
  const edited = puzzleEditRect(l,'terrain',{x:1,y:3},{x:3,y:3},'BRICK');
  const loaded = puzzleSession(edited);
  assert.equal(loaded.world.getCell(2,3).type,BRICK); assert.equal(loaded.world.getCell(2,2).type,WATER);
  loaded.dispose();
});

test('解谜组合真值表：与、或、非覆盖全部输入，期限也可以用于失败树', () => {
  const a = count('>=',1,'SAND'), b = count('>=',1,'WATER');
  for (const x of [0,1]) for (const y of [0,1]) {
    const f = fixture({op:'or',conditions:[a,b]},{op:'not',condition:{op:'and',conditions:[a,b]}});
    f.stats.counts[SAND] = x; f.stats.counts[WATER] = y;
    assert.deepEqual(f.evaluate(1),{won:!!(x||y),lost:!(x&&y)});
  }
  const f = fixture(survive(9),{op:'not',condition:{op:'within',steps:2,condition:survive(1)}});
  assert.deepEqual([1,2,3].map(t=>f.evaluate(t).lost),[false,false,true]);
  for (const p of [0,1,100]) {
    const empty = fixture(integrity(p)); assert.equal(empty.evaluate(1).won,p===0);
  }
});

test('解谜编辑后验证：改名和无关地形仍可沿用原参考', () => {
  const l = structuredClone(puzzleLevels[0]); l.name = '新名字';
  const edited = puzzleEditRect(l,'terrain',{x:0,y:44},{x:0,y:44},'STONE');
  assert.deepEqual(edited.reference,l.reference); assert.equal(puzzleVerify(edited).stars,3);
});

test('解谜读档：终局可复现，相互矛盾的阶段只释放临时世界', () => {
  const level = puzzleLevels[0];
  const live = puzzleRestore(level,level.reference,'won');
  try {
    const hash = live.world.hash(), record = live.recording();
    let temporary;
    assert.throws(()=>puzzleRestore(level,record,'lost',opts=>(temporary=createWorld(opts))),/阶段不一致/);
    assert.ok(temporary.disposed);
    assert.equal(live.world.hash(),hash); assert.equal(live.phase,'won'); assert.equal(live.outcome.score,3);
    const factory = () => assert.fail('基本格式错误不应创建世界');
    assert.throws(()=>puzzleRestore(level,null,'won',factory),/无效的解谜进度/);
    assert.throws(()=>puzzleRestore(level,record,'无效',factory),/无效的解谜进度/);
  } finally { live.dispose(); }
});
