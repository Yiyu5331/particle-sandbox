
/* =====================================================================
 * 2.14 场景编解码（撤销快照、存档、导入导出共用；RLE 压缩）
 * ===================================================================== */
function rleEncode(src) {
  const n = src.length, out = new Uint8Array(n * 2 + 2);
  let p = 0, i = 0;
  while (i < n) {
    const v = src[i];
    let run = 1;
    while (run < 255 && i + run < n && src[i + run] === v) run++;
    out[p++] = run; out[p++] = v;
    i += run;
  }
  return out.slice(0, p);
}

function rleDecode(buf, n) {
  const out = new Uint8Array(n);
  let p = 0;
  for (let q = 0; q + 1 < buf.length && p < n; q += 2) {
    const run = buf[q];
    out.fill(buf[q + 1], p, Math.min(n, p + run));
    p += run;
  }
  return out;
}

// 快照：类型整张 RLE；其余属性只存非空格子，按字节平面分别 RLE。
// 正在下落的刚体按当前位置存成普通固体；空气的温度、浑浊度和湿度场不存。
function captureScene() {
  let cnt = 0;
  for (let i = 0; i < N; i++) if (type[i] !== 0) cnt++;
  const sd = new Uint8Array(cnt), tl = new Uint8Array(cnt), th = new Uint8Array(cnt),
        ll = new Uint8Array(cnt), lh = new Uint8Array(cnt), fl = new Uint8Array(cnt),
        w = new Uint8Array(cnt), x = new Uint8Array(cnt), ul = new Uint8Array(cnt), uh = new Uint8Array(cnt);
  for (let i = 0, k = 0; i < N; i++) {
    if (type[i] === 0) continue;
    let T = Math.round(temp[i]);
    T = (T < -32768 ? -32768 : T > 32767 ? 32767 : T) & 0xffff;
    const L = (flags[i] & F_BODY) ? 0 : life[i];
    sd[k] = seed[i]; tl[k] = T & 255; th[k] = T >> 8;
    ll[k] = L & 255; lh[k] = L >> 8; fl[k] = flags[i] & F_SAVE;
    w[k] = wet[i]; x[k] = aux[i]; ul[k] = fuel[i] & 255; uh[k] = fuel[i] >> 8;
    k++;
  }
  return { w: W, h: H, g: gravity, n: cnt, t: rleEncode(type), s: sd,
           tl: rleEncode(tl), th: rleEncode(th), ll: rleEncode(ll), lh: rleEncode(lh), f: rleEncode(fl),
           wt: rleEncode(w), ax: rleEncode(x), ul: rleEncode(ul), uh: rleEncode(uh),
           env: { time: env.time, timeScale: env.timeScale, temp: env.temp, wind: env.wind, windPower: env.windPower, weather: env.weather } };
}

// 还原到当前网格；尺寸不同的话按「底边居中」对齐，超出部分裁掉。v3 的存档没有含水量等字段，按默认值补。
function restoreScene(s) {
  const src = rleDecode(s.t, s.w * s.h), n = s.n;
  const tl = rleDecode(s.tl, n), th = rleDecode(s.th, n), ll = rleDecode(s.ll, n), lh = rleDecode(s.lh, n), fl = rleDecode(s.f, n);
  const v4 = !!s.wt;
  const wt = v4 ? rleDecode(s.wt, n) : null, ax = v4 ? rleDecode(s.ax, n) : null,
        ul = v4 ? rleDecode(s.ul, n) : null, uh = v4 ? rleDecode(s.uh, n) : null;
  clearGrid();
  setGravity(s.g || 'down');
  if (s.env) {
    env.time = s.env.time; env.timeScale = s.env.timeScale; env.temp = s.env.temp; env.wind = s.env.wind;
    setWeather(s.env.weather || 'clear');
    env.temp = s.env.temp; env.windPower = s.env.windPower;
    updateSun();
  }
  const ox = ((W - s.w) / 2) | 0, oy = H - s.h;
  let k = 0;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const t = src[x + y * s.w];
      if (t === 0) continue;
      const kk = k++;
      const X = x + ox, Y = y + oy;
      if (X < 0 || X >= W || Y < 0 || Y >= H || t >= NT) continue;
      const i = X + Y * W;
      let T = tl[kk] | (th[kk] << 8);
      if (T > 32767) T -= 65536;
      type[i] = t; seed[i] = s.s[kk]; temp[i] = T; life[i] = ll[kk] | (lh[kk] << 8); flags[i] = fl[kk] | (parity ^ 1);
      if (v4) { wet[i] = wt[kk]; aux[i] = ax[kk]; fuel[i] = ul[kk] | (uh[kk] << 8); }
      else { wet[i] = t === PLANT ? 60 : 0; aux[i] = M_RIGID[t] ? 255 : t === SOIL ? 200 : 0; fuel[i] = initFuel(t); }
    }
  }
  structDirty = true;
  wakeAll();
}

function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64ToBytes(b) {
  const s = atob(b), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

const SCENE_STREAMS = ['t', 's', 'tl', 'th', 'll', 'lh', 'f', 'wt', 'ax', 'ul', 'uh'];

function sceneToJSON(s) {
  const o = { app: 'particle-sandbox', v: 4, w: s.w, h: s.h, g: s.g, n: s.n, env: s.env };
  for (const k of SCENE_STREAMS) o[k] = bytesToB64(s[k]);
  return JSON.stringify(o);
}

function sceneFromJSON(str) {
  const o = JSON.parse(str);
  if (!o || o.app !== 'particle-sandbox' || !(o.w > 0) || !(o.h > 0)) throw new Error('不是粒子沙盘的存档文件');
  const s = { w: o.w | 0, h: o.h | 0, g: o.g, n: o.n | 0, env: o.env || null };
  for (const k of SCENE_STREAMS) if (typeof o[k] === 'string') s[k] = b64ToBytes(o[k]);
  if (!s.t || !s.s) throw new Error('存档文件不完整');
  return s;
}
