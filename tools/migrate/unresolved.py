"""找出模块里用到、但既没声明也没 import、也不是全局对象的名字（ES 模块里会是 ReferenceError）。"""
import re, sys, os, glob
sys.path.insert(0, os.path.dirname(__file__))
from host import scan_idents, prev_char, next_char
GLOBALS = set('''undefined null true false NaN Infinity Math JSON Object Array Number String Boolean Symbol Map Set WeakMap WeakSet Promise Error TypeError RangeError
Date RegExp Proxy Reflect BigInt ArrayBuffer SharedArrayBuffer DataView Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array
isFinite isNaN parseInt parseFloat encodeURIComponent decodeURIComponent console globalThis window document navigator location localStorage performance
requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone MessageChannel URL URLSearchParams Blob File FileReader Response
CompressionStream DecompressionStream TextEncoder TextDecoder atob btoa ResizeObserver MediaRecorder AudioContext OfflineAudioContext webkitAudioContext HTMLElement Image
arguments this new typeof instanceof void delete in of let const var function return if else for while do switch case default break continue try catch finally throw class extends super
import export from as async await yield static get set debugger with enum process GOLDEN_DATA Event KeyboardEvent PointerEvent MouseEvent WebGL2RenderingContext alert'''.split())

def check(path):
    src = open(path, encoding='utf8').read()
    imported = set()
    for m in re.finditer(r"^import\s*\{([^}]*)\}\s*from", src, re.M):
        imported |= {n.strip().split(' as ')[-1] for n in m.group(1).split(',') if n.strip()}
    for m in re.finditer(r"^import\s+\*\s+as\s+(\w+)", src, re.M): imported.add(m.group(1))
    body = re.sub(r"^import[^;]*;", '', src, flags=re.M)
    declared = set(re.findall(r'(?:\b(?:function|class)\s+|\b(?:const|let|var)\s+)([A-Za-z_$][\w$]*)', body))
    # 解构、参数、多重声明：粗略地把 (…) 参数表和 let a, b 里的名字都算上
    for m in re.finditer(r'\b(?:const|let|var)\s+([^;=]*?)(?:=|;|\bof\b|\bin\b)', body):
        declared |= set(re.findall(r'[A-Za-z_$][\w$]*', m.group(1)))
    for m in re.finditer(r'\b(?:const|let|var)\s+[^;]*', body):
        for part in re.findall(r',\s*([A-Za-z_$][\w$]*)\s*=', m.group(0)): declared.add(part)
    for m in re.finditer(r'\(([^()]*)\)\s*(?:=>|\{)', body):
        declared |= set(re.findall(r'[A-Za-z_$][\w$]*', m.group(1)))
    for m in re.finditer(r'([A-Za-z_$][\w$]*)\s*=>', body): declared.add(m.group(1))
    for m in re.finditer(r'\bcatch\s*\(\s*([A-Za-z_$][\w$]*)', body): declared.add(m.group(1))
    for m in re.finditer(r'\{([^{}]*)\}\s*=', body): declared |= set(re.findall(r'[A-Za-z_$][\w$]*', m.group(1)))
    bad = {}
    for s, e, nm in scan_idents(body):
        if nm in GLOBALS or nm in imported or nm in declared: continue
        p = prev_char(body, s)
        if p == '.' and body[s-3:s] != '...': continue
        if next_char(body, e) == ':' and p in '{,': continue
        ln = body.count('\n', 0, s) + 1
        bad.setdefault(nm, ln)
    return bad
files = sys.argv[1:]
for f in files:
    b = check(f)
    if b: print(f, ' '.join(f'{k}@{v}' for k, v in sorted(b.items(), key=lambda x: x[1])))
