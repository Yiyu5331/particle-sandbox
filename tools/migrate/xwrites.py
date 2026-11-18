"""找出「给别的模块导出的 let 赋值」的地方（ES 模块里这是运行时错误）。"""
import re, os, sys, json, glob
sys.path.insert(0, 'tools/migrate')
from blocks import strip_comments
files = sys.argv[1:] or sorted(glob.glob('src/engine/*.js'))
lets = {}
for f in glob.glob('src/**/*.js', recursive=True):
    t = strip_comments(open(f, encoding='utf8').read())
    for m in re.finditer(r'^export let ([^;]*);', t, re.M):
        for part in re.split(r',(?![^([{]*[)\]}])', m.group(1)):
            mm = re.match(r'\s*([A-Za-z_$][\w$]*)', part)
            if mm: lets[mm.group(1)] = f
for f in files:
    raw = open(f, encoding='utf8').read()
    imports = set()
    for m in re.finditer(r"^import \{([^}]*)\} from '([^']*)';", raw, re.M):
        for n in m.group(1).split(','): imports.add(n.strip())
    for ln, line in enumerate(raw.split('\n'), 1):
        code = re.sub(r'//.*', '', line)
        code = re.sub(r"'(?:\\.|[^'\\])*'", "''", code)
        for n in imports:
            if n not in lets: continue
            if re.search(r'(?<![\w$.])' + re.escape(n) + r'\s*(=(?!=)|\+=|-=|\*=|\|=|&=|\^=|\+\+|--)', code) or re.search(r'(\+\+|--)' + re.escape(n) + r'(?![\w$])', code):
                print(f'{f}:{ln}: [{n} @ {os.path.basename(lets[n])}] {line.strip()[:120]}')
