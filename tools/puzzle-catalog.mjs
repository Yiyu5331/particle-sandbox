import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const puzzleLevelDirectory = fileURLToPath(new URL('../src/modes/puzzle/levels/', import.meta.url));
export const readPuzzleJson = path => JSON.parse(readFileSync(path,'utf8'));

export function discoverPuzzleLevels(root = puzzleLevelDirectory) {
  const seen = new Set();
  function visit(dir) {
    const entries = readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name < b.name ? -1 : Number(a.name > b.name));
    const levels = new Map();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || ['order.json','meta.json'].includes(entry.name)) continue;
      const path = join(dir,entry.name), level = readPuzzleJson(path);
      if (typeof level?.id !== 'string') throw new Error('关卡缺少 id：'+path);
      if (seen.has(level.id)) throw new Error('关卡 id 重复：'+level.id);
      seen.add(level.id);
      levels.set(level.id,{path,level});
    }
    const manifest = join(dir,'order.json'), meta = join(dir,'meta.json');
    const order = existsSync(manifest) ? readPuzzleJson(manifest) : existsSync(meta) ? readPuzzleJson(meta).order ?? [] : [];
    if (!Array.isArray(order)) throw new Error('关卡目录顺序应为数组：'+dir);
    const sorted = order.map(id=>{
      if (!levels.has(id)) throw new Error('关卡目录包含重复或未知 id：'+id);
      const entry = levels.get(id);
      levels.delete(id);
      return entry;
    });
    sorted.push(...levels.values());
    for (const entry of entries) if (entry.isDirectory()) sorted.push(...visit(join(dir,entry.name)));
    return sorted;
  }
  return visit(root);
}
