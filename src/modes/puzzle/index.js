import { gameCheckOutcome, setPaused, startMode } from '../../game/manager.js';
import { OUTCOME_PLAYING } from '../../game/mode.js';
import { downloadBlob } from '../../ui/host.js';
import { puzzleLevels } from './catalog.js';
import { puzzleUnlocked, puzzleBlank } from './editor.js';
import { puzzleMaterial, puzzleValidateLevel } from './format.js';
import { puzzleRestore, puzzleSession, puzzleWorld } from './session.js';
import { puzzleView } from './view.js';

import { recordPuzzleStars } from '../../meta/profile/runtime.js';
import { uiT } from '../../ui/i18n.js';
import { MATERIALS } from '../../engine/index.js';
const puzzleCustom = new Map();
const puzzlePrepared = Symbol();
export const puzzleModeDef = {
  id:'puzzle', name:'物理解谜', desc:'规划或实时布置材料，让物理过程完成关卡目标。', create:puzzleMode,
};

function puzzleMode() {
  const controller = new AbortController();
  let ctx, view, world = null, session = null, level = null, screen = 'select', official = null, form = null;
  // 完整准备成功才进入管理器的切换流程；此时旧世界及编辑表单仍然可用。
  function go(params) {
    const next = prepare(params);
    startMode('puzzle',{[puzzlePrepared]:next});
  }
  function showWorld(next) {
    const previous = world;
    ctx.setWorld(next); world = next;
    if (next) document.getElementById('viewport').style.setProperty('--puzzle-aspect',String(next.width/next.height));
    if (previous && previous !== next) previous.dispose();
  }
  function preview(next) {
    const built = puzzleWorld(puzzleValidateLevel(next),ctx.createWorld);
    showWorld(built.world); level = next;
  }
  function playParams() { return { screen,level,official }; }
  function reset(keep) {
    const log = keep ? session.recording().log.filter(e=>e.step === 0) : [];
    go({...playParams(),saved:{steps:0,log,hintsUsed:session.hintsUsed},phase:level.type === 'planning' ? 'planning' : 'running'});
  }
  function prepare(params) {
    const scene = params.screen ?? (params.levelId ? 'play' : 'select');
    if (scene === 'select') return {screen:scene, official:null, level:null, session:null, world:null};
    if (!['play','record','edit'].includes(scene)) throw new Error('未知解谜页面');
    const id = params.official ?? params.levelId ?? null;
    let design = params.level;
    if (id !== null) {
      const i = puzzleLevels.findIndex(l=>l.id === id);
      if (i < 0 || !puzzleUnlocked(puzzleLevels,i,ctx.profile?.progress?.stars)) throw new Error('关卡尚未解锁');
      design = puzzleLevels[i];
    }
    if (scene === 'edit') {
      const built = puzzleWorld(puzzleValidateLevel(design),ctx.createWorld);
      return {screen:scene, official:id, level:design, session:null, world:built.world};
    }
    const play = params.saved ? puzzleRestore(design,params.saved,params.phase,ctx.createWorld) : puzzleSession(design,ctx.createWorld);
    return {screen:scene, official:id, level:design, session:play, world:play.world};
  }
  let saving = false, saveError = '';
  function persistWin() {
    if (screen !== 'play' || !official || session.phase !== 'won') return;
    const store = ctx.profile, score = session.outcome.score;
    if (!store) { saveError = '进度暂不可用'; return; }
    const owner = ctx.game.mode;
    saving = true;
    recordPuzzleStars(store,official,score).catch(e => {
      saveError = '通关进度保存失败'; console.error(e);
    }).finally(() => {
      saving = false;
      if (!controller.signal.aborted) gameCheckOutcome(owner);
    });
  }
  function adopt() {
    if (session.phase !== 'won') throw new Error('只有通关录制可以用作参考解法');
    go({screen:'edit',level:{...level,reference:session.recording()}});
  }
  function mount(next) {
    ({screen, official, level, session} = next);
    form = null;
    showWorld(next.world);
    setPaused(session?.phase !== 'running');
    if (screen === 'select') view.picking(puzzleLevels,puzzleCustom,ctx.profile);
    else if (screen === 'edit') form = view.editing(level);
    else {
      persistWin();
      view.playing(session,screen === 'record',()=>reset(true),()=>reset(false),official); view.status(session);
    }
  }
  return {
    id:'puzzle',name:'物理解谜',wantsOverlay:true,
    init(c,params = {}) {
      ctx = c;
      view = puzzleView({
        select:()=>go({screen:'select'}), play:id=>go({levelId:id}),
        newLevel() {
          const draft = puzzleBlank();
          for (const key of ['name','chapter','hint']) draft[key] = uiT(draft[key]);
          go({screen:'edit',level:draft});
        },
        editCopy:l=>go({screen:'edit',level:structuredClone(l)}),
        importLevel(l,edit) {
          go({screen:edit ? 'edit' : 'play',level:l});
          puzzleCustom.set(l.id,l);
        },
        record:l=>go({screen:'record',level:l}),
        backToEditor:()=>go({screen:'edit',level}),
        adopt,
        preview, download:l=>downloadBlob(new Blob([JSON.stringify(l,null,2)],{type:'application/json'}),l.id+'.json'),
        size:()=>world,
        blocked:()=>document.getElementById('app').inert || ctx.game.menuOpen || ctx.game.busy || (session && session.phase !== 'planning' &&
          !(session.phase === 'running' && level.type === 'realtime')),
        run() { session.run(); setPaused(false); view.status(session); },
        stroke(args) { session.stroke(args); view.status(session); },
      },controller.signal);
      try { mount(params[puzzlePrepared] ?? prepare(params)); } catch (e) { mount(prepare({screen:'select'})); view.note(e.message); }
    },
    beforeStep() { session?.beforeStep(); },
    update() {
      if (!session || session.phase !== 'running') return;
      session.afterStep();
      if (session.phase !== 'running') {
        setPaused(true);
        persistWin();
      }
      if (session.elapsed % 6 === 0 || session.phase !== 'running') view.status(session);
    },
    onEvent() {},
    renderOverlay(g) {
      if (!level || !world) return;
      const sx = g.canvas.width/world.width, sy = g.canvas.height/world.height;
      g.clearRect(0,0,g.canvas.width,g.canvas.height);
      function outline(r,color) {
        g.strokeStyle = color; g.lineWidth = 2;
        g.strokeRect(r.x*sx+1,r.y*sy+1,Math.max(1,r.w*sx-2),Math.max(1,r.h*sy-2));
      }
      for (const r of level.regions) {
        if (r.type === 'zone' && screen !== 'edit') continue;
        g.setLineDash(r.type === 'noBuild' || r.type === 'zone' ? [4,4] : []);
        outline(r,{goal:'#ffd66d',noBuild:'#ea91a1',protected:'#97caff',zone:'#b8bcc699'}[r.type]);
      }
      g.setLineDash([]); const rect = view.previewRect(); if (rect) outline(rect,'white');
    },
    getHUD() {
      if (!session) return {items:[{id:'page',type:'hint',label:screen === 'edit' ? '编辑地形' : '选择关卡'}]};
      return {items:[
        level.budget ? {id:'budget',type:'progress',label:'用料',value:session.used,max:level.budget} : {id:'budget',type:'value',label:'用料',value:'0/0'},
        {id:'time',type:'countdown',label:'剩余时间',seconds:(level.maxSteps-session.elapsed)/60},
        ...Object.keys(level.materials).map(key=>({id:key,type:'value',label:MATERIALS[puzzleMaterial(key)].name,value:session.left(key)})),
        ...(saving ? [{id:'save',type:'hint',label:'正在保存星级'}] : []),
      ]};
    },
    restart() { if (session) reset(false); else go({screen:'select'}); },
    checkOutcome() {
      if (!session || saving || session.phase === 'planning' || session.phase === 'running') return OUTCOME_PLAYING;
      const actions = [{label:'返回选关',onClick:()=>go({screen:'select'})}];
      if (saveError && ctx.profile) actions.unshift({label:'重试保存',onClick:()=>go({...playParams(),saved:session.progress(),phase:session.phase})});
      if (screen === 'record') {
        if (session.phase === 'won') actions.unshift({label:'采用本次录制',onClick:adopt});
        actions.push({label:'返回编辑器',onClick:()=>go({screen:'edit',level})});
      }
      return {...session.outcome,detail:saveError || session.outcome.detail,
        stats:[{label:'星级',value:'★'.repeat(session.outcome.score)+'☆'.repeat(3-session.outcome.score)},{label:'用料',value:session.used},
          ...(level.hints ? [{label:'已查看提示',value:session.hintsUsed}] : [])],actions};
    },
    serialize() {
      return {screen,official,level:structuredClone(form ? form() : level),...(session ? {saved:session.progress(),phase:session.phase} : {})};
    },
    deserialize(data) {
      if (!['select','edit','play','record'].includes(data?.screen)) throw new Error('无效的解谜存档页面');
      if (['play','record'].includes(data.screen) && !data.saved) throw new Error('解谜存档缺少回放进度');
      go(structuredClone(data));
    },
    dispose() {
      controller.abort(); view?.dispose(); world?.dispose(); world = null;
      document.getElementById('viewport').style.removeProperty('--puzzle-aspect');
    },
  };
}
