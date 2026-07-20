// WebAudio 合成音效 v3 —— 金属质感落子（无采样素材、无版权风险）。
// 金属敲击的关键：非谐波分音（bell/metal-bar 频率比，非整数倍）+ 高频瞬态"叮"声 +
// 中短衰减带余韵，整体高通让声音变"薄""亮"。chess.com 音源专有、lichess 标准音效集
// 亦无开放许可，均不可 vendor，只能合成逼近。
let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// 金属敲击：一组非谐波正弦分音（越高的分音幅度越小、衰减越快）+ 极短高频噪声瞬态
function metalTap(t0, {
  f0 = 1000, partials = [1, 2.76, 5.4, 8.9], dur = 0.13, vol = 0.34,
  click = 0.32, hp = 480,
} = {}) {
  const c = ac();
  const t = c.currentTime + t0;

  const out = c.createGain();
  out.gain.value = vol;
  const highpass = c.createBiquadFilter(); // 高通 → 更薄更"金属"
  highpass.type = 'highpass';
  highpass.frequency.value = hp;
  out.connect(highpass).connect(c.destination);

  partials.forEach((r, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f0 * r;
    const g = c.createGain();
    const amp = 1 / (i + 1.5);           // 高分音更弱
    const d = dur / (1 + i * 0.7);       // 高分音衰减更快 → 起始"叮"、余韵变纯
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.0015); // 极快起振
    g.gain.exponentialRampToValueAtTime(0.0006, t + d);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + d + 0.02);
  });

  if (click > 0) { // 高频噪声瞬态：金属的"嗒"击感
    const len = Math.max(6, Math.floor(c.sampleRate * 0.006));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const chp = c.createBiquadFilter();
    chp.type = 'highpass';
    chp.frequency.value = 3200;
    const cg = c.createGain();
    cg.gain.setValueAtTime(click, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.006);
    src.connect(chp).connect(cg).connect(c.destination);
    src.start(t);
  }
}

function safe(fn) {
  return (...a) => {
    if (!enabled) return;
    try { fn(...a); } catch { /* 无声降级 */ }
  };
}

export const sound = {
  setEnabled(v) { enabled = v; },
  isEnabled: () => enabled,
  // 走子：清脆的金属"叮嗒"
  move: safe(() => metalTap(0, { f0: 1040, dur: 0.12, vol: 0.32, click: 0.3 })),
  // 吃子：更重更亮的金属撞击（脆击 + 低沉金属余韵双层）
  capture: safe(() => {
    metalTap(0, { f0: 1500, partials: [1, 2.7, 5.1], dur: 0.07, vol: 0.4, click: 0.5, hp: 900 });
    metalTap(0.02, { f0: 720, partials: [1, 2.76, 5.4, 8.9], dur: 0.16, vol: 0.36, click: 0 });
  }),
  // 易位：两声金属连击
  castle: safe(() => {
    metalTap(0, { f0: 980, dur: 0.11, vol: 0.3, click: 0.26 });
    metalTap(0.1, { f0: 900, dur: 0.13, vol: 0.34, click: 0.28 });
  }),
  // 将军：落子 + 高频金属长鸣（警示）
  check: safe(() => {
    metalTap(0, { f0: 1040, dur: 0.11, vol: 0.34, click: 0.3 });
    metalTap(0.03, { f0: 2100, partials: [1, 2.9], dur: 0.28, vol: 0.16, click: 0, hp: 1500 });
  }),
  // 升变：落子 + 上扬金属亮音
  promote: safe(() => {
    metalTap(0, { f0: 1040, dur: 0.1, vol: 0.32, click: 0.28 });
    metalTap(0.07, { f0: 1760, partials: [1, 2.76], dur: 0.16, vol: 0.18, click: 0, hp: 1200 });
  }),
  // 终局：三声下行金属敲击收束
  gameEnd: safe(() => {
    metalTap(0, { f0: 1180, dur: 0.14, vol: 0.32, click: 0.24 });
    metalTap(0.15, { f0: 980, dur: 0.15, vol: 0.32, click: 0.24 });
    metalTap(0.31, { f0: 760, dur: 0.22, vol: 0.36, click: 0.26 });
  }),
};
