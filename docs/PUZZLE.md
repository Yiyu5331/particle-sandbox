# 物理解谜关卡

构建后打开 `dist/particle-sandbox.html?mode=puzzle`，或从主菜单进入「物理解谜」。选关按章节显示，第一关开放，上一关至少一星即解锁下一关。重复通关保留最高星。正式关卡的星级在 X2 提交成功后进入结算页，刷新后从档案恢复星级与解锁。存储失败可在结算页重试。编辑器试玩和导入关卡不会写入官方进度。

## 关卡文件

一个 UTF-8 JSON 文件定义一关。[完整 JSON Schema](../src/modes/puzzle/level.schema.json) 可供编辑器使用。浏览器和 Node 读取相同的 schema 和关卡文件。尺寸边界、区域引用、材料白名单、三星门槛和时间线还会经过跨字段检查。

| 字段 | 含义 |
|---|---|
| version / id / name / chapter / difficulty | 格式版本 1、唯一标识、默认关名、默认章名、难度 1～5。id 以英文字母开头，可接字母、数字、下划线或连字符。 |
| nameI18n / chapterI18n / desc / hints / hint | 可选的双语关名、章名、描述和分级提示。旧版 `hint` 字符串仍可用作简介。 |
| type | `planning` 暂停布置，点击运行后锁定画笔。 `realtime` 进入即开始，结算前可以继续绘制。 |
| world | `width, height, seed` 及 `commands` 或 `serialized` 两者之一。宽高各为 16～512 格。 |
| regions | `{id,type,x,y,w,h,allow?}` 的数组。矩形包含起点，右边界和下边界在矩形外。区域可重叠，id 在关内唯一。 |
| environment | 可选的初始天气、固定时间、气温、风向、风力。 |
| events | 可选的定时事件数组，每项格式为 `{step,action:{command,args}}`。 |
| materials / budget | 材料名到格数上限的映射，以及整关最大用料。未列出的材料不可选。 |
| goal / fail | 通关条件和失败条件。没有显式失败条件时用 null。 |
| maxSteps | 整关时限，1～36,000 个模拟步。60 步相当于正常速度下 1 秒；暂停布置不计时。 |
| stars | `two`、`three` 各含 `maxUsed` 和 `maxSteps`。通关保底一星，两项都在对应上限以内才得该档星级。三星门槛不可宽于二星。 |
| reference | `{steps,log:[{step,command:"stroke",args},…]}`。steps 是实际结算步。编辑中的空参考可以是 `{"steps":0,"log":[]}`。 |

### 初始世界和区域

`world.commands` 是按顺序执行的 `{command,args}` 数组。支持 `fillRect`、`fillCircle`、`stroke`、`clear`、`setGravity`、`setWeather`、`setEnv`、`loadScene`、`ignite`、`spawn`、`lightning` 和 `explode`。参数沿用[引擎 API](API.md)。材料可写公开编号或大写材料键。程序先执行初始命令，再注册关卡区域。搭建地形不计入玩家预算。

为指定格子设置温度或湿度需要公开引擎命令。[接口需求](API_REQUESTS.md)已记录。可用 `world.serialized` 载入合法存档中已有的格子温湿度。

`world.serialized` 接受 `world.serialize()` 返回的完整字符串，外层种子及内部网格尺寸必须与关卡声明相符。通过 restoreFull 命令载入物理状态，另用 addRegion 注册快照携带的区域规则，再添加本关命名区域。快照可以从非零 tick 开始，本关计时仍从 0 开始。条件使用关卡中显式命名的 region id。

- 金色目标区 `goal` 可用于统计，本身允许落笔。
- 虚线禁建区 `noBuild` 使用引擎的 `paint:false`。
- 蓝色保护区 `protected` 使用 `protect:true`。区域限制玩家命令，沙和水仍能通过物理运动进入。
- 统计区 `zone` 在编辑时显示灰色虚线框，在游玩时隐藏。可用于胜败条件和辅助统计，默认允许落笔。
- 任意区域可用 `allow` 限制可放置的材料，例如 `["WATER","SAND"]`。省略代表不限，空数组代表禁止所有材料。区域重叠时，每个区域的规则都生效。物理运动仍可将材料带入区域。

玩家 stroke 参数是 `tool,x0,y0,x1,y1,size,shape?`。size 为 1～16，1 表示单格，shape 支持 circle、square、spray。玩家不能设置 limit、替换、擦除或发出关卡搭建命令。系统将单材余额和总余额的较小值作为 stroke.limit，再按实际 placed 扣款；重叠、越界裁切和受保护的格子不会重复收费。

### 环境与定时事件

`environment` 在搭建或读档后设置。每个字段都可单独填写，留空沿用世界设置。天气先应用，随后应用指定的气温 `temp`（°C）、风向 `wind`（−1 向左，1 向右）和风力 `windPower`（0～1）。天气预设支持 `clear`、`cloudy`、`rain`、`storm`、`snow`。设置 `time` 会定格昼夜，取值为 `0 ≤ time < 1`，`0.5` 是正午。玩家游玩时无环境修改入口。关卡可用定时命令调整环境。天气事件会保留关卡指定的气温和风力，创作者可用 `setEnv` 显式改这些值。气温字段使用引擎的基准气温，仍参与昼夜温差计算。

```json
{
  "environment": {"time": 0.5, "weather": "clear", "temp": 18, "wind": -0.4, "windPower": 0.3},
  "events": [
    {"step": 60, "action": {"command": "spawn", "args": {"mat": "WATER", "x": 12, "y": 8, "r": 2}}},
    {"step": 120, "action": {"command": "setWeather", "args": {"key": "rain"}}}
  ]
}
```

`step` 从 1 起算，最晚为 `maxSteps`，相对本关起点。第 N 步事件在玩家于已完成 N−1 步时的落笔之后、物理模拟第 N 步之前执行。同一步的事件按数组原顺序执行。规划关在点运行后开始计时。结算后的事件不触发。事件命令与初始命令共用参数格式，`loadScene` 只准用于搭建。定时点火、生成、爆炸和笔画沿用引擎的区域限制，放水也可使用 `fillRect`。定时命令不占玩家用料。

### 双语文字和分级提示

`name` 和 `chapter` 保留为默认字符串。`nameI18n`、`chapterI18n`、`desc` 和 `hints` 中的每条提示都可写成 `{"zh-CN":"中文","en":"English"}`。界面随 X4 语言设置即时更新。章名和关名缺少当前语言时用默认字符串，官方旧关仍可使用界面词表。描述和提示缺少当前语言时显示已提供的另一语言。自制关的旧版纯文本按原样显示。

`hints` 可放 1～3 条，按查看顺序排列。玩家每点击一次就展开下一级，已展开的文字保留。查看级数保存在本局进度，继续、重试或重置时保留，重新选关开局时清零。当前星级仍按用料和步数计算。

## 目标条件

每个模拟步结束后求值一次，第一步记为 1。胜败条件共享该步的 queryRegion 结果。逻辑树的每个子条件都会采样，即使另一分支已经足以决定布尔结果。

| op | 参数 | 判定 |
|---|---|---|
| count | region, material, compare, value | 区域内材料格数，compare 为 `>=` 或 `<=`，包含等号。 |
| burning | region, compare, value | 区域内带燃烧标志的格数，使用同样的比较符。火焰材料本身可另外用 `count` 查询。 |
| noFire | region, steps | 连续指定步数既没有 FIRE 材料，也没有带燃烧标志的格子。任一种火源都会清零计数。 |
| cooler | region, temperature | 区域**最高温度**严格低于指定摄氏温度。 |
| integrity | region, material, percent | 取该区域内指定刚性材料的初始位置和强度。仍在原位置、材料相同且未掉入下落刚体的格子，按保留的 aux 强度计分，每格最多计初始强度。总和达到初始总强度的指定百分比即满足。空的初始结构会报错。 |
| survive | steps | 本关已模拟步数达到指定值。 |
| within | steps, condition | 当前步数不超过期限，并且子条件在当前步成立。嵌套使用时不会锁存之前已经失效的结果。 |
| hold | steps, condition | 子条件连续成立至少 steps 步。任一步不满足就重新累计，可用于胜败条件和任意嵌套。 |
| and / or | conditions | 非空子条件数组，全部满足 / 至少一项满足。 |
| not | condition | 反转子条件。 |

例如，下面的目标要求在第 90 步以内，同时达到水量和无火要求。

```json
{
  "op": "within", "steps": 90,
  "condition": {
    "op": "and",
    "conditions": [
      {"op":"count","region":"pool","material":"WATER","compare":">=","value":8},
      {"op":"noFire","region":"pool","steps":12}
    ]
  }
}
```

同一步的优先级为显式失败、通关、整关超时。因此在 maxSteps 的最后一步仍可获胜。终局锁住用时、得分和输入。重试会回卷到关卡起点，保留第 0 步的起手笔画；重置会清空全部笔画。实时关在后续步数放置的材料在两种操作中都会被回卷。

## 在浏览器新建一关

1. 在选关页点击「新建关卡」。默认新世界为 80×48。给关卡起名；章节、id、尺寸、种子、难度和时限在「元信息、失败条件与星级」中。
2. 选「地形矩形」和石头，拖出一条底板。选「目标区」，填入区域标识 `bucket`，在底板上方拖出收集框。相同 id 可重新绘制，也可移除。空气地形可擦空一块矩形。
3. 将白名单设为 `{"SAND":5}`，总预算设为 6。通关条件填 `{"op":"count","region":"bucket","material":"SAND","compare":">=","value":4}`。点击「应用配置」。
4. 可在「定时事件」输入步数、命令及 JSON 参数，点击「添加定时事件」。时间轴按步显示，点击条目可保存修改或删除。「环境设定」填写关卡环境，「关卡文本」填写双语描述及提示。
5. 点击「录制参考解法」。在框上方画一小排沙，再点击「运行」。通关后点击「采用本次录制」。实时关会记录笔画发生的实际步数。
6. 点击「验证参考解法」。两个独立世界都通关，且哈希、用时、用料和星级一致才算成功。「导出 JSON」会复验当前配置。修改后仍符合格式的旧参考可以继续验证。换玩法或白名单使参考不合法时，重新录制。
7. 回到选关页，用「载入关卡 JSON」直接游玩，或「导入并编辑 JSON」继续编辑。已载入的自制关卡按 id 留在本次页面的选关列表里。刷新前请导出要保留的作品。

## 恢复一局游戏

模式的 `serialize()` 保存页面、关卡来源、已走步数、玩家笔画、查看过的提示级数和阶段。旧存档缺少级数时从 0 恢复。调用当前模式的 `deserialize(data)` 时，会先在临时世界回放并核对阶段。若记录声称通关、实际回放却失败，调用会抛错，当前世界、用料和编辑表单仍可继续使用。成功后才切换到恢复的实例。

恢复终局时无需再走一步。管理器先发送 `mode:enter`，随后发送一次与回放一致的 `outcome`，并保持暂停。官方关卡按内置 id 找回定义；导入关卡即使用了相同的 id，仍按自制关处理。

## 参考回放与 CI

参考日志只含玩家笔画，时间为相对本关起点的已完成步数。同一步的笔画按数组原顺序执行，再执行下一步的关卡事件和物理模拟。规划关的所有笔画均在第 0 步。零放置的喷雾笔画也会记录，以便复现随机数状态。成功执行的定时命令和玩家笔画都进入 `world.recording()`，引擎日志使用命令发生时已完成的绝对步数。参考验证和进度恢复直接从关卡定义重建定时事件。通关后有多余步骤、未通关或两次回放不一致，验证命令都返回非零退出码。

```sh
node tools/levels.mjs validate
node tools/levels.mjs validate my-level.json
node tools/test.mjs --only=解谜
node tools/build.mjs
node tools/test.mjs
node tools/golden.mjs check
```

| 示例 | 玩法 | 星级 | 步数 | 用料 |
|---|---|---:|---:|---:|
| [一捧落沙](../src/modes/puzzle/levels/sand-cup.json) | 规划，沙粒自然落入禁建收集区 | 3 | 6 | 12 |
| [蓄水闸](../src/modes/puzzle/levels/water-lock.json) | 实时，在第 5 和 14 步分批注水 | 3 | 30 | 11 |
| [冷却桥墩](../src/modes/puzzle/levels/quiet-pier.json) | 规划，同时检查水量、火、温度和结构 | 3 | 73 | 10 |

发布内置关卡时，把导出的 JSON 放入 `src/modes/puzzle/levels/` 或它的子目录。构建和 CI 递归读取同一目录，并检查关卡 ID 唯一。每个目录可用 `order.json` 数组指定本目录的解锁顺序，也可沿用 `meta.json` 的 `order`。未列入顺序的关卡按文件名追加，子目录按目录名在其后加载。单文件构建会内联关卡 JSON 和 schema，浏览器可以离线加载。C3 的设计、验证数据和截图见[关卡设计报告](puzzle-levels.md)。

### C3 文本迁移

X5.1 已将 C3 的双语章名、关名、目标和三级提示合并进 30 个关卡。旧版副本可通过 `node tools/migrate/c3-text.mjs [关卡目录]` 预览迁移，加 `--write` 写入。工具会在写入前校验全部关卡，可重复执行。用 `node tools/c3/build.mjs` 重新生成 C3 关卡时会直接带上双语字段。

浏览器回归在 `tests/e2e/`。构建后运行 `npx playwright install chromium` 和 `npx playwright test`，会实际验证新玩家通关、刷新后解锁，以及从空白编辑、下载、载入、自制关进度隔离。
