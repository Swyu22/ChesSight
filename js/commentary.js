// AI 实时解说客户端：调用 Cloudflare Worker 代理（key 在 Worker secret 中），SSE 流式接收。
// 队列模式：每一步都入队、按顺序逐条解说，即使下棋很快、解说来不及，也会依次补上，
// 不会出现"下了棋却没有解说"。空响应/失败自动重试一次。
const ENDPOINT = 'https://chessight-commentary.swyu22.workers.dev/';

let queue = [];
let processing = false;
let curAbort = null;

// 清空队列并中止当前在途请求（新对局/摆棋/回退时调用）
export function clearCommentaryQueue() {
  queue = [];
  if (curAbort) { curAbort.abort(); curAbort = null; }
}

// 入队一条解说任务。handlers: { onText(fullText), onDone(finalText), onError() }
export function enqueueCommentary(payload, handlers) {
  queue.push({ payload, handlers });
  pump();
}

async function pump() {
  if (processing) return;
  processing = true;
  while (queue.length) {
    const job = queue.shift();
    await runJob(job);
  }
  processing = false;
}

async function streamOnce(payload, signal, onText) {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim();
      if (d === '[DONE]') return text;
      try {
        const t = JSON.parse(d).choices?.[0]?.delta?.content;
        if (t) { text += t; onText(text); }
      } catch { /* 忽略不完整片段 */ }
    }
  }
  return text;
}

async function runJob(job) {
  const { payload, handlers } = job;
  // 一个 job 一个 controller（而非每次 attempt 新建）：这样在两次尝试之间的 400ms 退避期内
  // 若 clearCommentaryQueue() 触发 abort，重试的 fetch 会立即以 AbortError 放弃，
  // 不再向已清空/已撤销的局面发出多余请求，也不会用过期解说填充 DOM 条目。
  const my = new AbortController();
  curAbort = my;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await streamOnce(payload, my.signal, (t) => handlers.onText(t));
      if (text.trim()) { curAbort = null; handlers.onDone(text); return; }
      // 空响应：还有机会则重试
    } catch (e) {
      if (e.name === 'AbortError') { curAbort = null; return; } // 被清空/中止：放弃该条
      if (attempt === 1) { curAbort = null; handlers.onError(); return; }
    }
    handlers.onText(''); // 清掉首次的残留，准备重试
    await new Promise((r) => setTimeout(r, 400));
  }
  curAbort = null;
  handlers.onDone(''); // 两次都空
}
