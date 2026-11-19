"""删掉模块里所有 import，按实际用到的名字重新生成（只看 src/ 下各模块导出的名字）。
用法：python3 imports.py 目录或文件...  （默认 src/engine）"""
import re, os, sys, glob
sys.path.insert(0, os.path.dirname(__file__))
from blocks import strip_comments, split_blocks

ROOTS = sys.argv[1:] or ['src/engine']
ALL = sorted(set(glob.glob('src/**/*.js', recursive=True)) | set(glob.glob('tests/**/*.js', recursive=True)))
EXP = re.compile(r'^export\s+(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let)\s+([^;=]*(?:=[^;]*)?);)', re.M)

def exported(path):
    t = strip_comments(open(path, encoding='utf8').read())
    names = set()
    for m in re.finditer(r'^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)', t, re.M): names.add(m.group(1))
    for m in re.finditer(r'^export\s+(?:const|let)\s+', t, re.M):
        # 读到顶层的分号为止，按顶层逗号切
        k, depth, cur, parts, st = m.end(), 0, '', [], None
        while k < len(t):
            ch = t[k]
            if st:
                if ch == '\\': k += 2; continue
                if ch == st: st = None
                k += 1; continue
            if ch in "'\"`": st = ch
            elif ch in '([{': depth += 1
            elif ch in ')]}': depth -= 1
            elif ch == ',' and depth == 0: parts.append(cur); cur = ''; k += 1; continue
            elif ch == ';' and depth == 0: break
            cur += ch; k += 1
        parts.append(cur)
        for p in parts:
            mm = re.match(r'\s*([A-Za-z_$][\w$]*)', p)
            if mm: names.add(mm.group(1))
    return names

exports = {p: exported(p) for p in ALL}
# 引擎公开入口 index.js 的再导出：export { a, b } from './x.js' / export * from './x.js'
INDEX = 'src/engine/index.js'
if INDEX in exports:
    it = strip_comments(open(INDEX, encoding='utf8').read())
    pub = set()
    for m in re.finditer(r"^export\s*\{([^}]*)\}\s*from\s*'([^']*)'", it, re.M):
        for n in m.group(1).split(','):
            n = n.strip()
            if n: pub.add(n.split(' as ')[-1].strip())
    for m in re.finditer(r"^export\s*\*\s*from\s*'\./([^']*)'", it, re.M):
        pub |= exports.get('src/engine/' + m.group(1), set())
    exports[INDEX] = pub
owner = {}
for p, names in exports.items():
    for n in names:
        owner.setdefault(n, []).append(p)

IDENT = re.compile(r'(?<![\w$.])([A-Za-z_$][\w$]*)(?!\s*:(?!:))')
def used_idents(t):
    t = strip_comments(t)
    t = re.sub(r"'(?:\\.|[^'\\\n])*'", "''", t)
    t = re.sub(r'"(?:\\.|[^"\\\n])*"', '""', t)
    t = re.sub(r'`(?:\\.|[^`\\])*`', lambda m: ' '.join(re.findall(r'\$\{([^}]*)\}', m.group(0))), t)
    t = re.sub(r'([{,]\s*)[A-Za-z_$][\w$]*\s*:(?!:)', r'\1', t)      # 对象字面量的键名不算「用到」
    t = re.sub(r'\bcase\s+[A-Za-z_$][\w$]*\s*:', 'case :', t) if False else t
    return set(re.findall(r'(?<![\w$.])([A-Za-z_$][\w$]*)', t))

targets = []
for r in ROOTS:
    targets += [r] if r.endswith('.js') else sorted(glob.glob(os.path.join(r, '**/*.js'), recursive=True))
problems = 0
for path in targets:
    src = open(path, encoding='utf8').read()
    body = re.sub(r"^import \{[^}]*\} from '[^']*';\n?", '', src, flags=re.M)
    own = exports.get(path, set())
    # 本模块里非导出的顶层声明 / 函数参数等都会遮住同名导出；只对「本模块没声明过」的名字生成 import
    local_decl = set(re.findall(r'(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)', strip_comments(body)))
    for _, names in split_blocks(body): local_decl |= set(names)      # 顶层 let a, b, c; 的每个名字
    imports = {}
    for n in sorted(used_idents(body) - own - local_decl):
        homes = [h for h in owner.get(n, []) if h != path]
        inside = path.startswith('src/engine/') or path.startswith('tests/')
        if inside: homes = [h for h in homes if h != INDEX]
        if path.startswith('src/engine/'): homes = [h for h in homes if h.startswith('src/engine/')]   # 引擎只依赖引擎自己
        elif any(h.startswith('src/engine/') for h in homes):
            # 引擎外面（模式、UI、渲染、game……）只能从公开入口 index.js 取引擎的东西
            if INDEX in homes: homes = [INDEX]
            else:
                others = [h for h in homes if not h.startswith('src/engine/')]
                if others: homes = others
                else: print('非公开', path, n); problems += 1; continue
        if not homes: continue
        if len(homes) > 1:
            # 同名导出出现在多个模块：优先同一个顶层目录
            same = [h for h in homes if h.split('/')[1] == path.split('/')[1]] or homes
            if len(same) > 1: print('歧义', path, n, same); problems += 1
            homes = same
        imports.setdefault(homes[0], []).append(n)
    lines = []
    for h in sorted(imports):
        rel = os.path.relpath(h, os.path.dirname(path)).replace('\\', '/')
        if not rel.startswith('.'): rel = './' + rel
        lines.append("import { " + ', '.join(sorted(imports[h])) + " } from '" + rel + "';")
    head = "'use strict';\n" if body.startswith("'use strict';") else ''
    body2 = body[len("'use strict';\n"):] if head else body
    out = head + '\n'.join(lines) + ('\n' if lines else '') + body2
    open(path, 'w', encoding='utf8').write(out)
print('imports regenerated for', len(targets), 'files;', problems, 'ambiguities')
