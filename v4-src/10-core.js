'use strict';
/* =====================================================================
 * 粒子沙盘 v4
 * 模块顺序：1 核心（常量/随机数/材料表/规则表/网格/分块/环境）
 *           2 模拟（运动/燃烧/含水量/植物/爆炸/电/温度/飞行粒子/慢速过程/主步进）
 *             2s 结构力学（支撑检测 + 刚体）   2w 天气（风/湿度/云/降水/闪电/昼夜）
 *           3 渲染（WebGL2 管线 + Canvas2D 退路）
 *           4 音效（WebAudio 程序合成）
 *           5 UI     6 自测与 soak     7 主循环
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * 1.1 常量与随机数
 * ------------------------------------------------------------------- */
let CELL = 3;              // 每格的 CSS 像素边长，可在设置里切 2 / 3 / 4
const CHUNK = 32;          // 分块边长
const AMBIENT = 20;        // 默认气温 °C（实际环境温度见 env.ambient）
const WAKE_TTL = 3;        // 被唤醒后至少再模拟几帧
const SIM_HZ = 60;
const QS = new URLSearchParams(location.search);

// xorshift32：模拟里只用它，不用 Math.random。初始种子固定，由宿主（页面 / 测试）显式设置
let _rs = 0x2545f491;
function rngState() { return _rs; }
function setRngState(s) { _rs = (s | 0) || 1; }
function rnd() {
  _rs ^= _rs << 13; _rs ^= _rs >>> 17; _rs ^= _rs << 5;
  return (_rs >>> 0) * 2.3283064365386963e-10;
}
function rndi(n) { return (rnd() * n) | 0; }
function seedRng(s) { _rs = (s | 0) || 1; }

/* ---------------------------------------------------------------------
 * 1.1b 确定性数学：模拟里禁止用 Math.sin / cos / exp / pow / log / hypot
 *      （不同 JS 引擎的结果在最后几位可能不同）。这里只用 + - * / 和 Math.floor / sqrt / abs，
 *      这些在 IEEE 754 下每个引擎结果都一样。精度约 1e-7，模拟够用。渲染层不受这条限制。
 * ------------------------------------------------------------------- */
const TAU = 6.283185307179586, HALF_PI = 1.5707963267948966;
function dsin(x) {
  x -= Math.floor(x / TAU + 0.5) * TAU;              // 归到 [-π, π]
  if (x > HALF_PI) x = 3.141592653589793 - x;         // 再折到 [-π/2, π/2]
  else if (x < -HALF_PI) x = -3.141592653589793 - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800))))));
}
function dcos(x) { return dsin(x + HALF_PI); }

/* ---------------------------------------------------------------------
 * 1.2 材料表（声明式；所有通用行为都从这张表读）
 * ------------------------------------------------------------------- */
const S_EMPTY = 0, S_SOLID = 1, S_POWDER = 2, S_LIQUID = 3, S_GAS = 4, S_ENERGY = 5;
const STATE_NAMES = ['空', '固体', '粉末', '液体', '气体', '能量'];

const EMPTY = 0, SAND = 1, WATER = 2, FIRE = 3, WOOD = 4, STONE = 5, LAVA = 6, PLANT = 7,
      ICE = 8, ACID = 9, SMOKE = 10, STEAM = 11, EMBER = 12, TNT = 13, METAL = 14, CLONE = 15,
      VOID = 16, OIL = 17, GUNPOWDER = 18, GLASS = 19, ASH = 20, CHARCOAL = 21, SALT = 22,
      SALTWATER = 23, SPARK = 24, SEED = 25, FLOWER = 26, SOIL = 27,
      BRICK = 28, CONCRETE = 29, STEEL = 30, ANCHOR = 31, ROPE = 32, DEADPLANT = 33, FOAM = 34, SNOW = 35;
const NT = 36;
// 工具（不是材料）
const TOOL_ERASE = 100, TOOL_HEAT = 101, TOOL_COOL = 102, TOOL_LIGHTNING = 103;

const MAT_DEFAULTS = {
  state: S_SOLID, cat: 'solid', density: 1000, viscosity: 0, dispersion: 0,
  flammability: 0, ignitionTemp: Infinity, burnInto: EMPTY, burnTime: 0, burnTemp: 0,
  flame: 0, residue: 1,
  meltTemp: Infinity, meltInto: EMPTY, latent: 0, latentRate: 4,
  boilTemp: Infinity, boilInto: EMPTY,
  freezeTemp: -Infinity, freezeInto: EMPTY, freezeLatent: 0,
  conductivity: 0.15, heatCapacity: 1.5, relax: 0.001,
  hardness: 0.2, emissive: 0, alpha: 1, palette: ['#ff00ff'],
  spawnTemp: AMBIENT, life: null, decayInto: EMPTY, decayChance: 0,
  blastRadius: 0, blastPower: 0, electric: false,
  absorb: 0,          // 最多能吸多少水（0-255；100 = 一格水）
  sap: 0,             // 自带的含水量在这个值以内不妨碍燃烧（活植物的汁液）；超出的部分才算「打湿了」
  slide: 1,           // 侧面要有多深的落差才会滑落：1 = 松散（约 45°），2 = 更陡
  wind: 0,            // 受风影响的程度
  rigid: false,       // 是否参与结构支撑
  bond: 1,            // 连接强度系数（越小越容易被冲击震松）
  fracture: Infinity, // 刚体撞击速度超过它就碎裂
  note: '',
};

const MATERIALS = [];
function defMat(id, key, name, props) {
  MATERIALS[id] = Object.assign({ id, key, name }, MAT_DEFAULTS, props);
}

defMat(EMPTY, 'EMPTY', '空气', { state: S_EMPTY, cat: 'none', density: 1.2, conductivity: 0.08, heatCapacity: 1,
  relax: 0.03, hardness: 0, palette: ['#0a0a0f'] });

// ---- 粉末 ----
defMat(SAND, 'SAND', '沙', { state: S_POWDER, cat: 'powder', density: 1600, hardness: 0.10, absorb: 120,
  meltTemp: 1450, meltInto: GLASS,
  palette: ['#c8a85a', '#d4b56a', '#bd9c50', '#cfae5e'], note: '打湿后颜色变深、会结块；高温熔成玻璃' });
defMat(SOIL, 'SOIL', '土', { state: S_POWDER, cat: 'powder', density: 1400, conductivity: 0.12, heatCapacity: 1.6,
  hardness: 0.12, absorb: 150, slide: 3,
  palette: ['#5b4030', '#664a36', '#50382a', '#6f5240'], note: '比沙堆得陡；吸水保墒，植物靠它扎根' });
defMat(SALT, 'SALT', '盐', { state: S_POWDER, cat: 'powder', density: 2100, conductivity: 0.2, hardness: 0.15,
  palette: ['#e8e8ee', '#d8dbe6', '#f4f4f8'], note: '溶于水成盐水，能融冰' });
defMat(GUNPOWDER, 'GUNPOWDER', '火药', { state: S_POWDER, cat: 'powder', density: 1700, hardness: 0.08, absorb: 60,
  flammability: 1, ignitionTemp: 170, burnTime: 2, burnInto: SMOKE, blastRadius: 4, blastPower: 0.6,
  palette: ['#3a3a40', '#2e2e34', '#45454c'], note: '遇火瞬间燃爆并连锁；受潮就点不着' });
defMat(ASH, 'ASH', '灰', { state: S_POWDER, cat: 'powder', density: 500, conductivity: 0.05, hardness: 0.02,
  absorb: 100, wind: 0.6,
  palette: ['#8a8a8e', '#77777c', '#9a9a9e'], note: '燃烧的最终产物；会被风吹走，受潮后慢慢变成土' });
defMat(SEED, 'SEED', '种子', { state: S_POWDER, cat: 'powder', density: 1150, hardness: 0.05, absorb: 40, wind: 0.3,
  flammability: 0.5, ignitionTemp: 250, burnTime: 20, burnTemp: 600, flame: 0.1, burnInto: ASH, residue: 0.5,
  palette: ['#b89a4a', '#9c8038', '#c8ab5c'], note: '要有湿土、阳光和空间才发芽；基因决定株高和分叉' });
defMat(DEADPLANT, 'DEADPLANT', '枯枝', { state: S_POWDER, cat: 'powder', density: 300, hardness: 0.04, absorb: 80,
  slide: 2, wind: 0.2,
  flammability: 0.95, ignitionTemp: 170, burnTime: 28, burnTemp: 720, flame: 0.3, burnInto: ASH, residue: 0.4,
  palette: ['#7a6238', '#6b5630', '#8a7044'], note: '植物枯死后的残骸，比活的易燃得多；受潮会腐烂成土' });
defMat(SNOW, 'SNOW', '雪', { state: S_POWDER, cat: 'powder', density: 200, conductivity: 0.1, heatCapacity: 2, relax: 0,
  hardness: 0.02, slide: 2, wind: 0.7, meltTemp: 0.5, meltInto: WATER, latent: 300, latentRate: 60, spawnTemp: -3,
  palette: ['#f2f6ff', '#e4ecfa', '#ffffff'], note: '气温低于 0°C 时云里下的是雪；会堆积，遇热融化' });

// ---- 液体（密度：熔岩 > 酸 > 盐水 > 水 > 油；粘度：熔岩 >> 油 > 酸 > 水）----
defMat(WATER, 'WATER', '水', { state: S_LIQUID, cat: 'liquid', density: 1000, dispersion: 5,
  conductivity: 0.6, heatCapacity: 4, relax: 0, hardness: 0.03, alpha: 0.82, electric: true,
  boilTemp: 100, boilInto: STEAM, freezeTemp: 0, freezeInto: ICE, freezeLatent: 1500,
  palette: ['#3a7bd5', '#3574cc', '#4082da'], note: '比热大：能把燃烧的东西降到燃点以下；会被土、沙、木头吸收，会蒸发' });
defMat(SALTWATER, 'SALTWATER', '盐水', { state: S_LIQUID, cat: 'liquid', density: 1100, dispersion: 5,
  conductivity: 0.6, heatCapacity: 4, relax: 0, hardness: 0.03, alpha: 0.85, electric: true,
  boilTemp: 104, boilInto: STEAM, freezeTemp: -18, freezeInto: ICE, freezeLatent: 1500,
  palette: ['#3f9aa8', '#3a90a0', '#46a3b0'], note: '比水重，冰点更低，导电' });
defMat(OIL, 'OIL', '油', { state: S_LIQUID, cat: 'liquid', density: 850, viscosity: 0.45, dispersion: 3,
  heatCapacity: 2, hardness: 0.03, alpha: 0.92,
  flammability: 0.9, ignitionTemp: 220, burnTime: 70, burnTemp: 950, flame: 0.45, burnInto: SMOKE, residue: 0.3,
  palette: ['#4a3518', '#55401e', '#3e2c12'], note: '浮在水上，易燃；油火泼水不会灭，反而被汽化的水崩开' });
defMat(ACID, 'ACID', '酸液', { state: S_LIQUID, cat: 'liquid', density: 1500, viscosity: 0.15, dispersion: 3,
  conductivity: 0.4, heatCapacity: 3, hardness: 0.03, emissive: 0.35, alpha: 0.9,
  palette: ['#a050ff', '#7be04a', '#8f6cf0'], note: '溶解大多数东西，每次溶解自身有一半概率被消耗；玻璃和金属除外' });
defMat(LAVA, 'LAVA', '熔岩', { state: S_LIQUID, cat: 'liquid', density: 2800, viscosity: 0.8, dispersion: 1,
  conductivity: 0.05, heatCapacity: 4, relax: 0.0003, hardness: 0.05, emissive: 1,
  freezeTemp: 850, freezeInto: STONE, spawnTemp: 1500,
  palette: ['#ff4500', '#ff6a10', '#e03800', '#ffb030'], note: '遇水先在表面结出硬壳，里面还是液态；冷却到 850°C 以下凝成石头' });

// ---- 固体 ----
defMat(STONE, 'STONE', '石头', { cat: 'solid', density: 2600, conductivity: 0.2, heatCapacity: 2, hardness: 0.75,
  rigid: true, bond: 0.9, fracture: 2.2, meltTemp: 1250, meltInto: LAVA,
  palette: ['#828287', '#77777c', '#8c8c92', '#6e6e74'], note: '1250°C 熔成熔岩，能挡住爆炸；失去支撑会塌，摔得重会裂' });
defMat(WOOD, 'WOOD', '木头', { cat: 'solid', density: 700, conductivity: 0.1, heatCapacity: 1.6, hardness: 0.35,
  rigid: true, bond: 0.8, fracture: 4, absorb: 100,
  flammability: 0.5, ignitionTemp: 300, burnTime: 160, burnTemp: 800, flame: 0.12, burnInto: CHARCOAL,
  palette: ['#8b5e3c', '#7a5133', '#996a45', '#6e4a2e'], note: '烧成炭再成灰；湿木头要先烘干才点得着；能浮在水上' });
defMat(METAL, 'METAL', '金属', { cat: 'solid', density: 7800, conductivity: 1, heatCapacity: 1.2, hardness: 0.97,
  rigid: true, bond: 1, electric: true,
  palette: ['#9090a0', '#868696', '#9a9aaa'], note: '导热快、导电；烧到 900°C 以上会软化，撑不住东西' });
defMat(STEEL, 'STEEL', '钢梁', { cat: 'solid', density: 7800, conductivity: 0.9, heatCapacity: 1.2, hardness: 0.98,
  rigid: true, bond: 1, electric: true,
  palette: ['#5c6672', '#525c68', '#66707c'], note: '连接极强，适合搭框架；炸不断，但 900°C 以上会软化' });
defMat(BRICK, 'BRICK', '砖', { cat: 'solid', density: 1900, conductivity: 0.15, heatCapacity: 1.8, hardness: 0.6,
  rigid: true, bond: 0.6, fracture: 1.3,
  palette: ['#a44a35', '#96422f', '#b0533c', '#8a3c2b'], note: '砌墙用；连接比石头弱，倒下来容易摔碎' });
defMat(CONCRETE, 'CONCRETE', '混凝土', { cat: 'solid', density: 2400, conductivity: 0.2, heatCapacity: 2, hardness: 0.82,
  rigid: true, bond: 0.7, fracture: 1.5,
  palette: ['#9a9c9e', '#8e9092', '#a6a8aa'], note: '比石头硬但脆：抗炸，一摔就裂' });
defMat(GLASS, 'GLASS', '玻璃', { cat: 'solid', density: 2500, conductivity: 0.12, hardness: 0.3, alpha: 0.3,
  rigid: true, bond: 0.5, fracture: 0.6,
  palette: ['#bfe6f2', '#d0eef7', '#a8d8e8'], note: '耐酸，透明；一撞就碎' });
defMat(ICE, 'ICE', '冰', { cat: 'solid', density: 917, conductivity: 0.25, heatCapacity: 2.5, relax: 0, hardness: 0.3,
  rigid: true, bond: 0.5, fracture: 1.2, meltTemp: 0, meltInto: WATER, latent: 1500, spawnTemp: -30,
  palette: ['#a0c4ff', '#b4d2ff', '#8eb6f5'], note: '融化要吸够潜热，过程中持续给周围降温；浮在水上' });
defMat(ROPE, 'ROPE', '绳子', { cat: 'solid', density: 300, hardness: 0.08, rigid: true, bond: 0.5, absorb: 50,
  flammability: 0.8, ignitionTemp: 200, burnTime: 22, burnTemp: 650, flame: 0.15, burnInto: ASH, residue: 0.1,
  palette: ['#c9a66b', '#b89455', '#d8b87c'], note: '只能受拉：能吊住下面的东西，不能从下面撑住东西；火能烧断' });
defMat(ANCHOR, 'ANCHOR', '锚点', { cat: 'solid', density: 9000, hardness: 2, rigid: true,
  palette: ['#3fd0c9', '#2bb8b2', '#55e0d8'], note: '固定不动的支点；连着它的固体不会塌' });
defMat(PLANT, 'PLANT', '植物', { cat: 'solid', density: 600, hardness: 0.1, absorb: 100, sap: 60,
  flammability: 0.7, ignitionTemp: 230, burnTime: 35, burnTemp: 700, flame: 0.25, burnInto: ASH, residue: 0.35,
  palette: ['#3cb450', '#2f9a42', '#4cc862', '#267a35'], note: '生长要耗水、要阳光、要空间；有株高上限和寿命，老了会枯' });
defMat(FLOWER, 'FLOWER', '花', { cat: 'solid', density: 500, hardness: 0.05,
  flammability: 0.8, ignitionTemp: 220, burnTime: 20, burnTemp: 650, flame: 0.2, burnInto: ASH, residue: 0.2,
  palette: ['#ff6fa8', '#ffd23f', '#b06cff', '#ff5a4a', '#f4f4ff'], note: '开一阵子就谢，落下种子' });
defMat(CHARCOAL, 'CHARCOAL', '炭', { cat: 'solid', density: 800, conductivity: 0.12, hardness: 0.25,
  rigid: true, bond: 0.3, fracture: 1.0, absorb: 50,
  flammability: 0.4, ignitionTemp: 380, burnTime: 320, burnTemp: 620, flame: 0.015, burnInto: ASH, residue: 0.7,
  palette: ['#26221f', '#1e1b19', '#302b27'], note: '有空气才阴燃发光，最后变成灰；很脆' });
defMat(TNT, 'TNT', 'TNT', { cat: 'solid', density: 1600, hardness: 0.2, rigid: true, bond: 0.4,
  flammability: 1, ignitionTemp: 240, burnTime: 60, burnInto: EMPTY, blastRadius: 15, blastPower: 1,
  palette: ['#e03030', '#c82828', '#f0e6e6'], note: '点燃后引信约 1 秒，爆炸半径 15 格；防水' });
defMat(CLONE, 'CLONE', '克隆体', { cat: 'tool', density: 9000, hardness: 2, rigid: true,
  palette: ['#c060c0', '#d070d0'], note: '非物理元素：锁定第一个碰到的材料并凭空复制，是场景的外部输入，不计入守恒' });
defMat(VOID, 'VOID', '黑洞', { cat: 'tool', density: 9000, hardness: 2, relax: 0.05, rigid: true,
  palette: ['#200030'], note: '非物理元素：把半径 5 格内的粒子吞掉，不计入守恒' });

// ---- 气体 ----
defMat(SMOKE, 'SMOKE', '烟', { state: S_GAS, cat: 'gas', density: 0.6, conductivity: 0.1, heatCapacity: 1, relax: 0.02,
  hardness: 0, life: [80, 150], wind: 1, palette: ['#505055', '#5c5c62', '#44444a'],
  note: '缺氧的火冒黑烟，烧得充分烟就淡，湿东西烧起来冒白烟' });
defMat(STEAM, 'STEAM', '蒸汽', { state: S_GAS, cat: 'gas', density: 0.5, conductivity: 0.02, heatCapacity: 1, relax: 0.002,
  hardness: 0, spawnTemp: 160, freezeTemp: 85, freezeInto: EMPTY, wind: 1,
  palette: ['#b4c3d7', '#c4d0e0'], note: '冷下来变成看不见的水汽升到高空成云；碰到冷的表面直接凝成水珠' });
defMat(FOAM, 'FOAM', '泡沫', { state: S_GAS, cat: 'gas', density: 0.9, conductivity: 0.05, heatCapacity: 1, relax: 0.02,
  hardness: 0, life: [50, 140], palette: ['#f4f8ff', '#e6eefc'], note: '水砸进水里搅出来的，浮在水面，慢慢消散' });

// ---- 能量 ----
defMat(FIRE, 'FIRE', '火', { state: S_GAS, cat: 'energy', density: 0.3, conductivity: 0.5, heatCapacity: 1, relax: 0,
  hardness: 0, emissive: 1, spawnTemp: 900, life: [18, 40], decayInto: SMOKE, decayChance: 0.12, wind: 1,
  palette: ['#ff6414', '#ffb030', '#ff3b0a'], note: '只是短命的火焰气体；没有燃料在烧就几十帧内消失，碰到水就灭' });
defMat(EMBER, 'EMBER', '余烬', { state: S_GAS, cat: 'energy', density: 0.4, conductivity: 0.3, heatCapacity: 1, relax: 0,
  hardness: 0, emissive: 0.9, spawnTemp: 650, life: [30, 70], decayInto: SMOKE, decayChance: 0.2, wind: 0.8,
  palette: ['#ffb41e', '#ff8a10'] });
defMat(SPARK, 'SPARK', '电火花', { state: S_ENERGY, cat: 'energy', density: 0.1, conductivity: 0.05, heatCapacity: 1,
  relax: 0.05, hardness: 0, emissive: 1, life: [7, 11],
  palette: ['#bfe8ff', '#ffffff', '#7fc8ff'], note: '沿金属和水传导（在水里约 40 格就衰减完），点燃火药、油、TNT' });

// ---- 由材料表生成的并行数组（热循环只读这些）----
const M_STATE = new Uint8Array(NT), M_DENS = new Float32Array(NT), M_VISC = new Float32Array(NT),
      M_DISP = new Uint8Array(NT), M_FLAM = new Float32Array(NT), M_IGN = new Float32Array(NT),
      M_BURNINTO = new Uint8Array(NT), M_BURNTIME = new Uint16Array(NT), M_BURNTEMP = new Float32Array(NT),
      M_FLAME = new Float32Array(NT), M_RESIDUE = new Float32Array(NT),
      M_MELT = new Float32Array(NT), M_MELTINTO = new Uint8Array(NT), M_LATENT = new Uint16Array(NT), M_LATK = new Float32Array(NT),
      M_BOIL = new Float32Array(NT), M_BOILINTO = new Uint8Array(NT),
      M_FREEZE = new Float32Array(NT), M_FREEZEINTO = new Uint8Array(NT), M_FLATENT = new Uint16Array(NT),
      M_IHC = new Float32Array(NT), M_RELAX = new Float32Array(NT), M_HARD = new Float32Array(NT),
      M_SPAWN = new Float32Array(NT), M_LIFE0 = new Uint16Array(NT), M_LIFE1 = new Uint16Array(NT),
      M_DECAY = new Uint8Array(NT), M_DECAYP = new Float32Array(NT),
      M_BLAST = new Uint8Array(NT), M_BPOW = new Float32Array(NT), M_ELEC = new Uint8Array(NT),
      M_ABSORB = new Uint8Array(NT), M_SAP = new Uint8Array(NT), M_SLIDE = new Uint8Array(NT), M_WIND = new Float32Array(NT),
      M_RIGID = new Uint8Array(NT), M_BOND = new Float32Array(NT), M_FRAC = new Float32Array(NT);
const AIRLIKE = new Uint8Array(NT);          // 空气，以及占着空气位置的火焰 / 烟 / 余烬：它们的 aux 都是「这格空气的浑浊度」
AIRLIKE[EMPTY] = AIRLIKE[FIRE] = AIRLIKE[SMOKE] = AIRLIKE[EMBER] = 1;
const KTAB = new Float32Array(NT * NT);     // 两种材料之间的导热系数
const SINKP = new Float32Array(NT * NT);    // [a*NT+b]：a 每帧沉进液体 b 的概率（看密度差和粘度）

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

(function buildMaterialArrays() {
  for (let t = 0; t < NT; t++) {
    const m = MATERIALS[t];
    M_STATE[t] = m.state; M_DENS[t] = m.density; M_VISC[t] = m.viscosity; M_DISP[t] = m.dispersion;
    M_FLAM[t] = m.flammability; M_IGN[t] = m.ignitionTemp; M_BURNINTO[t] = m.burnInto;
    M_BURNTIME[t] = m.burnTime; M_BURNTEMP[t] = m.burnTemp; M_FLAME[t] = m.flame; M_RESIDUE[t] = m.residue;
    M_MELT[t] = m.meltTemp; M_MELTINTO[t] = m.meltInto; M_LATENT[t] = m.latent; M_LATK[t] = m.latentRate;
    M_BOIL[t] = m.boilTemp; M_BOILINTO[t] = m.boilInto;
    M_FREEZE[t] = m.freezeTemp; M_FREEZEINTO[t] = m.freezeInto; M_FLATENT[t] = m.freezeLatent;
    M_IHC[t] = 1 / m.heatCapacity; M_RELAX[t] = m.relax; M_HARD[t] = m.hardness;
    M_SPAWN[t] = m.spawnTemp;
    if (m.life) { M_LIFE0[t] = m.life[0]; M_LIFE1[t] = m.life[1]; }
    M_DECAY[t] = m.decayInto; M_DECAYP[t] = m.decayChance;
    M_BLAST[t] = m.blastRadius; M_BPOW[t] = m.blastPower; M_ELEC[t] = m.electric ? 1 : 0;
    M_ABSORB[t] = m.absorb; M_SAP[t] = m.sap; M_SLIDE[t] = m.slide; M_WIND[t] = m.wind;
    M_RIGID[t] = m.rigid ? 1 : 0; M_BOND[t] = m.bond; M_FRAC[t] = m.fracture;
    m.rgb = m.palette.map(hexToRgb);
  }
  for (let a = 0; a < NT; a++) for (let b = 0; b < NT; b++) {
    KTAB[a * NT + b] = 0.2 * Math.min(MATERIALS[a].conductivity, MATERIALS[b].conductivity);
    const da = MATERIALS[a].density, db = MATERIALS[b].density;
    // 沉降：密度差越大越快，液体越粘越慢（沙在水里 ≈ 0.34，在油里更慢，在熔岩里浮着）
    SINKP[a * NT + b] = MATERIALS[b].state === S_LIQUID && da > db
      ? Math.min(0.9, (da - db) / da * 0.9 + 0.02) * (1 - MATERIALS[b].viscosity) * (1 - MATERIALS[b].viscosity) : 0;
  }
})();

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
const ACID_SOLUBLE = [SAND, SOIL, SALT, GUNPOWDER, ASH, SEED, WOOD, PLANT, FLOWER, CHARCOAL, ICE, TNT, ROPE, DEADPLANT];

// { a, b, p, a2, b2, use(主动方被消耗概率), maxT(主动方温度上限), aT/bT(产物温度), aDT/bDT(温度变化), tag }
const RULES = [
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

const RX = new Array(NT * NT).fill(null);
const HASRX = new Uint8Array(NT);
for (const r of RULES) { RX[r.a * NT + r.b] = r; HASRX[r.a] = 1; }

/* ---------------------------------------------------------------------
 * 1.4 环境（天气、昼夜）与全局统计
 * ------------------------------------------------------------------- */
const DAY_STEPS = 36000;   // 时间流速 1x 时，一昼夜 = 10 分钟模拟时间
const env = {
  structure: true,         // 结构力学开关
  plantAging: 1,           // 植物、花、种子的衰老速度倍数（1 = 正常）
  dayNight: true,          // 关掉后恒为正午、气温恒为 env.temp（自测用）
  time: 0.8,               // 0 = 午夜，0.25 = 日出，0.5 = 正午，0.75 = 日落
  timeScale: 1,            // 0 / 1 / 10 / 60
  wind: 0.2,               // 风向与相对强度：-1（向左）.. 1（向右）
  windPower: 0.3,          // 风力 0..1
  moistPerMin: 0,          // 天气预设每分钟最多注入多少格水汽（外部输入）
  atmosCap: 0,             // 每个粗格列的大气含水容量，大气里的水汽 + 云到了这个量就停止注入
  atmos: 0,                // 当前大气里的水汽 + 云（每 4 步更新一次）
  cloudFade: 0,            // 晴天时云的消散速率（外部输出）
  temp: AMBIENT,           // 全局气温
  weather: 'clear', storm: 0,
  sun: 1, el: 1, ambient: AMBIENT,
  // 水量账本（单位：格水）
  waterIn: 0, waterOut: 0, waterSink: 0,
  rainCount: 0, snowCount: 0, strikes: 0, charge: 0,
};
// 水量收支明细（单位：格水），只用来诊断，不参与模拟
const LEDGER_KEYS = ['weatherIn', 'cloneIn', 'precip', 'voidOut', 'evapSurface', 'evapWet', 'steamToVapor', 'transpire', 'plantUse', 'seep', 'decayOut', 'sublimate', 'cloudFade', 'condense', 'cloudEvap', 'wallCondense'];
const WL = {};
function ledgerReset() { for (const k of LEDGER_KEYS) WL[k] = 0; }
ledgerReset();

/* ---------------------------------------------------------------------
 * 1.5 网格与分块
 * ------------------------------------------------------------------- */
const F_PAR = 1, F_BURN = 2, F_SCORCH = 4, F_TIP = 8, F_BODY = 16, F_PIN = 32, F_FALL = 0xC0;   // flags 位
const F_SAVE = F_BURN | F_SCORCH | F_TIP;
const STALE_MAX = 200;     // 空气浑浊度到这个值就不够支持燃烧了

let W = 0, H = 0, N = 0;
let type, seed, flags, charge, chargeE, life, temp;
let wet;                   // 含水量（非空格）
let aux;                   // 空气格：浑浊度（缺氧程度）；刚性固体：结构完整度；土：养分
let fuel;                  // 可燃格剩余燃料（帧）
let CW = 0, CHN = 0, chunkTTL, chunkCount;
let parity = 0, tick = 0;
let gravity = 'down', gx = 0, gy = 1, lx = 1, ly = 0;
let sceneDirty = true;     // 渲染端需要整张重传
let structDirty = true;    // 有待处理的支撑检测（脏格列表见 2s）

function allocGrid(w, h) {
  W = w; H = h; N = w * h;
  type = new Uint8Array(N); seed = new Uint8Array(N); flags = new Uint8Array(N);
  charge = new Uint8Array(N); chargeE = new Uint8Array(N);
  wet = new Uint8Array(N); aux = new Uint8Array(N); fuel = new Uint16Array(N);
  life = new Uint16Array(N); temp = new Float32Array(N).fill(env.temp);
  CW = Math.ceil(w / CHUNK); CHN = Math.ceil(h / CHUNK);
  chunkTTL = new Uint8Array(CW * CHN); chunkCount = new Uint16Array(CW * CHN);
  elecCount = 0; fpClear(); exClear(); bodiesClear(); allocStruct(); allocWeather();
  wakeAll();
}

function clearGrid() {
  type.fill(0); seed.fill(0); flags.fill(0); charge.fill(0); chargeE.fill(0); life.fill(0); temp.fill(env.temp);
  wet.fill(0); aux.fill(0); fuel.fill(0);
  elecCount = 0; fpClear(); exClear(); bodiesClear(); clearWeather();
  env.waterIn = env.waterOut = env.waterSink = 0; env.rainCount = env.snowCount = env.strikes = 0; env.charge = 0;
  ledgerReset();
  ripples.fill(0); rippleHead = 0; lastBolt = null;      // 渲染用的涟漪和闪电记录也清掉
  markStructAll();
  wakeAll();
}

function wakeAll() { chunkTTL.fill(WAKE_TTL); sceneDirty = true; }

function inb(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }

function wake(x, y) {
  const cx = x >> 5, cy = y >> 5, c = cx + cy * CW, ax = x & 31, ay = y & 31;
  chunkTTL[c] = WAKE_TTL;
  if (ax === 0) { if (cx > 0) chunkTTL[c - 1] = WAKE_TTL; }
  else if (ax === 31) { if (cx < CW - 1) chunkTTL[c + 1] = WAKE_TTL; }
  if (ay === 0) { if (cy > 0) chunkTTL[c - CW] = WAKE_TTL; }
  else if (ay === 31) { if (cy < CHN - 1) chunkTTL[c + CW] = WAKE_TTL; }
}

function initLife(t) {
  const a = M_LIFE0[t];
  return a ? a + rndi(M_LIFE1[t] - a + 1) : 0;
}

// 燃料量：爆炸物的 burnTime 是引信（放在 life 里），其余可燃物是能烧多少帧
function initFuel(t) {
  const bt = M_BURNTIME[t];
  return bt && !M_BLAST[t] ? Math.max(1, (bt * (0.7 + rnd() * 0.6)) | 0) : 0;
}

// 新生成一个粒子（笔刷、克隆、喷发等）
function put(i, t, x, y) {
  const old = type[i];
  type[i] = t; seed[i] = rndi(256); temp[i] = M_SPAWN[t];
  life[i] = t === PLANT ? rndi(150) : initLife(t);      // 植物的 life 是年龄：起始年龄随机，免得整片同时老死
  flags[i] = parity | (t === SPARK ? F_TIP : 0); charge[i] = 0;
  wet[i] = t === PLANT ? 60 : 0; fuel[i] = initFuel(t);
  aux[i] = M_RIGID[t] ? 255 : t === SOIL ? 200 : (AIRLIKE[t] && AIRLIKE[old]) ? aux[i] : 0;   // 火焰和烟继承所在空气格的浑浊度
  if (M_RIGID[t] | M_RIGID[old]) markStructAround(i);
  wake(x, y);
}

// 清成空气，保留该格温度
function clearCell(i, x, y) {
  const old = type[i];
  type[i] = 0; life[i] = 0; flags[i] = parity; charge[i] = 0; wet[i] = 0; fuel[i] = 0;
  if (!AIRLIKE[old]) aux[i] = 0;                     // 火焰 / 烟消失后，这格空气的浑浊度留着
  if (M_RIGID[old]) markStructAround(i);
  wake(x, y);
}

// 原地变成另一种材料，保留 seed、温度和含水量
function morph(i, t, x, y) {
  if (t === EMPTY) { clearCell(i, x, y); return; }
  const o = type[i];
  type[i] = t; life[i] = initLife(t); flags[i] = (flags[i] & F_SCORCH) | parity;
  fuel[i] = initFuel(t);
  aux[i] = M_RIGID[t] ? (M_RIGID[o] ? aux[i] >> 1 : 255) : t === SOIL ? 255 : (AIRLIKE[t] && AIRLIKE[o]) ? aux[i] : 0;
  if (wet[i] > M_ABSORB[t]) wet[i] = M_ABSORB[t];
  if (M_RIGID[t] | M_RIGID[o]) markStructAround(i);
  wake(x, y);
}

function swapCells(i, j, x, y, nx, ny) {
  let a = type[i]; type[i] = type[j]; type[j] = a;
  a = seed[i]; seed[i] = seed[j]; seed[j] = a;
  a = life[i]; life[i] = life[j]; life[j] = a;
  a = wet[i]; wet[i] = wet[j]; wet[j] = a;
  a = aux[i]; aux[i] = aux[j]; aux[j] = a;
  a = fuel[i]; fuel[i] = fuel[j]; fuel[j] = a;
  const fi = flags[i], fj = flags[j];
  flags[i] = (fj & ~F_PAR) | parity; flags[j] = (fi & ~F_PAR) | parity;
  const tf = temp[i]; temp[i] = temp[j]; temp[j] = tf;
  wake(x, y); wake(nx, ny);
}

function setGravity(dir) {
  gravity = dir;
  if (dir === 'down') { gx = 0; gy = 1; lx = 1; ly = 0; }
  else if (dir === 'up') { gx = 0; gy = -1; lx = 1; ly = 0; }
  else if (dir === 'left') { gx = -1; gy = 0; lx = 0; ly = 1; }
  else { gx = 1; gy = 0; lx = 0; ly = 1; }
  if (sdList.length === N && N > 0) markStructAll();
  if (chunkTTL) wakeAll();
}

// 每步统计，供音效和调试面板使用
const st = { powder: 0, liquid: 0, fire: 0, hiss: 0, elec: 0, boom: 0, boil: 0, rain: 0, crash: 0 };
// 模拟 → 表现层的回调（爆炸闪光、震动、音效）
let onBoom = null, onThunder = null, onCrash = null;

// 涟漪事件（只给渲染用）：最近 8 次有东西砸进液面的位置
const ripples = new Float32Array(8 * 3);
let rippleHead = 0;
function addRipple(x, y) {
  const o = rippleHead * 3;
  ripples[o] = x; ripples[o + 1] = y; ripples[o + 2] = tick;
  rippleHead = (rippleHead + 1) & 7;
}
