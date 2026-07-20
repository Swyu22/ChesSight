// ChesSight AI 解说代理：浏览器 → 本 Worker（持有 DEEPSEEK_API_KEY secret）→ DeepSeek API
// 职责：Origin 白名单、入参校验、简单限流、组装解说 Prompt、SSE 流式透传。
const ALLOWED_ORIGINS = new Set([
  'https://chessight.art',
  'https://www.chessight.art',
  'http://localhost:8173',
  'http://127.0.0.1:8173',
]);

const SYSTEM_PROMPT =
  '你是一位精通七言律诗的国际象棋解说员。' +
  '针对给出的最新一步棋，即兴创作原创的七言两句（每句七字、共十四字），' +
  '两句对仗工整、意象凝练，点出这步棋的意图、气势或攻守呼应。' +
  '只输出这两句诗，两句之间用一个逗号分隔（形如"前七字，后七字"）；' +
  '不要标题、不要编号、不要引号、不要解释、不要着法记号、不要提及你是AI。';

// 每个 isolate 内的轻量限流（尽力而为）：每 IP 每分钟最多 30 次
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear(); // 防内存膨胀
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
    const moves = Array.isArray(body.moves) ? body.moves.slice(0, 400).map(String) : [];
    const lastMove = typeof body.lastMove === 'string' ? body.lastMove.slice(0, 12) : '';
    const fen = typeof body.fen === 'string' ? body.fen.slice(0, 100) : '';
    const opening = typeof body.opening === 'string' ? body.opening.slice(0, 60) : '';
    if (!opening && (!lastMove || !moves.length)) {
      return new Response('Bad Request', { status: 400, headers: cors });
    }

    const sideJustMoved = moves.length % 2 === 1 ? '白方' : '黑方';
    const userPrompt = opening
      ? `棋盘刚按开局库摆出「${opening}」（着法：${fmtMoves(moves)}）。请为这个开局的气质创作七言两句（共十四字，一逗分隔）。`
      : `当前棋谱：${fmtMoves(moves)}\n当前局面 FEN：${fen}\n${sideJustMoved}刚走了最新一步：${lastMove}。请为这一步创作七言两句（共十四字，一逗分隔）。`;

    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        stream: true,
        // v4-flash 为思考型模型：先输出 reasoning_content 再出正文，需给足预算否则正文为空。
        // 正文只有七言两句（约十四字），但要留出前置推理的 token。
        max_tokens: 400,
        temperature: 1.15,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

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
