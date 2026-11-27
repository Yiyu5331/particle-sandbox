import puzzleSandCup from './levels/sand-cup.json' with { type: 'json' };
import puzzleWaterLock from './levels/water-lock.json' with { type: 'json' };
import puzzleQuietPier from './levels/quiet-pier.json' with { type: 'json' };
// C3 物理解谜 6 章 × 5 关（源定义在 tools/c3/levels.src.mjs，node tools/c3/build.mjs 生成）
import puzzleC3_1_1 from './levels/c3/c3-1-1-pour.json' with { type: 'json' };
import puzzleC3_1_2 from './levels/c3/c3-1-2-repose.json' with { type: 'json' };
import puzzleC3_1_3 from './levels/c3/c3-1-3-funnel.json' with { type: 'json' };
import puzzleC3_1_4 from './levels/c3/c3-1-4-level.json' with { type: 'json' };
import puzzleC3_1_5 from './levels/c3/c3-1-5-exam.json' with { type: 'json' };
import puzzleC3_2_1 from './levels/c3/c3-2-1-divert.json' with { type: 'json' };
import puzzleC3_2_2 from './levels/c3/c3-2-2-aqueduct.json' with { type: 'json' };
import puzzleC3_2_3 from './levels/c3/c3-2-3-skim.json' with { type: 'json' };
import puzzleC3_2_4 from './levels/c3/c3-2-4-raft.json' with { type: 'json' };
import puzzleC3_2_5 from './levels/c3/c3-2-5-spring.json' with { type: 'json' };
import puzzleC3_3_1 from './levels/c3/c3-3-1-bonfire.json' with { type: 'json' };
import puzzleC3_3_2 from './levels/c3/c3-3-2-firebreak.json' with { type: 'json' };
import puzzleC3_3_3 from './levels/c3/c3-3-3-bridge.json' with { type: 'json' };
import puzzleC3_3_4 from './levels/c3/c3-3-4-cellar.json' with { type: 'json' };
import puzzleC3_3_5 from './levels/c3/c3-3-5-beacon.json' with { type: 'json' };
import puzzleC3_4_1 from './levels/c3/c3-4-1-steam.json' with { type: 'json' };
import puzzleC3_4_2 from './levels/c3/c3-4-2-snowmelt.json' with { type: 'json' };
import puzzleC3_4_3 from './levels/c3/c3-4-3-cast.json' with { type: 'json' };
import puzzleC3_4_4 from './levels/c3/c3-4-4-desalt.json' with { type: 'json' };
import puzzleC3_4_5 from './levels/c3/c3-4-5-snowtower.json' with { type: 'json' };
import puzzleC3_5_1 from './levels/c3/c3-5-1-pillar.json' with { type: 'json' };
import puzzleC3_5_2 from './levels/c3/c3-5-2-hang.json' with { type: 'json' };
import puzzleC3_5_3 from './levels/c3/c3-5-3-blast.json' with { type: 'json' };
import puzzleC3_5_4 from './levels/c3/c3-5-4-fuses.json' with { type: 'json' };
import puzzleC3_5_5 from './levels/c3/c3-5-5-breach.json' with { type: 'json' };
import puzzleC3_6_1 from './levels/c3/c3-6-1-circuit.json' with { type: 'json' };
import puzzleC3_6_2 from './levels/c3/c3-6-2-canal.json' with { type: 'json' };
import puzzleC3_6_3 from './levels/c3/c3-6-3-reroute.json' with { type: 'json' };
import puzzleC3_6_4 from './levels/c3/c3-6-4-flowspark.json' with { type: 'json' };
import puzzleC3_6_5 from './levels/c3/c3-6-5-doubleshot.json' with { type: 'json' };

// 解锁顺序就是这个数组的顺序：序章的三个示例关之后接 C3 第一章到第六章。
export const puzzleLevels = [
  puzzleSandCup, puzzleWaterLock, puzzleQuietPier,
  puzzleC3_1_1, puzzleC3_1_2, puzzleC3_1_3, puzzleC3_1_4, puzzleC3_1_5,
  puzzleC3_2_1, puzzleC3_2_2, puzzleC3_2_3, puzzleC3_2_4, puzzleC3_2_5,
  puzzleC3_3_1, puzzleC3_3_2, puzzleC3_3_3, puzzleC3_3_4, puzzleC3_3_5,
  puzzleC3_4_1, puzzleC3_4_2, puzzleC3_4_3, puzzleC3_4_4, puzzleC3_4_5,
  puzzleC3_5_1, puzzleC3_5_2, puzzleC3_5_3, puzzleC3_5_4, puzzleC3_5_5,
  puzzleC3_6_1, puzzleC3_6_2, puzzleC3_6_3, puzzleC3_6_4, puzzleC3_6_5,
];
