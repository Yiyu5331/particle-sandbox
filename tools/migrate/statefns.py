"""给每个有状态的引擎模块加上 <名>Save / <名>Load / <名>Set（多世界切换、读档都靠它们）。"""
import re, glob, os, sys
sys.path.insert(0, 'tools/migrate')
from blocks import strip_comments
# 每个世界一份的对象 / 数组：从 const 改成 let，切换世界时整个换掉
TO_LET = {
  'engine/structure.js': ['bodies', 'structStats', 'bodyOrder'],
  'engine/explosion.js': ['exA'],
  'engine/particles.js': ['fpAlive'],
  'engine/grid.js': ['ripples'],
  'engine/env.js': ['env', 'WL', 'st'],
  'engine/step.js': ['perf'],
}
for f in sorted(glob.glob('src/engine/*.js')):
    mod = 'engine/' + os.path.basename(f)
    src = open(f, encoding='utf8').read()
    for name in TO_LET.get(mod, []):
        src, n = re.subn(r'^export const (' + re.escape(name) + r'\b)', r'export let \1', src, count=1, flags=re.M)
        assert n == 1, (f, name)
    names = []
    for m in re.finditer(r'^export let ([^;]*?);', strip_comments(src), re.M | re.S):
        for part in re.split(r',(?![^([{]*[)\]}])', m.group(1)):
            mm = re.match(r'\s*([A-Za-z_$][\w$]*)', part)
            if mm: names.append(mm.group(1))
    if not names:
        open(f, 'w', encoding='utf8').write(src); continue
    base = os.path.basename(f)[:-3]
    fn = re.sub(r'[^A-Za-z0-9]', '', base)
    obj = ', '.join(names)
    cases = '\n'.join(f"    case '{n}': {n} = v; break;" for n in names)
    src += f'''
/* ---- 本模块的全部可变状态（多世界切换、读档用；由迁移脚本生成，新增 let 状态时记得加进来） ---- */
export function {fn}Save() {{ return {{ {obj} }}; }}
export function {fn}Load(s) {{ ({{ {obj} }} = s); }}
export function {fn}Set(name, v) {{
  switch (name) {{
{cases}
    default: throw new Error('{base}.js 没有可写的状态 ' + name);
  }}
}}
'''
    open(f, 'w', encoding='utf8').write(src)
    print(base.ljust(12), len(names), 'vars:', obj[:110])
