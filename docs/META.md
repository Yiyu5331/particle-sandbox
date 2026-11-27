# 玩家档案与存档

沙盘的「存档」菜单可以保存命名槽位、设置自动存档间隔，以及导出或导入整个玩家档案。世界 JSON 和录制文件仍有各自的导入导出按钮。旧版 v4.1 的本地槽位在列表里标为「旧版」，支持原文和 gzip 格式。读取旧槽位后点击保存，即可将它纳入新档案。

## 模式如何使用

模式从 `ctx.profile` 取得同一个服务。存储被浏览器禁用时为 `null`。在无头环境中可以自行创建服务。

```js
import { createProfileStore } from './src/meta/profile/index.js';
import { createMemoryStorage } from './src/meta/profile/storage.js';
import { recordPuzzleStars, recordDefenseRun } from './src/meta/profile/runtime.js';

const store = createProfileStore(createMemoryStorage(), { onWarning: console.warn });
await store.updateProfile(p => {
  p.settings.language = 'zh-TW';
  if (!p.unlocked.includes('ICE')) p.unlocked.push('ICE');
});
await recordPuzzleStars(store, '溢洪道', 2);
await recordDefenseRun(store, { wave: 12, score: 400 });

await store.saveSlot('civ', '河谷', world, { thumbnail: pngDataUrl, data: { villagers } });
const names = await store.listSlots('civ');
const { json, thumbnail, data } = await store.loadSlot('civ', '河谷');
world.exec('restoreFull', { json });
```

最后一行沿用沙盘的命令读档路径。C0 的这条命令恢复物理状态，但沿用目标世界的种子和区域。槽位中的原文保留了两者。依赖保护区或跟踪区的模式见[完整读档命令需求](API_REQUESTS.md)。

| 接口 | 行为 |
|---|---|
| `openProfileStorage()` | 打开 IndexedDB。新库会试写事务。启动失败时退回 localStorage。主库为空时继续使用已有后备档案。两边都有进度时，先合并，再切回主库。 |
| `readProfile()` | 读取独立副本。旧档在读取时迁移，下次成功写入时持久化。 |
| `updateProfile(edit)` | 在最新档案上执行同步修改函数并验证。返回已提交的档案。槽位目录由槽位 API 维护。 |
| `recordPuzzleStars(store, level, stars)` | 保存最高星级，同关重玩可提高星级。 |
| `recordDefenseRun(store, {wave, ...其他字段})` | 追加一场结果并更新最高波次。历史记录使用 JSON 数据。 |
| `saveSlot(mode, name, world, options?)` | 调用时立即捕获 `world.serialize()`。同模式同名覆盖。可传 `thumbnail` 和 `data`，分别是 PNG/JPEG/WebP 的 base64 数据 URL 和模式自己的 JSON 状态。 |
| `listSlots(mode)` / `listPreviews(mode)` | 返回名称数组，或带 `{name, thumbnail}` 的数组。文明用 `civ`，生态用 `eco`。 |
| `loadSlot(mode, name)` / `deleteSlot(mode, name)` | 读取校验过的 `{json, thumbnail, data}`，或删除指定槽位并回收空间。 |
| `exportProfile()` / `importProfile(file)` | 导出可下载的 JSON Blob，或从 File、Blob、JSON 字符串导入。带清单的备份通过校验后替换进度和槽位。旧备份保留本机独有槽位。 |
| `createProfileAutosave(save, onError)` | 返回控制器，`setInterval(ms)` 调整间隔，传 0 停止。前一次写入未结束时跳过本次触发。 |

API 的异步操作应等待完成并处理异常。保存新槽位时，捕获世界或构造缩略图也可能失败。沙盘只对当前活动的沙盘世界自动保存，回放和自测期间暂停，专用槽位名为「自动存档」。IndexedDB 用原生读写事务协调同源标签页。localStorage 优先使用 Web Locks，缺少该 API 时按跨页票号排队。崩溃页面的票据在 30 秒后过期，恢复的旧页面写入前会重新验票。浏览器自测使用独立内存档案。

## 数据结构

当前逻辑档案为 v4。存储适配器通过 `exclusive(async rows => …)` 提供一次串行操作，`rows` 提供异步的 `get(key)`、`put(key,value)`、`remove(key)`、`keys()`。服务通过 `kind` 标识后端。

| 分区 | 内容 |
|---|---|
| settings | quality 为 low/mid/high/ultra，volume 为 0～1，gridPrecision 为每格 2/3/4 像素，language 为语言标记，autosaveMs 为毫秒间隔，默认 0。当前界面为简体中文。 |
| unlocked | 已解锁元素的唯一 ID 数组，由玩法决定解锁条件。 |
| puzzle | `{stars: {关卡ID: 0至3}}`。 |
| defense | `{highestWave, history: [{wave, ...}]}`。 |
| codex / reactions | 已收录的条目 ID 和已发现的反应 ID，各自去重。游戏总线的首次生成材料和反应事件会自动更新。 |
| slots | `[{mode, name, key, previous}]`。key 指向当前世界，previous 指向该槽位上一次可读的世界，首次保存时为 null。调用方用模式和名称寻址。 |

IndexedDB 的库名为 `particle-sandbox-meta`，对象仓库为 `records`。后备存储的键前缀为 `particle-sandbox-meta-`。主库以 Blob 保存世界，后备存储用等价的 JSON 文本编码它。世界、模式数据和缩略图各自有校验和。FNV-1a 校验用于发现意外损坏。

档案记录 `profile` 和上次写入前的 `backup` 保存 `{version, parts: {字段: {value, sum}}}`。单个分区校验或结构检查失败时，先读备份中的同一字段，再尝试默认值。缩略图损坏时仍能读世界。世界损坏时，从同一槽位的 previous 指针读取旧版。调整设置、更新进度和写其他槽位都会保留这个指针。无法恢复的槽位会单独报错，导出时将其列进 `skipped`，其他槽位和进度仍可备份。

写入新世界时先暂存独立 Blob，再更新目录。导入多个槽位同样只在末尾切换目录。校验或配额失败会清除本次暂存数据，原有进度和槽位继续可用。崩溃留下的未引用 Blob 会在后续成功的槽位操作中回收。配额错误通过 Promise 返回给调用方，用户可以导出档案、删除槽位后重试。

## 主库恢复与备份文件

IndexedDB 和后备库都有已提交的目录时，打开游戏会合并两个档案。图鉴、反应和解锁取并集，每关星级和最高波次取较高值，守护历史追加后备记录。后备设置中与默认值不同的项优先。若两边使用同一个模式和槽位名，主库存档保留原名，后备世界加「后备 1」等后缀。合并和接收记录在同一次主库事务提交，之后才切换后备目录并清理旧数据。中断后可以重试；已迁出的旧标签页会提示刷新。

新版文件的格式标记为 `particle-profile-v2`。`manifest` 校验槽位名称、模式、各条目校验和以及 `skipped` 清单。少了整项、改了名称或丢失清单时，导入会在替换本机目录前失败。导出时已标记为损坏跳过的世界，如果本机还保留同名槽位，导入会保留本机副本。较早的 `particle-profile` 文件没有完整性清单，按模式和名称合并槽位。

## 新增一个迁移

1. 在 `schema.js` 为当前版本编写到下一版的纯函数，如 `metaV4ToV5(old)`。函数返回新结构和目标版本号。在 `metaMigrations` 以来源版本为键注册，保留之前的迁移。
2. 更新 `metaProfileVersion`、`newPlayerProfile()` 和 `validateProfilePart()`。有版本号的新分区也要定义合理的缺省值。保持旧迁移的目标版本及已有字段含义稳定。
3. 在 `tests/suites/profile.test.js` 放入旧格式数据，分别通过本地读档或文件导入入口验证。覆盖已有值、缺省值、跨多版本升级、未来版本拒绝写入。若变更槽位二进制格式，另外在 `metaReadSlot` 中按槽位版本迁移，保留旧 Blob 的解码能力。
4. 运行 `npm ci --ignore-scripts`、`node tools/test.mjs --only=档案`，再运行构建、完整测试和黄金快照。测试依赖 fake-indexeddb 仅由 Node 测试导入。

已有迁移覆盖 v1 → v2 的百分比音量和关卡星级、v2 → v3 的守护历史与默认设置、v3 → v4 的槽位上一版引用。读取旧目录时从备份目录补全引用，再随下次成功写入持久化。单个旧分区损坏时，保留其余有效进度，本机读档使用对应备份或默认值，旧文件导入优先保留本机同一字段。

界面读取 `store.progress` 得到最近成功读取或提交的只读进度摘要；`store.onProgress(fn)` 可订阅变更并返回解绑函数。档案导入、槽位增删和关卡结算都使用同一来源。
