"""把旧的分块脚本切成顶层语句块，并找出每块声明了哪些名字。只用于这一次迁移。"""
import re

def split_blocks(src):
    """返回 [(text, names)]。按括号深度切分顶层语句，前面的注释并入后一块。"""
    blocks, cur, depth = [], [], 0
    i, n = 0, len(src)
    state = None  # None | '//' | '/*' | "'" | '"' | '`'
    tmpl_stack = []
    line_start = 0
    buf = []
    start = 0
    def flush(end):
        nonlocal start
        text = src[start:end]
        if text.strip():
            blocks.append(text)
        start = end
    while i < n:
        c = src[i]
        nx = src[i + 1] if i + 1 < n else ''
        if state == '//':
            if c == '\n':
                state = None           # 换行交给下面的代码分支处理（判断语句是否结束）
                continue
            i += 1; continue
        if state == '/*':
            if c == '*' and nx == '/':
                state = None; i += 2; continue
            i += 1; continue
        if state in ("'", '"'):
            if c == '\\': i += 2; continue
            if c == state: state = None
            i += 1; continue
        if state == '`':
            if c == '\\': i += 2; continue
            if c == '`': state = None; i += 1; continue
            if c == '$' and nx == '{':
                tmpl_stack.append(depth); depth += 1; state = None; i += 2; continue
            i += 1; continue
        # code
        if c == '/' and nx == '/': state = '//'; i += 2; continue
        if c == '/' and nx == '*': state = '/*'; i += 2; continue
        if c in ("'", '"', '`'): state = c; i += 1; continue
        if c in '([{': depth += 1
        elif c in ')]}':
            depth -= 1
            if tmpl_stack and depth == tmpl_stack[-1]:
                tmpl_stack.pop(); state = '`'; i += 1; continue
        if c == '\n' and depth == 0:
            # 语句结束：这一行以 ; 或 } 结尾（去掉行尾注释）
            line = src[line_start:i]
            code = re.sub(r'//.*$', '', line).rstrip()
            if code.endswith(';') or code.endswith('}'):
                flush(i + 1)
            line_start = i + 1
            i += 1; continue
        if c == '\n':
            line_start = i + 1
        i += 1
    flush(n)
    # 只有注释 / 空行的块并到下一块
    merged, pending = [], ''
    for b in blocks:
        stripped = re.sub(r'/\*.*?\*/', '', b, flags=re.S)
        stripped = re.sub(r'//.*', '', stripped).strip()
        if not stripped:
            pending += b; continue
        merged.append(pending + b); pending = ''
    if pending: merged.append(pending)
    return [(b, declared_names(b)) for b in merged]

def strip_comments(t):
    t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)
    return re.sub(r'//.*', '', t)

def declared_names(block):
    code = strip_comments(block).strip()
    m = re.match(r'(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)', code)
    if m: return [m.group(2)]
    m = re.match(r'(const|let|var)\s+', code)
    if not m: return []
    body = code[m.end():]
    # 顶层逗号切分
    parts, depth, cur, st = [], 0, '', None
    k = 0
    while k < len(body):
        ch = body[k]
        if st:
            cur += ch
            if ch == '\\': cur += body[k+1]; k += 2; continue
            if ch == st: st = None
            k += 1; continue
        if ch in "'\"`": st = ch; cur += ch; k += 1; continue
        if ch in '([{': depth += 1
        elif ch in ')]}': depth -= 1
        if ch == ',' and depth == 0: parts.append(cur); cur = ''; k += 1; continue
        if ch == ';' and depth == 0: break
        cur += ch; k += 1
    parts.append(cur)
    names = []
    for p in parts:
        mm = re.match(r'\s*([A-Za-z_$][\w$]*)', p)
        if mm: names.append(mm.group(1))
    return names

def kind(block):
    code = strip_comments(block).strip()
    if re.match(r'(async\s+)?function', code): return 'function'
    if code.startswith('let '): return 'let'
    if code.startswith('const '): return 'const'
    return 'stmt'
