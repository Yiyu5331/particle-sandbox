import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createWorld, WATER } from '../../src/engine/index.js';
import { createBus } from '../../src/game/bus.js';
import { createProfileStore } from '../../src/meta/profile/index.js';
import { metaChecksum, migratePlayerProfile, newPlayerProfile } from '../../src/meta/profile/schema.js';
import { createMemoryStorage, openProfileStorage } from '../../src/meta/profile/storage.js';
import { attachProfileDiscoveries, createProfileAutosave, recordPuzzleStars, recordDefenseRun } from '../../src/meta/profile/runtime.js';

function memoryLocal() {
  const rows = new Map();
  return {
    get length() { return rows.size; },
    getItem: k => rows.get(k) ?? null,
    setItem: (k, v) => rows.set(k, v),
    key: i => [...rows.keys()][i],
    removeItem: k => rows.delete(k),
  };
}
const sampleWorld = n => ({ serialize: () => JSON.stringify({ tick: n }) });
const preview = 'data:image/png;base64,AQID';

test('档案迁移 v1：音量百分比、解谜星级和解锁保留到最新版', async () => {
  const store = createProfileStore(createMemoryStorage());
  const old = { version: 1, settings: { volumePercent: 35, quality: 'mid' }, stars: { dam: 3 }, unlocked: [2], bestWave: 4 };
  const p = await store.importProfile(JSON.stringify(old));
  assert.deepEqual(p.settings, { ...newPlayerProfile().settings, volume: 0.35, quality: 'mid' });
  assert.deepEqual(p.puzzle.stars, old.stars);
  assert.deepEqual(p.unlocked, [2]);
  assert.equal(p.defense.highestWave, 4);
  assert.deepEqual(await store.readProfile(), p);
});

test('档案迁移 v2：本地旧档拆出守护历史并保留发现记录', async () => {
  const a = createMemoryStorage();
  const old = { version: 2, bestWave: 9, runs: [{ wave: 9, score: 140 }], codex: [2], reactions: [3], settings: { language: 'zh-TW' } };
  await a.put('profile', old);
  const store = createProfileStore(a), p = await store.readProfile();
  assert.deepEqual(p.defense, { highestWave: 9, history: old.runs });
  assert.deepEqual(p.reactions, [3]);
  assert.deepEqual(p.codex, [2]);
  assert.equal(p.settings.language, 'zh-TW');
  await store.updateProfile(next => { next.puzzle.stars.dam = 1; });
  assert.equal((await a.get('profile')).version, newPlayerProfile().version);
  assert.throws(() => migratePlayerProfile({ version: newPlayerProfile().version + 1 }), /版本/);
});

for (const kind of ['memory', 'indexedDB', 'localStorage']) {
  test('档案存读真实世界、缩略图、同名跨模式槽位：' + kind, async () => {
    const a = kind === 'memory' ? createMemoryStorage() : await openProfileStorage({
      indexedDB: kind === 'indexedDB' ? new IDBFactory() : null, localStorage: memoryLocal(),
    });
    assert.equal(a.kind, kind);
    const store = createProfileStore(a);
    const w = createWorld({ width: 42, height: 30, seed: 92 });
    w.exec('fillRect', { x0: 6, y0: 2, x1: 12, y1: 9, mat: WATER });
    w.step(17);
    const hash = w.hash();
    const save = store.saveSlot('civ', '河谷', w, { thumbnail: preview, data: { villagers: 3 } });
    w.step(13);
    await save;
    await store.saveSlot('eco', '河谷', w);
    const stored = await a.get((await store.readProfile()).slots[0].key);
    assert.ok(stored.world instanceof Blob);
    const reopened = createProfileStore(a);
    const slot = await reopened.loadSlot('civ', '河谷');
    assert.deepEqual(slot.data, { villagers: 3 });
    assert.equal(slot.thumbnail, preview);
    assert.deepEqual(await store.listPreviews('civ'), [{ name: '河谷', thumbnail: preview }]);
    const restored = createWorld({ width: 16, height: 16, seed: 1 });
    restored.exec('restoreFull', { json: slot.json });
    assert.equal(restored.hash(), hash);
    restored.step(13);
    assert.equal(restored.hash(), w.hash());
    const file = await store.exportProfile();
    assert.equal(file.type, 'application/json');
    const imported = createProfileStore(createMemoryStorage());
    await imported.importProfile(file);
    assert.deepEqual(await imported.listSlots('civ'), ['河谷']);
    assert.deepEqual(await imported.listSlots('eco'), ['河谷']);
    assert.deepEqual(await imported.loadSlot('civ', '河谷'), slot);
    await store.deleteSlot('civ', '河谷');
    assert.deepEqual(await store.listSlots('civ'), []);
    assert.deepEqual(await store.listSlots('eco'), ['河谷']);
    w.dispose(); restored.dispose();
  });
}

test('档案损坏：单分区恢复、完整 JSON 损坏、未知版本保护', async () => {
  const local = memoryLocal(), a = await openProfileStorage({ localStorage: local });
  const warnings = [], store = createProfileStore(a, { onWarning: s => warnings.push(s) });
  await store.updateProfile(p => { p.settings.volume = 0.3; });
  await store.updateProfile(p => { p.settings.volume = 0.9; p.unlocked.push(7); });
  const row = await a.get('profile');
  row.parts.settings.value.volume = 0.4;
  await a.put('profile', row);
  assert.equal((await store.readProfile()).settings.volume, 0.3);
  assert.deepEqual((await store.readProfile()).unlocked, [7]);
  assert.ok(warnings.some(s => s.includes('settings')));
  local.setItem('particle-sandbox-meta-profile', '{');
  assert.equal((await store.readProfile()).settings.volume, 0.3);
  await a.put('profile', { version: 17 });
  await assert.rejects(store.updateProfile(() => {}), /升级/);
  assert.deepEqual(await a.get('profile'), { version: 17 });
  assert.equal((await openProfileStorage({ indexedDB: new IDBFactory(), localStorage: local })).kind, 'localStorage');
  await assert.rejects(openProfileStorage({}), /不可用/);
});

test('档案损坏：缩略图降级，坏槽位回退，其他世界仍可读取', async () => {
  const a = createMemoryStorage(), store = createProfileStore(a);
  await store.saveSlot('eco', '池塘', sampleWorld(4));
  await store.saveSlot('civ', '城', sampleWorld(1));
  const p = await store.saveSlot('civ', '城', sampleWorld(2), { thumbnail: preview });
  const key = p.slots.find(s => s.mode === 'civ').key, row = await a.get(key);
  await a.put(key, { ...row, thumbnail: null });
  assert.deepEqual(await store.loadSlot('civ', '城'), { json: '{"tick":2}', thumbnail: null, data: null });
  await a.put(key, { ...row, world: new Blob(['坏']) });
  assert.equal((await store.loadSlot('civ', '城')).json, '{"tick":1}');
  assert.equal((await store.loadSlot('eco', '池塘')).json, '{"tick":4}');
  const other = p.slots.find(s => s.mode === 'eco').key;
  await a.remove(other);
  await assert.rejects(store.loadSlot('eco', '池塘'), /不存在/);
  const archive = JSON.parse(await (await store.exportProfile()).text());
  assert.deepEqual(archive.skipped, [{ mode: 'eco', name: '池塘' }]);
  assert.equal(archive.saves.length, 1);
});

test('档案配额不足：目录提交失败，清理暂存 Blob，重试可成功', async () => {
  const a = createMemoryStorage(), store = createProfileStore(a), put = a.put;
  await store.saveSlot('civ', '城', sampleWorld(1));
  const keys = await a.keys();
  a.put = async (k, v) => {
    if (k === 'profile') throw new DOMException('已满', 'QuotaExceededError');
    return put(k, v);
  };
  await assert.rejects(store.saveSlot('civ', '城', sampleWorld(2)), /空间不足/);
  assert.deepEqual(await a.keys(), keys);
  assert.equal((await store.loadSlot('civ', '城')).json, '{"tick":1}');
  a.put = put;
  await store.saveSlot('civ', '城', sampleWorld(2));
  assert.equal((await store.loadSlot('civ', '城')).json, '{"tick":2}');
});

test('档案文件导入：第二个槽位损坏时整次撤回，覆盖成功后目录一致', async () => {
  const source = createProfileStore(createMemoryStorage());
  await source.saveSlot('civ', '一', sampleWorld(1));
  await source.saveSlot('eco', '二', sampleWorld(2));
  const file = await source.exportProfile(), archive = JSON.parse(await file.text());
  const a = createMemoryStorage(), dest = createProfileStore(a);
  await dest.saveSlot('sandbox', '已有', sampleWorld(3));
  const previousKeys = await a.keys();
  archive.saves[1].json += 'x';
  await assert.rejects(dest.importProfile(JSON.stringify(archive)), /校验/);
  assert.deepEqual(await a.keys(), previousKeys);
  assert.deepEqual(await dest.listSlots('sandbox'), ['已有']);
  await dest.importProfile(file);
  assert.deepEqual(await dest.listSlots('sandbox'), []);
});

test('档案并发修改：独立进度无丢失，发现事件去重，可解绑', async () => {
  const a = createMemoryStorage(), store = createProfileStore(a), second = createProfileStore(a);
  await Promise.all([store.updateProfile(p => { p.unlocked.push('ICE'); }),
    second.updateProfile(p => { p.puzzle.stars.ice = 3; })]);
  const bus = createBus(), off = attachProfileDiscoveries(bus, store, await store.readProfile(), assert.fail);
  bus.emit('world:reaction', { rule: 0 }); bus.emit('world:reaction', { rule: 0 });
  bus.emit('world:materialFirstCreated', { material: 4 });
  off(); bus.emit('world:materialFirstCreated', { material: 5 });
  const p = await store.readProfile();
  assert.deepEqual(p.codex, [4]); assert.deepEqual(p.reactions, [0]);
  assert.deepEqual(p.unlocked, ['ICE']); assert.equal(p.puzzle.stars.ice, 3);
  await assert.rejects(store.updateProfile(v => { v.settings.volume = -1; }), /settings/);
});

test('档案自动存档：间隔切换、重叠跳过、失败可重试、关闭', async () => {
  let run, finish, count = 0, interval = 0, failed = 0;
  const timers = {
    setInterval(fn, ms) { run = fn; interval = ms; return 42; },
    clearInterval(id) { assert.equal(id, 42); run = null; },
  };
  const auto = createProfileAutosave(async () => {
    count++;
    if (count === 1) await new Promise(resolve => { finish = resolve; });
    else throw new Error('配额不足');
  }, () => failed++, timers);
  auto.setInterval(500); assert.equal(interval, 500);
  const pending = run(); await run(); assert.equal(count, 1);
  finish(); await pending;
  auto.setInterval(1000); assert.equal(interval, 1000);
  await run(); await run(); assert.equal(failed, 2);
  auto.setInterval(0); assert.equal(run, null);
  assert.throws(() => auto.setInterval(-1), /无效/);
});

test('档案进度：重玩保留最高星、守护最高波次和每场历史，JSON 往返', async () => {
  const store = createProfileStore(createMemoryStorage());
  await recordPuzzleStars(store, '水坝', 3);
  await recordPuzzleStars(store, '水坝', 1);
  await recordDefenseRun(store, { wave: 8, score: 160 });
  await recordDefenseRun(store, { wave: 2, score: 20 });
  const restored = await store.importProfile(await store.exportProfile());
  assert.deepEqual(restored.puzzle.stars, { 水坝: 3 });
  assert.deepEqual(restored.defense, { highestWave: 8, history: [{ wave: 8, score: 160 }, { wave: 2, score: 20 }] });
  assert.throws(() => recordPuzzleStars(store, '水坝', 4), /星级/);
  await assert.rejects(recordDefenseRun(store, { wave: -1 }), /defense/);
});

test('档案世界封装：完整文本传入命令，保留种子与保护区', async () => {
  const world = createWorld({ width: 32, height: 24, seed: 243 });
  const region = world.addRegion({ x: 1, y: 2, w: 4, h: 4, rules: { protect: true } });
  const store = createProfileStore(createMemoryStorage());
  const source = world.serialize();
  await store.saveSlot('puzzle', '堤坝', world);
  const { json } = await store.loadSlot('puzzle', '堤坝');
  // 模拟待接入的完整读档命令，用公开反序列化接口核对外层元数据。
  const mirror = createWorld({ width: 16, height: 16, seed: 1 });
  const receiver = { exec(cmd, args) {
    assert.equal(cmd, 'restoreFull'); assert.equal(args.json, source);
    mirror.deserialize(args.json);
  } };
  receiver.exec('restoreFull', { json });
  assert.equal(mirror.seed, world.seed);
  assert.deepEqual(mirror.regionAt(2, 3), [region]);
  assert.equal(mirror.hash(), world.hash());
  world.dispose(); mirror.dispose();
});

test('档案删除回收被删除槽位的 Blob，可释放空间', async () => {
  const a = createMemoryStorage(), store = createProfileStore(a);
  await store.saveSlot('civ', '甲', sampleWorld(1));
  await store.saveSlot('civ', '甲', sampleWorld(2));
  await store.deleteSlot('civ', '甲');
  assert.deepEqual((await a.keys()).sort(), ['backup', 'profile']);
});

for (const backend of ['memory', 'indexedDB', 'localStorage']) {
  test('档案跨客户端：无 Web Locks 并发保存两槽与进度，均可读取（' + backend + '）', async () => {
    const host = { indexedDB: backend === 'indexedDB' ? new IDBFactory() : null, localStorage: memoryLocal(), navigator: { locks: null } };
    const adapter = backend === 'memory' ? createMemoryStorage() : await openProfileStorage(host);
    const other = backend === 'memory' ? adapter : await openProfileStorage(host);
    const a = createProfileStore(adapter);
    const module = await import('../../src/meta/profile/index.js?independent-client');
    const b = module.createProfileStore(other);
    await Promise.all([
      a.saveSlot('civ', '甲', sampleWorld(1)), b.saveSlot('civ', '乙', sampleWorld(2)),
      recordPuzzleStars(a, '坝', 2), recordPuzzleStars(b, '桥', 3),
    ]);
    assert.deepEqual((await a.listSlots('civ')).sort(), ['乙', '甲']);
    assert.equal((await b.loadSlot('civ', '甲')).json, '{"tick":1}');
    assert.equal((await a.loadSlot('civ', '乙')).json, '{"tick":2}');
    assert.deepEqual((await b.readProfile()).puzzle.stars, { 坝: 2, 桥: 3 });
  });
}

test('档案损坏回退：修改音量、写其他槽、重开客户端后仍能取回上一版', async () => {
  const a = createMemoryStorage(), store = createProfileStore(a);
  await store.saveSlot('civ', '城', sampleWorld(1));
  const profile = await store.saveSlot('civ', '城', sampleWorld(2));
  const key = profile.slots[0].key;
  await a.put(key, { ...await a.get(key), world: new Blob(['损坏']) });
  assert.equal((await store.loadSlot('civ', '城')).json, '{"tick":1}');
  await store.updateProfile(p => { p.settings.volume = 0.3; });
  await store.saveSlot('eco', '林', sampleWorld(9));
  assert.equal((await createProfileStore(a).loadSlot('civ', '城')).json, '{"tick":1}');
  // 同名槽位再写一代时，损坏版本也不应挤掉原有的健康副本。
  const repaired = await store.saveSlot('civ', '城', sampleWorld(3));
  const latest = repaired.slots.find(s => s.mode === 'civ');
  await a.remove(latest.key);
  assert.equal((await store.loadSlot('civ', '城')).json, '{"tick":1}');
});

test('档案迁移：旧档单区损坏，从备份或默认值恢复并保留其余分区', async () => {
  const a = createMemoryStorage(), store = createProfileStore(a);
  const old = { version: 2, settings: { volume: '损坏' }, bestWave: 8, runs: [{ wave: 8 }],
    unlocked: [2], puzzle: { stars: { dam: 3 } } };
  await a.put('profile', old);
  assert.equal((await store.readProfile()).settings.volume, 0.6);
  await a.put('backup', { ...old, settings: { volume: 0.42 } });
  const p = await store.updateProfile(profile => { profile.codex.push('ICE'); });
  assert.equal(p.settings.volume, 0.42);
  assert.deepEqual(p.puzzle.stars, { dam: 3 });
  assert.deepEqual(p.defense, { highestWave: 8, history: [{ wave: 8 }] });
  assert.deepEqual(p.unlocked, [2]);
  const imported = await store.importProfile(JSON.stringify(old));
  assert.equal(imported.settings.volume, 0.42);
  assert.deepEqual(imported.puzzle.stars, p.puzzle.stars);
});

test('档案后备迁移：数据库恢复后合并进度和同名世界，重新打开不重复历史', async () => {
  const host = { indexedDB: new IDBFactory(), localStorage: memoryLocal(), navigator: { locks: null } };
  const db = createProfileStore(await openProfileStorage(host));
  await recordPuzzleStars(db, 'A', 2);
  await recordDefenseRun(db, { wave: 4 });
  await db.saveSlot('civ', '城', sampleWorld(1));
  const offline = createProfileStore(await openProfileStorage({ ...host, indexedDB: null }));
  await recordPuzzleStars(offline, 'B', 3);
  await recordDefenseRun(offline, { wave: 7 });
  await offline.saveSlot('civ', '城', sampleWorld(2));
  const recovered = createProfileStore(await openProfileStorage(host));
  assert.equal(recovered.kind, 'indexedDB');
  assert.deepEqual((await recovered.readProfile()).puzzle.stars, { A: 2, B: 3 });
  assert.equal((await recovered.loadSlot('civ', '城')).json, '{"tick":1}');
  assert.equal((await recovered.loadSlot('civ', '城（后备 1）')).json, '{"tick":2}');
  await assert.rejects(offline.saveSlot('eco', '旧页', sampleWorld(1)), /刷新/);
  const reopened = createProfileStore(await openProfileStorage(host));
  assert.deepEqual((await reopened.readProfile()).defense, { highestWave: 7, history: [{ wave: 4 }, { wave: 7 }] });
});

test('档案备份清单：整项丢失、改名和缺清单均不能覆盖，旧格式保留本机独有槽位', async () => {
  const a = createMemoryStorage(), store = createProfileStore(a);
  await store.saveSlot('eco', '池塘', sampleWorld(1));
  const original = JSON.parse(await (await store.exportProfile()).text());
  for (const alter of [
    archive => { archive.saves = []; },
    archive => { archive.saves[0].name = '沼泽'; },
    archive => { delete archive.manifest; },
    archive => { archive.skipped.push({ mode: 'eco', name: '池塘' }); },
  ]) {
    const archive = structuredClone(original); alter(archive);
    const keys = await a.keys();
    await assert.rejects(store.importProfile(JSON.stringify(archive)), /清单/);
    assert.deepEqual(await a.keys(), keys);
    assert.equal((await store.loadSlot('eco', '池塘')).json, '{"tick":1}');
  }
  const old = { ...original, format: 'particle-profile', saves: [] };
  delete old.manifest;
  await store.importProfile(JSON.stringify(old));
  assert.equal((await store.loadSlot('eco', '池塘')).json, '{"tick":1}');
});

test('档案迁移 v3：从双目录找回旧 Blob 并在 v4 显式保存其引用', async () => {
  const a = createMemoryStorage(), store = createProfileStore(a);
  await store.saveSlot('civ', '甲', sampleWorld(1));
  await store.saveSlot('civ', '甲', sampleWorld(2));
  for (const k of ['profile', 'backup']) {
    const old = await a.get(k);
    old.version = 3;
    delete old.parts.slots.value[0].previous;
    old.parts.slots.sum = metaChecksum(JSON.stringify(old.parts.slots.value));
    await a.put(k, old);
  }
  const migrated = await store.updateProfile(p => { p.settings.volume = 0.3; });
  assert.equal(migrated.version, 4);
  assert.ok(migrated.slots[0].previous);
  await a.remove(migrated.slots[0].key);
  assert.equal((await store.loadSlot('civ', '甲')).json, '{"tick":1}');
});

test('档案后备迁移：主库提交后退役失败，重试接续新进度', async () => {
  const local = memoryLocal(), host = { localStorage: local, indexedDB: new IDBFactory(), navigator: { locks: null } };
  const primary = createProfileStore(await openProfileStorage(host));
  await recordDefenseRun(primary, { wave: 1 });
  const offline = createProfileStore(await openProfileStorage({ ...host, indexedDB: null }));
  await recordDefenseRun(offline, { wave: 2 });
  const set = local.setItem;
  local.setItem = (key, value) => {
    if (key === 'particle-sandbox-fallback-generation') throw new DOMException('已满', 'QuotaExceededError');
    set(key, value);
  };
  const interrupted = await openProfileStorage(host);
  assert.equal(interrupted.kind, 'localStorage');
  assert.match(interrupted.warning, /后备/);
  local.setItem = set;
  await recordDefenseRun(createProfileStore(interrupted), { wave: 3 });
  const after = createProfileStore(await openProfileStorage(host));
  assert.deepEqual((await after.readProfile()).defense.history, [{ wave: 1 }, { wave: 2 }, { wave: 3 }]);
});

test('档案事务：IDB 请求已成功但事务中止时撤回所有写入', async () => {
  const a = await openProfileStorage({ indexedDB: new IDBFactory() });
  await a.put('原值', 1);
  await assert.rejects(a.exclusive(async rows => {
    await rows.put('临时', '已写');
    await rows.remove('原值');
    throw new Error('模拟提交前中断');
  }), /中断/);
  assert.deepEqual(await a.keys(), ['原值']);
  assert.equal(await a.get('原值'), 1);
});

test('档案跨页票据：挂起页面失去票据后无法写回旧状态', async () => {
  const local = memoryLocal(), host = { localStorage: local, navigator: { locks: null } };
  const old = await openProfileStorage(host), next = await openProfileStorage(host);
  let entered, resume;
  const ready = new Promise(r => { entered = r; });
  const paused = new Promise(r => { resume = r; });
  const stale = old.exclusive(async rows => {
    entered();
    await paused;
    await rows.put('验证', '旧');
  });
  await ready;
  const key = Array.from({ length: local.length }, (_, i) => local.key(i)).find(k => k.startsWith('particle-sandbox-lock-'));
  local.setItem(key, JSON.stringify({ number: 1, until: 0 }));
  await next.exclusive(rows => rows.put('验证', '新'));
  resume();
  await assert.rejects(stale, /过期/);
  assert.equal(await next.get('验证'), '新');
});

test('档案后备迁移：切换目录后清理中断，下次打开回收旧空间', async () => {
  const local = memoryLocal(), host = { indexedDB: new IDBFactory(), localStorage: local, navigator: { locks: null } };
  await createProfileStore(await openProfileStorage(host)).saveSlot('civ', '甲', sampleWorld(1));
  const off = createProfileStore(await openProfileStorage({ ...host, indexedDB: null }));
  await off.saveSlot('civ', '乙', sampleWorld(2));
  const remove = local.removeItem;
  local.removeItem = k => {
    if (k.startsWith('particle-sandbox-meta-slot-')) throw new Error('中断清理');
    remove(k);
  };
  await openProfileStorage(host);
  const keys = () => Array.from({ length: local.length }, (_, i) => local.key(i));
  assert.ok(keys().some(k => k.startsWith('particle-sandbox-meta-slot-')));
  local.removeItem = remove;
  const restored = createProfileStore(await openProfileStorage(host));
  assert.equal((await restored.loadSlot('civ', '乙')).json, '{"tick":2}');
  assert.ok(!keys().some(k => k.startsWith('particle-sandbox-meta-slot-')));
});

test('档案进度摘要跟随已提交的关卡、守护、发现、槽位和导入更新',async()=>{
  const store=createProfileStore(createMemoryStorage());
  const fresh=await store.exportProfile(), seen=[];
  const off=store.onProgress(p=>seen.push(p));
  await store.readProfile();
  await store.updateProfile(p=>{p.codex.push('SAND','WATER'); p.defense.highestWave=6;});
  await recordPuzzleStars(store,'sand-cup',3);
  await store.saveSlot('civ','甲',sampleWorld(1)); await store.saveSlot('eco','乙',sampleWorld(2));
  assert.deepEqual(store.progress,{sandbox:2,defense:6,puzzle:1,civ:1,eco:1,stars:{'sand-cup':3}});
  await assert.rejects(store.updateProfile(p=>{p.puzzle.stars.bad=4;}));
  assert.equal(seen.at(-1),store.progress); assert.equal(seen.length,5);
  await store.deleteSlot('civ','甲'); assert.equal(store.progress.civ,0);
  await store.importProfile(fresh);
  assert.deepEqual(store.progress,{sandbox:0,defense:0,puzzle:0,civ:0,eco:0,stars:{}});
  off(); await store.readProfile(); assert.equal(seen.length,7);
});
