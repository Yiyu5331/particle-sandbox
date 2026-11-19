// 构建：把 src/ 的 ES 模块打成一个零依赖的单文件 dist/particle-sandbox.html
//   node tools/build.mjs [--out=路径] [--no-tests]
//
// 为什么不用 esbuild：引擎模块之间大量依赖 ES 模块的「活绑定」（比如 grid.js 里 allocGrid 重新给 type 赋值，
// cells.js 读到的必须是新数组）。最省事、也最贴近原来 v4 单文件的做法，是按 ES 模块的求值顺序把各模块的顶层代码
// 拼进同一个作用域：活绑定天然成立，生成的代码就是原来的代码（便于在浏览器里调试），也不需要装任何依赖。
// 代价是所有模块的顶层名字必须全局唯一——这里会检查，重名就报错。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const OUT = path.resolve(ROOT, args.out || 'dist/particle-sandbox.html');
const ENTRY = path.join(ROOT, 'src', 'main.js');

// 1) 按 ES 模块的求值顺序（深度优先、按 import 语句出现的顺序、后序）排出模块列表
const DEP = /^(?:import\s*(?:\{[^}]*\}\s*from\s*)?|export\s*(?:\{[^}]*\}|\*)\s*from\s*)'([^']+)';?[ \t]*$/gm;
const order = [], seen = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(DEP)) visit(path.resolve(path.dirname(file), m[1]));
  order.push({ file, src });
}
visit(ENTRY);

// 2) 去掉 import / 再导出语句和 export 关键字
function strip(src) {
  return src
    .replace(/^'use strict';[ \t]*\n/, '')
    .replace(/^import\s*(?:\{[^}]*\}\s*from\s*)?'[^']+';?[ \t]*\n/gm, '')
    .replace(/^export\s*(?:\{[^}]*\}|\*)\s*from\s*'[^']+';?[ \t]*\n/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)/gm, '');
}

// 3) 顶层名字不能重复（所有模块拼在同一个作用域里）
function topNames(src) {
  const names = [];
  const lines = src.split('\n');
  let depth = 0, inTpl = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (depth === 0 && !inTpl) {
      let m = line.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/) || line.match(/^class\s+([A-Za-z_$][\w$]*)/);
      if (m) names.push(m[1]);
      else if ((m = line.match(/^(?:const|let|var)\s+/))) {
        // 读到顶层分号为止，按顶层逗号切
        let text = line.slice(m[0].length), k = li;
        while (!/;\s*(\/\/.*)?$/.test(text) && k + 1 < lines.length) text += '\n' + lines[++k];
        let d = 0, cur = '', st = null; const parts = [];
        for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (st) { if (c === '\\') { i++; continue; } if (c === st) st = null; continue; }
          if (c === "'" || c === '"' || c === '`') { st = c; continue; }
          if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--;
          if (c === ',' && d === 0) { parts.push(cur); cur = ''; continue; }
          if (c === ';' && d === 0) break;
          cur += c;
        }
        parts.push(cur);
        for (const p of parts) { const mm = p.match(/^\s*([A-Za-z_$][\w$]*)/); if (mm) names.push(mm[1]); }
      }
    }
    // 粗略地跟踪括号深度和模板字面量（着色器源码在模板字面量里）
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inTpl) { if (c === '\\') i++; else if (c === '`') inTpl = false; continue; }
      if (c === '/' && line[i + 1] === '/') break;
      if (c === "'" || c === '"') { const q = c; i++; while (i < line.length && line[i] !== q) { if (line[i] === '\\') i++; i++; } continue; }
      if (c === '`') { inTpl = true; continue; }
      if (c === '{' || c === '(' || c === '[') depth++; else if (c === '}' || c === ')' || c === ']') depth--;
    }
  }
  return names;
}
const owner = new Map(), dup = [];
for (const m of order) {
  m.code = strip(m.src);
  for (const n of topNames(m.code)) {
    if (owner.has(n) && owner.get(n) !== m.file) dup.push(n + '：' + path.relative(ROOT, owner.get(n)) + ' 和 ' + path.relative(ROOT, m.file));
    else owner.set(n, m.file);
  }
}
if (dup.length) { console.error('顶层名字重复（单文件里会冲突）：\n  ' + dup.join('\n  ')); process.exit(1); }

// 4) 黄金快照数据嵌进页面：浏览器端用它做跨引擎确定性检查
const g = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'golden.json'), 'utf8'));
g.recs = {};
for (const r of g.replays) g.recs[r.file] = JSON.parse(readFileSync(path.join(ROOT, 'tests', r.file), 'utf8'));

let bundle = "'use strict';\nconst GOLDEN_DATA = " + JSON.stringify(g) + ';\n';
for (const m of order) bundle += '\n/* ==== ' + path.relative(ROOT, m.file) + ' ==== */\n' + m.code;
bundle = bundle.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8').replace('/*BUNDLE*/', () => bundle);
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
// 语法检查：把脚本部分交给 node --check
const tmp = path.join(path.dirname(OUT), '.bundle-check.js');
writeFileSync(tmp, bundle);
const { execFileSync } = await import('node:child_process');
try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
catch (e) { console.error('语法错误：\n' + String(e.stderr || e)); process.exit(1); }
finally { (await import('node:fs')).unlinkSync(tmp); }
console.log(`已生成 ${path.relative(ROOT, OUT)}：${order.length} 个模块，${(html.length / 1024).toFixed(0)} KB`);
