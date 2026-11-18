"""把 60/62/64 用例和黄金快照脚本拆成 tests/lib/*.js（辅助函数）+ tests/suites/*.js（用例注册）。"""
import re, os, sys
sys.path.insert(0, 'tools/migrate')
from blocks import split_blocks, kind
os.makedirs('tests/lib', exist_ok=True); os.makedirs('tests/suites', exist_ok=True)
lib, suites = [], {}
def exportify(text):
    return re.sub(r'^((?:\s*(?://[^\n]*|/\*.*?\*/)\s*)*\s*)(async\s+function|function|const|let)\b', lambda m: m.group(1) + 'export ' + m.group(2), text, count=1, flags=re.S)
for fname, suite in [('60-tests.js', 'v3.js'), ('62-tests4.js', 'v4.js'), ('64-tests41.js', 'v41.js')]:
    for text, names in split_blocks(open('v4-src/' + fname, encoding='utf8').read()):
        k = kind(text)
        if k in ('function', 'let', 'const'): lib.append(exportify(text))
        else: suites.setdefault(suite, []).append(text)
open('tests/lib/harness.js', 'w', encoding='utf8').write("'use strict';\n/* 自测的公共部分：用例注册表、测试场地、soak 采样与判定。只给 tests/ 和 tools/ 用。 */\n" + ''.join(lib))
for suite, parts in suites.items():
    open('tests/suites/' + suite, 'w', encoding='utf8').write("'use strict';\n" + ''.join(parts))
g = []
for text, names in split_blocks(open('v4-src/golden-scripts.js', encoding='utf8').read()):
    g.append(exportify(text) if kind(text) in ('function', 'let', 'const') else text)
open('tests/lib/golden-scripts.js', 'w', encoding='utf8').write("'use strict';\n" + ''.join(g))
print('ok', {k: len(v) for k, v in suites.items()}, len(lib), 'lib blocks')
