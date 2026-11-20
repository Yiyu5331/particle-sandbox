import { WATER, SALTWATER, LAVA, ICE, STONE, createWorld } from '../engine/index.js';
import { checkDefenseMap } from './layout.js';
export { checkDefenseMap } from './layout.js';

function mapgenLiquid(t) { return t===WATER || t===SALTWATER || t===LAVA; }

// 观察每一步，包含初始波动。统计实际液体移动次数、原有湿格腾空和坍塌格数。
export function* mapgenStabilitySteps(map) {
  const {width,height,seed}=map.meta, world=createWorld({width,height,seed});
  try {
    for (const cmd of map.commands) world.exec(cmd);
    const type=world.getField('type'), initial=type.slice(), wet=[], stone=[];
    for (let i=0;i<type.length;i++) {
      if (mapgenLiquid(type[i])) wet.push(i);
      if (type[i]===STONE) stone.push(i);
    }
    const limits={collapse:Math.max(3,Math.floor(type.length/2000)),flow:Math.max(6,Math.ceil(wet.length*.15)),
      drained:Math.max(4,Math.ceil(wet.length*.20))};
    let collapse=0, peakFlow=0, peakDrained=0, previous=world.view.st.liquid;
    world.on('collapse',e=>{collapse+=e.cells;});
    for (let step=1;step<=300;step++) {
      world.step();
      const moved=world.view.st.liquid;
      peakFlow=Math.max(peakFlow,moved-previous); previous=moved;
      let drained=0;
      for (const i of wet) {
        const t=type[i];
        if (mapgenLiquid(t) || (initial[i]===LAVA ? t===STONE : t===ICE)) continue;
        drained++;
      }
      peakDrained=Math.max(peakDrained,drained);
      if (step%30===0) yield step;
    }
    let missingRock=0;
    for (const i of stone) if (type[i]!==STONE) missingRock++;
    const settledIssues=map.meta.preset==='defense' ? checkDefenseMap(map,type) : [];
    return {ok:!settledIssues.length && collapse<=limits.collapse && missingRock<=limits.collapse && peakFlow<=limits.flow && peakDrained<=limits.drained,
      collapse,missingRock,peakFlow,peakDrained,initialLiquid:wet.length,limits,settledIssues};
  } finally { world.dispose(); }
}

export function checkMapStability(map) {
  const simulation=mapgenStabilitySteps(map);
  let state;
  do { state=simulation.next(); } while (!state.done);
  return state.value;
}
