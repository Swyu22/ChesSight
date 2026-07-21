// Stockfish 引擎封装：Web Worker + UCI 协议。单线程 lite 构建适配静态托管。
// 初始化截止时间覆盖 WASM 预下载、流式读取与 Worker UCI 握手的完整链路。
export function createEngine(workerUrl, {
  fetchImpl = (...args) => fetch(...args),
  WorkerCtor = globalThis.Worker,
  initTimeoutMs = 90000,
} = {}) {
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

  function withAbort(promise, signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(promise).then(
        (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
        (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
      );
    });
  }

  async function preloadWasm(onProgress, signal) {
    const response = await fetchImpl(wasmUrl, { signal });
    if (!response.ok) throw new Error('引擎文件下载失败（HTTP ' + response.status + '）');
    if (!response.body) return;
    const total = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body.getReader();
    let complete = false;
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await withAbort(reader.read(), signal);
        if (done) { complete = true; break; }
        received += value.length;
        if (onProgress) {
          const label = total
            ? Math.min(100, Math.round((received / total) * 100)) + '%'
            : (received / 1048576).toFixed(1) + ' MB';
          onProgress(label);
        }
      }
    } finally {
      if (!complete) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  function init(onProgress) {
    if (ready) return ready;
    ready = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error('引擎初始化超时（网络较慢可稍后重试）'));
      }, initTimeoutMs);
      try {
        try {
          await withAbort(preloadWasm(onProgress, controller.signal), controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          // 预下载不是硬依赖：普通网络错误时交由 Worker 自行加载同一 WASM URL。
        }

        if (typeof WorkerCtor !== 'function') throw new Error('当前浏览器不支持 Web Worker');
        worker = new WorkerCtor(workerUrl);
        await new Promise((resolve, reject) => {
            const onMessage = (event) => {
              if (event.data === 'uciok') { cleanup(); resolve(); }
            };
            const onError = () => { cleanup(); reject(new Error('引擎 Worker 加载失败')); };
            const onAbort = () => { cleanup(); reject(controller.signal.reason); };
            const cleanup = () => {
              worker?.removeEventListener('message', onMessage);
              worker?.removeEventListener('error', onError);
              worker?.removeEventListener('messageerror', onError);
              controller.signal.removeEventListener('abort', onAbort);
            };
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onError);
            worker.addEventListener('messageerror', onError);
            controller.signal.addEventListener('abort', onAbort, { once: true });
            worker.postMessage('uci');
          });
      } finally {
        clearTimeout(timeout);
      }
    })();
    ready.catch(reset);
    return ready;
  }

  // 单 Worker 串行搜索，避免多个 bestmove 响应互相串扰。
  let chain = Promise.resolve();
  function bestMove(fen, movetime = 1200, searchmoves = null, onProgress = null) {
    const task = () => rawBestMove(fen, movetime, searchmoves, onProgress);
    const result = chain.then(task, task);
    chain = result.then(() => {}, () => {});
    return result;
  }

  async function rawBestMove(fen, movetime, searchmoves, onProgress) {
    await init(onProgress);
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer);
        worker?.removeEventListener('message', onMessage);
        worker?.removeEventListener('error', onWorkerError);
        worker?.removeEventListener('messageerror', onWorkerError);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => {
        finish(new Error('引擎响应超时'));
        reset();
      }, movetime + 20000);
      const onMessage = (event) => {
        if (typeof event.data !== 'string') return;
        const match = event.data.match(/^bestmove\s+(\S+)/);
        if (match) finish(null, match[1]);
      };
      const onWorkerError = () => {
        finish(new Error('引擎 Worker 运行失败'));
        reset();
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onWorkerError);
      worker.addEventListener('messageerror', onWorkerError);
      worker.postMessage('position fen ' + fen);
      const restrict = searchmoves?.length ? ' searchmoves ' + searchmoves.join(' ') : '';
      worker.postMessage('go movetime ' + movetime + restrict);
    });
  }

  return { bestMove };
}
