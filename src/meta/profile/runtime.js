// 仅监听世界事件，档案写入在模拟步外异步完成。
export function attachProfileDiscoveries(bus, store, profile, onError, active = () => true) {
  const seen = { codex: new Set(profile.codex), reactions: new Set(profile.reactions) };
  function discover(key, id) {
    if (!active() || seen[key].has(id)) return;
    seen[key].add(id);
    store.updateProfile(p => {
      if (!p[key].includes(id)) p[key].push(id);
    }).catch(e => { seen[key].delete(id); onError(e); });
  }
  const offMaterial = bus.on('world:materialFirstCreated', e => discover('codex', e.material));
  const offReaction = bus.on('world:reaction', e => discover('reactions', e.rule));
  return () => { offMaterial(); offReaction(); };
}

export function createProfileAutosave(save, onError, timers = globalThis) {
  let timer = null, busy = false;
  async function run() {
    if (busy) return;
    busy = true;
    try { await save(); } catch (e) { onError(e); }
    finally { busy = false; }
  }
  return {
    setInterval(ms) {
      if (!Number.isInteger(ms) || ms < 0 || ms > 2147483647) throw new Error('自动存档间隔无效');
      if (timer !== null) timers.clearInterval(timer);
      timer = ms ? timers.setInterval(run, ms) : null;
    },
  };
}

// 由模式在结算时调用，重复挑战只会提高该关的最高星级。
export function recordPuzzleStars(store, level, stars) {
  if (typeof level !== 'string' || !level || !Number.isInteger(stars) || stars < 0 || stars > 3) {
    throw new Error('关卡或星级无效');
  }
  return store.updateProfile(p => {
    const best = Object.hasOwn(p.puzzle.stars, level) ? p.puzzle.stars[level] : 0;
    p.puzzle.stars = { ...p.puzzle.stars, [level]: Math.max(best, stars) };
  });
}

export function recordDefenseRun(store, run) {
  const entry = structuredClone(run);
  return store.updateProfile(p => {
    p.defense.highestWave = Math.max(p.defense.highestWave, entry.wave);
    p.defense.history.push(entry);
  });
}
