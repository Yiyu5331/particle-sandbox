// C3 关卡源文件用的小工具：把常用的地形、区域、条件写短一点。
export const rect = (mat, x0, y0, x1, y1) => ({ command: 'fillRect', args: { mat, x0, y0, x1, y1 } });
export const circle = (mat, cx, cy, r) => ({ command: 'fillCircle', args: { mat, cx, cy, r } });
export const line = (tool, x0, y0, x1, y1, size = 1) => ({ command: 'stroke', args: { tool, x0, y0, x1, y1, size } });
export const env = (key, value) => ({ command: 'setEnv', args: { key, value } });
export const weather = key => ({ command: 'setWeather', args: { key } });
export const ignite = (x, y) => ({ command: 'ignite', args: { x, y } });

export const goal = (id, x, y, w, h) => ({ id, type: 'goal', x, y, w, h });
export const noBuild = (id, x, y, w, h) => ({ id, type: 'noBuild', x, y, w, h });
export const guard = (id, x, y, w, h) => ({ id, type: 'protected', x, y, w, h });

export const atLeast = (region, material, value) => ({ op: 'count', region, material, compare: '>=', value });
export const atMost = (region, material, value) => ({ op: 'count', region, material, compare: '<=', value });
export const all = (...conditions) => ({ op: 'and', conditions });
export const any = (...conditions) => ({ op: 'or', conditions });
export const not = condition => ({ op: 'not', condition });
export const within = (steps, condition) => ({ op: 'within', steps, condition });
export const survive = steps => ({ op: 'survive', steps });
export const noFire = (region, steps) => ({ op: 'noFire', region, steps });
export const cooler = (region, temperature) => ({ op: 'cooler', region, temperature });
export const intact = (region, material, percent) => ({ op: 'integrity', region, material, percent });

// 笔画：S(材料, x0, y0, x1, y1, 大小, 形状)；实时关用 at(步数, 笔画)。
export const S = (tool, x0, y0, x1 = x0, y1 = y0, size = 1, shape) => ({ tool, x0, y0, x1, y1, size, ...(shape ? { shape } : {}) });
export const at = (step, args) => ({ step, args });

// 64×40 的标准底板：最下面三行石头。
export const FLOOR = rect('STONE', 0, 37, 63, 39);
