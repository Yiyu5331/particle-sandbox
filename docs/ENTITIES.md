# 实体（只有接口，尚未实现）

实体是在格子世界里移动、有自己状态的东西：塔防的敌人和炮塔、文明模式的小人、生态模式的动物。它们**不是**格子材料，也不进引擎：实体系统写在模式这一层（`src/entities/`），通过公开世界 API 读世界、用命令改世界。

## 为什么不放进引擎

- 引擎的哈希和黄金快照只覆盖格子物理。实体放在外面，引擎不用为每种玩法改动，也不会让黄金快照变化。
- 实体的数量少（几十到几百个），逻辑复杂（寻路、AI），和逐格物理的性能要求完全不同。
- 实体对世界的所有影响都走 `world.exec`，所以自动进录制，回放仍然逐格一致。

## 接口

```js
/**
 * @typedef {Object} Entity
 * @property {number} id            在一个 EntitySystem 里唯一，按创建顺序递增
 * @property {string} kind          'villager' | 'enemy' | 'tower' | …
 * @property {number} x, y          格子坐标（可以是小数，渲染时取整）
 * @property {number} vx, vy        每步位移
 * @property {number} hp
 * @property {Object} data          这种实体自己的状态（必须能 JSON 序列化）
 */

/**
 * @typedef {Object} EntityKind      每种实体一份定义
 * @property {string} kind
 * @property {(e: Entity, ctx: EntityContext) => void} update      每个模拟步一次，在 world.step 之后
 * @property {(e: Entity, ev: WorldEvent, ctx: EntityContext) => void} [onEvent]   附近发生的引擎事件
 * @property {(e: Entity, g: CanvasRenderingContext2D, cell: number) => void} [draw] 画在模式的叠加层上
 */

/**
 * @typedef {Object} EntityContext
 * @property {World} world           只读用：getCell / queryRegion / view；写只能 world.exec
 * @property {(cmd: string, args: object) => any} exec   = world.exec，方便统一记录
 * @property {() => number} rand     实体自己的确定性随机数（种子来自世界种子 + 实体 id），不能用 Math.random
 * @property {EntitySystem} system
 */

/**
 * @typedef {Object} EntitySystem    一个模式一个
 * @property {(kind: string, x: number, y: number, data?: object) => Entity} spawn
 * @property {(id: number) => void} remove
 * @property {(step: number) => void} update        模式的 update(step) 里调用：按 id 顺序更新全部实体
 * @property {(ev: WorldEvent) => void} onEvent      模式的 onEvent 里调用：按距离分发给附近的实体
 * @property {(x: number, y: number, r: number) => Entity[]} near
 * @property {() => object} serialize
 * @property {(o: object) => void} deserialize
 */
```

## 规则

1. **确定性**：更新顺序固定（按 id），随机数用自己的 xorshift（种子 = 世界种子 ⊕ 实体 id），不读时钟。同样的录制回放出同样的实体轨迹。
2. **只通过命令改世界**：实体挖土 = `exec('stroke', {tool: TOOL_ERASE, …})`，放火 = `exec('ignite', …)`。不要直接写 `getField` 返回的数组。
3. **读世界用公开 API**：脚下是什么 `getCell`，周围有没有火 `queryRegion(...).burning`，温度 `getField('temp')`。
4. **和格子的碰撞**由实体自己判定（读 `type` 场，结合 `MATERIALS[t].state`）。实体不会被格子物理推动；需要的话在 `update` 里自己处理（比如站的地方变成水就下沉）。
5. **存档**：模式的 `serialize()` = `{world: world.serialize(), entities: system.serialize(), …}`。

## 以后可能需要的引擎接口

这些现在都没有，需要时写进 `docs/API_REQUESTS.md`：

- 批量读一行 / 一列（寻路扫描时减少 `getCell` 调用）
- 「格子对实体的力」：爆炸冲击波、水流对附近实体的推力（目前只能从 `explosion` 事件自己估算）
- 让实体在渲染器里画成格子颜色的一部分（目前只能画在叠加层上）
