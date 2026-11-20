import { uiT } from '../../ui/i18n.js';
import { createWorld, FIRE, F_BODY } from '../../engine/index.js';
import { createBudget } from '../../game/budget.js';
import { puzzleCheckStroke, puzzleMaterial, puzzleValidateLevel } from './format.js';

export function puzzleWorld(level, factory = createWorld) {
  const w = factory(level.world);
  try {
    if (level.world.serialized) {
      const data = JSON.parse(level.world.serialized);
      w.exec('restoreFull',{json:level.world.serialized});
      // C0 的完整读档命令只处理物理状态。用公开接口重新注册存档中的区域规则。
      for (const region of data.regions) w.addRegion(region);
    }
    for (const {command,args} of level.world.commands || []) {
      const normalized = {...args};
      if ('mat' in args) normalized.mat = puzzleMaterial(args.mat);
      if ('tool' in args) normalized.tool = puzzleMaterial(args.tool);
      w.exec(command,normalized);
    }
    const ids = new Map();
    for (const r of level.regions) {
      const rules = r.type === 'protected' ? {protect:true} : r.type === 'noBuild' ? {paint:false} : {};
      ids.set(r.id,w.addRegion({...r, tag:r.id, rules}));
    }
    return {world:w, ids};
  } catch (error) { w.dispose(); throw error; }
}

// 编译一次条件树。每个时间叶有独立计数器，同一步的区域统计在胜/败两棵树间共享。
export function puzzleConditions(level, world, ids) {
  function compile(c) {
    const id = ids.get(c.region);
    switch (c.op) {
      case 'and':
      case 'or': {
        const children = c.conditions.map(compile);
        return frame => {
          const results = children.map(test => test(frame));
          return c.op === 'and' ? results.every(Boolean) : results.some(Boolean);
        };
      }
      case 'not': {
        const inner = compile(c.condition);
        return frame => !inner(frame);
      }
      case 'within': {
        const inner = compile(c.condition);
        return frame => inner(frame) && frame.step <= c.steps;
      }
      case 'survive': return frame => frame.step >= c.steps;
      case 'count': {
        const mat = puzzleMaterial(c.material);
        return frame => {
          const n = frame.query(id).counts[mat];
          return c.compare === '>=' ? n >= c.value : n <= c.value;
        };
      }
      case 'noFire': {
        let streak = 0;
        return frame => {
          const stats = frame.query(id);
          streak = !stats.counts[FIRE] && !stats.burning ? streak + 1 : 0;
          return streak >= c.steps;
        };
      }
      case 'cooler': return frame => frame.query(id).maxTemp < c.temperature;
      case 'integrity': {
        const mat = puzzleMaterial(c.material), footprint = [];
        const r = level.regions.find(area => area.id === c.region);
        const type = world.getField('type'), aux = world.getField('aux'), width = world.width;
        let initial = 0;
        for (let y=r.y;y<r.y+r.h;y++) for (let x=r.x;x<r.x+r.w;x++) {
          const i = y * width + x;
          if (type[i] !== mat) continue;
          const strength = Math.max(1,aux[i]);
          footprint.push([i,strength]); initial += strength;
        }
        if (!initial) throw new Error(uiT('结构目标没有初始承重格：{id}',{id:c.region}));
        return frame => {
          if (!frame.query(id).counts[mat]) return c.percent === 0;
          const types = world.getField('type'), health = world.getField('aux'), flags = world.getField('flags');
          let retained = 0;
          for (const [i,base] of footprint) {
            if (types[i] === mat && !(flags[i] & F_BODY)) retained += Math.min(base,health[i]);
          }
          return retained * 100 >= initial * c.percent;
        };
      }
      default: throw new Error(uiT('未知条件：{id}',{id:c.op}));
    }
  }
  const goal = compile(level.goal), fail = level.fail && compile(level.fail);
  let lastStep = 0, lastResult;
  return step => {
    if (lastResult && step === lastStep) return lastResult;
    if (step !== lastStep+1) throw new Error(uiT('条件必须从第一步开始连续采样'));
    const cache = new Map();
    const frame = {step, query(id) {
      if (!cache.has(id)) cache.set(id,world.queryRegion(id));
      return cache.get(id);
    }};
    lastResult = {won:goal(frame), lost:!!fail && fail(frame)}; lastStep = step;
    return lastResult;
  };
}

export function puzzleSession(level, factory = createWorld) {
  puzzleValidateLevel(level);
  const {world,ids} = puzzleWorld(level,factory);
  let evaluate;
  try { evaluate = puzzleConditions(level,world,ids); }
  catch (error) { world.dispose(); throw error; }
  const budget = createBudget(Object.fromEntries(Object.entries(level.materials).map(([key,n])=>[puzzleMaterial(key),n])));
  const origin = world.tick, log = [];
  let used = 0, elapsed = 0, phase = level.type === 'planning' ? 'planning' : 'running';
  let outcome = {state:'playing',score:0,detail:''};
  function afterStep() {
    if (phase !== 'running') return outcome;
    if (world.tick !== origin + elapsed + 1) throw new Error(uiT('解谜必须逐步采样'));
    elapsed++;
    const {won,lost} = evaluate(elapsed);
    if (lost || won || elapsed >= level.maxSteps) {
      const passed = won && !lost;
      const earns = rule => elapsed <= rule.maxSteps && used <= rule.maxUsed;
      const score = passed ? 1 + Number(earns(level.stars.two)) + Number(earns(level.stars.three)) : 0;
      phase = passed ? 'won' : 'lost';
      outcome = {state:phase,score,detail:lost ? '触发失败条件' : passed ? '目标达成' : '超过时限'};
    }
    return outcome;
  }
  return {
    world,level, get phase() { return phase; }, get elapsed() { return elapsed; }, get used() { return used; },
    get outcome() { return outcome; }, left:key => budget.left(puzzleMaterial(key)),
    run() { if (phase === 'planning') phase = 'running'; },
    stroke(args) {
      if (phase !== 'planning' && !(phase === 'running' && level.type === 'realtime')) throw new Error(uiT('当前阶段不能放置材料'));
      if (log.length >= 36000) throw new Error(uiT('笔画数已达到关卡格式上限'));
      const tool = puzzleCheckStroke(level,args);
      const res = budget.brushStroke(world,{...args,tool,limit:level.budget-used});
      used += res.placed;
      // 零放置的喷雾也可能消耗随机数，必须原样保留。
      log.push({step:elapsed,command:'stroke',args:{...args,tool}});
      return res;
    },
    afterStep,
    advance() { if (phase === 'running') { world.step(); afterStep(); } return outcome; },
    recording() { return {steps:elapsed, log:structuredClone(log)}; },
    dispose() { world.dispose(); },
  };
}

// 前缀回放也用于模式恢复。最后一步后的未运行笔画可存在于进行中的存档。
export function puzzleRestore(level, record, phase, factory) {
  if (!Number.isInteger(record?.steps) || record.steps < 0 || record.steps > level.maxSteps ||
      !Array.isArray(record.log) || record.log.length > 36000 || !['planning','running','won','lost'].includes(phase)) {
    throw new Error(uiT('无效的解谜进度'));
  }
  const s = puzzleSession(level,factory);
  try {
    let i = 0;
    for (let step=0;step<=record.steps;step++) {
      while (record.log[i]?.step === step) {
        if (record.log[i].command !== 'stroke') throw new Error(uiT('未知玩家命令'));
        s.stroke(record.log[i++].args);
      }
      if (step === 0 && phase !== 'planning') s.run();
      if (step < record.steps) {
        if (s.phase !== 'running') throw new Error(uiT('记录超过结算步'));
        s.advance();
      }
    }
    if (i !== record.log.length || phase !== s.phase) throw new Error(uiT('解谜记录与阶段不一致'));
    return s;
  } catch (error) { s.dispose(); throw error; }
}

function* puzzleReplay(level) {
  const s = puzzleSession(level);
  try {
    let i = 0;
    const {steps,log} = level.reference;
    while (s.elapsed < steps && s.outcome.state === 'playing') {
      while (log[i]?.step === s.elapsed) s.stroke(log[i++].args);
      s.run(); s.advance();
      if (s.elapsed % 60 === 0) yield;
    }
    if (s.phase !== 'won') throw new Error(uiT('参考解法未通关：{reason}',{reason:uiT(s.outcome.detail || '录制结束')}));
    if (i !== log.length || s.elapsed !== steps) throw new Error(uiT('参考记录在结算后还有步骤'));
    return {hash:s.world.hash(),steps:s.elapsed,used:s.used,stars:s.outcome.score};
  } finally { s.dispose(); }
}

function puzzleCompareRuns(a,b) {
  if (a.hash !== b.hash || a.steps !== b.steps || a.used !== b.used || a.stars !== b.stars) throw new Error(uiT('两次回放结果不同'));
  return a;
}
export function puzzleVerify(level) {
  function once() {
    const replay = puzzleReplay(level);
    let r; do { r = replay.next(); } while (!r.done);
    return r.value;
  }
  return puzzleCompareRuns(once(),once());
}
export async function puzzleVerifyAsync(level, signal) {
  async function once() {
    const replay = puzzleReplay(level);
    try {
      for (;;) {
        if (signal?.aborted) throw new Error(uiT('已取消验证'));
        const r = replay.next(); if (r.done) return r.value;
        await new Promise(done=>setTimeout(done,0));
      }
    } finally { replay.return(); }
  }
  return puzzleCompareRuns(await once(),await once());
}
