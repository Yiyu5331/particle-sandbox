// C3 解谜关卡的源定义：6 章 × 5 关。node tools/c3/build.mjs 把它们写成 src/modes/puzzle/levels/c3/*.json。
// 每关的第一个解法是三星参考解法，其余是备选解法（都要能通关）。坐标基于 64×40 的世界，最下面三行（y 37–39）是石头地面。
import { FLOOR, S, all, any, at, atLeast, atMost, circle, cooler, env, goal, guard, ignite, intact, line, noBuild, noFire, not, rect, survive, weather, within } from './dsl.mjs';

export const C3_LEVELS = [];
const L = def => C3_LEVELS.push(def);

/* ============================== 第一章 · 粉末与重力 ============================== */

L({
  n: '1-1', slug: 'pour', type: 'planning', difficulty: 1, seed: 11,
  setup: [FLOOR, rect('STONE', 25, 27, 26, 36), rect('STONE', 37, 27, 38, 36)],
  regions: [goal('cup', 27, 27, 10, 10), noBuild('chute', 25, 14, 14, 23), guard('lawnL', 0, 31, 25, 6), guard('lawnR', 39, 31, 25, 6)],
  materials: { SAND: 45 }, budget: 45, maxSteps: 360,
  goal: within(300, atLeast('cup', 'SAND', 30)),
  fail: any(atLeast('lawnL', 'SAND', 6), atLeast('lawnR', 'SAND', 6)),
  stars: { two: [40, 300], three: [34, 200] },
  solutions: [
    { name: '槽口正上方竖着倒', strokes: [S('SAND', 31, 2, 31, 11, 2)] },
    { name: '宽宽地撒一排', strokes: [S('SAND', 28, 8, 35, 8, 3)] },
  ],
  text: {
    name: ['一斗沙', 'A Bucket of Sand'],
    desc: ['把至少 30 格沙倒进石槽，别撒到两边的草地上。', 'Pour at least 30 grains of sand into the stone trough without spilling onto the lawns.'],
    hints: [
      ['沙子会笔直往下落。', 'Sand falls straight down.'],
      ['在虚线禁建区上面、正对着槽口倒沙。', 'Pour above the dashed no-build zone, right over the trough.'],
      ['在槽中线上方竖着画一道两格粗的沙，大约 30 格就够。', 'Draw a vertical two-cell-wide line of sand over the middle of the trough; about 30 grains is enough.'],
    ],
    mechanic: ['重力：粉末自由下落', 'Gravity: powders fall freely'],
  },
});

L({
  n: '1-2', slug: 'repose', type: 'planning', difficulty: 1, seed: 12,
  setup: [FLOOR, rect('STONE', 44, 20, 45, 36)],
  regions: [goal('mark', 40, 29, 4, 3), noBuild('markNB', 40, 29, 4, 3), goal('clear', 40, 22, 4, 5), guard('garden', 0, 31, 28, 6)],
  materials: { SAND: 70 }, budget: 70, maxSteps: 450,
  goal: within(400, all(atLeast('mark', 'SAND', 6), atMost('clear', 'SAND', 0))),
  fail: atLeast('garden', 'SAND', 3),
  stars: { two: [56, 380], three: [44, 300] },
  solutions: [
    { name: '贴着墙倒', strokes: [S('SAND', 42, 2, 42, 14, 2)] },
    { name: '离墙几格多倒些', strokes: [S('SAND', 40, 2, 40, 20, 2)] },
  ],
  text: {
    name: ['靠墙堆沙', 'Lean on the Wall'],
    desc: ['让沙堆高到下面的金框里（至少 6 格），上面的金框要留空，沙子不能滚进花园。', 'Pile sand up into the lower gold frame (at least 6 grains), keep the upper frame empty, and keep sand out of the garden.'],
    hints: [
      ['沙堆的坡度是固定的：堆得越高，底就越宽。', 'A sand pile always has the same slope: the higher it is, the wider its base.'],
      ['墙可以替你挡住沙堆的一半。', 'The wall can hold up half of the pile for you.'],
      ['在金框正上方、紧贴石墙竖着倒四十来格沙。', 'Pour about forty grains straight down right next to the stone wall, above the gold frame.'],
    ],
    mechanic: ['休止角：沙堆坡度固定，靠墙省一半料', 'Angle of repose: a pile against a wall needs half the sand'],
  },
});

L({
  n: '1-3', slug: 'funnel', type: 'planning', difficulty: 2, seed: 13,
  setup: [FLOOR, rect('STONE', 28, 27, 28, 36), rect('STONE', 32, 27, 32, 36),
    line('STONE', 18, 7, 28, 26, 2), line('STONE', 52, 15, 32, 26, 2)],
  regions: [goal('tube', 29, 27, 3, 10), noBuild('throat', 27, 0, 7, 37), guard('lawnL', 0, 31, 27, 6), guard('lawnR', 34, 31, 30, 6)],
  materials: { SAND: 70 }, budget: 70, maxSteps: 450,
  goal: within(400, atLeast('tube', 'SAND', 24)),
  fail: any(atLeast('lawnL', 'SAND', 4), atLeast('lawnR', 'SAND', 4)),
  stars: { two: [50, 400], three: [32, 300] },
  solutions: [
    { name: '倒在陡的一边', strokes: [S('SAND', 23, 1, 23, 9, 2)] },
    { name: '倒在缓的一边', strokes: [S('SAND', 42, 1, 42, 12, 3)] },
  ],
  text: {
    name: ['漏斗', 'The Funnel'],
    desc: ['把至少 24 格沙送进中间的细管，不能撒到草地上。', 'Get at least 24 grains of sand into the narrow tube without spilling onto the lawns.'],
    hints: [
      ['斜面够陡，沙才会滑下去；太缓的斜面会把沙留住。', 'Sand only slides down a steep slope; a gentle slope keeps some of it.'],
      ['漏斗左右两边的坡度不一样。', 'The two sides of the funnel have different slopes.'],
      ['在左边陡坡的上方倒三十来格沙。', 'Pour about thirty grains above the steep left side.'],
    ],
    mechanic: ['漏斗：陡坡滑落、缓坡留沙', 'Funnels: steep slopes shed sand, gentle slopes keep it'],
  },
});

L({
  n: '1-4', slug: 'level', type: 'planning', difficulty: 2, seed: 14,
  setup: [FLOOR, rect('STONE', 0, 31, 63, 36), rect('EMPTY', 12, 31, 21, 34), rect('EMPTY', 40, 31, 45, 35)],
  regions: [goal('pitA', 12, 31, 10, 4), goal('pitB', 40, 31, 6, 5), noBuild('air', 0, 22, 64, 9)],
  materials: { SAND: 110 }, budget: 110, maxSteps: 500,
  goal: all(atLeast('pitA', 'SAND', 35), atLeast('pitB', 'SAND', 26), atMost('air', 'SAND', 10)),
  fail: null,
  stars: { two: [86, 400], three: [74, 300] },
  solutions: [
    { name: '比坑窄一格、一行一行铺', strokes: [...[3, 6, 9, 12, 15].map(y => S('SAND', 13, y, 20, y)), ...[0, 3, 6, 9, 12, 15, 18].map(y => S('SAND', 41, y, 44, y))] },
    { name: '方笔刷分几块', strokes: [S('SAND', 14, 6, 18, 6, 2, 'square'), S('SAND', 14, 12, 18, 12, 2, 'square'), S('SAND', 42, 4, 43, 4, 2, 'square'), S('SAND', 42, 9, 43, 9, 2, 'square'), S('SAND', 41, 14, 44, 14)] },
  ],
  text: {
    name: ['填平路面', 'Level the Road'],
    desc: ['把路上的两个坑填平：坑里要填满，路面上不能堆出沙包。', 'Fill both potholes in the road: they must be full, with no mound of sand left on the road.'],
    hints: [
      ['往一个点倒沙会堆成尖堆，坑角还空着，中间已经冒出来了。', 'Pouring at one point makes a peak: the middle overflows while the corners are still empty.'],
      ['按坑的宽度横着铺，用量和坑的格数差不多。', 'Spread the sand across the width of each pit, using about as many grains as the pit holds.'],
      ['左坑 10×4、右坑 6×5：各画一道和坑一样宽的横线，用量刚好够填满。', 'The left pit is 10×4 and the right one 6×5: draw one horizontal line as wide as each pit, with just enough sand to fill it.'],
    ],
    mechanic: ['填平：横向铺开，按容积用料', 'Levelling: spread sideways and match the volume'],
  },
});

L({
  n: '1-5', slug: 'exam', type: 'planning', difficulty: 3, seed: 15, W: 96, H: 40,
  setup: [rect('STONE', 0, 37, 95, 39),
    // A 站：路面上的坑
    rect('STONE', 0, 31, 27, 36), rect('EMPTY', 10, 31, 17, 33),
    // 隔墙
    rect('STONE', 28, 18, 29, 36), rect('STONE', 62, 18, 63, 36),
    // B 站：漏斗和细管
    rect('STONE', 43, 29, 43, 36), rect('STONE', 47, 29, 47, 36), line('STONE', 34, 8, 43, 28, 2), line('STONE', 60, 21, 47, 28, 2),
    // C 站：石墙
    rect('STONE', 90, 22, 91, 36)],
  regions: [
    goal('pit', 10, 31, 8, 3), noBuild('road', 0, 24, 28, 7),
    goal('tube', 44, 29, 3, 8), noBuild('throat', 42, 0, 7, 37), guard('lawnL', 30, 31, 12, 6), guard('lawnR', 49, 31, 13, 6),
    goal('mark', 86, 31, 4, 3), noBuild('markNB', 86, 31, 4, 3), goal('clear', 86, 24, 4, 5), guard('garden', 64, 31, 12, 6)],
  materials: { SAND: 130 }, budget: 130, maxSteps: 600,
  goal: within(500, all(atLeast('pit', 'SAND', 20), atMost('road', 'SAND', 6), atLeast('tube', 'SAND', 18),
    atLeast('mark', 'SAND', 6), atMost('clear', 'SAND', 0))),
  fail: any(atLeast('lawnL', 'SAND', 4), atLeast('lawnR', 'SAND', 4), atLeast('garden', 'SAND', 3)),
  stars: { two: [108, 500], three: [88, 400] },
  solutions: [
    { name: '三处都用巧办法', strokes: [...[2, 5, 8, 11].map(y => S('SAND', 11, y, 16, y)), S('SAND', 39, 1, 39, 7, 2), S('SAND', 88, 2, 88, 12, 2)] },
    { name: '漏斗走缓坡、堆沙离墙远', strokes: [...[2, 5, 8, 11].map(y => S('SAND', 11, y, 16, y)), S('SAND', 54, 1, 54, 8, 3), S('SAND', 85, 2, 85, 16, 2)] },
  ],
  text: {
    name: ['沙之考场', 'Sand Finals'],
    desc: ['三个考点一次过：填平坑、把沙送进细管、靠墙把沙堆到金框里。三处都不能撒到草地。', 'Pass all three tests at once: level the pothole, feed the narrow tube and pile sand into the frame by the wall, without spilling on any lawn.'],
    hints: [
      ['三个考点各对应前面一关学过的办法，预算只够每处都省着用。', 'Each test matches an earlier level; the budget only works if you are thrifty everywhere.'],
      ['坑要横着铺，漏斗挑陡的一边，堆沙要贴着墙。', 'Spread across the pit, use the steep side of the funnel, and pile against the wall.'],
      ['左坑铺三行和坑一样宽的细线；漏斗左侧上方倒二十来格；墙边金框正上方竖着倒四十格左右。', 'Lay three thin rows as wide as the pit; pour about twenty grains above the left side of the funnel; pour about forty grains straight down above the frame by the wall.'],
    ],
    mechanic: ['综合：填平、漏斗、休止角', 'Review: levelling, funnels and the angle of repose'],
  },
});

/* ============================== 第二章 · 水与流体 ============================== */

L({
  n: '2-1', slug: 'divert', type: 'planning', difficulty: 1, seed: 21,
  setup: [FLOOR, rect('STONE', 31, 18, 32, 36), rect('STONE', 25, 17, 38, 17), rect('STONE', 25, 14, 25, 16), rect('STONE', 38, 14, 38, 16),
    rect('WATER', 26, 9, 37, 16)],
  regions: [goal('field', 40, 30, 24, 7), guard('village', 0, 30, 24, 7), guard('pillar', 31, 18, 2, 19)],
  materials: { STONE: 24 }, budget: 24, maxSteps: 450,
  goal: within(400, atLeast('field', 'WATER', 32)),
  fail: atLeast('village', 'WATER', 4),
  stars: { two: [20, 400], three: [16, 300] },
  solutions: [
    { name: '把左边池壁加高', strokes: [S('STONE', 25, 8, 25, 13, 2)] },
    { name: '把左壁垒得更高', strokes: [S('STONE', 25, 13, 25, 5, 2)] },
  ],
  text: {
    name: ['改道', 'Divert the Water'],
    desc: ['水池满了，水会从两边漫出来。让水只流向右边的田（至少 32 格），左边的村子一滴都不能进。', 'The pool is overflowing on both sides. Send the water only to the field on the right (at least 32 cells) and keep it out of the village.'],
    hints: [
      ['水往低处流，哪边的池壁矮就从哪边漫出去。', 'Water runs downhill and spills over whichever wall is lower.'],
      ['只要把左边的池壁垒高，水就只能往右流。', 'Raise the left wall of the pool and the water can only go right.'],
      ['在左池壁正上方竖着画一道两格粗、六七格高的石头。', 'Draw a two-cell-wide, six- or seven-cell-tall line of stone right on top of the left wall.'],
    ],
    mechanic: ['引流：水从低的一侧漫出', 'Diverting: water spills over the lower side'],
  },
});

L({
  n: '2-2', slug: 'aqueduct', type: 'planning', difficulty: 2, seed: 22,
  setup: [FLOOR, rect('STONE', 0, 20, 20, 36), rect('STONE', 42, 20, 63, 36), rect('EMPTY', 43, 20, 52, 23), rect('STONE', 2, 8, 3, 19), rect('STONE', 15, 15, 16, 19),
    rect('WATER', 4, 8, 14, 19), rect('STONE', 30, 30, 32, 36)],
  regions: [goal('field', 43, 20, 10, 4), guard('mine', 21, 31, 21, 6), guard('rock', 30, 30, 3, 7)],
  materials: { STONE: 70 }, budget: 70, maxSteps: 500,
  goal: within(450, atLeast('field', 'WATER', 25)),
  fail: atLeast('mine', 'WATER', 4),
  stars: { two: [40, 450], three: [24, 350] },
  solutions: [
    { name: '一格厚的渡槽', strokes: [S('STONE', 19, 20, 43, 20)] },
    { name: '三格厚的石桥', strokes: [S('STONE', 21, 21, 41, 21, 2)] },
  ],
  text: {
    name: ['渡槽', 'The Aqueduct'],
    desc: ['把高台水池漫出来的水引过深谷，送进右边的田（至少 30 格），谷底的矿井不能进水。', 'Carry the overflow from the high pool across the gorge to the field on the right (at least 30 cells) without flooding the mine below.'],
    hints: [
      ['水需要一条连着两岸的路，否则就掉进谷底。', 'Water needs a path that joins both sides, or it falls into the gorge.'],
      ['石头连到两边的崖壁上就不会塌，一格厚就够。', 'Stone that touches both cliffs will not fall; one cell thick is enough.'],
      ['从左崖顶一直到右崖边，画一条和崖顶齐平的一格石线。', 'Draw a one-cell line of stone level with the top of the cliff, from the left cliff edge to the right one.'],
    ],
    mechanic: ['连通：搭渡槽把高处的水引到低处', 'Connecting: build an aqueduct to carry water downhill'],
  },
});

L({
  n: '2-3', slug: 'skim', type: 'planning', difficulty: 2, seed: 23,
  setup: [FLOOR, rect('STONE', 20, 8, 21, 36), rect('STONE', 32, 25, 33, 36), rect('WATER', 22, 33, 31, 36), rect('OIL', 22, 29, 31, 32),
    rect('STONE', 34, 33, 49, 36), rect('STONE', 48, 26, 49, 32)],
  regions: [goal('jar', 34, 26, 14, 7), noBuild('tank', 22, 12, 10, 25), guard('drain', 50, 31, 14, 6)],
  materials: { WATER: 90, SALTWATER: 90, SAND: 40 }, budget: 90, maxSteps: 600,
  goal: within(550, atLeast('jar', 'OIL', 18)),
  fail: any(atLeast('jar', 'WATER', 4), atLeast('jar', 'SALTWATER', 4), atLeast('jar', 'SAND', 4)),
  stars: { two: [86, 550], three: [78, 450] },
  solutions: [
    { name: '往罐里倒水把油顶出去', strokes: [S('WATER', 26, 2, 26, 8, 4)] },
    { name: '倒盐水沉底顶油', strokes: [S('SALTWATER', 26, 2, 26, 7, 4)] },
    { name: '多倒一些水', strokes: [S('WATER', 26, 1, 26, 10, 4)] },
  ],
  text: {
    name: ['撇油', 'Skim the Oil'],
    desc: ['把罐里浮着的油顶出出油口，至少 18 格流进右边的油缸；水和沙子都不能流进去。', 'Push the floating oil out over the spout so at least 18 cells reach the oil tank on the right, without any water or sand following it.'],
    hints: [
      ['油比水轻，总是浮在最上面。', 'Oil is lighter than water and always floats on top.'],
      ['往罐里加更重的液体，它会沉到油下面，把油整个往上顶。沙子会把水吸走，不管用。', 'Any heavier liquid you add sinks below the oil and lifts it. Sand just soaks up the water.'],
      ['罐里离出油口还差四行，往罐里倒七十格左右的水或盐水，油会先溢出来。', 'The liquid is four rows below the spout; pour about seventy cells of water or brine into the tank and the oil spills first.'],
    ],
    mechanic: ['密度分层：重的沉底、轻的上浮', 'Density layering: heavy sinks, light floats'],
  },
});

L({
  n: '2-4', slug: 'raft', type: 'planning', difficulty: 2, seed: 24,
  setup: [FLOOR, rect('STONE', 18, 12, 19, 36), rect('STONE', 44, 21, 45, 36), rect('WATER', 20, 26, 43, 36), rect('WOOD', 29, 24, 34, 25)],
  regions: [goal('dock', 28, 15, 8, 7), noBuild('mast', 28, 0, 8, 26), guard('village', 46, 30, 18, 7)],
  materials: { WATER: 150, OIL: 150 }, budget: 150, maxSteps: 700,
  goal: all(survive(360), atLeast('dock', 'WOOD', 8)),
  fail: atLeast('village', 'WATER', 6),
  stars: { two: [100, 650], three: [90, 500] },
  solutions: [
    { name: '在木筏两边倒水', strokes: [S('WATER', 22, 12, 25, 13, 3), S('WATER', 38, 12, 41, 13, 3)] },
    { name: '倒油也能托起木筏', strokes: [S('OIL', 22, 12, 25, 13, 3), S('OIL', 38, 12, 41, 13, 3)] },
    { name: '只在一边多倒', strokes: [S('WATER', 21, 10, 24, 14, 4)] },
  ],
  text: {
    name: ['升筏', 'Raise the Raft'],
    desc: ['抬高闸里的水位，让木筏浮进金框并停稳；水不能漫过右边的闸墙淹到村子。', 'Raise the water in the lock until the raft floats up into the gold frame and stays there, without spilling over the right wall into the village.'],
    hints: [
      ['木头比水轻，水涨它就跟着往上浮。', 'Wood is lighter than water, so it rises as the water rises.'],
      ['木筏正上方不能倒，在它两边倒；油比木头重，也能托起它。', 'You cannot pour right above the raft, so pour on both sides of it; oil is heavier than wood and lifts it too.'],
      ['在木筏左右各画一道三格粗的短横线，一共八十格左右，水位正好升到闸墙下面。', 'Draw a short three-cell-thick line on each side of the raft, about 80 cells in all, which brings the level just below the top of the wall.'],
    ],
    mechanic: ['浮力：水涨船高', 'Buoyancy: a rising tide lifts the raft'],
  },
});

L({
  n: '2-5', slug: 'spring', type: 'realtime', difficulty: 3, seed: 25,
  setup: [FLOOR,
    // 泉眼：克隆体锁定压在上面的水，不停往下冒
    rect('STONE', 33, 0, 33, 3), rect('STONE', 40, 0, 40, 3), rect('CLONE', 34, 3, 39, 3), rect('WATER', 34, 1, 39, 2),
    // 分水台：右端有两格高的沿
    rect('STONE', 26, 12, 46, 12), rect('STONE', 35, 13, 36, 36), rect('STONE', 46, 10, 46, 11),
    // 左田
    rect('STONE', 17, 30, 17, 36), rect('STONE', 28, 30, 28, 36),
    // 右闸和木筏，右墙矮一些，满了往右边排走
    rect('STONE', 45, 22, 45, 36), rect('STONE', 56, 26, 56, 36), rect('WATER', 46, 32, 55, 36), rect('WOOD', 49, 30, 52, 31)],
  regions: [goal('fieldA', 18, 30, 10, 7), guard('village', 0, 30, 17, 7), goal('dock', 46, 22, 10, 5), guard('spring', 33, 0, 8, 4)],
  materials: { STONE: 30 }, budget: 30, maxSteps: 1200,
  goal: all(atLeast('fieldA', 'WATER', 55), atLeast('dock', 'WOOD', 6)),
  fail: atLeast('village', 'WATER', 4),
  stars: { two: [24, 1100], three: [12, 900] },
  solutions: [
    { name: '左田快满时把左端加高', strokes: [at(200, S('STONE', 26, 8, 26, 11))] },
    { name: '堵得又高又厚', strokes: [at(200, S('STONE', 27, 6, 27, 10, 2))] },
  ],
  text: {
    name: ['分水', 'Share the Spring'],
    desc: ['泉水先流进左边的田。田灌满（80 格）以后及时把水改到右边，让闸里的木筏浮进金框。左边的村子不能进水。', 'The spring first runs into the left field. Once it holds 80 cells, switch the flow to the right so the raft in the lock floats into the gold frame. Keep the village dry.'],
    hints: [
      ['分水台右端有沿，水只会从左端流下去；左端要是更高，水就改从右端流。', 'The ledge has a lip on the right, so water only falls off the left end; make the left end higher and it falls off the right.'],
      ['太早改道，左田灌不满；太晚，左田满出来淹到村子。', 'Switch too early and the left field never fills; too late and it overflows into the village.'],
      ['看左田的水快到槽口时（大约第 330 步），在分水台左端竖着加三格高的石头。', 'When the left field is almost full (around step 330), add a three-cell-tall stone lip on the left end of the ledge.'],
    ],
    mechanic: ['综合：引流、浮力和时机', 'Review: diverting, buoyancy and timing'],
  },
});

/* ============================== 第三章 · 火与热 ============================== */

const GRATE = (x0, x1, y) => [rect('STONE', x0, y, x0, 36), rect('STONE', x1, y, x1, 36), rect('STONE', x0, y - 1, x1, y - 1), rect('EMPTY', x0 + 2, y - 1, x1 - 2, y - 1)];

L({
  n: '3-1', slug: 'bonfire', type: 'planning', difficulty: 1, seed: 31,
  setup: [FLOOR, rect('STONE', 24, 35, 39, 36), rect('STONE', 26, 31, 26, 34), rect('STONE', 37, 31, 37, 34), rect('STONE', 26, 31, 37, 31), rect('EMPTY', 28, 31, 35, 31),
    rect('WOOD', 27, 26, 36, 30)],
  regions: [goal('pile', 27, 26, 10, 5)],
  materials: { FIRE: 12 }, budget: 12, maxSteps: 700,
  goal: within(650, atLeast('pile', 'CHARCOAL', 5)),
  fail: null,
  stars: { two: [11, 650], three: [9, 500] },
  solutions: [
    { name: '炉膛里放一排火', strokes: [S('FIRE', 28, 33, 35, 33)] },
    { name: '炉膛里塞满火', strokes: [S('FIRE', 27, 32, 36, 34, 2)] },
  ],
  text: {
    name: ['篝火', 'The Bonfire'],
    desc: ['点燃炉栅上的木堆，烧出至少 5 格木炭。', 'Light the woodpile on the grate and burn it until at least 5 cells of charcoal form.'],
    hints: [
      ['火焰是热气，会往上飘：放在木头上面或旁边，一下就飘走了。', 'Flames are hot gas and rise: put them above or beside the wood and they just float away.'],
      ['炉栅下面有一个三格高的炉膛，火放在那里会往上烤着木堆。', 'Under the grate is a hearth three cells high; fire placed there rises into the woodpile.'],
      ['在炉膛里横着画一排八格的火。', 'Draw a row of eight fire cells inside the hearth.'],
    ],
    mechanic: ['点火：火往上烧', 'Ignition: fire burns upward'],
  },
});

L({
  n: '3-2', slug: 'firebreak', type: 'realtime', difficulty: 2, seed: 32,
  setup: [FLOOR, rect('SOIL', 0, 35, 63, 36), rect('DEADPLANT', 8, 33, 55, 34), rect('WOOD', 2, 27, 7, 34), rect('WOOD', 56, 27, 61, 34), ignite(31, 33), ignite(32, 34)],
  regions: [guard('houseL', 2, 27, 6, 8), guard('houseR', 56, 27, 6, 8), goal('pastureL', 8, 33, 15, 2), goal('pastureR', 41, 33, 15, 2)],
  materials: { WATER: 20 }, budget: 20, maxSteps: 1600,
  goal: all(survive(1500), atLeast('pastureL', 'DEADPLANT', 20), atLeast('pastureR', 'DEADPLANT', 20)),
  fail: any(not(intact('houseL', 'WOOD', 95)), not(intact('houseR', 'WOOD', 95))),
  stars: { two: [17, 1600], three: [14, 1600] },
  solutions: [
    { name: '两边火头前各浇一道窄水带', strokes: [at(40, S('WATER', 23, 30, 29, 30)), at(40, S('WATER', 34, 30, 40, 30))] },
    { name: '早一点、浇得宽一些', strokes: [at(10, S('WATER', 22, 30, 29, 30)), at(10, S('WATER', 34, 30, 42, 30))] },
  ],
  text: {
    name: ['防火带', 'Firebreak'],
    desc: ['草原中间起火了。拦住往两边烧的火：两座木屋都不能烧着，屋前的草场各留下至少 20 格干草。', 'The middle of the meadow is on fire. Stop it spreading both ways: neither cabin may burn, and each pasture in front of them must keep at least 20 cells of hay.'],
    hints: [
      ['湿的草点不着。', 'Wet grass will not burn.'],
      ['在火头前面浇一道水，把草地从上到下浇透，就成了防火带。', 'Pour a strip of water ahead of the fire, soaking the grass all the way down, and it becomes a firebreak.'],
      ['火刚烧起来时，在它左右两边几格外的草上各横着画一道七格的水。', 'As soon as the fire starts, draw a seven-cell line of water on the grass a few cells to each side of it.'],
    ],
    mechanic: ['防火带：浸湿可燃物', 'Firebreaks: soak the fuel'],
  },
});

L({
  n: '3-3', slug: 'bridge', type: 'planning', difficulty: 2, seed: 33,
  setup: [FLOOR, rect('STONE', 0, 24, 20, 36), rect('STONE', 43, 24, 63, 36), rect('WOOD', 18, 22, 45, 23), rect('WOOD', 46, 12, 50, 23)],
  regions: [goal('bridge', 21, 22, 22, 2), guard('tower', 46, 12, 5, 12)],
  materials: { FIRE: 20, WATER: 40 }, budget: 50, maxSteps: 1600,
  goal: all(survive(1400), atMost('bridge', 'WOOD', 14), intact('tower', 'WOOD', 90)),
  fail: not(intact('tower', 'WOOD', 80)),
  stars: { two: [38, 1600], three: [28, 1600] },
  solutions: [
    { name: '先浇湿木塔，再从桥下点火', strokes: [S('WATER', 46, 9, 50, 9), S('WATER', 46, 8, 50, 8), S('FIRE', 26, 25, 33, 25), S('FIRE', 26, 26, 33, 26)] },
    { name: '浇透木塔两侧', strokes: [S('WATER', 44, 6, 52, 6, 2), S('FIRE', 26, 27, 35, 27, 2)] },
  ],
  text: {
    name: ['烧桥', 'Burn the Bridge'],
    desc: ['烧掉峡谷上的木桥，但旁边的木塔必须保住。', 'Burn down the wooden bridge over the gorge, but keep the wooden tower next to it standing.'],
    hints: [
      ['桥一烧，火会顺着木头烧到木塔上。', 'Once the bridge burns, fire will creep along the wood to the tower.'],
      ['湿木头点不着：先把木塔浇湿，再点火。火要放在桥下面。', 'Wet wood will not light: soak the tower first, then light the fire under the bridge.'],
      ['在木塔顶上画两行水，在桥中间正下方的峡谷里画两排八格的火。', 'Draw two rows of water on top of the tower and two rows of eight fire cells in the gorge right under the middle of the bridge.'],
    ],
    mechanic: ['湿木头：浸湿的木头不会着火', 'Wet wood: soaked wood does not catch fire'],
  },
});

L({
  n: '3-4', slug: 'cellar', type: 'realtime', difficulty: 3, seed: 34,
  setup: [FLOOR, rect('STONE', 16, 20, 17, 36), rect('STONE', 46, 20, 47, 36), rect('STONE', 16, 20, 47, 21), rect('EMPTY', 30, 20, 33, 21),
    rect('WOOD', 22, 30, 27, 36), rect('WOOD', 30, 28, 35, 36), rect('WOOD', 38, 31, 42, 36), ignite(22, 30), ignite(27, 30)],
  regions: [goal('crates', 22, 28, 21, 9), goal('cellar', 18, 22, 28, 15), noBuild('roofL', 14, 0, 16, 22), noBuild('roofR', 34, 0, 16, 22)],
  materials: { WATER: 220 }, budget: 220, maxSteps: 1200,
  goal: all(noFire('cellar', 120), intact('crates', 'WOOD', 70)),
  fail: not(intact('crates', 'WOOD', 55)),
  stars: { two: [200, 500], three: [180, 320] },
  solutions: [
    { name: '一着火就从进水口灌水', strokes: [at(20, S('WATER', 31, 2, 32, 16, 4)), at(40, S('WATER', 31, 2, 32, 14, 4))] },
    { name: '慢慢灌', strokes: [at(60, S('WATER', 31, 4, 32, 16, 3)), at(110, S('WATER', 31, 4, 32, 16, 3)), at(160, S('WATER', 31, 4, 32, 16, 3)), at(210, S('WATER', 31, 4, 32, 16, 3))] },
  ],
  text: {
    name: ['地窖失火', 'Cellar Fire'],
    desc: ['地窖里的木箱着火了。从屋顶的进水口灌水把火淹灭，至少保住七成木箱。', 'The crates in the cellar are on fire. Pour water through the hole in the roof to drown the fire and save at least 70% of the crates.'],
    hints: [
      ['从上面泼水只能浇到表面，火会在里面接着烧。', 'Splashing water from above only wets the surface; the fire keeps burning inside.'],
      ['把整个地窖灌满，让水漫过燃烧的木箱，火就没有空气了。', 'Fill the whole cellar so the water covers the burning crates and the fire has no air.'],
      ['火一着就在进水口正上方画两道粗水柱，一共一百八十格左右。', 'As soon as the fire starts, draw two thick columns of water right above the hole, about 180 cells in all.'],
    ],
    mechanic: ['灭火：用水隔绝空气、带走热量', 'Firefighting: water cuts off air and carries away heat'],
  },
});

L({
  n: '3-5', slug: 'beacon', type: 'planning', difficulty: 4, seed: 35,
  setup: [FLOOR, rect('STONE', 38, 22, 63, 36),
    // 烽火台炉膛：腿 x 40、x 51，炉栅 y 16，炉膛 y 17–21
    rect('STONE', 40, 16, 40, 21), rect('STONE', 51, 16, 51, 21), rect('STONE', 40, 16, 51, 16), rect('EMPTY', 42, 16, 49, 16), rect('WOOD', 41, 11, 50, 15),
    // 岗亭紧挨着柴堆
    rect('WOOD', 53, 9, 58, 21),
    // 引水斜槽：从左上方一直接到岗亭顶上
    line('STONE', 26, 4, 53, 8, 2)],
  regions: [goal('pile', 41, 11, 10, 5), guard('hut', 53, 9, 6, 13), noBuild('sky', 44, 0, 20, 9)],
  materials: { FIRE: 4, DEADPLANT: 16, WATER: 36 }, budget: 46, maxSteps: 1200,
  goal: all(survive(1000), atMost('pile', 'WOOD', 25), intact('hut', 'WOOD', 85)),
  fail: not(intact('hut', 'WOOD', 70)),
  stars: { two: [39, 1200], three: [36, 1200] },
  solutions: [
    { name: '枯枝引火，斜槽引水浇岗亭', strokes: [S('DEADPLANT', 42, 20, 49, 20), S('FIRE', 44, 17, 47, 17), S('WATER', 30, 1, 36, 1, 2)] },
    { name: '两层枯枝、多浇水', strokes: [S('DEADPLANT', 42, 21, 49, 21), S('DEADPLANT', 42, 20, 49, 20), S('FIRE', 44, 18, 47, 18), S('WATER', 29, 1, 37, 1, 2)] },
  ],
  text: {
    name: ['烽火台', 'Signal Beacon'],
    desc: ['点燃烽火台上的柴堆，烧掉一半以上；紧挨着的木岗亭不能烧着。', 'Light the woodpile on the beacon and burn more than half of it, without setting fire to the wooden hut right next to it.'],
    hints: [
      ['只有四格火，直接点柴堆点不着，需要先烧着更容易着的东西。', 'Four cells of fire are not enough to light the woodpile; first set fire to something that catches more easily.'],
      ['枯枝一点就着、烧得又旺又久；岗亭要先浇湿，水只能顺着斜槽流过去。', 'Dead branches catch at once and burn hot and long. Soak the hut first; water can only reach it down the chute.'],
      ['炉膛里铺一排枯枝，往上隔一两格放四格火；在斜槽高处倒二十来格水。', 'Lay a row of dead branches in the hearth, put the four fire cells a row or two above it, and pour about twenty cells of water at the high end of the chute.'],
    ],
    mechanic: ['综合：引火物、湿木头和引流', 'Review: tinder, wet wood and channelling water'],
  },
});

/* ============================== 第四章 · 相变 ============================== */

L({
  n: '4-1', slug: 'steam', type: 'planning', difficulty: 2, seed: 41,
  setup: [FLOOR, rect('STONE', 9, 8, 9, 36), rect('STONE', 21, 12, 21, 32), rect('LAVA', 10, 33, 20, 36), rect('STONE', 21, 33, 21, 36),
    rect('STONE', 9, 7, 46, 7), rect('STONE', 22, 18, 46, 18), rect('STONE', 46, 8, 46, 17), rect('STONE', 22, 19, 23, 36)],
  regions: [goal('cistern', 22, 8, 24, 10), noBuild('lid', 22, 0, 26, 19), guard('furnace', 10, 33, 11, 4)],
  materials: { WATER: 90 }, budget: 90, maxSteps: 900,
  goal: within(850, atLeast('cistern', 'WATER', 30)),
  fail: null,
  stars: { two: [80, 850], three: [70, 700] },
  solutions: [
    { name: '把水倒在熔岩上', strokes: [S('WATER', 11, 20, 19, 26, 3)] },
    { name: '多倒一些', strokes: [S('WATER', 11, 14, 19, 28, 3)] },
  ],
  text: {
    name: ['蒸汽搬水', 'Steam Lift'],
    desc: ['高处的蓄水池够不着。让至少 30 格水进到池里。', 'You cannot reach the high cistern. Get at least 30 cells of water into it.'],
    hints: [
      ['水碰到熔岩会变成蒸汽，蒸汽会往上升。', 'Water that touches lava turns into steam, and steam rises.'],
      ['蒸汽碰到凉的石顶会重新凝成水珠，顺着石顶流进蓄水池。', 'When steam meets the cool stone roof it condenses back into water and runs into the cistern.'],
      ['在左边竖井里、熔岩正上方画一大块水，七十格左右。', 'Draw a big block of water, about seventy cells, in the left shaft right above the lava.'],
    ],
    mechanic: ['汽化与凝结：水遇热成蒸汽，遇冷又成水', 'Boiling and condensing: water turns to steam in heat and back to water in the cold'],
  },
});

L({
  n: '4-2', slug: 'snowmelt', type: 'planning', difficulty: 2, seed: 42,
  setup: [env('temp', -8), FLOOR, rect('STONE', 0, 24, 63, 36), rect('EMPTY', 4, 24, 19, 31), rect('EMPTY', 24, 24, 39, 31), rect('EMPTY', 44, 24, 59, 31),
    rect('SNOW', 4, 26, 19, 31), rect('SNOW', 24, 26, 39, 31), rect('SNOW', 44, 26, 59, 31),
    rect('WOOD', 2, 22, 61, 23), rect('EMPTY', 11, 22, 13, 23), rect('EMPTY', 51, 22, 53, 23)],
  regions: [goal('pondA', 4, 24, 16, 8), guard('icehouse', 24, 24, 16, 8), goal('pondB', 44, 24, 16, 8),
    guard('roofA', 2, 22, 9, 2), guard('roofB', 14, 22, 37, 2), guard('roofC', 54, 22, 8, 2)],
  materials: { LAVA: 40, FIRE: 40 }, budget: 40, maxSteps: 900,
  goal: all(survive(600), atLeast('pondA', 'WATER', 55), atLeast('pondB', 'WATER', 55), atLeast('icehouse', 'SNOW', 50)),
  fail: any(atMost('icehouse', 'SNOW', 40), not(intact('roofA', 'WOOD', 95)), not(intact('roofB', 'WOOD', 95)), not(intact('roofC', 'WOOD', 95))),
  stars: { two: [24, 900], three: [14, 900] },
  solutions: [
    { name: '两个烟囱口各投一小股熔岩', strokes: [S('LAVA', 12, 14, 12, 19), S('LAVA', 52, 14, 52, 19)] },
    { name: '各投一大股', strokes: [S('LAVA', 12, 10, 12, 19), S('LAVA', 52, 10, 52, 19)] },
  ],
  text: {
    name: ['化雪', 'Snowmelt'],
    desc: ['天冷，雪不会自己化。把两边雪池里的雪各化成至少 55 格水；中间冰窖的雪要留着，木棚顶不能烧着。', 'It is freezing, so snow will not melt by itself. Melt each of the two outer snow pools into at least 55 cells of water, but keep the snow in the icehouse between them and do not set the wooden roofs on fire.'],
    hints: [
      ['雪要吸够热才会化成水，火焰一飘就走，热量不够。', 'Snow needs plenty of heat to melt; flames just drift away without giving enough.'],
      ['熔岩落到雪上，会一边往下沉一边把周围的雪化掉；落到木棚顶上就会着火。', 'Lava dropped on snow sinks in and melts the snow around it; dropped on a wooden roof it sets it alight.'],
      ['从两个烟囱口各竖着投六格熔岩就够了。', 'Drop a vertical line of six lava cells through each chimney; that is enough.'],
    ],
    mechanic: ['熔化：固体吸热变成液体', 'Melting: solids absorb heat and turn liquid'],
  },
});

L({
  n: '4-3', slug: 'cast', type: 'planning', difficulty: 2, seed: 43,
  setup: [FLOOR, rect('STONE', 0, 26, 63, 36), rect('EMPTY', 16, 26, 47, 27), rect('WOOD', 4, 22, 9, 25), rect('WOOD', 54, 22, 59, 25)],
  regions: [goal('mold', 16, 26, 32, 2), guard('shedL', 4, 22, 6, 4), guard('shedR', 54, 22, 6, 4)],
  materials: { LAVA: 70, WATER: 70 }, budget: 110, maxSteps: 400,
  goal: within(150, atLeast('mold', 'STONE', 30)),
  fail: any(not(intact('shedL', 'WOOD', 95)), not(intact('shedR', 'WOOD', 95))),
  stars: { two: [90, 150], three: [70, 130] },
  solutions: [
    { name: '一层熔岩一层水', strokes: [S('LAVA', 16, 24, 47, 24), S('WATER', 16, 18, 47, 18)] },
    { name: '一层熔岩、浇两层水', strokes: [S('LAVA', 16, 24, 47, 24), S('WATER', 16, 18, 47, 18), S('WATER', 16, 16, 47, 16)] },
  ],
  text: {
    name: ['浇铸石板', 'Cast a Slab'],
    desc: ['在 150 步之内，用模子浇出一块石板（至少 30 格石头），两边的木棚不能着火。', 'Within 150 steps, cast a stone slab of at least 30 cells in the mold, without setting the wooden sheds on fire.'],
    hints: [
      ['熔岩冷到 850°C 以下就凝成石头，可是自己冷得太慢。', 'Lava turns to stone below 850°C, but it cools too slowly on its own.'],
      ['往熔岩上浇水，水会瞬间汽化，把热量一起带走。', 'Water poured on lava flashes into steam and carries the heat away.'],
      ['模子里倒一排熔岩，上方再画一排同样长的水。', 'Pour one row of lava into the mold and draw an equally long row of water above it.'],
    ],
    mechanic: ['凝固：熔岩遇水冷却成石', 'Solidifying: water cools lava into stone'],
  },
});

L({
  n: '4-4', slug: 'desalt', type: 'planning', difficulty: 3, seed: 44,
  setup: [FLOOR,
    // 海：左上高台上的盐水池，右壁矮，水会漫出来
    rect('STONE', 0, 14, 12, 36), rect('STONE', 0, 1, 0, 13), rect('STONE', 11, 9, 12, 13), rect('SALTWATER', 1, 2, 10, 13),
    // 炉子竖井和蓄水池（同第一关）
    rect('STONE', 16, 14, 16, 36), rect('STONE', 27, 12, 27, 32), rect('LAVA', 17, 33, 26, 36), rect('STONE', 27, 33, 27, 36),
    rect('STONE', 16, 7, 52, 7), rect('STONE', 28, 18, 52, 18), rect('STONE', 52, 8, 52, 17), rect('STONE', 28, 19, 29, 36)],
  regions: [goal('cistern', 28, 8, 24, 10), noBuild('lid', 28, 0, 26, 19), guard('sea', 0, 0, 13, 14), guard('furnace', 17, 33, 10, 4), guard('beach', 13, 28, 3, 9)],
  materials: { STONE: 20 }, budget: 20, maxSteps: 1400,
  goal: all(survive(600), atLeast('cistern', 'WATER', 20), atMost('cistern', 'SALTWATER', 0)),
  fail: atLeast('beach', 'SALTWATER', 12),
  stars: { two: [12, 1400], three: [7, 1400] },
  solutions: [
    { name: '从海边搭一小段石槽到竖井口', strokes: [S('STONE', 12, 11, 17, 11)] },
    { name: '搭一段三格厚的石槽', strokes: [S('STONE', 12, 11, 16, 11, 2)] },
  ],
  text: {
    name: ['海水淡化', 'Desalination'],
    desc: ['海水会从高台上漫出来白白流走。想办法让蓄水池里攒下至少 20 格淡水，一点盐水都不能有。', 'Seawater spills off the cliff and runs to waste. Collect at least 20 cells of fresh water in the cistern, with no salt water at all.'],
    hints: [
      ['盐水碰到熔岩也会变成蒸汽，凝结下来的却是淡水。', 'Salt water also boils into steam on lava, but what condenses is fresh water.'],
      ['把漫出来的海水引进炉子竖井：从海边搭一段石槽，伸进竖井左墙上方的窗口。', 'Lead the overflow into the furnace shaft: build a stone trough from the sea into the window above the left wall of the shaft.'],
      ['紧贴着海的右壁，往右画一条五格长的石线，一直伸进竖井左墙上方的窗口。', 'Right against the sea wall, draw a five-cell stone line to the right, reaching into the window above the left wall of the shaft.'],
    ],
    mechanic: ['综合：蒸馏把盐留下', 'Review: distillation leaves the salt behind'],
  },
});

L({
  n: '4-5', slug: 'snowtower', type: 'planning', difficulty: 4, seed: 45,
  setup: [env('temp', -8), FLOOR, rect('STONE', 9, 8, 9, 36), rect('STONE', 21, 12, 21, 36), rect('SNOW', 10, 22, 20, 36),
    rect('STONE', 9, 7, 46, 7), rect('STONE', 22, 18, 46, 18), rect('STONE', 46, 8, 46, 17), rect('STONE', 22, 19, 23, 36),
    rect('WOOD', 28, 31, 40, 36)],
  regions: [goal('cistern', 22, 8, 24, 10), noBuild('lid', 22, 0, 26, 19), guard('barn', 28, 31, 13, 6)],
  materials: { LAVA: 40, FIRE: 40, SAND: 40 }, budget: 40, maxSteps: 1600,
  goal: all(survive(900), atLeast('cistern', 'WATER', 25)),
  fail: not(intact('barn', 'WOOD', 95)),
  stars: { two: [34, 1600], three: [28, 1600] },
  solutions: [
    { name: '往雪上投三排熔岩', strokes: [S('LAVA', 11, 18, 19, 18), S('LAVA', 11, 15, 19, 15), S('LAVA', 11, 12, 19, 12)] },
    { name: '投四排熔岩', strokes: [S('LAVA', 11, 18, 19, 18), S('LAVA', 11, 16, 19, 16), S('LAVA', 11, 14, 19, 14), S('LAVA', 11, 12, 19, 12)] },
  ],
  text: {
    name: ['雪水上楼', 'Snow to the Rooftop'],
    desc: ['竖井里塞满了冻雪。让至少 25 格水进到高处的蓄水池，旁边的木仓不能着火。', 'The shaft is packed with frozen snow. Get at least 25 cells of water into the high cistern, without setting the wooden barn on fire.'],
    hints: [
      ['雪要先化成水，水还得再变成蒸汽才能升上去。', 'The snow has to melt into water first, and the water has to turn into steam to rise.'],
      ['熔岩一样东西就能把两件事都办了：先化雪，再把化出的水烧开。', 'Lava alone can do both jobs: melt the snow, then boil the meltwater.'],
      ['在竖井雪面上方画三排熔岩，一共二十七格。', 'Draw three rows of lava above the snow in the shaft, twenty-seven cells in all.'],
    ],
    mechanic: ['综合：熔化、汽化、凝结', 'Review: melting, boiling and condensing'],
  },
});

/* ============================== 第五章 · 结构与爆破 ============================== */

L({
  n: '5-1', slug: 'pillar', type: 'planning', difficulty: 1, seed: 51,
  setup: [FLOOR, rect('STONE', 18, 14, 45, 16), rect('GLASS', 22, 30, 41, 30), rect('GLASS', 22, 31, 22, 36), rect('GLASS', 41, 31, 41, 36)],
  regions: [goal('balcony', 18, 14, 28, 3), guard('greenhouse', 22, 17, 20, 20)],
  materials: { STONE: 60 }, budget: 60, maxSteps: 400,
  goal: all(survive(300), intact('balcony', 'STONE', 95)),
  fail: not(intact('balcony', 'STONE', 80)),
  stars: { two: [44, 400], three: [24, 400] },
  solutions: [
    { name: '在一端立一根细柱', strokes: [S('STONE', 19, 37, 19, 15)] },
    { name: '两端各立一根粗柱', strokes: [S('STONE', 19, 36, 19, 17, 2), S('STONE', 44, 36, 44, 17)] },
  ],
  text: {
    name: ['支柱', 'The Pillar'],
    desc: ['石台悬在半空，一开始就会掉下来砸坏温室。给它撑住。', 'The stone ledge is hanging in mid-air and will fall onto the greenhouse as soon as time starts. Hold it up.'],
    hints: [
      ['没有和地面或锚点连起来的石头会整块掉下来。', 'Stone that is not connected to the ground or an anchor falls as one piece.'],
      ['柱子只要从地面一直连到石台底下就行，温室上方不能放东西。', 'A column only needs to connect the ground to the underside of the ledge; you cannot build above the greenhouse.'],
      ['在石台左端下面，从地面竖着画一根一格粗的石柱。', 'Draw a one-cell-thick stone column from the ground up to the left end of the ledge.'],
    ],
    mechanic: ['支撑：刚体要连到地面或锚点', 'Support: rigid bodies must connect to the ground or an anchor'],
  },
});

L({
  n: '5-2', slug: 'hang', type: 'planning', difficulty: 2, seed: 52,
  setup: [FLOOR, rect('ANCHOR', 30, 1, 33, 1), rect('STONE', 27, 15, 36, 18), rect('GLASS', 18, 30, 45, 30), rect('GLASS', 18, 31, 18, 36), rect('GLASS', 45, 31, 45, 36)],
  regions: [goal('lamp', 27, 15, 10, 4), guard('greenhouse', 14, 19, 36, 18)],
  materials: { ROPE: 40, SAND: 40 }, budget: 40, maxSteps: 400,
  goal: all(survive(300), intact('lamp', 'STONE', 95)),
  fail: not(intact('lamp', 'STONE', 80)),
  stars: { two: [28, 400], three: [14, 400] },
  solutions: [
    { name: '一根绳子吊住', strokes: [S('ROPE', 31, 1, 31, 15)] },
    { name: '两根绳子吊住', strokes: [S('ROPE', 30, 1, 30, 15), S('ROPE', 33, 1, 33, 15)] },
  ],
  text: {
    name: ['吊灯', 'Hang the Lamp'],
    desc: ['一块石灯悬在温室上方，开始后会掉下来。用绳子把它吊在顶上的锚点上。', 'A stone lamp hangs above the greenhouse and will fall when time starts. Hang it from the anchor overhead with rope.'],
    hints: [
      ['锚点固定不动，连着它的东西都不会掉。', 'Anchors never move, and anything connected to them stays put.'],
      ['温室上方不能垫东西，只能从上面吊；沙子撑不住它。', 'You cannot prop it up from the greenhouse, only hang it from above; sand will not hold it.'],
      ['从锚点正下方竖着画一根绳子，一直连到石灯顶上。', 'Draw a vertical rope from right under the anchor down to the top of the lamp.'],
    ],
    mechanic: ['绳子：把东西吊在锚点上', 'Rope: hang loads from an anchor'],
  },
});

L({
  n: '5-3', slug: 'blast', type: 'planning', difficulty: 2, seed: 53,
  setup: [FLOOR, rect('BRICK', 30, 20, 34, 36), rect('WOOD', 0, 30, 5, 36), rect('WOOD', 58, 30, 63, 36)],
  regions: [goal('wall', 30, 20, 5, 17), guard('houseL', 0, 30, 6, 7), guard('houseR', 58, 30, 6, 7)],
  materials: { TNT: 8, GUNPOWDER: 24, LAVA: 4 }, budget: 30, maxSteps: 700,
  goal: all(survive(400), not(intact('wall', 'BRICK', 25)), intact('houseL', 'WOOD', 70), intact('houseR', 'WOOD', 70)),
  fail: any(not(intact('houseL', 'WOOD', 50)), not(intact('houseR', 'WOOD', 50))),
  stars: { two: [20, 700], three: [13, 700] },
  solutions: [
    { name: 'TNT 贴墙竖一排，火药引子，熔岩点火', strokes: [S('TNT', 28, 30, 28, 36), S('GUNPOWDER', 24, 35, 27, 35), S('LAVA', 24, 33, 25, 33)] },
    { name: '多放 TNT、拉一条长引线', strokes: [S('TNT', 28, 28, 29, 36), S('GUNPOWDER', 16, 36, 27, 36), S('LAVA', 16, 34, 17, 34)] },
  ],
  text: {
    name: ['定点爆破', 'Controlled Demolition'],
    desc: ['炸掉中间的砖墙（至少毁掉四分之三），两边的木屋要保住。', 'Blow up the brick wall in the middle (at least three quarters of it) while keeping both wooden houses intact.'],
    hints: [
      ['TNT 不怕热也不怕水，直接拿熔岩烤不着，得有东西先炸起来引爆它。', 'TNT shrugs off heat and water; lava alone will not set it off, so something has to explode next to it first.'],
      ['火药一碰熔岩就燃爆，正好用来当引子。TNT 的爆炸半径大约 15 格。', 'Gunpowder flares up the moment lava touches it, which makes a good primer. TNT blasts reach about 15 cells.'],
      ['紧贴墙根竖着放一排七格 TNT，旁边地上铺四格火药，再在火药上方点两格熔岩。', 'Stack a column of seven TNT cells against the foot of the wall, lay four cells of gunpowder beside it on the ground, and put two cells of lava above the powder.'],
    ],
    mechanic: ['TNT 和引线：用火药引爆', 'TNT and fuses: prime it with gunpowder'],
  },
});

L({
  n: '5-4', slug: 'fuses', type: 'realtime', difficulty: 3, seed: 54,
  setup: [FLOOR, rect('SOIL', 0, 35, 63, 36), rect('TNT', 1, 31, 4, 34), rect('TNT', 59, 31, 62, 34),
    rect('DEADPLANT', 7, 33, 56, 34), rect('GUNPOWDER', 5, 33, 6, 34), rect('GUNPOWDER', 57, 33, 58, 34), ignite(31, 33), ignite(32, 34), ignite(31, 34), ignite(32, 33)],
  regions: [guard('depotL', 0, 28, 6, 7), guard('depotR', 58, 28, 6, 7), guard('fire', 29, 29, 6, 6), goal('fuse', 7, 33, 50, 2)],
  materials: { WATER: 16, SAND: 40 }, budget: 40, maxSteps: 1500,
  goal: all(survive(1400), atLeast('depotL', 'TNT', 16), atLeast('depotR', 'TNT', 16), atLeast('fuse', 'DEADPLANT', 60)),
  fail: any(atMost('depotL', 'TNT', 10), atMost('depotR', 'TNT', 10)),
  stars: { two: [24, 1500], three: [14, 1500] },
  solutions: [
    { name: '两边火头前各浇一小段水', strokes: [at(40, S('WATER', 22, 30, 26, 30)), at(40, S('WATER', 37, 30, 41, 30))] },
    { name: '稍晚一些、浇得长一点', strokes: [at(60, S('WATER', 19, 30, 25, 30)), at(60, S('WATER', 38, 30, 45, 30))] },
  ],
  text: {
    name: ['掐断引线', 'Cut the Fuses'],
    desc: ['两条干草引线从中间烧起来，正往两边的炸药库烧。在火烧到之前把它们掐断，引线上至少留下 60 格干草。', 'Two hay fuses are burning outward from the middle toward the explosives depots on both sides. Cut them before the fire gets there, keeping at least 60 cells of the fuses unburnt.'],
    hints: [
      ['沙子盖在草上挡不住火，草下面还是干的。', 'Sand on top of the hay will not stop the fire; the hay underneath stays dry.'],
      ['湿草点不着：在两边火头前各浇一段水，把草浇透。', 'Wet hay will not burn: soak a stretch of each fuse ahead of the fire.'],
      ['一开始就在中间火堆左右各十格左右的草上，各画一道五格的水。', 'Right at the start, draw a five-cell line of water on the hay about ten cells to each side of the fire.'],
    ],
    mechanic: ['综合：引线、防火带和时机', 'Review: fuses, firebreaks and timing'],
  },
});

L({
  n: '5-5', slug: 'breach', type: 'planning', difficulty: 4, seed: 55,
  setup: [FLOOR, rect('WATER', 0, 20, 21, 36), rect('BRICK', 22, 16, 23, 36), rect('STONE', 56, 28, 56, 36), rect('WOOD', 59, 30, 63, 36),
    rect('STONE', 40, 6, 58, 7)],
  regions: [goal('field', 24, 30, 32, 7), goal('bridge', 40, 6, 19, 2), guard('house', 59, 30, 5, 7), guard('lake', 0, 0, 22, 37)],
  materials: { TNT: 10, GUNPOWDER: 10, LAVA: 4, STONE: 70 }, budget: 80, maxSteps: 900,
  goal: all(survive(700), atLeast('field', 'WATER', 30), intact('bridge', 'STONE', 80), intact('house', 'WOOD', 80)),
  fail: any(not(intact('bridge', 'STONE', 50)), not(intact('house', 'WOOD', 60))),
  stars: { two: [60, 900], three: [45, 900] },
  solutions: [
    { name: '先立柱，再引爆坝脚', strokes: [S('STONE', 57, 37, 57, 5), S('TNT', 25, 31, 26, 36), S('GUNPOWDER', 27, 35, 30, 35), S('LAVA', 29, 33, 30, 33)] },
    { name: '两根柱子、多放火药', strokes: [S('STONE', 57, 37, 57, 5), S('STONE', 41, 37, 41, 5), S('TNT', 25, 31, 26, 36), S('GUNPOWDER', 27, 34, 30, 35), S('LAVA', 29, 32, 30, 32)] },
  ],
  text: {
    name: ['炸坝引水', 'Breach the Dam'],
    desc: ['炸开砖坝，让至少 30 格湖水流进田里。田上方悬空的石桥要先撑住，右边的木屋也要保住。', 'Blow open the brick dam so at least 30 cells of lake water flow into the field. Hold up the stone bridge hanging over the field first, and keep the wooden house on the right intact.'],
    hints: [
      ['石桥一开始就会掉下来；TNT 要靠火药引爆。', 'The bridge falls as soon as time starts, and TNT needs gunpowder to set it off.'],
      ['柱子立在离坝远的一端，爆炸就伤不到它。', 'Put the column at the end of the bridge far from the dam so the blast cannot reach it.'],
      ['在石桥右端下面（木屋左边）立一根石柱；坝脚右侧竖放一排 TNT，旁边铺四格火药，上面点两格熔岩。', 'Stand a stone column under the right end of the bridge, just left of the house; stack a column of TNT against the right foot of the dam, lay four cells of gunpowder beside it and put two cells of lava above.'],
    ],
    mechanic: ['综合：支撑、爆破与引水', 'Review: support, demolition and water'],
  },
});

/* ============================== 第六章 · 天气与电 ============================== */

L({
  n: '6-1', slug: 'circuit', type: 'planning', difficulty: 2, seed: 61,
  setup: [FLOOR, rect('METAL', 2, 28, 2, 36), rect('METAL', 3, 36, 21, 36), rect('METAL', 28, 36, 50, 36), rect('TNT', 51, 33, 52, 36), rect('BRICK', 54, 26, 59, 36), rect('STONE', 60, 20, 63, 36)],
  regions: [goal('boulder', 54, 26, 6, 11), guard('line', 28, 31, 36, 6)],
  materials: { METAL: 30, SPARK: 4 }, budget: 32, maxSteps: 500,
  goal: within(450, not(intact('boulder', 'BRICK', 30))),
  fail: null,
  stars: { two: [28, 450], three: [22, 300] },
  solutions: [
    { name: '补上缺口，再在金属桩旁点电火花', strokes: [S('METAL', 20, 36, 29, 36, 2), S('SPARK', 1, 31, 3, 31)] },
    { name: '整段再铺一层，多点几个火花', strokes: [S('METAL', 20, 36, 29, 36, 2), S('METAL', 12, 35, 19, 35), S('SPARK', 1, 31, 3, 31), S('SPARK', 1, 29, 3, 29)] },
  ],
  text: {
    name: ['接通电路', 'Close the Circuit'],
    desc: ['电线断了一截。接上它，让电火花顺着电线跑到另一头，引爆 TNT 炸开巨石。', 'A stretch of the wire is missing. Repair it so a spark can run along the wire to the far end, set off the TNT and blast the boulder.'],
    hints: [
      ['电火花会顺着金属一路跑过去，跑到头就点着挨着的炸药。', 'A spark races along metal and sets off whatever explosive it reaches at the end.'],
      ['电线中间缺了六格，金属必须连成一条线才导电。', 'Six cells of wire are missing; the metal has to be continuous to conduct.'],
      ['用两格粗的笔刷把缺口补上，再在左边金属桩旁边点电火花。', 'Fill the gap with a two-cell-thick stroke of metal, then put a spark next to the metal post on the left.'],
    ],
    mechanic: ['导电：电火花沿金属传导', 'Conduction: sparks travel along metal'],
  },
});

L({
  n: '6-2', slug: 'canal', type: 'planning', difficulty: 2, seed: 62,
  setup: [FLOOR, rect('STONE', 0, 31, 63, 36), rect('EMPTY', 12, 31, 51, 33), rect('WATER', 12, 31, 43, 33), rect('TNT', 50, 31, 51, 33), rect('BRICK', 53, 22, 58, 30), rect('STONE', 59, 14, 63, 30),
    rect('METAL', 11, 24, 11, 33)],
  regions: [goal('boulder', 53, 22, 6, 9), guard('cliff', 50, 20, 14, 11), noBuild('far', 13, 0, 30, 31)],
  materials: { WATER: 30, METAL: 30, SAND: 30, SPARK: 3 }, budget: 34, maxSteps: 500,
  goal: within(450, not(intact('boulder', 'BRICK', 30))),
  fail: null,
  stars: { two: [30, 450], three: [24, 300] },
  solutions: [
    { name: '往干沟里灌水接通，再在金属桩旁放火花', strokes: [S('WATER', 43, 32, 50, 32, 2), S('SPARK', 10, 27, 12, 27)] },
    { name: '往干沟里填金属', strokes: [S('METAL', 43, 32, 50, 32, 2), S('SPARK', 10, 27, 12, 27)] },
  ],
  text: {
    name: ['水渠导电', 'The Wet Wire'],
    desc: ['TNT 埋在水渠尽头的干沟里。让电火花传过去引爆它，炸开巨石。', 'The TNT is buried in a dry ditch at the end of the canal. Send a spark there to set it off and blast the boulder.'],
    hints: [
      ['水也导电，只是每走一格都会损耗，大约能传四十格。', 'Water conducts too, but it loses strength each cell and only carries about forty cells.'],
      ['水渠和 TNT 之间还隔着一段干沟，要先接上。TNT 不怕水。', 'A dry ditch separates the canal from the TNT and has to be bridged first. TNT does not mind getting wet.'],
      ['往干沟里灌满水，再在左边金属桩旁点电火花。', 'Fill the ditch with water, then put a spark next to the metal post on the left.'],
    ],
    mechanic: ['导电：水也能传电', 'Conduction: water carries current too'],
  },
});

L({
  n: '6-3', slug: 'reroute', type: 'planning', difficulty: 3, seed: 63,
  setup: [FLOOR, rect('METAL', 3, 18, 3, 36), rect('METAL', 7, 36, 40, 36),
    rect('WOOD', 8, 30, 13, 35), rect('WOOD', 19, 30, 24, 35), rect('WOOD', 30, 30, 35, 35),
    rect('TNT', 58, 33, 59, 36), rect('BRICK', 60, 24, 63, 36)],
  regions: [goal('boulder', 60, 24, 4, 13), guard('houseA', 8, 30, 6, 6), guard('houseB', 19, 30, 6, 6), guard('houseC', 30, 30, 6, 6)],
  materials: { METAL: 100, SPARK: 6 }, budget: 104, maxSteps: 600,
  goal: all(survive(400), not(intact('boulder', 'BRICK', 40))),
  fail: any(not(intact('houseA', 'WOOD', 50)), not(intact('houseB', 'WOOD', 50)), not(intact('houseC', 'WOOD', 50))),
  stars: { two: [98, 600], three: [88, 600] },
  solutions: [
    { name: '贴着屋顶上方拉一条新线', strokes: [S('METAL', 2, 26, 59, 26), S('METAL', 57, 25, 57, 34, 2), S('SPARK', 2, 22, 4, 22), S('SPARK', 2, 30, 4, 30)] },
    { name: '从桩顶拉一条高线', strokes: [S('METAL', 4, 20, 57, 20), S('METAL', 57, 21, 57, 34), S('SPARK', 2, 22, 4, 22)] },
  ],
  text: {
    name: ['绕开木屋', 'Reroute the Line'],
    desc: ['引爆右边的 TNT 炸开巨石。旧电线从木屋底下穿过，通了电会把木屋烤着。', 'Set off the TNT on the right to blast the boulder. The old wire runs under the wooden houses and would set them alight if it carried current.'],
    hints: [
      ['通电的金属会烤热紧挨着的可燃物，木头碰着就着。', 'Live metal heats anything flammable touching it; wood catches fire.'],
      ['别去接旧电线的缺口，从电桩另拉一条不碰木头的新线到 TNT。', 'Do not repair the gap in the old wire; run a new line from the post to the TNT that touches no wood.'],
      ['从电桩中段往右拉一条横线，比屋顶高出两格以上，到 TNT 上方再往下拐，贴到 TNT 旁边。', 'Run a horizontal line right from the middle of the post, at least two cells above the roofs, then turn down beside the TNT.'],
    ],
    mechanic: ['导电的副作用：通电金属会发热', 'A side effect of conduction: live metal gets hot'],
  },
});

L({
  n: '6-4', slug: 'flowspark', type: 'realtime', difficulty: 3, seed: 64,
  setup: [FLOOR, rect('STONE', 0, 31, 63, 36), rect('EMPTY', 8, 30, 41, 33), rect('STONE', 6, 26, 7, 30),
    // 泉眼在水渠左端上方
    rect('STONE', 9, 20, 9, 23), rect('STONE', 14, 20, 14, 23), rect('CLONE', 10, 23, 13, 23), rect('WATER', 10, 21, 13, 22),
    rect('TNT', 42, 30, 43, 33), rect('BRICK', 45, 22, 50, 30), rect('STONE', 51, 16, 63, 30), rect('WOOD', 0, 26, 5, 30), rect('METAL', 8, 22, 8, 33)],
  regions: [goal('boulder', 45, 22, 6, 9), guard('village', 0, 24, 8, 7), guard('spring', 9, 20, 6, 4), guard('cliff', 42, 20, 22, 11), noBuild('far', 19, 0, 23, 30)],
  materials: { SPARK: 6, METAL: 20, SAND: 20 }, budget: 20, maxSteps: 900,
  goal: within(800, not(intact('boulder', 'BRICK', 40))),
  fail: atLeast('village', 'WATER', 3),
  stars: { two: [8, 800], three: [3, 500] },
  solutions: [
    { name: '水一接到 TNT 就在金属桩旁放火花', strokes: [at(180, S('SPARK', 7, 23, 9, 23))] },
    { name: '晚一点、多放几个火花', strokes: [at(320, S('SPARK', 7, 23, 9, 23)), at(330, S('SPARK', 7, 25, 9, 25))] },
  ],
  text: {
    name: ['顺水通电', 'Current on the Tide'],
    desc: ['泉水正在灌满水渠。等水接到另一头的 TNT，再放电火花引爆它炸开巨石；水渠满了会漫进左边的村子。', 'The spring is filling the canal. Once the water reaches the TNT at the far end, send a spark to set it off and blast the boulder; when the canal is full it will spill into the village on the left.'],
    hints: [
      ['电火花只闪一下：水还没连到 TNT 时放，电会半路断掉。', 'A spark only flashes once: if the water has not reached the TNT yet, the current dies on the way.'],
      ['看着水头走到 TNT 跟前，再在泡在水里的金属桩旁放火花；别等水渠漫出来。', 'Watch the waterfront reach the TNT, then put a spark next to the metal post standing in the water, before the canal overflows.'],
      ['大约第 120 步水会碰到 TNT，之后在金属桩旁横着点三格电火花。', 'The water touches the TNT around step 120; after that, put a row of three sparks across the metal post.'],
    ],
    mechanic: ['综合：水流、导电与时机', 'Review: flowing water, conduction and timing'],
  },
});

L({
  n: '6-5', slug: 'doubleshot', type: 'realtime', difficulty: 4, seed: 65,
  setup: [FLOOR, rect('STONE', 0, 31, 63, 36), rect('EMPTY', 8, 30, 41, 33), rect('STONE', 6, 26, 7, 30),
    rect('STONE', 9, 20, 9, 23), rect('STONE', 14, 20, 14, 23), rect('CLONE', 10, 23, 13, 23), rect('WATER', 10, 21, 13, 22),
    rect('TNT', 42, 30, 43, 33), rect('STONE', 44, 16, 63, 30), rect('STONE', 34, 22, 43, 23), rect('WOOD', 0, 26, 5, 30),
    // 电桩，向上接一条高线，线中间断了一截，尽头是挂在锚点上的第二包 TNT
    rect('METAL', 8, 6, 8, 33), rect('METAL', 9, 6, 19, 6), rect('METAL', 26, 6, 35, 6), rect('ANCHOR', 36, 8, 40, 8), rect('TNT', 36, 5, 37, 7)],
  regions: [goal('tntLow', 42, 30, 2, 4), goal('tntHigh', 36, 5, 2, 3), guard('village', 0, 24, 8, 7), guard('spring', 9, 20, 6, 4), guard('cliff', 34, 16, 30, 15), guard('wire', 26, 3, 16, 7), noBuild('far', 16, 10, 26, 24), noBuild('sky', 10, 0, 16, 5), noBuild('gully', 10, 8, 6, 12)],
  materials: { SPARK: 3, METAL: 20, SAND: 20 }, budget: 24, maxSteps: 900,
  goal: within(850, all(atMost('tntLow', 'TNT', 0), atMost('tntHigh', 'TNT', 0))),
  fail: atLeast('village', 'WATER', 3),
  stars: { two: [18, 850], three: [12, 600] },
  solutions: [
    { name: '先补线，水接到下面的 TNT 再放火花', strokes: [at(0, S('METAL', 19, 6, 26, 6)), at(180, S('SPARK', 7, 24, 9, 24))] },
    { name: '晚一点补线，分两次放火花', strokes: [at(100, S('METAL', 19, 6, 26, 6, 2)), at(260, S('SPARK', 7, 24, 9, 24)), at(400, S('SPARK', 9, 27))] },
  ],
  text: {
    name: ['一火双响', 'One Spark, Two Blasts'],
    desc: ['用电火花把高处和水渠尽头的两包 TNT 都引爆。泉水正在灌渠，渠满了会淹到村子。', 'Use sparks to set off both charges of TNT: the one up high and the one at the end of the canal. The spring is filling the canal, which will flood the village when full.'],
    hints: [
      ['电桩同时连着上面的电线和下面的水渠，一个火花两头都能跑。', 'The post connects to both the wire above and the canal below, so one spark can run both ways.'],
      ['上面的电线断了一截要补上；下面要等水流到 TNT 跟前才导得通。', 'The upper wire is missing a stretch that must be repaired, and the lower route only conducts once the water reaches the TNT.'],
      ['一开始就用一排金属补上高线缺口，等到第 120 步以后，在电桩旁点三格电火花。', 'At the start, fill the gap in the high wire with a row of metal; after step 120, put three sparks beside the post.'],
    ],
    mechanic: ['综合：导线、水路与时机', 'Review: wires, water paths and timing'],
  },
});
