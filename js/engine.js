// Stockfish 引擎封装：Web Worker + UCI 协议。
// 使用单线程 lite 构建（GitHub Pages 无 COOP/COEP 响应头，不能用多线程版）。
// WASM 约 7.3MB：先带进度手动预下载（写入 HTTP 缓存，worker 内部同 URL fetch 直接命中），
// 全程带超时；失败/超时后自动重置，下一次调用即可重试。
export function createEngine(workerUrl) {
  let worker = null;
  let ready = null;

  const wasmUrl = workerUrl.replace(/\.js$/, '.wasm');

  function reset() {
    if (worker) {
      try { worker.terminate(); } catch { /* ignore */ }
    }
    worker = null;
    ready = null;
  }

  async function preloadWasm(onProgress) {
    const resp = await fetch(wasmUrl);
    if (!resp.ok) throw new Error('引擎文件下载失败（HTTP ' + resp.status + '）');
    if (!resp.body) return; // 老浏览器无流式读取：退化为整体下载
    const total = Number(resp.headers.get('Content-Length')) || 0;
    const reader = resp.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (onProgress) {
        if (total) onProgress(Math.min(100, Math.round((got / total) * 100)) + '%');
        else onProgress((got / 1048576).toFixed(1) + ' MB');
      }
    }
  }

  function init(onProgress) {
    if (ready) return ready;
    ready = (async () => {
      await preloadWasm(onProgress).catch(() => { /* 预下载失败不阻塞，交给 worker 自行加载 */ });
      worker = new Worker(workerUrl);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('引擎初始化超时（网络较慢可稍后重试）')); }, 90000);
        const onMsg = (e) => {
          if (e.data === 'uciok') { cleanup(); resolve(); }
        };
        const onErr = () => { cleanup(); reject(new Error('引擎 Worker 加载失败')); };
        const cleanup = () => {
          clearTimeout(timer);
          worker.removeEventListener('message', onMsg);
          worker.removeEventListener('error', onErr);
        };
        worker.addEventListener('message', onMsg);
        worker.addEventListener('error', onErr);
        worker.postMessage('uci');
      });
    })();
    ready.catch(reset); // 失败即重置，允许下次调用重试
    return ready;
  }

  // 返回 UCI 着法字符串（如 'e2e4'、'a7a8q'），无着法时返回 '(none)'。
  // searchmoves：限定搜索的着法列表（LAN 格式），用于防重复等过滤。
  // 串行化：单 worker 一次只能算一个局面，持续提示与「与电脑对弈」可能并发调用，
  // 用 promise 链保证一个算完再算下一个，避免 bestmove 响应串扰。
  let chain = Promise.resolve();
  function bestMove(fen, movetime = 1200, searchmoves = null, onProgress = null) {
    const task = () => rawBestMove(fen, movetime, searchmoves, onProgress);
    const p = chain.then(task, task);
    chain = p.then(() => {}, () => {}); // 吞掉结果/异常以维持链路
    return p;
  }

  async function rawBestMove(fen, movetime, searchmoves, onProgress) {
    await init(onProgress);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.removeEventListener('message', onMsg);
        reset(); // 引擎无响应：重置以便重试
        reject(new Error('引擎响应超时'));
      }, movetime + 20000);
      const onMsg = (e) => {
        if (typeof e.data !== 'string') return;
        const m = e.data.match(/^bestmove\s+(\S+)/);
        if (m) {
          clearTimeout(timer);
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
