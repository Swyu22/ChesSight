// ChesSight AI 解说代理：浏览器 → 本 Worker（持有 DEEPSEEK_API_KEY secret）→ DeepSeek API
// 职责：Origin 白名单、入参校验、简单限流、组装解说 Prompt、SSE 流式透传。
const ALLOWED_ORIGINS = new Set([
  'https://chessight.art',
  'https://www.chessight.art',
  'http://localhost:8173',
  'http://127.0.0.1:8173',
]);

const SYSTEM_PROMPT =
  '你是一位国际象棋解说员，用中文解说，风格清晰而富有诗意。' +
  '针对给出的最新一步棋，点出它的意图、制造的威胁或与前着的呼应。' +
  '严格限制在两句话以内（不超过60字为佳）。' +
  '直接输出解说正文：不要复述着法记号、不要编号、不要引号、不要提及你是AI或解说员。';

// 每个 isolate 内的轻量限流（尽力而为）：每 IP 每分钟最多 30 次
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) { // 防内存膨胀：仅淘汰窗口已过期的 IP，不整体清空（避免瞬间重置所有活跃窗口）
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= 60000) hits.delete(k);
  }
  return arr.length > 30;
}

function fmtMoves(moves) {
  // ['e4','e5','Nf3'] → "1.e4 e5 2.Nf3"
  let s = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) s += (i / 2 + 1) + '.';
    s += moves[i] + ' ';
  }
  return s.trim();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const okOrigin = ALLOWED_ORIGINS.has(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : 'https://chessight.art',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors });
    if (!okOrigin) return new Response('Forbidden', { status: 403, headers: cors });

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return new Response('Too Many Requests', { status: 429, headers: cors });

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad Request', { status: 400, headers: cors });
    }
    // 单个着法也截断长度（SAN 记号最长 ~7 字符），与 lastMove/fen/opening 一致，避免超大字符串放大上游 token 成本
    const moves = Array.isArray(body.moves) ? body.moves.slice(0, 400).map((m) => String(m).slice(0, 8)) : [];
    const lastMove = typeof body.lastMove === 'string' ? body.lastMove.slice(0, 12) : '';
    const fen = typeof body.fen === 'string' ? body.fen.slice(0, 100) : '';
    const opening = typeof body.opening === 'string' ? body.opening.slice(0, 60) : '';
    if (!opening && (!lastMove || !moves.length)) {
      return new Response('Bad Request', { status: 400, headers: cors });
    }

    const sideJustMoved = moves.length % 2 === 1 ? '白方' : '黑方';
    const userPrompt = opening
      ? `棋盘刚按开局库摆出「${opening}」（着法：${fmtMoves(moves)}）。请用不超过两句话整体解说这个开局的核心意图与棋风气质。`
      : `当前棋谱：${fmtMoves(moves)}\n当前局面 FEN：${fen}\n${sideJustMoved}刚走了最新一步：${lastMove}。请解说这一步。`;

    let upstream;
    try {
      upstream = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(15000), // 上游首字节/整体超时：卡死时不无限挂住请求
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          stream: true,
          // 关闭思考模式（非思考/直出）→ 最快出词、无 reasoning 前置延迟。
          thinking: { type: 'disabled' },
          max_tokens: 120,
          temperature: 1.0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
    } catch {
      // 网络级失败 / 超时（AbortError）：显式返回带 CORS 的 502，前端可读到语义而非不透明错误
      return new Response('Upstream error', { status: 502, headers: cors });
    }

    if (!upstream.ok || !upstream.body) {
      return new Response('Upstream ' + upstream.status, { status: 502, headers: cors });
    }
    return new Response(upstream.body, {
      headers: {
        ...cors,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  },
};
