# 物理解谜关卡

构建后打开 `dist/particle-sandbox.html?mode=puzzle`，或从主菜单进入「物理解谜」。选关按章节显示，第一关开放，上一关至少一星即解锁下一关。重复通关保留最高星。正式关卡的星级在 X2 提交成功后进入结算页，刷新后从档案恢复星级与解锁。存储失败可在结算页重试。编辑器试玩和导入关卡不会写入官方进度。

## 关卡文件

一个 UTF-8 JSON 文件定义一关。[完整 JSON Schema](../src/modes/puzzle/level.schema.json) 可供编辑器使用。浏览器和 Node 读取相同的 schema 和关卡文件。尺寸边界、区域引用、材料白名单、三星门槛和时间线还会经过跨字段检查。

| 字段 | 含义 |
|---|---|
| version / id / name / chapter / difficulty / hint | 格式版本 1、唯一标识、关名、章节、难度 1～5、提示。id 以英文字母开头，可接字母、数字、下划线或连字符。 |
| type | `planning` 暂停布置，点击运行后锁定画笔。 `realtime` 进入即开始，结算前可以继续绘制。 |
| world | `width, height, seed` 及 `commands` 或 `serialized` 两者之一。宽高各为 16～512 格。 |
| regions | `{id,type,x,y,w,h}` 的数组。矩形起点包含在内，右边界和下边界不包含。区域可重叠，id 在关内唯一。 |
| materials / budget | 材料名到格数上限的映射，以及整关最大用料。未列出的材料不可选。 |
| goal / fail | 通关条件和失败条件。没有显式失败条件时用 null。 |
| maxSteps | 整关时限，1～36,000 个模拟步。60 步相当于正常速度下 1 秒；暂停布置不计时。 |
| stars | `two`、`three` 各含 `maxUsed` 和 `maxSteps`。通关保底一星，两项都在对应上限以内才得该档星级。三星门槛不可宽于二星。 |
| reference | `{steps,log:[{step,command:"stroke",args},…]}`。steps 是实际结算步。编辑中的空参考可以是 `{"steps":0,"log":[]}`。 |

### 初始世界和区域

`world.commands` 是按顺序执行的 `{command,args}` 数组。v1 支持 fillRect、fillCircle、stroke、clear、setGravity、setWeather、setEnv、loadScene、ignite。参数沿用[引擎 API](API.md)。材料可写公开编号或大写材料键。初始命令先执行，再注册关卡区域，搭建地形不计入玩家预算。

`world.serialized` 接受 `world.serialize()` 返回的完整字符串，外层种子及内部网格尺寸必须与关卡声明相符。通过 restoreFull 命令载入物理状态，另用 addRegion 注册快照携带的区域规则，再添加本关命名区域。快照可以从非零 tick 开始，本关计时仍从 0 开始。条件使用关卡中显式命名的 region id。

- 金色目标区 `goal` 可用于统计，本身允许落笔。
- 虚线禁建区 `noBuild` 使用引擎的 `paint:false`。
- 蓝色保护区 `protected` 使用 `protect:true`。区域限制玩家命令，沙和水仍能通过物理运动进入。

玩家 stroke 参数是 `tool,x0,y0,x1,y1,size,shape?`。size 为 1～16，1 表示单格，shape 支持 circle、square、spray。玩家不能设置 limit、替换、擦除或发出关卡搭建命令。系统将单材余额和总余额的较小值作为 stroke.limit，再按实际 placed 扣款；重叠、越界裁切和受保护的格子不会重复收费。

## 目标条件

每个模拟步结束后求值一次，第一步记为 1。胜败条件共享该步的 queryRegion 结果。逻辑树的每个子条件都会采样，即使另一分支已经足以决定布尔结果。

| op | 参数 | 判定 |
|---|---|---|
| count | region, material, compare, value | 区域内材料格数，compare 为 `>=` 或 `<=`，包含等号。 |
| noFire | region, steps | 连续指定步数既没有 FIRE 材料，也没有带燃烧标志的格子。任一种火源都会清零计数。 |
| cooler | region, temperature | 区域**最高温度**严格低于指定摄氏温度。 |
| integrity | region, material, percent | 取该区域内指定刚性材料的初始位置和强度。仍在原位置、材料相同且未掉入下落刚体的格子，按保留的 aux 强度计分，每格最多计初始强度。总和达到初始总强度的指定百分比即满足。空的初始结构会报错。 |
| survive | steps | 本关已模拟步数达到指定值。 |
| within | steps, condition | 当前步数不超过期限，并且子条件在当前步成立。嵌套使用时不会锁存之前已经失效的结果。 |
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
4. 点击「录制参考解法」。在框上方画一小排沙，再点击「运行」。通关后点击「采用本次录制」。实时关会记录笔画发生的实际步数。
5. 点击「验证参考解法」。两个独立世界都通关，且哈希、用时、用料和星级一致才算成功。「导出 JSON」会复验当前配置。触发修改后，仍符合格式的旧参考可继续验证；换玩法或白名单使参考不合法时，重新录制。
6. 回到选关页，用「载入关卡 JSON」直接游玩，或「导入并编辑 JSON」继续编辑。已载入的自制关卡按 id 留在本次页面的选关列表里。刷新前请导出要保留的作品。

## 恢复一局游戏

模式的 `serialize()` 保存页面、关卡来源、已走步数、玩家笔画和阶段。调用当前模式的 `deserialize(data)` 时，会先在临时世界回放并核对阶段。若记录声称通关、实际回放却失败，调用会抛错，当前世界、用料和编辑表单仍可继续使用。成功后才切换到恢复的实例。

恢复终局时无需再走一步。管理器先发送 `mode:enter`，随后发送一次与回放一致的 `outcome`，并保持暂停。官方关卡按内置 id 找回定义；导入关卡即使用了相同的 id，仍按自制关处理。

## 参考回放与 CI

参考日志只含玩家笔画，时间为相对本关起点的已完成步数。同一步的笔画按数组原顺序执行，然后模拟下一步。规划关的所有笔画均在第 0 步。零放置的喷雾笔画也会记录，以便复现随机数状态。回放通过与玩家相同的白名单、预算、区域和判定代码执行。通关后有多余步骤、未通关或两次回放不一致，验证命令都返回非零退出码。

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

发布新的内置关卡时，把导出的 JSON 放入 `src/modes/puzzle/levels/`（可以放子目录，例如 C3 的 30 关在 `levels/c3/`），在 [catalog.js](../src/modes/puzzle/catalog.js) 中按解锁顺序注册。CI 会在 PR 和推送时递归扫描所有关卡（跳过 `meta.json`），检查目录并双播；引擎改动让任何一关解不开都会失败。C3 关卡的设计、验证数据和截图见 [puzzle-levels.md](puzzle-levels.md)。单文件构建会内联 JSON 和 schema，浏览器可以离线加载。

选关和编辑器使用共享面板、卡片网格、标签页和表单，预算与剩余时间由结构化 HUD 显示。内置标题、提示、规则和控件随语言实时更新；自制关内容和未提交的草稿保持原文。

浏览器回归在 `tests/e2e/`。构建后运行 `npx playwright install chromium` 和 `npx playwright test`，会实际验证新玩家通关、刷新后解锁，以及从空白编辑、下载、载入、自制关进度隔离。
