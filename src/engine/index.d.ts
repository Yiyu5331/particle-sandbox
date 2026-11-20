// 粒子沙盘引擎公开 API 的类型声明（docs/API.md 是说明书，这里是精确签名）。
// 运行时代码是纯 JS；这个文件给编辑器补全和 AI 读接口用，不参与构建。

export type MaterialId = number;
export type Hash = string; // 16 位十六进制

export interface CreateWorldOptions { width: number; height: number; seed?: number; }

export type EventType = 'reaction' | 'materialFirstCreated' | 'ignite' | 'extinguish' | 'explosion' | 'collapse' | 'lightning' | 'regionChanged';
export const EVENT_TYPES: readonly EventType[];

interface EventBase { type: EventType; step: number; }
/** 本步里某条接触规则触发了 count 次；x,y 是第一次触发的位置 */
export interface ReactionEvent extends EventBase { type: 'reaction'; rule: number; reactant: MaterialId; other: MaterialId; products: [MaterialId, MaterialId]; count: number; x: number; y: number; }
/** 这个世界里第一次出现某种材料（resetWorld / reset 之后重新算）。put/morph 立即登记，其它路径最多晚 16 步 */
export interface MaterialFirstCreatedEvent extends EventBase { type: 'materialFirstCreated'; material: MaterialId; }
/** 本步新点着了 count 格；x,y 是第一格 */
export interface IgniteEvent extends EventBase { type: 'ignite'; count: number; x: number; y: number; }
/** 本步烧完 / 被浇灭了 count 格 */
export interface ExtinguishEvent extends EventBase { type: 'extinguish'; count: number; x: number; y: number; }
/** 本步的爆炸，按 32×32 的块聚合：count 个起爆点，x,y 是它们的平均位置 */
export interface ExplosionEvent extends EventBase { type: 'explosion'; count: number; x: number; y: number; radius: number; power: number; }
/** 一块结构失去支撑变成下落的刚体 */
export interface CollapseEvent extends EventBase { type: 'collapse'; cells: number; x: number; y: number; material: MaterialId; }
export interface LightningEvent extends EventBase { type: 'lightning'; x: number; y: number; fromX: number; fromY: number; }
/** track:true 的区域内容变了；counts 是区域里各材料的格数（按材料 key） */
export interface RegionChangedEvent extends EventBase { type: 'regionChanged'; region: number; tag: string; counts: Record<string, number>; }
export type WorldEvent = ReactionEvent | MaterialFirstCreatedEvent | IgniteEvent | ExtinguishEvent | ExplosionEvent | CollapseEvent | LightningEvent | RegionChangedEvent;

export interface Cell {
  x: number; y: number; type: MaterialId; key: string; name: string; temp: number; flags: number; seed: number;
  life: number; fuel: number; wet: number; aux: number; charge: number; burning: boolean; inBody: boolean;
}

export type FieldName = 'type' | 'temp' | 'flags' | 'seed' | 'life' | 'fuel' | 'wet' | 'aux' | 'charge' | 'vapor' | 'cloud' | 'windX' | 'heat';
export const FIELDS: readonly FieldName[];

export interface Rect { x: number; y: number; w: number; h: number; }
export interface MaskRect extends Rect { mask: Uint8Array; }
export interface RegionQuery {
  cells: number; counts: Uint32Array; byKey: Record<string, number>;
  burning: number; avgTemp: number; maxTemp: number; minTemp: number;
}
export interface RegionRules {
  /** 玩家笔刷完全不能改这里；ignite / explode / spawn 落在这里被拒绝 */
  protect?: boolean;
  /** false：不能放材料 */
  paint?: boolean;
  /** false：不能擦 */
  erase?: boolean;
  /** 只允许放这些材料 */
  allow?: MaterialId[];
}
export interface RegionDef extends Rect { tag?: string; mask?: Uint8Array; track?: boolean; rules?: RegionRules; }
export interface Region extends Rect { id: number; tag: string; track: boolean; rules: RegionRules; mask: Uint8Array | number[] | null; }

// ---- 命令（world.exec 的全部写操作） ----
export interface StrokeArgs { tool: MaterialId; x0: number; y0: number; x1: number; y1: number; size: number; shape?: 'circle' | 'square' | 'spray'; replace?: boolean; erase?: boolean; /** 预算：最多放这么多格 */ limit?: number; }
export interface StrokeResult { placed: number; removed: number; }
export interface Rejected { rejected: 'protected' | 'budget'; region?: number; }
export interface Commands {
  stroke: [StrokeArgs, StrokeResult];
  strokeBegin: [{}, null];
  strokeEnd: [{}, null];
  fillRect: [{ mat: MaterialId; x0: number; y0: number; x1: number; y1: number }, null];
  fillCircle: [{ mat: MaterialId; cx: number; cy: number; r: number }, null];
  clear: [{}, null];
  ignite: [{ x: number; y: number }, null];
  explode: [{ x: number; y: number; r?: number; p?: number }, null];
  lightning: [{ x?: number }, null];
  setWeather: [{ key: string }, null];
  setEnv: [{ key: 'wind' | 'windPower' | 'temp' | 'time' | 'timeScale' | 'dayNight' | 'structure' | 'moistPerMin' | 'atmosCap'; value: number | boolean }, null];
  setGravity: [{ dir: 'down' | 'up' | 'left' | 'right' }, null];
  loadScene: [{ index: number }, null];
  restoreScene: [{ json: string }, null];
  restoreFull: [{ json: string }, null];
  resize: [{ w: number; h: number }, null];
  spawn: [{ mat: MaterialId; x: number; y: number; r?: number }, null];
}
export type CommandName = keyof Commands;
export interface CommandRecord<K extends CommandName = CommandName> { step: number; command: K; args: Commands[K][0]; }
export interface Recording { app: 'particle-sandbox'; kind: 'recording'; v: number; seed: number; w: number; h: number; steps: number; log: CommandRecord[]; regions?: Region[]; }
export interface Snapshot { kind: 'world-snapshot'; }

export interface FxHooks { onBoom?: ((x: number, y: number, radius: number, power: number) => void) | null; onThunder?: ((x: number, y: number) => void) | null; onCrash?: ((...a: unknown[]) => void) | null; }

/** 宿主只读状态（渲染器 / 音频 / 调试面板用）：全是活引用，只能读；世界换尺寸后要重新取 */
export interface RenderState {
  W: number; H: number; N: number; CW: number; CHN: number; chunkTTL: Uint8Array; chunkCount: Uint16Array; tick: number; gx: number; gy: number;
  gravity: 'down' | 'up' | 'left' | 'right'; gridEpoch: number;
  type: Uint8Array; temp: Float32Array; flags: Uint8Array; seed: Uint8Array; life: Uint16Array; fuel: Uint16Array; wet: Uint8Array; aux: Uint8Array; charge: Uint8Array;
  ripples: Float32Array; rippleHead: number;
  fpAlive: Uint8Array; fpType: Uint8Array; fpSeed: Uint8Array; fpTemp: Float32Array; fpX: Float32Array; fpY: Float32Array; fpPX: Float32Array; fpPY: Float32Array; fpQX: Float32Array; fpQY: Float32Array; fpCount: number;
  GW: number; GH: number; cloud: Float32Array; vapor: Float32Array; windX: Float32Array; heatC: Float32Array; lastBolt: { x: number; y: number; sx: number; sy: number; tick: number } | null;
  env: Readonly<Record<string, unknown>>; st: Record<string, number>; perf: Record<string, number>; simStepsTotal: number;
  exActive: number; elecCount: number; bodyCount: number; bodies: unknown[]; structHold: boolean; structStats: Record<string, number>; sceneState: unknown;
}

export interface World {
  readonly width: number; readonly height: number; readonly tick: number; readonly seed: number; readonly disposed: boolean;
  /** 往前走 n 步；每步结束按固定顺序派发事件；返回这次调用产生的全部事件（没有订阅者时返回空数组） */
  step(n?: number): WorldEvent[];
  hash(): Hash;
  getCell(x: number, y: number): Cell | null;
  getField(name: FieldName, opt?: { copy?: boolean }): Uint8Array | Uint16Array | Float32Array;
  fieldSize(name: FieldName): { w: number; h: number };
  views(): Readonly<Record<FieldName, ArrayLike<number>> & { width: number; height: number }>;
  /** 只读视图：属性都是 getter；热循环里先取到局部变量 */
  readonly view: Readonly<RenderState>;
  renderState(): RenderState;
  getEnv(): Record<string, unknown>;
  queryRegion(area: Rect | MaskRect | number): RegionQuery;
  exec<K extends CommandName>(command: K, args?: Commands[K][0]): Commands[K][1] | Rejected;
  exec<K extends CommandName>(command: { command: K; args?: Commands[K][0] }): Commands[K][1] | Rejected;
  snapshot(): Snapshot;
  restore(s: Snapshot): void;
  serialize(): string;
  deserialize(s: string | object): void;
  recording(): Recording;
  replay(rec: Recording, steps?: number): Hash;
  replayBegin(rec: Recording): void;
  replayPump(): boolean;
  replayEnd(keepLog?: boolean): void;
  readonly replaying: boolean;
  reset(seed?: number): void;
  setRecording(on: boolean): void;
  readonly recordingOn: boolean;
  captureScene(): string;
  addRegion(def: RegionDef): number;
  removeRegion(id: number): void;
  regions(): Region[];
  regionAt(x: number, y: number): number[];
  on(type: EventType | '*', fn: (e: WorldEvent, w: World) => void): () => void;
  off(type: EventType | '*', fn: (e: WorldEvent, w: World) => void): void;
  setFxHooks(h: FxHooks): void;
  setProfiler(clock: (() => number) | null): void;
  dispose(): void;
}

export function createWorld(opts: CreateWorldOptions): World;
/** 让「宿主默认世界」（没用 createWorld 时的模块状态）回到台上；只有测试和工具需要 */
export function activateHostWorld(): void;
export function activeWorld(): World | null;
export const HOST_WORLD: { readonly isHost: true; renderState(): RenderState; readonly view: Readonly<RenderState> };
export function cloneState<T>(v: T): T;
/** 冷启动热身：临时世界里跑一遍爆炸、倒塌、闪电，跑完就扔 */
export function warmUpEngine(): void;

// ---- 静态数据（只读） ----
export interface Material { id: MaterialId; key: string; name: string; state: number; cat: string; density: number; conductivity: number; heatCapacity: number; hardness: number; palette: string[]; [k: string]: unknown; }
export const MATERIALS: readonly Material[];
export const NT: number;
export const EMPTY: 0;
export const TOOL_ERASE: number;
export const STATE_NAMES: readonly string[];
export const RULES: readonly { a: MaterialId; b: MaterialId; a2: MaterialId; b2: MaterialId; p: number; tag?: string; use?: number; idx: number }[];
export const SCENES: readonly { name: string; note: string }[];
export const WEATHER_PRESETS: Readonly<Record<string, { name: string; moistPerMin: number; atmosCap: number; cloudFade: number; storm: number; windPower: number }>>;
export const RAIN_THR: number;
export function thunderDelay(x: number, y: number): number;
export const COMMANDS: Readonly<Record<CommandName, (a: object) => unknown>>;
export const ENV_DEFAULTS: Readonly<Record<string, unknown>>;
export const LEDGER_KEYS: readonly string[];
export const F_PAR: number, F_BURN: number, F_SCORCH: number, F_TIP: number, F_BODY: number, F_PIN: number, F_FALL: number;
export const CHUNK: number, SIM_HZ: number, FP_MAX: number, BODY_MAX: number;
export function bytesToB64(u8: Uint8Array): string;
export function b64ToBytes(b: string): Uint8Array;
// 材料 id 常量（SAND、WATER、STONE……）和材料属性表（M_DENS、M_FLAM……）也从这里导出，见 src/engine/materials.js
export const SAND: MaterialId, WATER: MaterialId, STONE: MaterialId, WOOD: MaterialId, FIRE: MaterialId, LAVA: MaterialId, OIL: MaterialId, TNT: MaterialId, METAL: MaterialId, ICE: MaterialId, STEAM: MaterialId, SMOKE: MaterialId, PLANT: MaterialId, SOIL: MaterialId, SEED: MaterialId;
