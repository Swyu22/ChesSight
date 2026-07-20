// Stockfish 引擎封装：Web Worker + UCI 协议。
// 使用单线程 lite 构建（GitHub Pages 无 COOP/COEP 响应头，不能用多线程版）。
export function createEngine(workerUrl) {
  let worker = null;
  let ready = null;

  function init() {
    if (ready) return ready;
    worker = new Worker(workerUrl);
    ready = new Promise((resolve, reject) => {
      const onMsg = (e) => {
        if (typeof e.data === 'string' && e.data === 'uciok') {
          worker.removeEventListener('message', onMsg);
          resolve();
        }
      };
      worker.addEventListener('message', onMsg);
      worker.addEventListener('error', (err) => {
        ready = null; // 允许重试
        reject(new Error('引擎 Worker 加载失败'));
      }, { once: true });
      worker.postMessage('uci');
    });
    return ready;
  }

  // 返回 UCI 着法字符串（如 'e2e4'、'a7a8q'），无着法时返回 '(none)'。
  // searchmoves：限定搜索的着法列表（LAN 格式），用于防重复等过滤
  async function bestMove(fen, movetime = 1200, searchmoves = null) {
    await init();
    return new Promise((resolve) => {
      const onMsg = (e) => {
        if (typeof e.data !== 'string') return;
        const m = e.data.match(/^bestmove\s+(\S+)/);
        if (m) {
          worker.removeEventListener('message', onMsg);
          resolve(m[1]);
        }
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage('position fen ' + fen);
      const restrict = searchmoves && searchmoves.length ? ' searchmoves ' + searchmoves.join(' ') : '';
      worker.postMessage('go movetime ' + movetime + restrict);
    });
  }

  return { bestMove, preload: init };
}
