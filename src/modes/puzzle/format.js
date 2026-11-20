import { uiT } from '../../ui/i18n.js';
import puzzleSchema from './level.schema.json' with { type: 'json' };
import { MATERIALS, M_RIGID } from '../../engine/index.js';

const puzzleMaterials = new Map(MATERIALS.map(m => [m.key, m.id]));
export function puzzleMaterial(value) {
  const id = typeof value === 'number' ? value : puzzleMaterials.get(value);
  if (!Number.isInteger(id) || !MATERIALS[id]) throw new Error(uiT('未知材料：{id}',{id:value}));
  return id;
}

// 解释本 schema 用到的 JSON Schema 关键字；跨字段约束在结构校验后处理。
function puzzleCheckShape(s, value, path, depth = 0) {
  const bad = msg => { throw new Error(path + uiT('：') + uiT(msg)); };
  if (depth > 64) bad('条件嵌套过深');
  if (s.$ref) return puzzleCheckShape(puzzleSchema.$defs[s.$ref.split('/').pop()],value,path,depth);
  if (s.oneOf) {
    // 带标记的条件和命令按标记分派，以保留具体字段的报错位置。
    const fields = s.oneOf[0].properties || {};
    const discriminator = fields.op ? 'op' : fields.command ? 'command' : null;
    if (discriminator) {
      const variant = s.oneOf.find(v => v.properties[discriminator].const === value?.[discriminator]);
      if (!variant) bad(uiT('未知的 {key}',{key:discriminator}));
      return puzzleCheckShape(variant,value,path,depth);
    }
    let matches = 0;
    for (const variant of s.oneOf) {
      try { puzzleCheckShape(variant,value,path,depth); matches++; } catch {}
    }
    if (matches !== 1) bad('格式或类型不符合关卡定义');
    return;
  }
  if ('const' in s && value !== s.const || s.enum && !s.enum.includes(value)) bad('取值不合法');
  if (s.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad('应为对象');
    const keys = Object.keys(value);
    if (keys.length < (s.minProperties || 0)) bad('至少需要一个材料');
    for (const k of s.required || []) if (!Object.hasOwn(value,k)) bad(uiT('缺少 {key}',{key:k}));
    for (const k of keys) {
      const sub = Object.hasOwn(s.properties || {},k) ? s.properties[k] : s.additionalProperties;
      if (!sub) bad(uiT('不支持字段 {key}',{key:k}));
      puzzleCheckShape(sub,value[k],path + '.' + k,depth+1);
    }
  } else if (s.type === 'array') {
    if (!Array.isArray(value) || value.length < s.minItems || value.length > s.maxItems) bad('列表长度不合要求');
    value.forEach((v,i) => puzzleCheckShape(s.items,v,path+'['+i+']',depth+1));
  } else if (s.type === 'string') {
    if (typeof value !== 'string' || !value.trim() || value.length < s.minLength || value.length > s.maxLength || s.pattern && !new RegExp(s.pattern).test(value)) bad('文本格式不合要求');
  } else if (s.type === 'number' || s.type === 'integer') {
    if (!Number.isFinite(value) || s.type === 'integer' && !Number.isSafeInteger(value) || value < s.minimum || value > s.maximum) bad('数值不合要求');
  } else if (s.type === 'boolean' && typeof value !== 'boolean') bad('应为布尔值');
  else if (s.type === 'null' && value !== null) bad('应为 null');
}

export function puzzleCheckStroke(level, args) {
  puzzleCheckShape(puzzleSchema.$defs.stroke,args,uiT('笔画'));
  const id = puzzleMaterial(args.tool);
  if (!Object.hasOwn(level.materials,MATERIALS[id].key)) throw new Error(uiT('材料不在白名单'));
  for (const k of ['x0','x1','y0','y1']) if (args[k] >= (k[0] === 'x' ? level.world.width : level.world.height)) throw new Error(uiT('笔画越界'));
  return id;
}

export function puzzleValidateLevel(level) {
  puzzleCheckShape(puzzleSchema,level,uiT('关卡'));
  const {width,height,seed,commands,serialized} = level.world;
  if (serialized) {
    const data = JSON.parse(serialized);
    const scalars = data?.engine?.scalars;
    if (data?.kind !== 'world' || data.app !== 'particle-sandbox' || data.seed !== seed ||
      !Array.isArray(data.regions) || data.engine?.kind !== 'full' ||
      scalars?.W !== width || scalars?.H !== height) throw new Error(uiT('世界存档的尺寸、种子或格式不匹配'));
  }
  for (const {command,args} of commands || []) {
    if ('mat' in args) puzzleMaterial(args.mat);
    if ('tool' in args) puzzleMaterial(args.tool);
    for (const k of ['x0','x1','x','cx']) if (args[k] >= width) throw new Error(uiT('地形横坐标越界'));
    for (const k of ['y0','y1','y','cy']) if (args[k] >= height) throw new Error(uiT('地形纵坐标越界'));
    if (command === 'fillRect' && (args.x0 > args.x1 || args.y0 > args.y1)) throw new Error(uiT('地形矩形方向错误'));
  }
  for (const key of Object.keys(level.materials)) if (!puzzleMaterial(key)) throw new Error(uiT('不能把空气当作玩家材料'));
  const ids = new Set();
  for (const r of level.regions) {
    if (ids.has(r.id) || r.x+r.w > width || r.y+r.h > height) throw new Error(uiT('区域重名或越界：{id}',{id:r.id}));
    ids.add(r.id);
  }
  function condition(c) {
    if (c.region && !ids.has(c.region)) throw new Error(uiT('目标引用未知区域：{id}',{id:c.region}));
    if ('material' in c) {
      const id = puzzleMaterial(c.material);
      if (c.op === 'integrity' && !M_RIGID[id]) throw new Error(uiT('结构目标必须使用刚性材料'));
    }
    c.conditions?.forEach(condition);
    if (c.condition) condition(c.condition);
  }
  condition(level.goal); if (level.fail) condition(level.fail);
  for (const k of ['maxSteps','maxUsed']) if (level.stars.three[k] > level.stars.two[k]) throw new Error(uiT('三星门槛不能宽于二星'));
  const {steps,log} = level.reference;
  if (steps > level.maxSteps) throw new Error(uiT('参考解法超过时限'));
  let prev = 0;
  for (const event of log) {
    if (event.step < prev || event.step >= steps || level.type === 'planning' && event.step !== 0) throw new Error(uiT('参考笔画时间或顺序错误'));
    puzzleCheckStroke(level,event.args); prev = event.step;
  }
  return level;
}
