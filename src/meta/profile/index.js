import { metaChecksum, metaProfileVersion, migratePlayerProfile, newPlayerProfile, validateProfilePart } from './schema.js';

function metaPackProfile(profile) {
  const parts = {};
  for (const [key, value] of Object.entries(profile)) {
    if (key !== 'version') parts[key] = { value, sum: metaChecksum(JSON.stringify(value)) };
  }
  return { version: profile.version, parts };
}

function metaReadPart(row, key, validate = true) {
  const part = row?.parts?.[key];
  if (!part || part.value === undefined || part.sum !== metaChecksum(JSON.stringify(part.value))) throw new Error('校验失败');
  if (validate) validateProfilePart(key, part.value);
  return part.value;
}

// 老文件可为普通 JSON，也可沿用带分区校验的封装。
function metaUpgradeRow(row, recover = false) {
  if (row?.version === metaProfileVersion && row.parts) return row;
  const damaged = new Set();
  let plain = row;
  if (row?.parts) {
    plain = { version: row.version };
    for (const k of Object.keys(row.parts)) {
      try { plain[k] = metaReadPart(row, k, false); } catch (e) {
        if (!recover) throw e;
        // 映射到新分区后交给备份恢复，防止迁移默认值掩盖损坏。
        const target = { stars: 'puzzle', bestWave: 'defense', runs: 'defense' }[k] || k;
        damaged.add(target);
      }
    }
  }
  const profile = migratePlayerProfile(plain, recover ? key => damaged.add(key) : undefined);
  for (const key of damaged) delete profile[key];
  return metaPackProfile(profile);
}

function metaThumbnailValid(image) {
  return image === null || (typeof image === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image));
}

function metaPackSlot(json, thumbnail, data) {
  if (!metaThumbnailValid(thumbnail)) throw new Error('缩略图格式无效');
  const world = new Blob([json], { type: 'application/json' });
  data = JSON.parse(JSON.stringify(data));
  return { version: 1, world, worldSum: metaChecksum(json), thumbnail, imageSum: metaChecksum(thumbnail || ''),
    data, dataSum: metaChecksum(JSON.stringify(data)) };
}

class MetaSlotDamage extends Error {}

async function metaReadSlot(row, warn) {
  if (row?.version > 1) throw new Error('请升级游戏后读取新版槽位');
  if (row?.version !== 1 || !(row.world instanceof Blob)) throw new MetaSlotDamage('槽位不存在或格式无效');
  const json = await row.world.text();
  if (metaChecksum(json) !== row.worldSum || row.data === undefined || metaChecksum(JSON.stringify(row.data)) !== row.dataSum) {
    throw new MetaSlotDamage('世界或模式数据校验失败');
  }
  let thumbnail = row.thumbnail;
  if (!metaThumbnailValid(thumbnail) || metaChecksum(thumbnail || '') !== row.imageSum) {
    thumbnail = null;
    warn('缩略图损坏，已保留世界');
  }
  return { json, data: row.data, thumbnail };
}

function metaProfileOps(adapter, onWarning) {
  async function readRow(key) {
    try { return await adapter.get(key); } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      onWarning('记录损坏：' + key);
      return null;
    }
  }
  async function readProfileRow(key) {
    const row = await readRow(key);
    if (row?.version > metaProfileVersion) throw new Error('请升级游戏后读取新版档案');
    if (!row) return row;
    try { return metaUpgradeRow(row, true); } catch { return null; }
  }
  async function read() {
    const p = newPlayerProfile();
    const primary = await readProfileRow('profile');
    let backup;
    for (const key of Object.keys(p)) {
      if (key === 'version') continue;
      try { p[key] = metaReadPart(primary, key); } catch {
        if (backup === undefined) backup = (await readProfileRow('backup')) ?? null;
        if (primary === undefined && !backup) break;
        try { p[key] = metaReadPart(backup, key); onWarning('已从备份恢复：' + key); }
        catch { onWarning('已重置损坏字段：' + key); }
      }
    }
    // 升级未带 previous 的目录。旧格式的上一版可能仍在备份目录中。
    if (p.slots.some(s => s.previous === undefined)) {
      backup ??= await readProfileRow('backup');
      let previous = [];
      try { previous = metaReadPart(backup, 'slots'); } catch {}
      for (const entry of p.slots) {
        const prior = previous.find(s => s.mode === entry.mode && s.name === entry.name);
        if (entry.previous === undefined) {
          entry.previous = prior?.key === entry.key ? prior.previous ?? null : prior?.key ?? null;
        }
      }
    }
    return p;
  }
  async function commit(before, after) {
    const value = migratePlayerProfile(after);
    await adapter.put('backup', metaPackProfile(before));
    await adapter.put('profile', metaPackProfile(value));
    return value;
  }
  // 两代目录均已提交后再回收旧 Blob。中断遗留的临时 Blob 在下次整理时回收。
  async function collect(current, previous) {
    const keep = new Set([...current.slots, ...previous.slots].flatMap(s => [s.key, s.previous]));
    try {
      for (const k of await adapter.keys()) if (k.startsWith('slot-') && !keep.has(k)) await adapter.remove(k);
    } catch (e) { onWarning('旧槽位清理失败：' + e.message); }
  }
  async function stage(mode, name, row, staged) {
    if (typeof mode !== 'string' || !mode || typeof name !== 'string' || !name) throw new Error('缺少模式或槽位名');
    const key = 'slot-' + [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, '0')).join('');
    await adapter.put(key, row);
    staged.push(key);
    return { mode, name, key, previous: null };
  }
  async function changeSlots(change) {
    const before = await read();
    const staged = [];
    let after;
    try {
      after = await change(structuredClone(before), staged);
      after = await commit(before, after);
    } catch (e) {
      for (const k of staged) await adapter.remove(k).catch(() => {});
      throw e;
    }
    await collect(after, before);
    return after;
  }
  async function load(entry) {
    if (!entry) throw new Error('找不到槽位');
    try { return await metaReadSlot(await readRow(entry.key), onWarning); } catch (e) {
      if (!(e instanceof MetaSlotDamage)) throw e;
      if (!entry.previous) throw e;
      const result = await metaReadSlot(await readRow(entry.previous), onWarning);
      onWarning('已恢复槽位的上一版：' + entry.name);
      return result;
    }
  }

  return {
    readProfile: read,
    async updateProfile(edit) {
      const before = await read(), next = structuredClone(before);
      const result = edit(next);
      if (result && typeof result.then === 'function') throw new Error('档案修改函数必须同步执行');
      next.slots = before.slots;
      return commit(before, next);
    },
    async listSlots(mode) {
      return (await read()).slots.filter(s => s.mode === mode).map(s => s.name);
    },
    async listPreviews(mode) {
      const slots = (await read()).slots.filter(s => s.mode === mode);
      return Promise.all(slots.map(async s => {
        const row = await readRow(s.key);
        const image = row?.thumbnail;
        const thumbnail = metaThumbnailValid(image) && row?.imageSum === metaChecksum(image || '') ? image : null;
        return { name: s.name, thumbnail };
      }));
    },
    saveSlot(mode, name, row) {
      return changeSlots(async (p, staged) => {
        const entry = await stage(mode, name, row, staged);
        const prior = p.slots.find(s => s.mode === mode && s.name === name);
        if (prior) {
          // 即使当前版本损坏，也保留已校验的上一版。
          try { await metaReadSlot(await readRow(prior.key), onWarning); entry.previous = prior.key; }
          catch (e) {
            if (!(e instanceof MetaSlotDamage)) throw e;
            if (prior.previous) entry.previous = prior.previous;
          }
        }
        p.slots = p.slots.filter(s => s.mode !== mode || s.name !== name);
        p.slots.push(entry);
        return p;
      });
    },
    async loadSlot(mode, name) {
      return load((await read()).slots.find(s => s.mode === mode && s.name === name));
    },
    async deleteSlot(mode, name) {
      const p = await read();
      p.slots = p.slots.filter(s => s.mode !== mode || s.name !== name);
      // 只缩小已有目录，让满盘时的删除仍能释放空间。
      const backup = await readProfileRow('backup');
      let oldSlots = [];
      try { oldSlots = metaReadPart(backup, 'slots'); } catch {}
      const remaining = oldSlots.filter(s => s.mode !== mode || s.name !== name);
      if (remaining.length !== oldSlots.length) {
        backup.parts.slots = { value: remaining, sum: metaChecksum(JSON.stringify(remaining)) };
        await adapter.put('backup', backup);
      }
      await adapter.put('profile', metaPackProfile(p));
      await collect(p, { slots: remaining });
      return p;
    },
    async exportProfile() {
      const p = await read(), saves = [], skipped = [];
      for (const s of p.slots) {
        let slot;
        try { slot = await load(s); } catch (e) {
          if (!(e instanceof MetaSlotDamage)) throw e;
          skipped.push({ mode: s.mode, name: s.name });
          onWarning('导出已跳过损坏槽位：' + s.name);
          continue;
        }
        const { json, thumbnail, data } = slot;
        saves.push({ mode: s.mode, name: s.name, json, sum: metaChecksum(json), thumbnail, data,
          imageSum: metaChecksum(thumbnail || ''), dataSum: metaChecksum(JSON.stringify(data)) });
      }
      const manifest = metaSaveManifest(saves, skipped);
      return new Blob([JSON.stringify({ format: 'particle-profile-v2', profile: metaPackProfile({ ...p, slots: [] }),
        saves, skipped, manifest })], { type: 'application/json' });
    },
    async importProfile(file) {
      const archive = JSON.parse(typeof file === 'string' ? file : await file.text());
      const damaged = [];
      const isArchive = archive?.format === 'particle-profile' || archive?.format === 'particle-profile-v2';
      if (archive?.format !== undefined && !isArchive) throw new Error('不支持的备份格式');
      const saves = isArchive ? archive.saves : [];
      if (!Array.isArray(saves)) throw new Error('不支持的备份格式');
      if (archive?.format === 'particle-profile-v2' && (!Array.isArray(archive.skipped)
        || archive.manifest !== metaSaveManifest(saves, archive.skipped))) throw new Error('备份槽位清单校验失败');
      const input = isArchive ? archive.profile : archive;
      const legacy = input?.version >= 1 && input.version < metaProfileVersion;
      const packed = metaUpgradeRow(input, legacy);
      const profile = newPlayerProfile();
      for (const key of Object.keys(profile)) {
        if (key === 'version') continue;
        try { profile[key] = metaReadPart(packed, key); } catch (e) {
          if (!legacy) throw e;
          damaged.push(key);
        }
      }
      if (profile.slots?.length) throw new Error('备份缺少槽位内容');
      return changeSlots(async (before, staged) => {
        for (const key of damaged) {
          profile[key] = before[key];
          onWarning('导入时保留本机字段：' + key);
        }
        // 旧备份没有槽位清单；无法区分条目遗失和主动删除，保留本机独有槽位。
        // 新备份中明确标记为损坏跳过的槽位也可以保留本机副本。
        if (archive.format === 'particle-profile') {
          profile.slots = before.slots.filter(s => !saves.some(item => item.mode === s.mode && item.name === s.name));
        } else if (archive.format === 'particle-profile-v2') {
          profile.slots = before.slots.filter(s => archive.skipped.some(item => item.mode === s.mode && item.name === s.name));
        }
        for (const s of saves) {
          if (typeof s.json !== 'string' || s.sum !== metaChecksum(s.json) || s.imageSum !== metaChecksum(s.thumbnail || '')
            || s.dataSum !== metaChecksum(JSON.stringify(s.data))) throw new Error('备份槽位校验失败');
          const row = metaPackSlot(s.json, s.thumbnail, s.data);
          profile.slots.push(await stage(s.mode, s.name, row, staged));
        }
        return profile;
      });
    },
  };
}

function metaSaveManifest(saves, skipped) {
  const entries = saves.map(s => [s.mode, s.name, s.sum, s.imageSum, s.dataSum]);
  return metaChecksum(JSON.stringify([entries, skipped.map(s => [s.mode, s.name])]));
}

export function createProfileStore(adapter, { onWarning = () => {} } = {}) {
  if (adapter.warning) onWarning(adapter.warning);
  // 只有已读取或已提交的档案可以更新界面投影。写入失败保留上一次结果。
  let progress = null;
  const listeners = new Set();
  const profileResults = new Set(['readProfile','updateProfile','saveSlot','deleteSlot','importProfile']);
  function publish(profile) {
    const stars = { ...profile.puzzle.stars };
    progress = Object.freeze({
      stars:Object.freeze(stars), sandbox:profile.codex.length, defense:profile.defense.highestWave,
      puzzle:Object.values(stars).filter(n => n > 0).length,
      civ:profile.slots.filter(s => s.mode === 'civ').length,
      eco:profile.slots.filter(s => s.mode === 'eco').length,
    });
    for (const listener of listeners) {
      try { listener(progress); } catch (error) { console.error('进度界面刷新失败',error); }
    }
  }
  async function run(method, args) {
    try {
      const value = await adapter.exclusive(rows => metaProfileOps(rows, onWarning)[method](...args));
      if (profileResults.has(method)) publish(value);
      return value;
    } catch (error) {
      if (error.name === 'QuotaExceededError') throw new Error('存储空间不足，请导出档案或清理空间后重试', { cause: error });
      throw error;
    }
  }
  const store = {
    kind:adapter.kind, get progress() { return progress; },
    onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  for (const method of ['readProfile', 'updateProfile', 'listSlots', 'listPreviews', 'deleteSlot', 'loadSlot', 'exportProfile', 'importProfile']) {
    store[method] = (...args) => run(method, args);
  }
  store.saveSlot = (mode, name, world, { thumbnail = null, data = null } = {}) => {
    // 排队前捕获世界和模式数据。
    return run('saveSlot', [mode, name, metaPackSlot(world.serialize(), thumbnail, data)]);
  };
  return store;
}

// 调用者已锁住后备库；target 是一次 IDB 读写事务，目录和所有 Blob 一起提交。
export async function mergeFallbackProfile(source, target, id) {
  const quiet = () => {};
  const incoming = await metaProfileOps(source, quiet).readProfile();
  const receipt = await target.get('fallbackReceipt');
  const checksum = metaChecksum(JSON.stringify(incoming));
  if (receipt?.id === id && receipt.checksum === checksum) return;
  const original = await metaProfileOps(target, quiet).readProfile();
  const merged = structuredClone(original);
  const defaults = newPlayerProfile();
  for (const key of Object.keys(defaults.settings)) {
    if (incoming.settings[key] !== defaults.settings[key]) merged.settings[key] = incoming.settings[key];
  }
  for (const key of ['unlocked', 'codex', 'reactions']) merged[key] = [...new Set([...original[key], ...incoming[key]])];
  for (const [level, stars] of Object.entries(incoming.puzzle.stars)) {
    const best = Object.hasOwn(merged.puzzle.stars, level) ? merged.puzzle.stars[level] : 0;
    Object.defineProperty(merged.puzzle.stars, level, {
      value: Math.max(best, stars), enumerable: true, configurable: true, writable: true,
    });
  }
  merged.defense.highestWave = Math.max(original.defense.highestWave, incoming.defense.highestWave);
  const history = incoming.defense.history;
  const consumed = receipt?.id === id && receipt.historySum === metaChecksum(JSON.stringify(history.slice(0, receipt.count))) ? receipt.count : 0;
  merged.defense.history = original.defense.history.concat(history.slice(consumed));
  for (const entry of incoming.slots) {
    if (merged.slots.some(s => s.key === entry.key)) continue;
    let name = entry.name, suffix = 1;
    while (merged.slots.some(s => s.mode === entry.mode && s.name === name)) name = entry.name + '（后备 ' + suffix++ + '）';
    for (const key of [entry.key, entry.previous].filter(Boolean)) {
      if (await target.get(key) !== undefined) continue;
      const row = await source.get(key);
      if (row !== undefined) await target.put(key, row);
    }
    merged.slots.push({ ...entry, name });
  }
  await target.put('backup', metaPackProfile(original));
  await target.put('profile', metaPackProfile(migratePlayerProfile(merged)));
  await target.put('fallbackReceipt', { id, checksum, count: history.length, historySum: metaChecksum(JSON.stringify(history)) });
}
