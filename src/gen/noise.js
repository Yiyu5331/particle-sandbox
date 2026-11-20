// 整数晶格上的 value noise。Q8 平滑权重 t²(3−2t)，所有乘积都在精确整数范围内。
export function mapgenHash32(seed, x, y = 0) {
  let v = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d);
  v = Math.imul(v ^ (v >>> 15), 0x846ca68b);
  return (v ^ (v >>> 16)) >>> 0;
}
export function mapgenRandom(seed) {
  let state = seed >>> 0 || 0x6d2b79f5;
  return n => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % n;
  };
}
export function mapgenNoise(seed, x, period, channel) {
  const cell = Math.floor(x / period);
  const t = Math.floor((x - cell * period) * 256 / period);
  const smooth = Math.floor(t * t * (768 - 2 * t) / 65536);
  const a = (mapgenHash32(seed, cell, channel) & 511) - 256;
  const b = (mapgenHash32(seed, cell + 1, channel) & 511) - 256;
  return a + Math.floor((b - a) * smooth / 256);
}
