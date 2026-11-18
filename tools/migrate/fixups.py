"""拆分之后、生成状态函数之前：把跨模块写操作改成调用所属模块的函数。"""
import re
def sub(path, a, b, cnt=1):
    p = 'src/engine/' + path
    t = open(p, encoding='utf8').read()
    assert t.count(a) >= cnt, (path, a[:80], t.count(a))
    t = t.replace(a, b, cnt)
    open(p, 'w', encoding='utf8').write(t)
def add_import(path, line):
    p = 'src/engine/' + path
    t = open(p, encoding='utf8').read()
    t = t.replace("'use strict';\n", "'use strict';\n" + line + '\n', 1)
    open(p, 'w', encoding='utf8').write(t)
def drop_import_name(path, name):
    p = 'src/engine/' + path
    t = open(p, encoding='utf8').read()
    def fix(m):
        names = [n.strip() for n in m.group(1).split(',') if n.strip() != name]
        return ("import { " + ', '.join(names) + " } from '" + m.group(2) + "';") if names else ''
    t = re.sub(r"^import \{([^}]*)\} from '([^']*)';", fix, t, flags=re.M)
    open(p, 'w', encoding='utf8').write(t)

# ---- grid.js：sceneDirty → gridEpoch；structDirty 挪到 structure.js；推进步数的函数
sub('grid.js', "export let sceneDirty = true;     // 渲染端需要整张重传\nexport let structDirty = true;    // 有待处理的支撑检测（脏格列表见 2s）",
    "export let gridEpoch = 0;         // 网格被整体重建 / 清空 / 唤醒的次数：渲染层看到它变了就整张重传")
sub('grid.js', "export function wakeAll() { chunkTTL.fill(WAKE_TTL); sceneDirty = true; }", "export function wakeAll() { chunkTTL.fill(WAKE_TTL); gridEpoch++; }")
sub('grid.js', "elecCount = 0; fpClear(); exClear(); bodiesClear(); allocStruct(); allocWeather();", "electricSet('elecCount', 0); fpClear(); exClear(); bodiesClear(); allocStruct(); allocWeather();")
sub('grid.js', "elecCount = 0; fpClear(); exClear(); bodiesClear(); clearWeather();", "electricSet('elecCount', 0); fpClear(); exClear(); bodiesClear(); clearWeather();")
sub('grid.js', "ripples.fill(0); rippleHead = 0; lastBolt = null;", "ripples.fill(0); rippleHead = 0; weatherSet('lastBolt', null);")
t = open('src/engine/grid.js', encoding='utf8').read()
t += "\n// 每个模拟步开头调用：翻转「本步已处理」的奇偶位，步数加一\nexport function advanceTick() { parity ^= 1; tick++; }\n"
open('src/engine/grid.js', 'w', encoding='utf8').write(t)
drop_import_name('grid.js', 'elecCount'); drop_import_name('grid.js', 'lastBolt')
add_import('grid.js', "import { electricSet } from './electric.js';\nimport { weatherSet } from './weather.js';")
# structure.js 里声明 structDirty
sub('structure.js', "export let structCooldown = 0, structHold = false;", "export let structDirty = true;    // 有待处理的支撑检测（脏格列表见下）\nexport let structCooldown = 0, structHold = false;")
drop_import_name('structure.js', 'structDirty')
t = open('src/engine/structure.js', encoding='utf8').read()
t += """
// 新开一局：上一局留下的结构力学状态全部清掉
export function resetStructState() {
  pinTick = -100; fracTick = -100; structCooldown = 0; structHold = false;
  structSettle = false; fracVX = 0; fracVY = 0; clearStructDirty(); markStructAll();
}
"""
open('src/engine/structure.js', 'w', encoding='utf8').write(t)

# ---- step.js
sub('step.js', "  parity ^= 1; tick++; simStepsTotal++;", "  advanceTick(); simStepsTotal++;")
drop_import_name('step.js', 'parity'); drop_import_name('step.js', 'tick')
add_import('step.js', "import { advanceTick } from './grid.js';")

# ---- commands.js
sub('commands.js', "  strokeBegin() { structHold = true; return null; },", "  strokeBegin() { structureSet('structHold', true); return null; },")
sub('commands.js', "  strokeEnd() { if (structHold) { structHold = false; clearPins(); markStructAll(); } return null; },", "  strokeEnd() { if (structHold) { structureSet('structHold', false); clearPins(); markStructAll(); } return null; },")
sub('commands.js', "    tick = keepTick; parity = keepPar; _rs = keepRng;", "    gridSet('tick', keepTick); gridSet('parity', keepPar); setRngState(keepRng);")
sub('commands.js', "  sceneState = null;\n  clearGrid();", "  scenesSet('sceneState', null);\n  clearGrid();")
sub('commands.js', "  tick = 0; parity = 0; slowPhase = 0; pinTick = -100; fracTick = -100; structCooldown = 0; structHold = false;\n  structSettle = false; fracVX = 0; fracVY = 0; clearStructDirty(); markStructAll();   // 上一局留下的结构力学状态全部清掉",
    "  gridSet('tick', 0); gridSet('parity', 0); slowSet('slowPhase', 0);\n  resetStructState();                                      // 上一局留下的结构力学状态全部清掉")
for n in ['structHold', 'tick', 'parity', '_rs', 'sceneState', 'slowPhase', 'pinTick', 'fracTick', 'structCooldown', 'structSettle', 'fracVX', 'fracVY', 'clearStructDirty']:
    drop_import_name('commands.js', n)
add_import('commands.js', "import { structureSet, resetStructState } from './structure.js';\nimport { gridSet, tick } from './grid.js';\nimport { setRngState } from './rng.js';\nimport { scenesSet } from './scenes.js';\nimport { slowSet } from './slow.js';")

# ---- scenes.js：局部函数 colX 改名，免得和结构模块的 colX 混淆
sub('scenes.js', "  const colX = k => x0 + Math.round((bw - colW) * k / cols);", "  const colAt = k => x0 + Math.round((bw - colW) * k / cols);")
t = open('src/engine/scenes.js', encoding='utf8').read()
a = t.index('export function buildDemolition'); b = t.index('\n}\n', a)
t = t[:a] + re.sub(r'\bcolX\(', 'colAt(', t[a:b]) + t[b:]
open('src/engine/scenes.js', 'w', encoding='utf8').write(t)
drop_import_name('scenes.js', 'colX')

# ---- serialize.js：读档时各模块的标量都通过各自的 Set 写回
sub('serialize.js', "  sdList.set(sd); sdCount = sd.length;", "  sdList.set(sd); structureSet('sdCount', sd.length);")
sub('serialize.js', "  if (el.length > 0) { elecCur = new Int32Array(N); elecNext = new Int32Array(N); elecCur.set(el); }",
    "  if (el.length > 0) { const ec = new Int32Array(N); ec.set(el); electricSet('elecCur', ec); electricSet('elecNext', new Int32Array(N)); }")
sub('serialize.js', """  tick = sc.tick; parity = sc.parity; _rs = sc.rng;
  fpHead = sc.fpHead; fpCount = sc.fpCount; exActive = sc.exActive; elecCount = el.length; slowPhase = sc.slowPhase;
  structDirty = sc.structDirty; structFull = sc.structFull; structCooldown = sc.structCooldown; structHold = sc.structHold;
  bodyCount = sc.bodyCount; fracVX = sc.fracVX; fracVY = sc.fracVY; fracTick = sc.fracTick; pinTick = sc.pinTick;
  solidRow = sc.solidRow; structSettle = sc.structSettle;""", """  gridSet('tick', sc.tick); gridSet('parity', sc.parity); setRngState(sc.rng);
  particlesSet('fpHead', sc.fpHead); particlesSet('fpCount', sc.fpCount); explosionSet('exActive', sc.exActive);
  electricSet('elecCount', el.length); slowSet('slowPhase', sc.slowPhase);
  for (const k of ['structDirty', 'structFull', 'structCooldown', 'structHold', 'bodyCount', 'fracVX', 'fracVY', 'fracTick', 'pinTick', 'structSettle']) structureSet(k, sc[k]);
  weatherSet('solidRow', sc.solidRow);""")
sub('serialize.js', "  sceneState = o.sceneState;", "  scenesSet('sceneState', o.sceneState);")
sub('serialize.js', "  rippleHead = o.rippleHead; lastBolt = o.lastBolt;\n  sceneDirty = true;", "  gridSet('rippleHead', o.rippleHead); weatherSet('lastBolt', o.lastBolt);")
for n in ['sdCount', 'elecCur', 'elecNext', 'tick', 'parity', '_rs', 'fpHead', 'fpCount', 'exActive', 'elecCount', 'slowPhase', 'structDirty', 'structFull', 'structCooldown', 'structHold', 'bodyCount', 'fracVX', 'fracVY', 'fracTick', 'pinTick', 'solidRow', 'structSettle', 'sceneState', 'rippleHead', 'lastBolt', 'sceneDirty']:
    pass
add_import('serialize.js', "import { structureSet } from './structure.js';\nimport { electricSet } from './electric.js';\nimport { gridSet } from './grid.js';\nimport { setRngState } from './rng.js';\nimport { particlesSet } from './particles.js';\nimport { explosionSet } from './explosion.js';\nimport { slowSet } from './slow.js';\nimport { weatherSet } from './weather.js';\nimport { scenesSet } from './scenes.js';")
print('fixups ok')
