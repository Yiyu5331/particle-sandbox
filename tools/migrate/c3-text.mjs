// 默认只检查并列出将变更的关卡。C3 合并后用 --write 写入。
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { puzzleValidateLevel } from '../../src/modes/puzzle/format.js';
import { puzzleLevelDirectory, readPuzzleJson } from '../puzzle-catalog.mjs';

function c3Localized(pair) {
  if (!Array.isArray(pair) || pair.length !== 2 || pair.some(s=>typeof s !== 'string' || !s.trim())) {
    throw new Error('需要一对中文和英文文本');
  }
  return {'zh-CN':pair[0],en:pair[1]};
}

export function c3LevelWithText(level, {chapter,name,desc,hints}) {
  if (!Array.isArray(hints) || hints.length !== 3) throw new Error('需要三级提示');
  return puzzleValidateLevel({...level,chapterI18n:c3Localized(chapter),nameI18n:c3Localized(name),
    desc:c3Localized(desc),hints:hints.map(c3Localized)});
}

export function migrateC3Text(dir, {write = false} = {}) {
  const meta = readPuzzleJson(join(dir,'meta.json'));
  if (meta?.version !== 1 || !Array.isArray(meta.order) || !meta.levels || typeof meta.levels !== 'object' ||
    !meta.order.length || new Set(meta.order).size !== meta.order.length || Object.keys(meta.levels).length !== meta.order.length) {
    throw new Error('C3 元数据的版本、关卡或顺序无效');
  }
  const updates = [];
  for (const id of meta.order) {
    if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) || !Object.hasOwn(meta.levels,id)) {
      throw new Error('C3 元数据包含无效关卡标识：'+id);
    }
    try {
      const path = join(dir,id+'.json');
      const current = readPuzzleJson(path);
      if (current.id !== id) throw new Error('文件中的关卡标识不匹配');
      const next = c3LevelWithText(current,meta.levels[id]);
      if (JSON.stringify(current) !== JSON.stringify(next)) updates.push({id,path,content:JSON.stringify(next,null,2)+'\n'});
    } catch (error) {
      throw new Error(id+'：'+error.message,{cause:error});
    }
  }
  if (write && updates.length) {
    const staging = mkdtempSync(join(dir,'.c3-text-'));
    try {
      updates.forEach(({content},i)=>writeFileSync(join(staging,String(i)),content));
      updates.forEach(({path},i)=>renameSync(join(staging,String(i)),path));
    } finally {
      rmSync(staging,{recursive:true,force:true});
    }
  }
  return updates.map(({id})=>id);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), write = args.includes('--write'), dirs = args.filter(a=>a !== '--write');
  if (dirs.length > 1 || dirs[0]?.startsWith('-')) {
    console.error('用法：node tools/migrate/c3-text.mjs [关卡目录] [--write]');
    process.exitCode = 2;
  } else {
    try {
      const updates = migrateC3Text(dirs[0] ?? join(puzzleLevelDirectory,'c3'),{write});
      console.log(updates.length ? (write ? '已更新 ' : '将更新 ')+updates.length+' 关：'+updates.join(', ') : '无需更新');
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
