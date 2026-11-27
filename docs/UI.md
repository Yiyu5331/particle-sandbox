# 通用界面

普通启动进入主菜单。背景的火山岛是一个 208×112、种子为 412 的独立世界，由现有模式管理器和渲染器实时运行。演示可以暂停，系统要求减少动态效果时默认暂停。进入其他模式会释放演示世界。返回自由沙盒会接续之前的沙盒，「重新开始」才新建世界。

`?mode=sandbox`、`?mode=puzzle`、`?scene=1` 和开发自测参数仍可直接进入对应场景。加载页面根据画布初始化、引擎热身、注册模式、渲染热身这四项的实际完成情况前进。C0 的引擎热身是同步调用，内部热身阶段的接入状态见 [API_REQUESTS.md](API_REQUESTS.md)。

## 界面与数据来源

- 主菜单可进入模式选择、自由沙盒、材料图鉴和设置。选择页含五个玩法入口，介绍和进度摘要由 `uiModes` 与 `port.progress(modeId)` 提供。进度来自 X2 已读取或成功提交的档案，依次使用图鉴条目数、最高波次、获星关卡数、文明槽位数、生态槽位数。
- 主菜单的材料图鉴入口保留占位说明，待 X3 接入。开发者子菜单只在 `?dev=1` 显示，内含地图生成器。设置与沙盒共用画质、音量和每格像素边长；语言即时生效，X2 的 settings.language 保存选择。
- 游玩中按 Esc 打开暂停菜单。已有沙盒浮层时先关闭浮层，并将焦点还给打开它的按钮。M 或顶栏菜单使用管理器的 openMenu / closeMenu，回游戏时恢复打开菜单前的暂停状态。空格和沙盒暂停按钮仍只控制模拟时钟，支持单步操作。
- 结算订阅 `game.bus` 的 `outcome` 事件。支持原有 `{state, score, detail}`，另可附 `stats: [{label, value}]`。界面展示得分、模拟步数、额外统计和重新开始按钮。胜负由模式判定。
- 壳层在 `src/ui/application.js` 连接公开的模式注册、启动、暂停及总线接口。DOM 测试可给 `uiScreens(root, app, port)` 注入进度、设置和控制动作；页面逻辑不依赖引擎内部状态。

## 原生组件

`src/ui/components.js` 的工厂均接受显示文本，由调用者传入当前语言。普通组件返回 DOM 节点，Modal 返回生命周期对象。节点使用原生按钮、表单和列表语义，图标使用内联 SVG。

| 组件 | 调用方式 |
|---|---|
| Button | `uiButton(label, onClick, icon?)` |
| Panel | `uiPanel(title, ...children)`，标题与区域通过 ARIA 关联 |
| Modal | `uiModal(title, content, onBack, backgroundNodes)`，调用 `open(host, initialFocus?)` 和 `close()` |
| Tabs | `uiTabs([{label, panel}], selectedIndex, accessibleLabel)`，支持左右键、Home 和 End |
| Field | `uiField(label, input)`，为文本框、数字框或 JSON 编辑框关联可访问名称 |
| Slider | `uiSlider(label, min, max, value, onInput)`，回调收到数值 |
| Toggle | `uiToggle(label, checked, onChange)`，回调收到布尔值 |
| Select | `uiSelect(label, [[value, text]], initialValue, onChange)`，回调收到字符串 |
| Tooltip | `uiTooltip(anchor, text)`，将返回的提示节点挂入 DOM；支持焦点、悬停和 Esc |
| Toast | `uiToast(liveRegion, text, delayMs?)`，更新礼貌通告区域，重复使用同一区域会重置计时 |
| ProgressBar | `uiProgress(label, value, max = 100)` |
| 卡片网格、列表 | `uiCardGrid(nodes)`、`uiList(nodes)`，各项保留列表语义 |
| 内联图标 | `uiIcon(name)`。可用 sandbox、defense、puzzle、civ、eco、book、settings、back、home、play、pause、restart、victory；图标对辅助技术隐藏，动作由按钮文字命名 |

```js
import { uiModal, uiPanel, uiButton } from './src/ui/components.js';
import { uiT } from './src/ui/i18n.js';

const close = () => modal.close();
const panel = uiPanel(uiT('设置'), uiButton(uiT('返回'), close, 'back'));
const modal = uiModal(uiT('设置'), panel, close, [document.querySelector('#app')]);
modal.open(document.querySelector('#ui-screen'));
```

对话框打开时禁用背景交互并聚焦首个动作，Tab 与 Shift+Tab 在对话框内循环，关闭后恢复焦点。嵌套页面返回时记住入口控件。沙盒画布也可聚焦，方向键移动笔刷，Enter 绘制，Delete 擦除。颜色、字体、阴影、圆角、间距和毛玻璃变量集中在 `src/index.html` 的 `:root`，新组件与沙盒共享。

## HUD 数据格式

模式可继续返回字符串或 null，也可返回对象。以下是一个包含五类元素的模式示例。

```js
getHUD() {
  return { items: [
    { id: 'score', type: 'value', label: '得分', value: this.score },
    { id: 'health', type: 'progress', label: '耐久', value: this.hp, max: 100 },
    { id: 'clock', type: 'countdown', label: '时间', seconds: this.remaining },
    { id: 'tip', type: 'hint', label: '用水保护目标' },
    { id: 'next', type: 'button', label: '下一波', disabled: this.running, onClick: () => this.nextWave() },
  ] };
}
```

每项的 id 在当前 HUD 中唯一并保持稳定。按数组顺序显示，倒计时按分、秒格式化，label 可以带 `params` 命名参数。为自定义 label 在词表补上译文。按钮按稳定 id 复用节点并更新回调，数值刷新时保持焦点。传空数组或 null 即清空。C2 合入前，注册模式时由 X4 的 `uiHudMode` 包装 `getHUD()`。管理器每轮采样一次，包装器将结果送入 X4 渲染器，再返回 null。C2 合并时由 Claude 移除包装并连接正式的 HUD 接口。

## 翻译与验收

`src/ui/catalog.js` 以中文原文为键，英文模板使用相同的命名参数，例如 `uiT('最高波次 · {n}', {n: 4})`。`uiSetLanguage('zh-CN' | 'en')` 同步更新文档语言、静态文本、ARIA 名称和当前页面。动态控件由各自渲染函数更新；玩家槽名和文件名按输入原文显示。开发者自测报告保留仓库测试用例的原名。

```sh
npm ci --ignore-scripts
node tools/build.mjs
node tools/check-i18n.mjs
node tools/test.mjs --only=UI
node tools/test.mjs
node tools/golden.mjs check
npx playwright install chromium
npx playwright test
```

翻译脚本检查词表、插值参数、HTML 属性、显示数据和界面源码，再加载构建产物检查英文 DOM。UI 用例覆盖每种组件、真实管理器导航、键盘输入、模式隔离、双语切换、存读档和结算。happy-dom 提供 DOM，Acorn 校验脚本语法和词条；二者仅用于开发。浏览器的 `?test=1` 另外验证实际渲染和声音。
