// WebAudio 合成音效 v2 —— 逐特征逼近 Chess.com 手感的纯打击乐合成。
// （chess.com 原始音源为其专有版权资产、lichess 标准音效集未开放许可，均不可 vendor；
//   本实现用"阻尼低频正弦体 + 带通噪声瞬态"合成木质敲击，无任何采样素材。）
let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// 播放前确保 AudioContext 处于 running 再发声：
//  - 已 running：立即播放；
//  - suspended（iOS/移动端自动播放策略下的初始态，或首个手势里 resume() 尚未落定）：
//    先 resume，待其在同一用户手势内完成后再播放。
// 关键：由此保证「第一步棋的音效」不会被调度到仍处挂起的上下文上而丢失——这正是移动端
// 首次打开常见的"要先切一次音效开关才响"的根因。voice(c) 一律用传入的 context，
// 且 knock 以 c.currentTime 为基准取时刻，故 resume 后现算的时间点总是有效的。
function play(voice) {
  if (!enabled) return;
  const c = ac();
  if (c.state === 'running') { try { voice(c); } catch { /* 无声降级 */ } return; }
  c.resume().then(() => { try { voice(c); } catch { /* 无声降级 */ } }).catch(() => { /* 无声降级 */ });
}

// 木质敲击：body=正弦基频（快速下滑八度并指数衰减），noise=带通噪声瞬态（木头的"叩"感）
function knock(c, t0, { body = 170, dur = 0.09, vol = 0.5, noiseHz = 600, noiseQ = 1.1, noiseVol = 0.33, noiseDur = 0.024 }) {
  const t = c.currentTime + t0;
  // 低频体
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(body, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(body * 0.45, 30), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004); // 4ms 软攻，避免爆音
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
  // 带通噪声瞬态
  if (noiseVol > 0) {
    const len = Math.max(8, Math.floor(c.sampleRate * noiseDur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = noiseHz;
    bp.Q.value = noiseQ;
    const ng = c.createGain();
    ng.gain.setValueAtTime(noiseVol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + noiseDur);
    src.connect(bp).connect(ng).connect(c.destination);
    src.start(t);
  }
}

export const sound = {
  setEnabled(v) { enabled = v; },
  isEnabled: () => enabled,
  // 在用户手势内解锁 AudioContext（iOS/移动端自动播放策略）：播放一段 1 采样的缓冲源并 resume，
  // 是 iOS 上最可靠的解锁方式。即便本次 resume 未在手势内立即落定，后续 play() 也会 resume-后-播，
  // 双重保障使第一步棋即有音效，无需先切换一次音效开关。返回 true 表示已进入 running 状态。
  unlock() {
    try {
      const c = ac();
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050); // 1 采样静音缓冲
      src.connect(c.destination);
      src.start(0);
      c.resume();
      return c.state === 'running';
    } catch { return false; }
  },
  isReady: () => !!ctx && ctx.state === 'running',
  // 走子：单声闷实的木质"哒"
  move: () => play((c) => knock(c, 0, { body: 175, dur: 0.085, vol: 0.5, noiseHz: 520, noiseVol: 0.3 })),
  // 吃子：先脆后沉的"嗒-咚"双击
  capture: () => play((c) => {
    knock(c, 0, { body: 230, dur: 0.05, vol: 0.5, noiseHz: 1500, noiseQ: 0.9, noiseVol: 0.5, noiseDur: 0.018 });
    knock(c, 0.022, { body: 125, dur: 0.1, vol: 0.5, noiseHz: 420, noiseVol: 0.22 });
  }),
  // 易位：王、车两声连击
  castle: () => play((c) => {
    knock(c, 0, { body: 165, dur: 0.075, vol: 0.42, noiseHz: 520, noiseVol: 0.26 });
    knock(c, 0.095, { body: 150, dur: 0.09, vol: 0.48, noiseHz: 480, noiseVol: 0.28 });
  }),
  // 将军：落子 + 高频木鱼点（短促、克制，不带旋律感）
  check: () => play((c) => {
    knock(c, 0, { body: 185, dur: 0.08, vol: 0.5, noiseHz: 560, noiseVol: 0.3 });
    knock(c, 0.03, { body: 620, dur: 0.05, vol: 0.16, noiseHz: 2100, noiseQ: 2.5, noiseVol: 0.22, noiseDur: 0.014 });
  }),
  // 升变：落子 + 轻微上扬点缀
  promote: () => play((c) => {
    knock(c, 0, { body: 175, dur: 0.08, vol: 0.48, noiseHz: 520, noiseVol: 0.28 });
    knock(c, 0.06, { body: 430, dur: 0.07, vol: 0.14, noiseHz: 1600, noiseQ: 2, noiseVol: 0.16, noiseDur: 0.015 });
  }),
  // 终局：三声下行叩击收束
  gameEnd: () => play((c) => {
    knock(c, 0, { body: 195, dur: 0.09, vol: 0.46, noiseHz: 560, noiseVol: 0.28 });
    knock(c, 0.14, { body: 160, dur: 0.09, vol: 0.46, noiseHz: 500, noiseVol: 0.28 });
    knock(c, 0.28, { body: 120, dur: 0.13, vol: 0.5, noiseHz: 420, noiseVol: 0.3 });
  }),
};
