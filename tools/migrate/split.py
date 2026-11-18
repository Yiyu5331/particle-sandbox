"""一次性迁移：把 v4-src 的分块脚本拆成 src/engine/*.js 等 ES 模块，自动补 import / export。"""
import re, os, sys, json
sys.path.insert(0, 'tools/migrate')
from blocks import split_blocks, kind, strip_comments

SRC = 'v4-src'
# 每个源文件的默认去向，以及按名字的例外
DEFAULT = {
  '10-core.js': 'engine/grid.js', '20-sim.js': 'engine/cells.js', '22-struct.js': 'engine/structure.js',
  '23-weather.js': 'engine/weather.js', '25-codec.js': 'engine/serialize.js', '26-state.js': 'engine/serialize.js',
  '27-scenes.js': 'engine/scenes.js',
}
BY_NAME = {}
def put(mod, names):
    for n in names.split(): BY_NAME[n] = mod
put('engine/rng.js', '_rs rngState setRngState rnd rndi seedRng')
put('engine/dmath.js', 'TAU HALF_PI dsin dcos')
put('engine/materials.js', 'AMBIENT S_EMPTY STATE_NAMES EMPTY NT TOOL_ERASE MAT_DEFAULTS MATERIALS defMat M_STATE AIRLIKE KTAB SINKP hexToRgb')
put('engine/rules.js', 'ACID_SOLUBLE RULES RX HASRX')
put('engine/env.js', 'DAY_STEPS env LEDGER_KEYS WL ledgerReset st onBoom ENV_DEFAULTS')
put('host', 'CELL QS')
put('engine/grid.js', 'CHUNK WAKE_TTL SIM_HZ DX4 DX8')
put('engine/fluids.js', 'windPush foamAt splash movePowder liquidCanSink moveLiquid moveGas')
put('engine/combustion.js', 'openSky hasOxygen ignite emitFlame emitSmoke burnStep')
put('engine/plants.js', 'plantLifespan geneHeight geneBranch geneLeaf skyOpen biomass stemHeight drawSap bloom growTip sprout')
put('engine/explosion.js', 'EX_MAX exA exActive exClear startExplosion stepExplosion stepExplosions')
put('engine/particles.js', 'FP_MAX fpAlive fpHead fpClear spawnFree fpSolidAt landFree stepFree')
put('engine/electric.js', 'elecCur addCharge stepElectric')
put('engine/temperature.js', 'stepThermal')
put('engine/slow.js', 'SLOW_STRIDE slowPhase slowWet slowWater slowPlant flowerNear slowFlower slowSeed slowSoil slowAsh slowDead slowIce SLOW slowTick')
put('engine/step.js', 'perf simStepsTotal sweepCells simClock setSimClock simStep')
put('engine/paint.js', 'paintCell fillRect fillCircle countType totalWater')
put('engine/commands.js', 'cmdLog cmdRecording worldSeed cmdHook stampCells cmdCellFilter COMMANDS execCmd resetWorld replay recordingOf')

# 非声明语句（defMat 调用、IIFE、HOOK[...] = 赋值……）跟着它前面最近的声明走
def target_of(fname, names, last):
    for n in names:
        if n in BY_NAME: return BY_NAME[n]
    if names: return DEFAULT[fname]
    return last

modules = {}   # mod -> list of (text, names, kind)
order = []
for fname in ['10-core.js', '20-sim.js', '22-struct.js', '23-weather.js', '25-codec.js', '26-state.js', '27-scenes.js']:
    src = open(os.path.join(SRC, fname), encoding='utf8').read()
    last = DEFAULT[fname]
    for text, names in split_blocks(src):
        if text.strip() == "'use strict';": continue
        k = kind(text)
        code = strip_comments(text).strip()
        # 语句块：看它在给谁赋值（HOOK[...] = / SLOW[...] =）
        if k == 'stmt':
            m = re.match(r'([A-Za-z_$][\w$]*)\s*\[', code)
            if m and m.group(1) in BY_NAME: tgt = BY_NAME[m.group(1)]
            elif code.startswith('defMat('): tgt = 'engine/materials.js'
            elif code.startswith('ledgerReset()'): tgt = 'engine/env.js'
            elif 'RULES.push' in code or 'RX[r.a' in code: tgt = 'engine/rules.js'
            else: tgt = last
        else:
            tgt = target_of(fname, names, last)
        last = tgt if tgt != 'host' else last
        modules.setdefault(tgt, []).append((text, names, k))
        if tgt not in order: order.append(tgt)

# 每个模块声明的名字
decl = {}
for mod, bl in modules.items():
    for text, names, k in bl:
        for n in names: decl[n] = (mod, k)
json.dump({n: v for n, v in decl.items()}, open('tools/migrate/decl.json', 'w'), ensure_ascii=False, indent=0)

IDENT = re.compile(r'(?<![\w$.])([A-Za-z_$][\w$]*)')
def idents(text):
    t = strip_comments(text)
    t = re.sub(r"'(?:\\.|[^'\\\n])*'", "''", t)
    t = re.sub(r'"(?:\\.|[^"\\\n])*"', '""', t)
    return set(IDENT.findall(t))

for mod in order:
    if mod == 'host': continue
    bl = modules[mod]
    used = set()
    for text, names, k in bl: used |= idents(text)
    own = set(n for text, names, k in bl for n in names)
    imports = {}
    for n in sorted(used - own):
        if n in decl and decl[n][0] != mod and decl[n][0] != 'host':
            imports.setdefault(decl[n][0], []).append(n)
    out = []
    for text, names, k in bl:
        if k in ('function', 'let', 'const'):
            # 在声明关键字前加 export（保留前面的注释）
            text = re.sub(r'^((?:\s*(?://[^\n]*|/\*.*?\*/)\s*)*\s*)(async\s+function|function|const|let)\b', lambda m: m.group(1) + 'export ' + m.group(2), text, count=1, flags=re.S)
        out.append(text)
    head = []
    for m2 in sorted(imports):
        rel = os.path.relpath(m2, os.path.dirname(mod)).replace('\\', '/')
        if not rel.startswith('.'): rel = './' + rel
        names = imports[m2]
        head.append('import { ' + ', '.join(names) + " } from '" + rel + "';")
    path = os.path.join('src', mod)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    body = ''.join(out)
    open(path, 'w', encoding='utf8').write("'use strict';\n" + '\n'.join(head) + '\n' + body)
    print(mod.ljust(26), len(bl), 'blocks,', sum(len(v) for v in imports.values()), 'imports from', len(imports), 'modules')
print('host-only:', [n for text, names, k in modules.get('host', []) for n in names])
