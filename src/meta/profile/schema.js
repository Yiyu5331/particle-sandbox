// 档案分区独立校验。文明和生态的本机槽位目录从实际提交的槽位生成。
export const metaProfileVersion = 4;

export function newPlayerProfile() {
  return {
    version: metaProfileVersion,
    settings: { quality: 'high', volume: 0.6, gridPrecision: 3, language: 'zh-CN', autosaveMs: 0 },
    unlocked: [], puzzle: { stars: {} }, defense: { highestWave: 0, history: [] },
    codex: [], reactions: [], slots: [],
  };
}

function metaV1ToV2(old) {
  const { volumePercent, ...settings } = old.settings || {};
  if (volumePercent !== undefined) settings.volume = volumePercent / 100;
  const { stars, ...rest } = old;
  return { ...rest, version: 2, settings, puzzle: { stars: stars ?? {} } };
}

function metaV2ToV3(old) {
  const { bestWave, runs, ...rest } = old;
  return { ...newPlayerProfile(), ...rest, version: 3,
    settings: { ...newPlayerProfile().settings, ...old.settings },
    defense: { highestWave: bestWave ?? 0, history: runs ?? [] },
  };
}

// v3 的旧版 Blob 引用存放在整档备份中。读取双目录后按槽位补齐 previous。
function metaV3ToV4(old) {
  return { ...old, version: 4 };
}

const metaMigrations = { 1: metaV1ToV2, 2: metaV2ToV3, 3: metaV3ToV4 };
const metaId = id => (typeof id === 'string' && id.length > 0) || (Number.isSafeInteger(id) && id >= 0);
const metaPlain = o => o !== null && typeof o === 'object' && Object.getPrototypeOf(o) === Object.prototype;
const metaWave = n => Number.isSafeInteger(n) && n >= 0;

export function validateProfilePart(key, v) {
  let ok;
  if (key === 'settings') {
    ok = metaPlain(v) && ['low','mid','high','ultra'].includes(v.quality)
      && Number.isFinite(v.volume) && v.volume >= 0 && v.volume <= 1
      && [2,3,4].includes(v.gridPrecision) && typeof v.language === 'string' && v.language.length > 0
      && metaWave(v.autosaveMs) && v.autosaveMs <= 2147483647;
  } else if (key === 'puzzle') {
    ok = metaPlain(v?.stars) && Object.values(v.stars).every(n => Number.isInteger(n) && n >= 0 && n <= 3);
  } else if (key === 'defense') {
    ok = metaWave(v?.highestWave) && Array.isArray(v.history)
      && v.history.every(r => metaPlain(r) && metaWave(r.wave) && r.wave <= v.highestWave);
  } else if (key === 'slots') {
    ok = Array.isArray(v) && v.every(s => metaPlain(s) && typeof s.mode === 'string' && s.mode
      && typeof s.name === 'string' && s.name && /^slot-[a-z0-9-]+$/.test(s.key)
      && (s.previous == null || /^slot-[a-z0-9-]+$/.test(s.previous)))
      && new Set(v.map(s => JSON.stringify([s.mode, s.name]))).size === v.length;
  } else {
    ok = Array.isArray(v) && v.every(metaId) && new Set(v).size === v.length;
  }
  if (!ok) throw new Error('档案字段无效：' + key);
}

export function migratePlayerProfile(input, onInvalidPart) {
  let p = structuredClone(input);
  if (!Number.isInteger(p?.version) || p.version < 1 || p.version > metaProfileVersion) throw new Error('不支持的档案版本');
  while (p.version < metaProfileVersion) p = metaMigrations[p.version](p);
  const result = newPlayerProfile();
  for (const k of Object.keys(result)) {
    if (k === 'version') continue;
    try { validateProfilePart(k, p[k]); } catch (e) {
      if (!onInvalidPart) throw e;
      onInvalidPart(k);
      delete result[k];
      continue;
    }
    result[k] = p[k];
  }
  return result;
}

// FNV-1a，用于检测误码。文本按 UTF-16 码元计算。
export function metaChecksum(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
