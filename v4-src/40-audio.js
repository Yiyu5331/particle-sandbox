
/* =====================================================================
 * 4. 音效：全部用 WebAudio 程序合成，没有任何音频文件。
 *    持续类（沙、水、火、嘶嘶、电、雨、风）各用一条常驻的滤波噪声「声床」，只调增益 → 同类声音天然合并；
 *    瞬时类（爆炸、噼啪、雷、坍塌）限制并发数。所有增益变化都走斜坡，总线上有压限器，避免爆音。
 *    声音图的搭建和每种声音的触发都接受任意 AudioContext，自测用 OfflineAudioContext 渲染同一套代码。
 * ===================================================================== */
const audio = { ctx: null, g: null, volume: 0.6, muted: false, lastBoom: 0, hissEnv: 0, elecEnv: 0, rainEnv: 0 };
const BED_MAX = { sand: 0.2, water: 0.16, fire: 0.22, hiss: 0.2, elec: 0.3, rain: 0.2, wind: 0.14 };

function buildAudioGraph(ctx, volume) {
  const g = { ctx, beds: {}, booms: 0, crackles: 0 };
  const master = g.master = ctx.createGain();
  master.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();          // 总线压限，叠加再多也不削波
  comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.2;
  const limit = ctx.createGain();
  limit.gain.value = 0.8;
  master.connect(comp); comp.connect(limit); limit.connect(ctx.destination);

  const nb = g.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = nb.getChannelData(0);
  let s = 0x2545f491;                                   // 固定种子的噪声：离线测试结果可复现
  for (let i = 0; i < nd.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; nd[i] = ((s >>> 0) / 2147483648) - 1; }

  const len = Math.floor(ctx.sampleRate * 1.8);         // 混响：指数衰减的噪声当脉冲响应
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = (((s >>> 0) / 2147483648) - 1) * Math.pow(1 - i / len, 2.6); }
  }
  const conv = g.reverb = ctx.createConvolver();
  conv.buffer = ir;
  const rg = ctx.createGain();
  rg.gain.value = 0.4;
  conv.connect(rg); rg.connect(master);

  const bed = (name, ftype, freq, q, rate) => {
    const src = ctx.createBufferSource();
    src.buffer = nb; src.loop = true; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = ftype; f.frequency.value = freq; f.Q.value = q;
    const gn = ctx.createGain();
    gn.gain.value = 0;
    src.connect(f); f.connect(gn); gn.connect(master);
    src.start();
    return (g.beds[name] = { gain: gn, filter: f });
  };
  bed('sand', 'bandpass', 5200, 0.7, 1.0);              // 沙沙声
  const water = bed('water', 'bandpass', 700, 1.1, 0.9);  // 流水：带通中心频率被慢速 LFO 晃动
  const lfo = ctx.createOscillator(), lg = ctx.createGain();
  lfo.frequency.value = 0.9; lg.gain.value = 260;
  lfo.connect(lg); lg.connect(water.filter.frequency); lfo.start();
  bed('fire', 'lowpass', 420, 0.5, 0.8);                // 火焰的低频呼呼声
  bed('hiss', 'highpass', 5500, 0.6, 1.1);              // 水浇在火或熔岩上的嘶嘶声
  bed('rain', 'bandpass', 2600, 0.5, 1.15);             // 雨
  const wind = bed('wind', 'bandpass', 380, 1.4, 0.7);  // 风：中心频率慢慢游走
  const wl = ctx.createOscillator(), wg = ctx.createGain();
  wl.frequency.value = 0.23; wg.gain.value = 160;
  wl.connect(wg); wg.connect(wind.filter.frequency); wl.start();
  const elec = bed('elec', 'bandpass', 3200, 6, 1.0);   // 电火花：窄带噪声被 55Hz 方波斩波 → 嗞嗞
  const chop = ctx.createOscillator(), cg = ctx.createGain(), am = ctx.createGain();
  chop.type = 'square'; chop.frequency.value = 55; cg.gain.value = 0.5; am.gain.value = 0.5;
  elec.gain.disconnect(); elec.gain.connect(am); am.connect(master);
  chop.connect(cg); cg.connect(am.gain); chop.start();
  return g;
}

function sfxCrackle(g, when, level, freq) {
  const ctx = g.ctx;
  if (g.crackles >= 6) return;
  g.crackles++;
  const dur = 0.05;
  const src = ctx.createBufferSource();
  src.buffer = g.noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.5;
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.0001, when);
  gn.gain.exponentialRampToValueAtTime(level, when + 0.002);
  gn.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f); f.connect(gn); gn.connect(g.master);
  src.start(when, 0.3, dur + 0.02);
  src.onended = () => { g.crackles--; };
}

// 爆炸 / 坍塌：噪声过一个下扫的低通 + 一个下滑的正弦低频，带混响
function sfxBoom(g, when, scale) {
  const ctx = g.ctx;
  if (g.booms >= 4) return;
  g.booms++;
  const s = Math.min(1, Math.max(0.12, scale)), dur = 0.35 + 1.3 * s;
  const src = ctx.createBufferSource();
  src.buffer = g.noise;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(300 + 1400 * s, when);
  lp.frequency.exponentialRampToValueAtTime(45, when + dur * 0.8);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.0001, when);
  gn.gain.exponentialRampToValueAtTime(0.9 * s, when + 0.008);
  gn.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(lp); lp.connect(gn); gn.connect(g.master); gn.connect(g.reverb);
  src.start(when, 0.1, dur + 0.05);
  src.onended = () => { g.booms--; };
  const osc = ctx.createOscillator(), og = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, when);
  osc.frequency.exponentialRampToValueAtTime(28, when + 0.5 * dur);
  og.gain.setValueAtTime(0.0001, when);
  og.gain.exponentialRampToValueAtTime(0.8 * s, when + 0.01);
  og.gain.exponentialRampToValueAtTime(0.0001, when + 0.7 * dur);
  osc.connect(og); og.connect(g.master);
  osc.start(when); osc.stop(when + dur);
}

// 雷：先一声脆裂，再拖一长串滚动的低频
function sfxThunder(g, when) {
  const ctx = g.ctx;
  sfxCrackle(g, when, 0.5, 2400);
  const dur = 2.6;
  const src = ctx.createBufferSource();
  src.buffer = g.noise; src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(900, when);
  lp.frequency.exponentialRampToValueAtTime(70, when + dur);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.0001, when);
  gn.gain.exponentialRampToValueAtTime(0.8, when + 0.03);
  gn.gain.exponentialRampToValueAtTime(0.25, when + 0.5);
  gn.gain.exponentialRampToValueAtTime(0.45, when + 0.9);      // 滚雷的第二下
  gn.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(lp); lp.connect(gn); gn.connect(g.master); gn.connect(g.reverb);
  src.start(when, 0.5); src.stop(when + dur + 0.05);
}

function audioStart() {
  if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audio.ctx = new AC();
  audio.g = buildAudioGraph(audio.ctx, audio.muted ? 0 : audio.volume);
}

function audioReady() { return audio.ctx && audio.ctx.state === 'running'; }

function audioSetVolume() {
  if (!audio.ctx) return;
  audio.g.master.gain.setTargetAtTime(audio.muted ? 0 : audio.volume, audio.ctx.currentTime, 0.03);
}

function audioBoom(scale) {
  if (!audioReady()) return;
  const now = audio.ctx.currentTime;
  if (now - audio.lastBoom < 0.05) return;              // 同一瞬间的爆炸合并成一声
  audio.lastBoom = now;
  sfxBoom(audio.g, now, scale);
}

function audioThunder(delay) { if (audioReady()) sfxThunder(audio.g, audio.ctx.currentTime + delay); }

// 每个渲染帧调用一次：把模拟统计量映射成各声床的音量
function audioFrame() {
  if (audioReady()) {
    const now = audio.ctx.currentTime, b = audio.g.beds;
    b.sand.gain.gain.setTargetAtTime(Math.min(BED_MAX.sand, st.powder / 500 * BED_MAX.sand), now, 0.07);
    b.water.gain.gain.setTargetAtTime(Math.min(BED_MAX.water, st.liquid / 900 * BED_MAX.water), now, 0.1);
    b.fire.gain.gain.setTargetAtTime(Math.min(BED_MAX.fire, st.fire / 220 * BED_MAX.fire), now, 0.12);
    audio.hissEnv = Math.min(1, audio.hissEnv * 0.9 + st.hiss * 0.12);
    b.hiss.gain.gain.setTargetAtTime(audio.hissEnv * BED_MAX.hiss, now, 0.04);
    audio.elecEnv = Math.min(1, audio.elecEnv * 0.8 + st.elec * 0.08);
    b.elec.gain.gain.setTargetAtTime(audio.elecEnv * BED_MAX.elec, now, 0.02);
    audio.rainEnv = Math.min(1, audio.rainEnv * 0.97 + st.rain * 0.02);
    b.rain.gain.gain.setTargetAtTime(audio.rainEnv * BED_MAX.rain, now, 0.2);
    b.wind.gain.gain.setTargetAtTime(Math.min(1, env.windPower * Math.abs(env.wind) * 1.6) * BED_MAX.wind, now, 0.5);
    if (st.fire > 0 && Math.random() < Math.min(0.45, st.fire / 180)) sfxCrackle(audio.g, now, 0.06 + Math.random() * 0.14, 1200 + Math.random() * 4200);
    if (st.crash > 40) audioBoom(Math.min(0.6, st.crash / 900));       // 坍塌的撞击声
  }
  st.powder = 0; st.liquid = 0; st.fire = 0; st.hiss = 0; st.elec = 0; st.boil = 0; st.boom = 0; st.rain = 0; st.crash = 0;
}

/* ---- 离线渲染自测：每种声音单独渲染 1.5 秒，检查不削波（峰值 < 0dBFS）且不是静音 ---- */
const SFX_TESTS = ['sand', 'water', 'fire', 'hiss', 'elec', 'rain', 'wind', 'boom', 'crackle', 'thunder', 'all'];

async function renderSfx(name) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const sr = 44100, ctx = new OAC(1, sr * (name === 'thunder' || name === 'all' ? 3 : 1.5), sr);
  const g = buildAudioGraph(ctx, 1);                    // 主音量开到最大
  const on = n => g.beds[n].gain.gain.setTargetAtTime(BED_MAX[n], 0.05, 0.05);
  if (BED_MAX[name] !== undefined) on(name);
  else if (name === 'boom') sfxBoom(g, 0.1, 1);
  else if (name === 'crackle') { for (let k = 0; k < 6; k++) sfxCrackle(g, 0.1 + k * 0.2, 0.2, 1500 + k * 600); }
  else if (name === 'thunder') sfxThunder(g, 0.1);
  else {                                                // 最坏情况：所有声床开到最大 + 同时 4 声爆炸 + 雷
    for (const n in BED_MAX) on(n);
    for (let k = 0; k < 4; k++) sfxBoom(g, 0.3 + k * 0.01, 1);
    sfxThunder(g, 0.35);
  }
  const buf = await ctx.startRendering(), d = buf.getChannelData(0);
  let peak = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; sum += v * v; }
  return { name, peak, rms: Math.sqrt(sum / d.length) };
}
