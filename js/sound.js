// WebAudio 合成音效（参考 Chess.com 手感）：零采样素材、零版权风险、离线可用。
// 核心是"木质敲击"：短促正弦体（快速降调）+ 低通白噪声瞬态叠加。
let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// 单次敲击：t0 为相对当前的延迟秒数
function hit(t0, { f0 = 260, f1 = 150, dur = 0.07, vol = 0.4, noise = 0.2, lp = 1100 }) {
  const c = ac();
  const t = c.currentTime + t0;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 30), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
  if (noise > 0) {
    const len = Math.floor(c.sampleRate * 0.03);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = lp;
    const ng = c.createGain();
    ng.gain.setValueAtTime(noise, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(filt).connect(ng).connect(c.destination);
    src.start(t);
  }
}

// 短音符（终局/升变的旋律用）：三角波更柔和
function tone(t0, freq, dur, vol) {
  const c = ac();
  const t = c.currentTime + t0;
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
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
  // 普通走子：单次木质落子
  move: safe(() => hit(0, { f0: 270, f1: 150, dur: 0.065, vol: 0.42, noise: 0.22, lp: 1000 })),
  // 吃子：更脆的先击 + 低沉本体，双层
  capture: safe(() => {
    hit(0, { f0: 340, f1: 170, dur: 0.05, vol: 0.5, noise: 0.5, lp: 1800 });
    hit(0.025, { f0: 190, f1: 110, dur: 0.09, vol: 0.42, noise: 0.12, lp: 800 });
  }),
  // 王车易位：两声连击
  castle: safe(() => {
    hit(0, { f0: 260, f1: 150, dur: 0.06, vol: 0.38, noise: 0.2 });
    hit(0.1, { f0: 240, f1: 140, dur: 0.07, vol: 0.42, noise: 0.2 });
  }),
  // 将军：落子 + 高音警示
  check: safe(() => {
    hit(0, { f0: 260, f1: 150, dur: 0.06, vol: 0.4, noise: 0.2 });
    tone(0.02, 880, 0.16, 0.16);
  }),
  // 升变：上行双音
  promote: safe(() => {
    tone(0, 523.25, 0.1, 0.18);
    tone(0.1, 784, 0.16, 0.18);
  }),
  // 将杀/逼和等终局：三音收束
  gameEnd: safe(() => {
    tone(0, 523.25, 0.12, 0.18);
    tone(0.13, 659.25, 0.12, 0.18);
    tone(0.26, 784, 0.22, 0.2);
  }),
};
