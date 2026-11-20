import { createWorld } from '../../src/engine/index.js';
import { defBrowserTest } from './gl.js';
import { mapgenFixtureText, mapgenTextChecksum, mapgenExpectedChecksum, mapgenExpectedSHA, mapgenFixtureWorld, mapgenExpectedWorld } from '../lib/mapgen-cases.js';

defBrowserTest('地图生成：24 组完整命令、区域、元数据与 Node 逐字节一致',async()=>{
  const text=mapgenFixtureText(), world=mapgenFixtureWorld(createWorld);
  if (world!==mapgenExpectedWorld) return {ok:false,info:'初始/300 步世界哈希不同：'+world};
  if (globalThis.crypto?.subtle) {
    const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
    const sha=Array.from(new Uint8Array(raw),b=>b.toString(16).padStart(2,'0')).join('');
    return {ok:sha===mapgenExpectedSHA,info:'SHA-256 '+sha};
  }
  const sum=mapgenTextChecksum(text);
  return {ok:sum===mapgenExpectedChecksum,info:'非安全上下文，FNV-1a '+sum};
});
