# 引擎公开 API

入口只有一个：`src/engine/index.js`（类型签名见同目录的 `index.d.ts`）。模式、UI、实体、game 层只能从这里取引擎的东西，`node tools/test.mjs` 会检查这条依赖规则。其它 `src/engine/*.js` 是引擎内部，随时会改。

```js
import { createWorld, SAND, WATER, STONE } from '../engine/index.js';

const w = createWorld({ width: 240, height: 150, seed: 42 });
w.exec('fillRect', { mat: STONE, x0: 0, y0: 140, x1: 239, y1: 149 });
const r = w.exec('stroke', { tool: SAND, x0: 100, y0: 20, x1: 140, y1: 20, size: 4 });   // r = {placed, removed}
w.on('explosion', e => console.log('爆炸', e.x, e.y, e.count));
w.step(600);                      // 10 秒模拟时间（60 步/秒）
console.log(w.hash());            // 同样的种子 + 同样的命令 = 同样的哈希（Node 和浏览器逐位一致）
```

## 1. 世界

| 接口 | 说明 |
|---|---|
| `createWorld({width, height, seed})` | 新建世界，至少 16×16。种子省略时为 1。新世界立刻开始录制命令 |
| `world.step(n = 1)` | 往前走 n 步。每步结束按固定顺序派发这一步的事件，返回这次调用产生的全部事件（没有订阅者时返回空数组） |
| `world.tick` / `width` / `height` / `seed` | 当前步数、尺寸、种子 |
| `world.hash()` | 16 位十六进制的状态哈希，覆盖全部模拟状态（网格、飞行粒子、刚体、爆炸、天气、环境、随机数状态……），不含区域和渲染用的东西 |
| `world.reset(seed?)` | 重新开局：清空网格、步数归零、换种子、清空录制。区域保留 |
| `world.dispose()` | 释放。之后不能再用 |

### 多世界

可以同时有多个世界（模式自己的世界、热身用的临时世界、AI 预演用的副本）。引擎内部是模块级状态，所以同一时刻只有一个世界“在台上”：调用哪个世界的方法，它就自动换上台，换台只是几十个引用赋值，很便宜。两个世界可以一步一步交错地跑，结果和各自单独跑完全一样（`tests/suites/api.js` 有用例）。

两条限制：
- **特效钩子里不能调用任何世界方法**（见第 8 节）。钩子是在模拟中途调用的，这时候换台会把别的世界的状态换进来。
- `world.view` 的 getter 每读一次都会把世界换上台。热循环里请先把数组取到局部变量。

## 2. 读

| 接口 | 说明 |
|---|---|
| `getCell(x, y)` | `{type, key, name, temp, flags, seed, life, fuel, wet, aux, charge, burning, inBody}`，越界返回 `null` |
| `getField(name, {copy})` | 整张场的类型数组，`name` ∈ `FIELDS`：`type temp flags seed life fuel wet aux charge`（W×H，下标 `x + y*W`）和粗网格场 `vapor cloud windX heat`（尺寸用 `fieldSize(name)` 查）。**返回的是活数组，只能读**；要副本传 `{copy: true}` |
| `views()` | 上面所有场的只读视图，加 `width/height`。世界换尺寸（`resize`）后要重新取 |
| `view` | 只读视图对象，属性是 getter：`W H tick gravity type temp env perf fpCount bodyCount structStats …`（完整列表见 `index.d.ts` 的 `RenderState`） |
| `renderState()` | 同样的内容，一次性返回一个普通对象（活引用）。渲染器、音频每帧取一次 |
| `getEnv()` | 环境参数的副本（风、气温、时间、天气……） |
| `queryRegion(area)` | 统计一块区域。`area` 是 `{x,y,w,h}`、带 `mask`（长度 w×h，非 0 的格算在内）的矩形，或区域 id。返回 `{cells, counts(Uint32Array，按材料 id), byKey({SAND: 120, …}), burning, avgTemp, maxTemp, minTemp}` |

格子标志位（`flags`）：`F_BURN` 在烧、`F_SCORCH` 焦黑、`F_BODY` 属于下落中的刚体、`F_TIP` 植物生长尖端、`F_PIN` 画的时候临时钉住。

## 3. 写：只有 `world.exec(command, args)`

所有改变世界的操作都是命令，都会被录制（录制 = 种子 + `{step, command, args}` 列表，可以逐格回放）。也可以写成 `exec({command, args})`。

| 命令 | 参数 | 返回 |
|---|---|---|
| `stroke` | `{tool, x0, y0, x1, y1, size, shape:'circle'|'square'|'spray', replace, erase, limit?}` 从 (x0,y0) 画到 (x1,y1)；两点相同就是点一下。`tool` 可以是材料 id 或工具（`TOOL_ERASE` 等） | `{placed, removed}` 实际改动的格数 |
| `strokeBegin` / `strokeEnd` | 无。画的过程中先不判定结构支撑，松手再算 | `null` |
| `fillRect` | `{mat, x0, y0, x1, y1}` | `null` |
| `fillCircle` | `{mat, cx, cy, r}` | `null` |
| `clear` | 无 | `null` |
| `ignite` | `{x, y}` 点燃（可燃物加热到燃点；炸药点引信） | `null` |
| `explode` | `{x, y, r = 15, p = 1}` | `null` |
| `lightning` | `{x}` 从这一列上方的云（没有云就从天顶）劈下 | `null` |
| `setWeather` | `{key}`，`key` ∈ `WEATHER_PRESETS` | `null` |
| `setEnv` | `{key, value}`，`key` 只能是 `wind windPower temp time timeScale dayNight structure moistPerMin atmosCap` | `null` |
| `setGravity` | `{dir: 'down'|'up'|'left'|'right'}` | `null` |
| `loadScene` | `{index}`，0–9，见 `SCENES` | `null` |
| `restoreScene` | `{json}` 紧凑场景快照（撤销用，见 `captureScene`） | `null` |
| `restoreFull` | `{json}` 完整存档（`serialize()` 的结果，也接受 v4.1 的存档） | `null` |
| `resize` | `{w, h}` 换网格尺寸，内容按底边居中保留 | `null` |
| `spawn` | `{mat, x, y, r = 2}` 生成灾难源（熔岩、火、克隆体……） | `null` |

### 预算钩子

`stroke` 返回实际放下的格数；传 `limit` 时最多放这么多格（不传时行为和 v4 完全一样）。背包 / 预算逻辑在 `src/game/budget.js`：它把剩余额度当作 `limit` 交给引擎，再按返回的 `placed` 扣减。引擎本身不知道预算。

### 区域规则

```js
const base = w.addRegion({ tag: 'base', x: 10, y: 50, w: 20, h: 26, rules: { protect: true } });
const pit  = w.addRegion({ tag: 'pit', x: 60, y: 40, w: 30, h: 36, rules: { allow: [SAND] }, track: true });
w.regionAt(15, 60);    // [base]
w.queryRegion(pit);    // 统计
w.removeRegion(base);
```

| 规则 | 作用 |
|---|---|
| `protect: true` | 玩家笔刷完全不能改这里的格；`ignite` / `explode` / `spawn` 落在这里时 `exec` 直接返回 `{rejected: 'protected', region}`，不执行也不录制 |
| `paint: false` | 不能放材料 |
| `erase: false` | 不能擦 |
| `allow: [id…]` | 只允许放这些材料 |
| `track: true` | 区域内容变化时发 `regionChanged` 事件 |

区域可以是矩形，也可以带 `mask`（长度 w×h）。区域只约束**玩家命令**（笔刷、点火、爆炸、生成），不约束物理：别处的爆炸照样能炸进保护区。区域会随 `snapshot` / `serialize` / `recording` 一起保存，但**不进哈希**（同样的命令序列在有无区域时可能不同，这是规则本身的效果）。`fillRect` / `fillCircle` / `loadScene` 这类关卡搭建命令不受区域约束。

## 4. 事件

```js
const off = w.on('collapse', (e, world) => { … });   // type 是事件名或 '*'
off();                                                 // 取消订阅
```

每一步结束时，引擎把这一步的事件**聚合后**按固定顺序一次发完（不会每格发一次）：

| 顺序 | 类型 | 字段 | 聚合方式 |
|---|---|---|---|
| 1 | `reaction` | `rule, reactant, other, products:[a2,b2], count, x, y` | 每条规则每步最多一条，`count` 是触发次数，`x,y` 是第一次的位置 |
| 2 | `materialFirstCreated` | `material` | 这个世界第一次出现某种材料（`reset` 后重新算） |
| 3 | `ignite` | `count, x, y` | 每步最多一条 |
| 4 | `extinguish` | `count, x, y` | 每步最多一条 |
| 5 | `explosion` | `count, x, y, radius, power` | 按 32×32 的块合并，`x,y` 是平均位置，`radius/power` 取最大 |
| 6 | `collapse` | `cells, x, y, material` | 每个失去支撑的结构块一条 |
| 7 | `lightning` | `x, y, fromX, fromY` | 每道闪电一条 |
| 8 | `regionChanged` | `region, tag, counts` | 每个 `track` 区域每步最多一条 |

每个事件都带 `type` 和 `step`（就是 `world.tick`）。

保证：
- **事件处理不能改变本步结果**。处理函数是在这一步完全算完之后才被调用的；在处理函数里调用 `world.step()` 会抛错；调用 `world.exec()` 是允许的，命令记在当前步数上，从下一步开始生效，回放时完全一致。
- 两步之间 `exec` 产生的事件（比如 `exec('ignite')` 点着的格）算进下一步的那一批。
- 订阅不订阅都不影响模拟结果和哈希。
- 一个处理函数抛错不影响其它处理函数，所有处理函数跑完后再把第一个错误抛出来。

## 5. 快照与存档

| 接口 | 说明 |
|---|---|
| `snapshot()` / `restore(s)` | 内存里的深拷贝（全部模拟状态 + 区域），比 `serialize` 快得多。适合撤销、AI 预演、关卡重来 |
| `serialize()` / `deserialize(s)` | JSON 字符串的完整存档（引擎状态 base64 + 区域）。也能读 v4.1 的 `kind:'full'` 存档 |
| `captureScene()` | 紧凑场景快照（RLE），配合 `exec('restoreScene', {json})` 做撤销；这个恢复会被录制 |

保证：任何时刻（包括爆炸进行中、刚体下落中）存档再读回，哈希一致，再跑 1000 步哈希仍一致。

## 6. 录制与回放

| 接口 | 说明 |
|---|---|
| `recording()` | `{seed, w, h, steps, log:[{step, command, args}], regions}` |
| `replay(rec, steps?)` | 从种子重新开局，按步数执行命令，跑到 `steps`（默认录制的步数），返回哈希。不派发事件 |
| `replayBegin(rec)` / `replayPump()` / `replayEnd(keepLog)` | 界面用的逐步回放：每个模拟步之前调 `replayPump()`，返回 `true` 表示放完。`replayEnd(true)` 后接着这段录制继续录 |
| `setRecording(on)` | 暂停 / 恢复录制（关卡搭建阶段可以关掉） |

## 7. 确定性规则

模拟代码里没有 `Math.random`、时钟和超越函数（`Math.sin/cos/exp/pow/log…`），用的是 xorshift32 和多项式；遍历、池分配、事件顺序都是固定的。`node tools/test.mjs` 会扫描 `src/engine/` 确认这一点。黄金快照（`tests/golden.json`）记录 10 个场景在第 0/1000/5000/36000 步的哈希和 5 段录制回放的哈希，Node 和浏览器都必须逐位一致。

## 8. 宿主接口（渲染、声音、调试）

| 接口 | 说明 |
|---|---|
| `setFxHooks({onBoom(x,y,R,P), onThunder(x,y), onCrash})` | 画面 / 声音特效钩子，在模拟中途调用。**只能用来触发特效**，不能改世界，也不能调用任何世界方法 |
| `setProfiler(clock)` | 给调试面板计时用的时钟（比如 `() => performance.now()`）。模拟本身从不读时钟 |
| `HOST_WORLD` | 「宿主默认世界」（不用 `createWorld` 时的模块状态）的只读入口，浏览器测试用 |
| `activateHostWorld()` | 让宿主默认世界回到台上。只有测试和工具需要 |
| `warmUpEngine()` | 冷启动热身：在临时世界里跑一遍爆炸、倒塌、闪电（约 0.5 秒），让第一次大爆炸不卡。不影响任何世界的确定性 |

## 9. 静态数据和常量

都是只读的：`MATERIALS`（按 id，含 `key name state density conductivity palette …`）、材料 id 常量（`SAND WATER STONE …`）和属性表（`M_DENS M_FLAM …`）、`RULES`、`SCENES`、`WEATHER_PRESETS`、`COMMANDS`、`ENV_DEFAULTS`、`STATE_NAMES`、标志位 `F_*`、`CHUNK`（32）、`SIM_HZ`（60）、`FP_MAX`、`BODY_MAX`、`RAIN_THR`、`thunderDelay(x,y)`、`bytesToB64 / b64ToBytes`。

## 10. 需要新接口？

不要改 `src/engine/`。在 `docs/API_REQUESTS.md` 里按模板写需求，由维护引擎的一方实现。
