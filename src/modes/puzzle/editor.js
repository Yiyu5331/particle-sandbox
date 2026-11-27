import { puzzleWorld } from './session.js';
import { puzzleMaterial, puzzleValidateLevel } from './format.js';

export function puzzleBlank() {
  return {
    version:1,id:'my-level',name:'新关卡',chapter:'自制关卡',difficulty:1,hint:'在目标区域收集材料。',
    type:'planning',world:{width:80,height:48,seed:1,commands:[]},regions:[],
    materials:{SAND:24},budget:24,maxSteps:180,goal:{op:'survive',steps:30},fail:null,
    stars:{two:{maxUsed:20,maxSteps:120},three:{maxUsed:12,maxSteps:80}},reference:{steps:0,log:[]},
  };
}

// 配置本身必须有效。旧参考仍符合新格式时先保留，由实际回放决定能否通关。
export function puzzleEditedLevel(next) {
  const blank = {...next,reference:{steps:0,log:[]}};
  puzzleValidateLevel(blank);
  try { return puzzleValidateLevel(next); } catch { return blank; }
}

export function puzzleEditRect(draft, tool, a, b, material, regionId) {
  const next = structuredClone(draft);
  const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y);
  const right = Math.max(a.x,b.x), bottom = Math.max(a.y,b.y);
  if (tool === 'terrain') {
    const args = {mat:material,x0:x,y0:y,x1:right,y1:bottom};
    if (next.world.commands) next.world.commands.push({command:'fillRect',args});
    else {
      const {world} = puzzleWorld({...puzzleEditedLevel(next),regions:[]});
      try {
        world.exec('fillRect',{...args,mat:puzzleMaterial(material)});
        next.world.serialized = world.serialize();
      } finally { world.dispose(); }
    }
  } else {
    const region = {id:regionId,type:tool,x,y,w:right-x+1,h:bottom-y+1};
    next.regions = next.regions.filter(r=>r.id !== regionId).concat(region);
  }
  return puzzleEditedLevel(next);
}

// 解锁顺序由内置目录定义，星级来自 X2 最近一次成功读取或提交的档案。
export function puzzleUnlocked(levels,index,stars) {
  return index === 0 || (index > 0 && (stars?.[levels[index-1].id] ?? 0) > 0);
}
