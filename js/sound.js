// WebAudio 合成音效 v4 —— 柔和低沉的落子"嗒"声，逼近 Chess.com 的手感（软、闷、短促、不刺耳）。
// （chess.com 原始音源为其专有版权资产、lichess 标准音效集亦无开放许可，均不可 vendor，只能合成逼近。）
let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// 柔和落子：低频正弦体（快速下滑 + 指数衰减）+ 低通噪声击感，整体低通保持"软/闷"
function tock(t0, {
  f0 = 250, f1 = 150, dur = 0.05, vol = 0.55, noise = 0.38, lp = 1300, noiseDur = 0.02,
} = {}) {
  const c = ac();
  const t = c.currentTime + t0;

  const lpf = c.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = lp;
  lpf.connect(c.destination);

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 40), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.003); // 3ms 软起振，避免爆音
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(lpf);
  osc.start(t);
  osc.stop(t + dur + 0.02);

  if (noise > 0) { // 柔和低通噪声击感（"嗒"）
    const len = Math.max(6, Math.floor(c.sampleRate * noiseDur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const nlp = c.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = lp * 1.5;
    const ng = c.createGain();
    ng.gain.setValueAtTime(noise, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + noiseDur);
    src.connect(nlp).connect(ng).connect(c.destination);
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
  // 走子：柔和短促的"嗒"
  move: safe(() => tock(0, { f0: 250, f1: 150, dur: 0.05, vol: 0.5, noise: 0.34, lp: 1300 })),
  // 吃子：更重更闷的双击（脆击 + 低沉落地）
  capture: safe(() => {
    tock(0, { f0: 320, f1: 190, dur: 0.038, vol: 0.5, noise: 0.5, lp: 1700 });
    tock(0.024, { f0: 165, f1: 105, dur: 0.085, vol: 0.5, noise: 0.18, lp: 850 });
  }),
  // 易位：两声柔和连击
  castle: safe(() => {
    tock(0, { f0: 235, f1: 145, dur: 0.048, vol: 0.44, noise: 0.3 });
    tock(0.1, { f0: 220, f1: 135, dur: 0.055, vol: 0.5, noise: 0.32 });
  }),
  // 将军：落子 + 柔和中频提示音（克制、不刺耳）
  check: safe(() => {
    tock(0, { f0: 255, f1: 150, dur: 0.05, vol: 0.5, noise: 0.32 });
    tock(0.045, { f0: 660, f1: 620, dur: 0.16, vol: 0.14, noise: 0, lp: 2000 });
  }),
  // 升变：落子 + 轻柔上扬
  promote: safe(() => {
    tock(0, { f0: 250, f1: 150, dur: 0.05, vol: 0.48, noise: 0.3 });
    tock(0.06, { f0: 520, f1: 560, dur: 0.12, vol: 0.14, noise: 0, lp: 2000 });
  }),
  // 终局：三声下行柔和收束
  gameEnd: safe(() => {
    tock(0, { f0: 300, f1: 200, dur: 0.07, vol: 0.46, noise: 0.26 });
    tock(0.15, { f0: 250, f1: 165, dur: 0.08, vol: 0.46, noise: 0.26 });
    tock(0.31, { f0: 195, f1: 125, dur: 0.11, vol: 0.5, noise: 0.28 });
  }),
};
