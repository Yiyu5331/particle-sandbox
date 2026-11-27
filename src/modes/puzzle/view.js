import { MATERIALS, WEATHER_PRESETS } from '../../engine/index.js';
import { puzzleVerifyAsync } from './session.js';
import { puzzleCheckEvent, puzzleLevelLabel, puzzleMaterial, puzzleText, puzzleValidateLevel } from './format.js';
import { puzzleEditedLevel, puzzleEditRect, puzzleUnlocked } from './editor.js';

import { uiButton, uiCardGrid, uiElement, uiField, uiPanel, uiSelect, uiTabs } from '../../ui/components.js';
import { uiT, uiOnLanguage } from '../../ui/i18n.js';

function puzzleRuleText(c) {
  const mat = c.material === undefined ? '' : uiT(MATERIALS[puzzleMaterial(c.material)].name);
  const values = {...c, mat};
  switch (c.op) {
    case 'count': return uiT('{region} 内{mat} {compare} {value} 格',values);
    case 'burning': return uiT('{region} 内燃烧格数 {compare} {value}',values);
    case 'noFire': return uiT('{region} 连续 {steps} 步无火',values);
    case 'cooler': return uiT('{region} 最高温度低于 {temperature}°C',values);
    case 'integrity': return uiT('{region} 的{mat}完好度 ≥ {percent}%',values);
    case 'survive': return uiT('存活 {steps} 步',values);
    case 'within': return uiT('{steps} 步内满足（{condition}）',{steps:c.steps,condition:puzzleRuleText(c.condition)});
    case 'hold': return uiT('持续 {steps} 步满足（{condition}）',{steps:c.steps,condition:puzzleRuleText(c.condition)});
    case 'not': return uiT('不满足（{condition}）',{condition:puzzleRuleText(c.condition)});
    default: return '('+c.conditions.map(puzzleRuleText).join(uiT(c.op === 'and' ? ' 且 ' : ' 或 '))+')';
  }
}

const puzzleEventExamples = {
  spawn:{mat:'WATER',x:4,y:4,r:2}, ignite:{x:4,y:4}, lightning:{x:4}, setWeather:{key:'rain'},
  setEnv:{key:'wind',value:1}, setGravity:{dir:'down'}, clear:{},
  fillRect:{mat:'WATER',x0:4,y0:4,x1:6,y1:4}, fillCircle:{mat:'WATER',cx:4,cy:4,r:2},
  stroke:{tool:'WATER',x0:4,y0:4,x1:6,y1:4,size:1}, explode:{x:4,y:4},
};
const puzzleEnvironmentFields = [['time','固定时间（0～1）'],['temp','环境气温（°C）'],['wind','风向（−1～1）'],['windPower','风力（0～1）']];

export function puzzleView(actions, signal) {
  const side = uiElement('section'), picker = uiElement('section'), message = uiElement('p');
  side.id = 'puzzle-tools'; picker.id = 'puzzle-picker'; message.setAttribute('role','status');
  document.getElementById('palette').append(side); document.getElementById('stage').append(picker);
  const canvas = document.getElementById('canvas'), bindings = [];
  let down = null, last = null, paint = null, finish = null, run = null, updateTools = null;
  let notice = () => '';
  function bind(fn) { bindings.push(fn); fn(); }
  function text(node, fn) { bind(()=>{node.textContent = fn();}); return node; }
  function note(key,params) {
    notice = typeof key === 'function' ? key : () => uiT(key,params);
    message.textContent = notice();
  }
  const offLanguage = uiOnLanguage(()=>{ bindings.forEach(fn=>fn()); message.textContent=notice(); });
  signal.addEventListener('abort',offLanguage,{once:true});
  function guard(fn) {
    return (...args) => {
      try { const result = fn(...args); if (result?.catch) result.catch(e=>{ if (!signal.aborted) note(e.message); }); }
      catch (e) { note(e.message); }
    };
  }
  function makeButton(label,fn,icon) {
    const b = uiButton('',guard(fn),icon);
    text(b.querySelector('span'), typeof label === 'function' ? label : ()=>uiT(label));
    return b;
  }
  function button(host,label,fn,icon) {
    const b=makeButton(label,fn,icon); host.append(b); return b;
  }
  function panel(title,...nodes) {
    const el=uiPanel('',...nodes);
    text(el.querySelector('h2'),typeof title==='function' ? title : ()=>uiT(title));
    return el;
  }
  function field(host,label,el) {
    const row=uiField('',el); text(row.firstChild,()=>uiT(label)); host.append(row); return el;
  }
  function select(host,label,items,initial=items[0][0]) {
    const row=uiSelect('',items,initial,()=>{}), el=row.querySelector('select');
    text(row.firstChild,()=>uiT(label));
    for (let i=0;i<items.length;i++) text(el.options[i],()=>uiT(items[i][1],{n:items[i][0]}));
    host.append(row); return el;
  }
  function input(host,label,value,numeric=false) {
    const el=uiElement('input'); el.type=numeric?'number':'text'; el.value=value ?? '';
    return field(host,label,el);
  }
  function json(host,label,value) {
    const el=uiElement('textarea'); el.rows=3; el.value=JSON.stringify(value,null,2); el.spellcheck=false;
    field(host,label,el);
    return () => parseJson(el,label);
  }
  function parseJson(el,label) {
    try { return JSON.parse(el.value); }
    catch { throw new Error(uiT('无效 JSON：{field}',{field:uiT(label)})); }
  }
  function locales(host,zhLabel,enLabel,value) {
    const zh = input(host,zhLabel,value?.['zh-CN']);
    const en = input(host,enLabel,value?.en);
    return () => {
      const entries = [['zh-CN',zh.value],['en',en.value]].filter(([,s])=>s.trim());
      return entries.length ? Object.fromEntries(entries) : undefined;
    };
  }
  function editLabel(host,zhLabel,enLabel,fallback,translations) {
    const initial = translations?.['zh-CN'] ?? fallback;
    const read = locales(host,zhLabel,enLabel,{'zh-CN':initial,en:translations?.en});
    return () => {
      const values = read(), zh = values?.['zh-CN'] ?? '';
      if (zh === initial && values?.en === translations?.en) return [fallback,translations];
      return [zh === initial ? fallback : zh,values?.en || translations?.['zh-CN'] ? values : undefined];
    };
  }
  function editTimeline(host,initial,limits) {
    const events = structuredClone(initial || []);
    const empty = uiElement('p'), list = uiElement('ol','puzzle-timeline');
    text(empty,()=>uiT('暂无定时事件'));
    host.append(empty,list);
    const step = input(host,'执行步数',1,true); step.min = 1;
    const command = select(host,'引擎命令',Object.keys(puzzleEventExamples).map(key=>[key,key]));
    const args = uiElement('textarea'); args.rows=4; args.spellcheck=false; field(host,'命令参数（JSON）',args);
    const defaultArgs = () => { args.value = JSON.stringify(puzzleEventExamples[command.value],null,2); };
    command.addEventListener('change',defaultArgs,{signal});
    defaultArgs();
    let selected = -1;
    const saveLabel = () => uiT(selected === -1 ? '添加定时事件' : '保存定时事件');
    const save = button(host,saveLabel,()=>{
      const event = {step:step.valueAsNumber,action:{command:command.value,args:parseJson(args,'命令参数（JSON）')}};
      puzzleCheckEvent(event,limits());
      if (selected === -1) events.push(event);
      else events[selected] = event;
      clearSelection();
    });
    const remove = button(host,'删除定时事件',()=>{ events.splice(selected,1); clearSelection(); });
    const cancel = button(host,'取消编辑',clearSelection);
    function clearSelection() {
      selected = -1;
      draw();
    }
    function draw() {
      empty.hidden = events.length > 0;
      list.replaceChildren(...events.map((event,index)=>({event,index})).sort((a,b)=>a.event.step-b.event.step).map(({event,index})=>{
        const item = uiElement('li');
        const edit = uiButton(uiT('第 {n} 步 · {command}',{n:event.step,command:event.action.command}),()=>{
          selected = index;
          step.value = event.step;
          command.value = event.action.command;
          args.value = JSON.stringify(event.action.args,null,2);
          updateButtons();
          step.focus();
        });
        const details = uiElement('code'); details.textContent = JSON.stringify(event.action.args);
        item.append(edit,details);
        return item;
      }));
      updateButtons();
    }
    function updateButtons() {
      save.querySelector('span').textContent = saveLabel();
      remove.disabled = cancel.disabled = selected === -1;
    }
    bind(draw);
    return () => structuredClone(events);
  }
  function begin(title) {
    picker.hidden=true;
    const container=panel(title,message);
    side.replaceChildren(container); note('');
    return container;
  }
  function tabs(groups) {
    const el=uiTabs(groups.map(([label,panel])=>({label:uiT(label),panel})));
    el.querySelectorAll('[role=tab]').forEach((b,i)=>text(b.firstChild,()=>uiT(groups[i][0])));
    return el;
  }
  function importButton(host,edit) {
    const file = uiElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; host.append(file);
    button(host,edit?'导入并编辑 JSON':'载入关卡 JSON',()=>file.click());
    file.onchange = guard(async () => {
      const selected = file.files[0]; file.value = '';
      if (!selected) return;
      const level = puzzleValidateLevel(JSON.parse(await selected.text()));
      if (!signal.aborted) actions.importLevel(level,edit);
    });
  }
  function point(e) {
    const rect = canvas.getBoundingClientRect(), size = actions.size();
    return {x:Math.max(0,Math.min(size.width-1,Math.floor((e.clientX-rect.left)*size.width/rect.width))),
      y:Math.max(0,Math.min(size.height-1,Math.floor((e.clientY-rect.top)*size.height/rect.height)))};
  }
  canvas.addEventListener('pointerdown',guard(e=>{
    if ((!paint && !finish) || e.button !== 0 || down || actions.blocked()) return;
    e.preventDefault(); const p = point(e);
    if (paint) paint(p,p);
    if (e.isTrusted) canvas.setPointerCapture(e.pointerId); down = {id:e.pointerId,p}; last = p;
  }),{signal});
  canvas.addEventListener('pointermove',guard(e=>{
    if (down?.id !== e.pointerId || actions.blocked()) return;
    const p = point(e);
    if (paint && (p.x !== last.x || p.y !== last.y)) paint(last,p);
    last = p;
  }),{signal});
  canvas.addEventListener('pointerup',guard(e=>{
    if (down?.id !== e.pointerId) return;
    const a = down.p, previous = last; down = null; last = null;
    if (actions.blocked()) return;
    const b = point(e);
    if (finish) finish(a,b);
    else if (paint && (previous.x !== b.x || previous.y !== b.y)) paint(previous,b);
  }),{signal});
  const cancel = () => { down = null; last = null; };
  canvas.addEventListener('lostpointercapture',cancel,{signal});
  canvas.addEventListener('pointercancel',cancel,{signal});

  return {
    note,
    picking(levels, custom, store) {
      const tools=begin('物理解谜'); picker.hidden=false;
      button(tools,'新建关卡',actions.newLevel); importButton(tools,false); importButton(tools,true);
      const whole=panel('选择关卡'); picker.replaceChildren(whole);
      const refresh=[];
      for (const chapter of new Set(levels.map(l=>l.chapter))) {
        const cards=levels.flatMap((level,i)=>{
          if (level.chapter!==chapter) return [];
          const b=makeButton(()=>puzzleLevelLabel(level,'name',true),()=>actions.play(level.id),'puzzle'), rating=uiElement('small');
          b.classList.add('ui-card'); b.dataset.level=level.id;
          if (level.desc || level.hint) b.append(text(uiElement('p'),()=>puzzleText(level.desc ?? level.hint,true)));
          b.append(rating);
          const update=()=>{
            const stars=store?.progress?.stars;
            b.disabled=!puzzleUnlocked(levels,i,stars);
            const n=stars?.[level.id] || 0;
            rating.textContent=b.disabled?uiT('未解锁'):'★'.repeat(n)+'☆'.repeat(3-n);
            rating.setAttribute('aria-label',b.disabled?uiT('未解锁'):uiT('{n} 星',{n}));
          };
          refresh.push(update); bind(update); return [b];
        });
        const entry = levels.find(l=>l.chapter === chapter && l.chapterI18n) ?? levels.find(l=>l.chapter === chapter);
        whole.append(text(uiElement('h3'),()=>puzzleLevelLabel(entry,'chapter',true)),uiCardGrid(cards));
      }
      const off=store?.onProgress(()=>refresh.forEach(fn=>fn()));
      if (off) signal.addEventListener('abort',off,{once:true});
      if (custom.size) {
        const cards = [...custom.values()].map(l=>{
          const card = makeButton(()=>puzzleLevelLabel(l,'name'),()=>actions.importLevel(l,false));
          if (l.desc || l.hint) card.append(text(uiElement('p'),()=>puzzleText(l.desc ?? l.hint)));
          return card;
        });
        whole.append(text(uiElement('h3'),()=>uiT('本次载入')),uiCardGrid(cards));
      }
    },
    playing(session, recording, retry, reset, official) {
      const l=session.level, tools=begin(()=>puzzleLevelLabel(l,'name',!!official));
      const controls=uiElement('div'), rules=uiElement('div');
      if (l.desc || l.hint) controls.append(text(uiElement('p'),()=>puzzleText(l.desc ?? l.hint,!!official)));
      controls.append(text(uiElement('p'),()=>uiT(l.type==='planning'?'规划型 · 布置后点击运行':'实时型 · 运行中可落笔')));
      let updateHint = () => {};
      if (l.hints) {
        const hints = uiElement('ol');
        hints.setAttribute('aria-live','polite');
        const items = l.hints.map(h=>text(uiElement('li'),()=>puzzleText(h)));
        hints.append(...items);
        const hintLabel = () => session.hintsUsed === items.length ? uiT('已显示全部提示') : uiT('显示第 {n} 级提示',{n:session.hintsUsed+1});
        const reveal = button(controls,hintLabel,()=>{ session.revealHint(); updateHint(); });
        updateHint = () => {
          reveal.querySelector('span').textContent = hintLabel();
          reveal.disabled = session.hintsUsed === items.length || ['won','lost'].includes(session.phase);
          items.forEach((item,i)=>{ item.hidden = i >= session.hintsUsed; });
        };
        controls.append(hints);
        updateHint();
      }
      rules.append(text(uiElement('p'),()=>puzzleRuleText(l.goal)));
      if (l.fail) rules.append(text(uiElement('p'),()=>uiT('失败条件：{rule}',{rule:puzzleRuleText(l.fail)})));
      for (const [key,label] of [['two','二星'],['three','三星']]) {
        rules.append(text(uiElement('p'),()=>uiT('{stars}：最多 {used} 格、{steps} 步',{stars:uiT(label),used:l.stars[key].maxUsed,steps:l.stars[key].maxSteps})));
      }
      rules.append(text(uiElement('p'),()=>uiT('金框为目标区，虚线为禁建区，蓝框为保护区。')));
      for (const r of l.regions.filter(r=>r.allow)) {
        rules.append(text(uiElement('p'),()=>uiT('{region} 允许放置：{materials}',{region:r.id,
          materials:r.allow.map(m=>uiT(MATERIALS[puzzleMaterial(m)].name)).join(', ') || uiT('无')})));
      }
      if (l.environment && Object.keys(l.environment).length) rules.append(text(uiElement('p'),()=>uiT('环境由关卡设定。')));
      const mat=select(controls,'可用材料',Object.keys(l.materials).map(k=>[k,MATERIALS[puzzleMaterial(k)].name]));
      const size=select(controls,'笔刷大小',[1,2,3,4].map(n=>[n,'{n} 格']));
      if (l.type==='planning') run=button(controls,'运行',actions.run,'play');
      button(controls,'重试（保留起手布置）',retry); button(controls,'重置（清空布置）',reset);
      if (recording) button(controls,'返回编辑器',actions.backToEditor);
      else button(controls,'编辑副本',()=>actions.editCopy(l));
      button(controls,'返回选关',actions.select,'back');
      tools.append(tabs([['操作',controls],['目标与星级',rules]]));
      paint=(a,b)=>actions.stroke({tool:mat.value,x0:a.x,y0:a.y,x1:b.x,y1:b.y,size:+size.value,shape:'square'});
      updateTools=()=>{
        const locked=session.phase!=='planning' && !(l.type==='realtime' && session.phase==='running');
        mat.disabled=locked; size.disabled=locked; updateHint();
      };
    },
    status(session) {
      if (run) run.disabled=session.phase!=='planning';
      updateTools?.();
    },
    editing(draft) {
      const tools=begin('关卡编辑器');
      const terrain=uiElement('div'), objectives=uiElement('div'), extra=uiElement('div');
      const timeline=uiElement('div'), environment=uiElement('div'), localized=uiElement('div');
      const tool=select(terrain,'绘制内容',[['terrain','地形矩形'],['goal','目标区'],['noBuild','禁止建造区'],['protected','受保护区'],['zone','统计区']]);
      const material=select(terrain,'地形材料',MATERIALS.map(m=>[m.key,m.name]),'STONE');
      const regionId = input(terrain,'区域标识','target');
      const allow = input(terrain,'区域允许材料（JSON，可留空）','');
      function loadAllow() { allow.value = JSON.stringify(draft.regions.find(r=>r.id === regionId.value)?.allow) ?? ''; }
      regionId.addEventListener('input',loadAllow,{signal});
      loadAllow();
      const regions = uiElement('p'); terrain.append(regions);
      function regionList() { regions.textContent = uiT('区域：{regions}',{regions:draft.regions.map(r=>r.id).join(', ') || uiT('尚未绘制')}); }
      bind(regionList);
      const name = editLabel(terrain,'关卡名称','英文关卡名称',draft.name,draft.nameI18n);
      const kind = select(objectives,'玩法',[['planning','规划型'],['realtime','实时型']],draft.type);
      const budget = input(objectives,'总预算',draft.budget,true);
      const limits = json(objectives,'材料白名单与上限',draft.materials);
      const goal = json(objectives,'通关条件',draft.goal);

      const id = input(extra,'关卡标识',draft.id);
      const chapter = editLabel(extra,'章节','英文章节',draft.chapter,draft.chapterI18n);
      const difficulty = input(extra,'难度',draft.difficulty,true), hint = input(extra,'提示',draft.hint);
      const width = input(extra,'世界宽度',draft.world.width,true), height = input(extra,'世界高度',draft.world.height,true);
      const seed = input(extra,'种子',draft.world.seed,true), max = input(extra,'时限（步）',draft.maxSteps,true);
      const fail = json(extra,'失败条件',draft.fail), stars = json(extra,'星级标准',draft.stars);
      const events = editTimeline(timeline,draft.events,()=>({maxSteps:+max.value,world:{width:+width.value,height:+height.value}}));
      const weather = select(environment,'天气',[['','沿用世界设置'],...Object.entries(WEATHER_PRESETS).map(([key,p])=>[key,p.name])],draft.environment?.weather ?? '');
      const envFields = puzzleEnvironmentFields.map(([key,label])=>{
        const el = input(environment,label,draft.environment?.[key],true); el.step = 'any';
        return [key,el];
      });
      const description = locales(localized,'中文描述','英文描述',draft.desc);
      const hintFields = [['中文提示 1','英文提示 1'],['中文提示 2','英文提示 2'],['中文提示 3','英文提示 3']]
        .map(([zh,en],i)=>locales(localized,zh,en,draft.hints?.[i]));
      function candidate(validate = true) {
        const {nameI18n:oldNames,chapterI18n:oldChapters,hint:oldHint,desc:oldDesc,hints:oldHints,events:oldEvents,environment:oldEnvironment,...base} = draft;
        const [levelName,names] = name(), [chapterName,chapters] = chapter();
        const next = {...base,id:id.value,name:levelName,chapter:chapterName,difficulty:+difficulty.value,type:kind.value,
          world:{...draft.world,width:+width.value,height:+height.value,seed:+seed.value},budget:+budget.value,materials:limits(),
          maxSteps:+max.value,goal:goal(),fail:fail(),stars:stars()};
        if (names) next.nameI18n = names;
        if (chapters) next.chapterI18n = chapters;
        if (hint.value.trim()) next.hint = hint.value;
        const desc = description();
        if (desc) next.desc = desc;
        const hints = hintFields.map(read=>read());
        const levels = hints.filter(Boolean).length;
        if (hints.slice(0,levels).includes(undefined)) throw new Error(uiT('请按级别顺序填写提示'));
        if (levels) next.hints = hints.slice(0,levels);
        const timed = events();
        if (timed.length) next.events = timed;
        const env = Object.fromEntries(envFields.filter(([,el])=>el.value !== '' || el.validity.badInput).map(([key,el])=>[key,el.valueAsNumber]));
        if (weather.value) env.weather = weather.value;
        if (Object.keys(env).length) next.environment = env;
        return validate ? puzzleEditedLevel(next) : next;
      }
      const allowed = () => allow.value.trim() ? parseJson(allow,'区域允许材料（JSON，可留空）') : undefined;
      finish = (a,b) => {
        const next = puzzleEditRect(candidate(false),tool.value,a,b,material.value,regionId.value,tool.value === 'terrain' ? undefined : allowed());
        actions.preview(next); draft = next; regionList(); note(tool.value === 'terrain' ? '地形已绘制' : '区域已设置');
      };
      button(terrain,'设置区域材料',()=>{
        const next = candidate(false);
        const idx = next.regions.findIndex(r=>r.id === regionId.value);
        if (idx < 0) throw new Error('没有这个区域');
        const {allow:previous,...region} = next.regions[idx], values = allowed();
        next.regions = next.regions.with(idx,values === undefined ? region : {...region,allow:values});
        const checked = puzzleEditedLevel(next); actions.preview(checked); draft = checked; note('区域已设置');
      });
      button(terrain,'移除指定区域',() => {
        const next = candidate(false);
        if (!next.regions.some(r=>r.id === regionId.value)) throw new Error('没有这个区域');
        next.regions = next.regions.filter(r=>r.id !== regionId.value);
        const checked = puzzleEditedLevel(next); actions.preview(checked); draft = checked; regionList(); loadAllow(); note('区域已移除');
      });
      tools.append(tabs([['地形',terrain],['目标和预算',objectives],['定时事件',timeline],['环境设定',environment],
        ['关卡文本',localized],['元信息、失败条件与星级',extra]]));
      button(tools,'应用配置',()=>{ const next = candidate(); actions.preview(next); draft = next; note('配置已应用'); });
      button(tools,'录制参考解法',()=>actions.record(candidate()));
      const verify = async download => {
        const next = candidate(); note('正在独立回放两次…');
        const r = await puzzleVerifyAsync(next,signal);
        if (signal.aborted) return;
        if (JSON.stringify(next) !== JSON.stringify(candidate())) throw new Error('验证期间关卡已改变，请重新验证');
        note('验证通过 · {n} 星 · {steps} 步 · {hash}',{n:r.stars,steps:r.steps,hash:r.hash});
        if (download) actions.download(next);
      };
      button(tools,'验证参考解法',()=>verify(false));
      button(tools,'导出 JSON',()=>verify(true)); importButton(tools,true);
      button(tools,'返回选关',actions.select);
      return candidate;
    },
    previewRect() { return finish && down && last ? {x:Math.min(down.p.x,last.x),y:Math.min(down.p.y,last.y),w:Math.abs(down.p.x-last.x)+1,h:Math.abs(down.p.y-last.y)+1} : null; },
    dispose() { side.remove(); picker.remove(); },
  };
}
