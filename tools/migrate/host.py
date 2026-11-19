"""C0 第二步：把 v4-src 的宿主脚本（渲染、音频、UI）转成 ES 模块的辅助函数。只用于这一次迁移。"""
import re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from blocks import split_blocks, kind

STATE_KEYS = ('W H N CW CHN tick gx gy gravity gridEpoch type temp flags seed life fuel wet aux charge ripples rippleHead '
              'fpAlive fpType fpSeed fpX fpY fpCount GW GH cloud vapor windX heatC lastBolt env st perf simStepsTotal '
              'exActive elecCount bodyCount bodies structHold structStats sceneState').split()

def modulize(src):
    out = []
    for text, names in split_blocks(src):
        if text.strip() == "'use strict';": continue
        if kind(text) in ('function', 'let', 'const'):
            text = re.sub(r'^((?:\s*(?://[^\n]*|/\*.*?\*/)\s*)*\s*)(async\s+function|function|const|let)\b', lambda m: m.group(1) + 'export ' + m.group(2), text, count=1, flags=re.S)
        out.append(text)
    return "'use strict';\n" + ''.join(out)

def scan_idents(src):
    """逐个找出代码里的标识符（跳过字符串、注释、模板字面量的文字部分），返回 (start, end, name) 列表"""
    res, i, n = [], 0, len(src)
    stack = []   # 模板字面量里 ${ 的深度栈
    depth = 0
    while i < n:
        c = src[i]; nx = src[i+1] if i + 1 < n else ''
        if c == '/' and nx == '/': j = src.find('\n', i); i = n if j < 0 else j; continue
        if c == '/' and nx == '*': j = src.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        if c in "'\"":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == '\\' else 1
            i = j + 1; continue
        if c == '`' or (c == '}' and stack and stack[-1] == depth):
            if c == '}': stack.pop()
            j = i + 1
            while j < n:
                if src[j] == '\\': j += 2; continue
                if src[j] == '`': j += 1; break
                if src[j] == '$' and j + 1 < n and src[j+1] == '{': stack.append(depth); j += 2; break
                j += 1
            i = j; continue
        if c == '{': depth += 1
        elif c == '}': depth -= 1
        if c.isalpha() or c in '_$':
            j = i
            while j < n and (src[j].isalnum() or src[j] in '_$'): j += 1
            res.append((i, j, src[i:j])); i = j; continue
        if c.isdigit():
            j = i
            while j < n and (src[j].isalnum() or src[j] in '._'): j += 1
            i = j; continue
        i += 1
    return res

def prev_char(src, k):
    k -= 1
    while k >= 0 and src[k] in ' \t\n': k -= 1
    return src[k] if k >= 0 else ''
def next_char(src, k):
    while k < len(src) and src[k] in ' \t\n': k += 1
    return src[k] if k < len(src) else ''

def free_refs(src, names):
    """names 里每个名字在 src 中作为「自由变量」出现的位置（排除属性访问 a.x 和对象键 {x: ...}）"""
    out = []
    for s, e, nm in scan_idents(src):
        if nm not in names: continue
        p = prev_char(src, s)
        if p == '.' and src[s-3:s] != '...': continue
        if next_char(src, e) == ':' and p in '{,' and src[e:e+2] != '::': continue
        out.append((s, e, nm))
    return out

def local_decls(src, names):
    found = []
    for m in re.finditer(r'(?:\b(?:const|let|var)\s+|\bfunction\s*[\w$]*\s*\(|\(\s*)([^;=)]*)', src):
        pass
    for nm in names:
        if re.search(r'\b(?:const|let|var)\s+(?:[^;=]*,\s*)?' + re.escape(nm) + r'\b\s*[=,;]', src): found.append(nm)
        elif re.search(r'(?:function\s*[\w$]*\s*\(|\()\s*(?:[\w$]+\s*,\s*)*' + re.escape(nm) + r'\s*(?:[,)]|=>)', src): found.append(nm)
    return found

def replace_refs(src, names, fmt):
    refs = free_refs(src, names)
    out, last = [], 0
    for s, e, nm in refs:
        out.append(src[last:s]); out.append(fmt(nm)); last = e
    out.append(src[last:])
    return ''.join(out)
