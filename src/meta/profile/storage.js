import { mergeFallbackProfile } from './index.js';

const metaNamespace = 'particle-sandbox-meta-';
const metaLockPrefix = 'particle-sandbox-lock-';
const metaUniqueId = () => [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, '0')).join('');

export function createMemoryStorage() {
  const rows = new Map();
  let tail = Promise.resolve();
  const adapter = {
    kind: 'memory',
    get: async key => structuredClone(rows.get(key)),
    put: async (key, value) => { rows.set(key, structuredClone(value)); },
    remove: async key => { rows.delete(key); },
    keys: async () => [...rows.keys()],
    exclusive(task) {
      const next = tail.then(() => task(adapter));
      tail = next.catch(() => {});
      return next;
    },
  };
  return adapter;
}

// 没有 Web Locks 的浏览器为每个操作单独取号。同号按随机 ID 排序。
// 标签页崩溃后票据到期；挂起后恢复的旧持有者在每次写入前重新验票。
async function metaLocalTicket(local, task) {
  const id = metaLockPrefix + metaUniqueId(), lifetime = 30000;
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  let number = 0, until = 0;
  function publish() {
    until = Date.now() + lifetime;
    local.setItem(id, JSON.stringify({ number, until }));
  }
  function assertOwner() {
    if (Date.now() >= until || !local.getItem(id)) throw new Error('跨页存储锁已过期，请重试');
    if (until - Date.now() < lifetime / 2) publish();
  }
  function contenders() {
    const peers = [];
    for (let i = 0; i < local.length; i++) {
      const key = local.key(i);
      if (!key?.startsWith(metaLockPrefix) || key === id) continue;
      const raw = local.getItem(key);
      if (raw === null) continue;
      let peer;
      try { peer = JSON.parse(raw); } catch { /* 残缺票据没有持有者 */ }
      if (Number.isFinite(peer?.until) && peer.until > Date.now()) peers.push({ key, ...peer });
      else if (local.getItem(key) === raw) { local.removeItem(key); i--; }
    }
    return peers;
  }
  publish();
  try {
    number = 1 + contenders().reduce((max, peer) => Math.max(max, peer.number), 0);
    publish();
    // 让其它页面收到 storage 变更，再检查仍在取号或先到的操作。
    await pause();
    while (contenders().some(p => !p.number || p.number < number || (p.number === number && p.key < id))) {
      assertOwner();
      await pause();
    }
    assertOwner();
    return await task(assertOwner);
  } finally { local.removeItem(id); }
}

export function createLocalProfileStorage(local, locks = globalThis.navigator?.locks) {
  const epochKey = 'particle-sandbox-fallback-generation';
  const generation = local.getItem(epochKey);
  const prefix = generation ? metaNamespace + generation + ':' : metaNamespace;
  function rows(guard) {
    return {
      async get(key) {
        const raw = local.getItem(prefix + key);
        if (raw === null) return undefined;
        const row = JSON.parse(raw);
        if (typeof row?.world === 'string') row.world = new Blob([row.world], { type: 'application/json' });
        return row;
      },
      async put(key, value) {
        const row = value.world instanceof Blob ? { ...value, world: await value.world.text() } : value;
        const raw = JSON.stringify(row);
        guard();
        local.setItem(prefix + key, raw);
      },
      async remove(key) { guard(); local.removeItem(prefix + key); },
      async keys() {
        const keys = [];
        for (let i = 0; i < local.length; i++) {
          const key = local.key(i);
          if (key?.startsWith(prefix) && !key.slice(prefix.length).includes(':')) keys.push(key.slice(prefix.length));
        }
        return keys;
      },
    };
  }
  const noop = () => {};
  function retiredKeys() {
    if (!generation) return [];
    const keys = [];
    for (let i = 0; i < local.length; i++) {
      const key = local.key(i);
      if (key?.startsWith(metaNamespace) && !key.startsWith(prefix)) keys.push(key);
    }
    return keys;
  }
  return {
    kind: 'localStorage', ...rows(noop),
    async cleanRetired() {
      if (!retiredKeys().length) return;
      await this.exclusive(async (_, retire, guard) => {
        for (const key of retiredKeys()) { guard(); local.removeItem(key); }
      });
    },
    exclusive(task) {
      function run(guard) {
        guard();
        if (generation !== local.getItem(epochKey)) throw new Error('后备进度已迁入主存储，请刷新页面');
        return task(rows(guard), () => { guard(); local.setItem(epochKey, metaUniqueId()); }, guard);
      }
      return locks ? locks.request('particle-sandbox-meta', () => run(noop)) : metaLocalTicket(local, run);
    },
  };
}

// 跨连接并发交给同一对象仓库的原生读写事务。Blob.text() 可能跨浏览器任务，
// 所以在 IDB 回调中派发队列中的实际请求；等待外部异步工作期间保持事务活跃。
function metaIDBTransaction(db, task) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records');
    const queue = [], pending = new Set();
    let finished = false, result, failure, aborted;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => {
      aborted = failure || tx.error || new Error('存储事务中止');
      for (const fail of pending) fail(aborted);
      reject(aborted);
    };
    function request(make) {
      if (aborted) return Promise.reject(aborted);
      return new Promise((done, fail) => {
        pending.add(fail);
        queue.push(() => {
          const op = make();
          op.onsuccess = () => { pending.delete(fail); done(op.result); };
          op.onerror = () => { pending.delete(fail); fail(op.error); };
        });
      });
    }
    function pump() {
      if (finished) return;
      try {
        for (const issue of queue.splice(0)) issue();
        store.getKey('profile').onsuccess = pump;
      } catch (e) { failure = e; tx.abort(); }
    }
    const rows = {
      get: k => request(() => store.get(k)),
      put: (k, v) => request(() => store.put(v, k)),
      remove: k => request(() => store.delete(k)),
      keys: () => request(() => store.getAllKeys()),
    };
    Promise.resolve().then(() => task(rows)).then(value => { result = value; finished = true; }, e => {
      failure = e;
      try { tx.abort(); } catch { /* 请求失败时事务可能已经中止 */ }
    });
    pump();
  });
}

function openMetaDatabase(factory) {
  return new Promise((resolve, reject) => {
    const req = factory.open('particle-sandbox-meta', 1);
    let blocked = false;
    req.onblocked = () => { blocked = true; reject(new Error('存储升级被其他标签页阻塞')); };
    req.onupgradeneeded = () => req.result.createObjectStore('records');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      const adapter = { kind: 'indexedDB', close: () => db.close(), exclusive: task => metaIDBTransaction(db, task) };
      for (const method of ['get', 'put', 'remove', 'keys']) {
        adapter[method] = (...args) => adapter.exclusive(rows => rows[method](...args));
      }
      resolve(adapter);
    };
  });
}

export async function openProfileStorage(host = globalThis) {
  let local;
  try { local = createLocalProfileStorage(host.localStorage, host.navigator?.locks); } catch {}
  let db, primaryKeys;
  try {
    db = await openMetaDatabase(host.indexedDB);
    primaryKeys = await db.keys();
    if (!primaryKeys.length) await db.remove('probe');
  } catch {
    db?.close();
    if (local) return local;
    throw new Error('浏览器本地存储不可用');
  }
  if (!local) return db;
  // 如果上次在目录切换后关闭了页面，此处回收旧代残留的 Blob。
  await local.cleanRetired().catch(() => {});
  let localKeys;
  try { localKeys = await local.keys(); } catch { return db; }
  if (!localKeys.some(k => k === 'profile' || k === 'backup')) return db;
  if (!primaryKeys.some(k => k === 'profile' || k === 'backup')) {
    db.close();
    return local;
  }
  // 两边都有进度时先锁后备库，再将合并结果原子提交到主库，最后退役旧目录。
  try {
    await local.exclusive(async (source, retire) => {
      let id = await source.get('mergeId');
      if (!id) { id = metaUniqueId(); await source.put('mergeId', id); }
      const oldKeys = await source.keys();
      await db.exclusive(target => mergeFallbackProfile(source, target, id));
      retire();
      for (const k of oldKeys) await source.remove(k);
    });
    return db;
  } catch (e) {
    const active = createLocalProfileStorage(host.localStorage, host.navigator?.locks);
    if (!(await active.keys()).some(k => k === 'profile' || k === 'backup')) return db;
    db.close();
    active.warning = '后备进度暂未迁入主库，继续使用后备档案：' + e.message;
    return active;
  }
}
