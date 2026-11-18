'use strict';
export const AMBIENT = 20;        // 默认气温 °C（实际环境温度见 env.ambient）

/* ---------------------------------------------------------------------
 * 1.2 材料表（声明式；所有通用行为都从这张表读）
 * ------------------------------------------------------------------- */
export const S_EMPTY = 0, S_SOLID = 1, S_POWDER = 2, S_LIQUID = 3, S_GAS = 4, S_ENERGY = 5;
export const STATE_NAMES = ['空', '固体', '粉末', '液体', '气体', '能量'];

export const EMPTY = 0, SAND = 1, WATER = 2, FIRE = 3, WOOD = 4, STONE = 5, LAVA = 6, PLANT = 7,
      ICE = 8, ACID = 9, SMOKE = 10, STEAM = 11, EMBER = 12, TNT = 13, METAL = 14, CLONE = 15,
      VOID = 16, OIL = 17, GUNPOWDER = 18, GLASS = 19, ASH = 20, CHARCOAL = 21, SALT = 22,
      SALTWATER = 23, SPARK = 24, SEED = 25, FLOWER = 26, SOIL = 27,
      BRICK = 28, CONCRETE = 29, STEEL = 30, ANCHOR = 31, ROPE = 32, DEADPLANT = 33, FOAM = 34, SNOW = 35;
export const NT = 36;
// 工具（不是材料）
export const TOOL_ERASE = 100, TOOL_HEAT = 101, TOOL_COOL = 102, TOOL_LIGHTNING = 103;

export const MAT_DEFAULTS = {
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

export const MATERIALS = [];
export function defMat(id, key, name, props) {
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
export const M_STATE = new Uint8Array(NT), M_DENS = new Float32Array(NT), M_VISC = new Float32Array(NT),
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
export const AIRLIKE = new Uint8Array(NT);          // 空气，以及占着空气位置的火焰 / 烟 / 余烬：它们的 aux 都是「这格空气的浑浊度」
AIRLIKE[EMPTY] = AIRLIKE[FIRE] = AIRLIKE[SMOKE] = AIRLIKE[EMBER] = 1;
export const KTAB = new Float32Array(NT * NT);     // 两种材料之间的导热系数
export const SINKP = new Float32Array(NT * NT);    // [a*NT+b]：a 每帧沉进液体 b 的概率（看密度差和粘度）

export function hexToRgb(h) {
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
