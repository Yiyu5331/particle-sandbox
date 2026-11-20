import { generateMap, mapgenBiomes, mapgenPresets } from '../../src/gen/index.js';

// 顺序固定。覆盖所有群系×预设、奇数尺寸、性能目标尺寸、符号边界和不同起伏。
export function mapgenFixtureText() {
  const rows=[], seeds=[0,1,-2147483648,4294967295,0x12345678,-7,1024,65537];
  for (const [i,biome] of Object.keys(mapgenBiomes).entries()) {
    for (const [j,preset] of Object.keys(mapgenPresets).entries()) {
      const [width,height]=[[97,65],[160,96],[422,246]][j];
      rows.push(JSON.stringify(generateMap(seeds[(i+j)%8],{width,height,biome,preset,relief:[0,.731,1][(i+j)%3]})));
    }
  }
  return rows.join('\n');
}
export function mapgenTextChecksum(text) {
  let hash=2166136261;
  for (let i=0;i<text.length;i++) hash=Math.imul(hash^text.charCodeAt(i),16777619);
  return (hash>>>0).toString(16).padStart(8,'0');
}
export const mapgenExpectedSHA = 'adb8c2600476322e846adbecac489d4bcba4f6d5a073eb1e52910aa681134a44';
export const mapgenExpectedChecksum = 'a5290825';

export function mapgenFixtureWorld(factory) {
  const map=generateMap(-17,{width:127,height:73,preset:'defense',biome:'archipelago',relief:.83});
  const w=factory(map.meta);
  try {
    for (const cmd of map.commands) w.exec(cmd);
    const initial=w.hash(); w.step(300);
    return [initial,w.hash()].join('/');
  } finally { w.dispose(); }
}
export const mapgenExpectedWorld = '357370552eab973c/67dbb2657c564f86';
