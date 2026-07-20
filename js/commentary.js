// AI 实时解说客户端：调用 Cloudflare Worker 代理（key 在 Worker secret 中），SSE 流式接收。
// 任意时刻只保留一个在途请求：新请求自动作废旧请求（快速连走只解说最新一步）。
const ENDPOINT = 'https://chessight-commentary.swyu22.workers.dev/';

let ctrl = null;

export function abortCommentary() {
  if (ctrl) {
    ctrl.abort();
    ctrl = null;
  }
}

export async function commentate(payload, { onDelta, onDone, onError }) {
  abortCommentary();
  const my = new AbortController();
  ctrl = my;
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: my.signal,
    });
    if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
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
        if (d === '[DONE]') {
          if (ctrl === my) ctrl = null;
          if (onDone) onDone();
          return;
        }
        try {
          const t = JSON.parse(d).choices?.[0]?.delta?.content;
          if (t) onDelta(t);
        } catch { /* 忽略不完整片段 */ }
      }
    }
    if (ctrl === my) ctrl = null;
    if (onDone) onDone();
  } catch (e) {
    if (ctrl === my) ctrl = null;
    if (e.name !== 'AbortError' && onError) onError(e);
  }
}
