'use strict';
import { ACID, ASH, BRICK, CHARCOAL, CONCRETE, DEADPLANT, EMBER, EMPTY, FIRE, FLOWER, GUNPOWDER, ICE, LAVA, NT, PLANT, ROPE, SALT, SALTWATER, SAND, SEED, SOIL, STEAM, STONE, TNT, WATER, WOOD } from './materials.js';

/* ---------------------------------------------------------------------
 * 1.3 反应矩阵（规则的唯一来源）
 *
 * 【接触反应】行 = 主动方，列 = 被接触方；格式「主动方变成 + 对方变成 (每帧每邻格概率)」
 *
 *            │ 熔岩                         │ 火 / 余烬            │ 盐           │ 冰                    │ 石头/砖/混凝土
 *  ──────────┼──────────────────────────────┼──────────────────────┼──────────────┼───────────────────────┼───────────────
 *  水        │ 蒸汽 + 熔岩降温260°C (.3)    │ 水升温 + 火熄灭 (1)  │ 盐水+空(.04) │ 冰+冰(.002，过冷水<-1°C) │ —
 *  盐水      │ 蒸汽 + 熔岩降温260°C (.3)    │ 盐水升温 + 火熄灭(1) │ —            │ 盐水+水 (.012)        │ —
 *  盐        │ —                            │ —                    │ —            │ 空+盐水 (.03)         │ —
 *  酸液      │ 火+熔岩 (1)                  │ —                    │ 溶解 (.02)   │ 溶解 (.02)            │ 溶解 (.0015~.004)
 *
 *  · 酸液 × 可溶物（沙、土、盐、火药、灰、种子、木头、植物、花、炭、冰、TNT、绳子、枯枝）：溶解 (.02)；
 *    每次溶解酸液自身有 50% 被消耗，所以一份酸能溶掉的东西是有限的。玻璃、金属、钢、锚点、克隆体、黑洞不溶。
 *  · 水 × 熔岩不再把整格熔岩瞬间变成石头：熔岩只是被吸走热量，降到 850°C 以下才凝固 → 先结表面硬壳。
 *  · 水 × 火：火焰不再 1:1 吃掉水，水只是升温（烧开了才变蒸汽）。
 *
 * 【含水量】（每格一个 wet 值，100 = 一格水）
 *    水碰到吸水材料（沙、土、木头、植物、灰、火药、种子、炭、绳子、枯枝）：对方变湿，水按量减少（守恒）。
 *    湿的东西超过 100°C 先烘干（吸热、放出水汽），烘干之前点不着 → 泼过水的地方是防火带。
 *    湿的东西暴露在空气里慢慢晾干，水分进入空气湿度场。
 *
 * 【燃烧】燃料 + 热量 + 氧气，缺一个就灭
 *    燃料：每个可燃格有 fuel，烧一帧减一，熄灭时不回补，烧完变成炭 / 灰。
 *    热量：贴着水的燃烧格每帧被吸走 150°C，降到燃点以下即熄灭，留下焦黑、潮湿的残骸并冒白烟。
 *    氧气：燃烧要消耗相邻空气格的氧（空气格的 aux = 浑浊度），浑浊度在空气里扩散；
 *          四周没有空气、或空气已经耗尽的火会闷熄。密闭空间里的火会自己把氧气烧光。
 *    木头(300°C) → 火 + 炭 → 炭(380°C)阴燃 → 灰        植物(230°C)/花/种子/枯枝(170°C)/绳子 → 火 + 灰
 *    油(220°C) → 大火 + 烟；油火遇水：水瞬间汽化，把燃烧的油崩成飞溅的火滴
 *    火药(170°C，受潮不燃) → 2 帧后小爆炸      TNT(240°C) → 60 帧引信后爆炸
 *
 * 【温度相变】
 *    冰 <──<0°C 且放够潜热──── 水（结冰时温度钉在 0°C，冰层下面的水要很久才冻上）
 *    冰 ──>0°C 且吸够潜热──> 水 ──>100°C──> 蒸汽 ──<85°C──> 水汽（湿度场）──高空饱和──> 云 ──> 雨 / 雪
 *    雪 ──>0.5°C 且吸够潜热──> 水      蒸汽碰到 <50°C 的固体表面 → 直接凝成水珠
 *    盐水 ──>104°C──> 蒸汽     盐水 ──<-18°C──> 冰
 *    沙 ──>1450°C──> 玻璃      石头 ──>1250°C──> 熔岩 ──<850°C──> 石头
 *
 * 【植物】种子(湿土+光+空间) → 幼苗 → 成株(受株高基因限制) → 开花 → 落种 → 老化 → 枯枝 → 腐烂成土
 *    生长每格消耗 0.14 格水（从茎里的水分或根部的湿土 / 水里取），没水、没光、太挤都不长。
 *
 * 【其他】
 *    电火花 / 带电导体 × 可燃物：给对方加热 250~300°C      电火花 × 金属 / 钢 / 水 / 盐水：注入电荷
 *    克隆体、黑洞：非物理元素，是场景的外部输入 / 输出
 * ------------------------------------------------------------------- */
export const ACID_SOLUBLE = [SAND, SOIL, SALT, GUNPOWDER, ASH, SEED, WOOD, PLANT, FLOWER, CHARCOAL, ICE, TNT, ROPE, DEADPLANT];

// { a, b, p, a2, b2, use(主动方被消耗概率), maxT(主动方温度上限), aT/bT(产物温度), aDT/bDT(温度变化), tag }
export const RULES = [
  { a: WATER, b: LAVA, p: 0.3, a2: STEAM, b2: LAVA, aT: 160, bDT: -260, tag: 'hiss' },
  { a: SALTWATER, b: LAVA, p: 0.3, a2: STEAM, b2: LAVA, aT: 160, bDT: -260, tag: 'hiss' },
  { a: WATER, b: FIRE, p: 1, a2: WATER, b2: EMPTY, aDT: 12, tag: 'hiss' },
  { a: SALTWATER, b: FIRE, p: 1, a2: SALTWATER, b2: EMPTY, aDT: 12, tag: 'hiss' },
  { a: WATER, b: EMBER, p: 1, a2: WATER, b2: EMPTY, aDT: 6 },
  { a: SALTWATER, b: EMBER, p: 1, a2: SALTWATER, b2: EMPTY, aDT: 6 },
  { a: WATER, b: SALT, p: 0.04, a2: SALTWATER, b2: EMPTY },
  { a: WATER, b: ICE, p: 0.002, a2: ICE, b2: ICE, maxT: -1, aT: -2 },     // 只有过冷水（< -1°C）碰到冰才会瞬间结晶
  { a: SALT, b: ICE, p: 0.03, a2: EMPTY, b2: SALTWATER, bT: 1 },
  { a: SALTWATER, b: ICE, p: 0.012, a2: SALTWATER, b2: WATER, bT: 1 },
  { a: ACID, b: LAVA, p: 1, a2: FIRE, b2: LAVA, aT: 900 },
  { a: ACID, b: STONE, p: 0.0015, a2: ACID, b2: EMPTY, use: 0.5 },
  { a: ACID, b: BRICK, p: 0.004, a2: ACID, b2: EMPTY, use: 0.5 },
  { a: ACID, b: CONCRETE, p: 0.003, a2: ACID, b2: EMPTY, use: 0.5 },
];
for (const s of ACID_SOLUBLE) RULES.push({ a: ACID, b: s, p: 0.02, a2: ACID, b2: EMPTY, use: 0.5 });

export const RX = new Array(NT * NT).fill(null);
export const HASRX = new Uint8Array(NT);
for (const r of RULES) { RX[r.a * NT + r.b] = r; HASRX[r.a] = 1; }
