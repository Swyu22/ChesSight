// ChesSight AI 解说代理：浏览器 → 本 Worker（持有 DEEPSEEK_API_KEY secret）→ DeepSeek API。
// 浏览器 Origin 白名单只提供 CORS 隔离，不等同身份认证；费用级防护仍需 Cloudflare WAF/限流。
const ALLOWED_ORIGINS = new Set([
  'https://chessight.art',
  'https://www.chessight.art',
  'http://localhost:8173',
  'http://127.0.0.1:8173',
]);

const OPENINGS = new Map([
  ['italian', ['意大利开局 · Italian Game', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']]],
  ['ruylopez', ['西班牙开局（鲁伊·洛佩兹）· Ruy López', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']]],
  ['sicilian', ['西西里防御 · Sicilian Defence', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6']]],
  ['french', ['法兰西防御 · French Defence', ['e4', 'e6', 'd4', 'd5']]],
  ['carokann', ['卡罗-卡恩防御 · Caro-Kann Defence', ['e4', 'c6', 'd4', 'd5']]],
  ['queensgambit', ['后翼弃兵 · Queen\'s Gambit', ['d4', 'd5', 'c4']]],
  ['kingsgambit', ['王翼弃兵 · King\'s Gambit', ['e4', 'e5', 'f4']]],
  ['kingsindian', ['王翼印度防御 · King\'s Indian Defence', ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6']]],
  ['nimzoindian', ['尼姆佐-印度防御 · Nimzo-Indian Defence', ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4']]],
  ['english', ['英国开局 · English Opening', ['c4']]],
  ['scotch', ['苏格兰开局 · Scotch Game', ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4']]],
  ['petrov', ['彼得罗夫防御（俄罗斯防御）· Petrov Defence', ['e4', 'e5', 'Nf3', 'Nf6']]],
  ['dutch', ['荷兰防御 · Dutch Defence', ['d4', 'f5']]],
  ['london', ['伦敦体系 · London System', ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4']]],
]);

const SYSTEM_PROMPT =
  '你是一位国际象棋解说员，用中文解说，风格清晰而富有诗意。' +
  '针对给出的最新一步棋，点出它的意图、制造的威胁或与前着的呼应。' +
  '严格限制在两句话以内（不超过60字为佳）。' +
  '直接输出解说正文：不要复述着法记号、不要编号、不要引号、不要提及你是AI或解说员。';

const MAX_BODY_BYTES = 8192;
const MAX_MOVES = 400;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60000;
const MAX_RATE_KEYS = 5000;
const UPSTREAM_TIMEOUT_MS = 15000;
const UPSTREAM_URL = 'https://api.deepseek.com/chat/completions';
const ALLOWED_FIELDS = new Set(['moves', 'lastMove', 'fen', 'opening']);
const SAN = /^(?:O-O(?:-O)?|[KQRBN]?(?:[a-h]|[1-8]|[a-h][1-8])?x?[a-h][1-8](?:=[QRBN])?[+#]?)$/;

class RequestProblem extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
    this.reason = reason;
  }
}

// Isolate 内的 O(1) 后备限流仅用于降噪；生产费用保护应在 Cloudflare 边缘层配置。
const hits = new Map();
function locallyRateLimited(ip, now = Date.now()) {
  let entry = hits.get(ip);
  if (!entry || now - entry.startedAt >= RATE_WINDOW_MS) {
    if (!entry && hits.size >= MAX_RATE_KEYS) hits.delete(hits.keys().next().value);
    entry = { startedAt: now, count: 0 };
    hits.set(ip, entry);
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

function logEvent(event, requestId, details = {}) {
  // 不记录 IP、Authorization、Prompt、FEN、棋谱或 secret。
  console.log(JSON.stringify({ event, requestId, ...details }));
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function reply(body, status, cors, extra = {}) {
  return new Response(body, { status, headers: { ...cors, ...extra } });
}

async function readJson(request) {
  const contentType = (request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new RequestProblem(415, 'unsupported_media_type');

  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new RequestProblem(413, 'body_too_large');
  if (!request.body) throw new RequestProblem(400, 'empty_body');

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel('body_too_large').catch(() => {});
        throw new RequestProblem(413, 'body_too_large');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestProblem(400, 'invalid_json');
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFenShape(fen) {
  if (typeof fen !== 'string' || fen.length > 100) return false;
  const fields = fen.split(' ');
  if (fields.length !== 6) return false;
  const ranks = fields[0].split('/');
  if (ranks.length !== 8) return false;
  for (const rank of ranks) {
    let count = 0;
    for (const char of rank) {
      if (/[1-8]/.test(char)) count += Number(char);
      else if (/[prnbqkPRNBQK]/.test(char)) count++;
      else return false;
    }
    if (count !== 8) return false;
  }
  return /^[wb]$/.test(fields[1])
    && /^(?:-|K?Q?k?q?)$/.test(fields[2])
    && /^(?:-|[a-h][36])$/.test(fields[3])
    && /^\d+$/.test(fields[4])
    && /^[1-9]\d*$/.test(fields[5]);
}

function sameMoves(actual, expected) {
  return actual.length === expected.length && actual.every((move, index) => move === expected[index]);
}

function validatePayload(body) {
  if (!isPlainObject(body)) throw new RequestProblem(400, 'invalid_object');
  if (Object.keys(body).some((field) => !ALLOWED_FIELDS.has(field))) {
    throw new RequestProblem(400, 'unknown_field');
  }
  if (!Array.isArray(body.moves) || body.moves.length < 1 || body.moves.length > MAX_MOVES) {
    throw new RequestProblem(400, 'invalid_moves');
  }
  if (!body.moves.every((move) => typeof move === 'string' && move.length <= 8 && SAN.test(move))) {
    throw new RequestProblem(400, 'invalid_san');
  }

  if (body.opening !== undefined) {
    if (typeof body.opening !== 'string' || !OPENINGS.has(body.opening)) {
      throw new RequestProblem(400, 'unknown_opening');
    }
    const [name, expectedMoves] = OPENINGS.get(body.opening);
    if (!sameMoves(body.moves, expectedMoves)) throw new RequestProblem(400, 'opening_moves_mismatch');
    return { kind: 'opening', name, moves: body.moves };
  }

  if (typeof body.lastMove !== 'string' || body.lastMove !== body.moves.at(-1) || !SAN.test(body.lastMove)) {
    throw new RequestProblem(400, 'invalid_last_move');
  }
  if (!isFenShape(body.fen)) throw new RequestProblem(400, 'invalid_fen');
  return { kind: 'move', moves: body.moves, lastMove: body.lastMove, fen: body.fen };
}

function fmtMoves(moves) {
  let text = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) text += (i / 2 + 1) + '.';
    text += moves[i] + ' ';
  }
  return text.trim();
}

function promptFor(payload) {
  if (payload.kind === 'opening') {
    return `棋盘刚按开局库摆出「${payload.name}」（着法：${fmtMoves(payload.moves)}）。请用不超过两句话整体解说这个开局的核心意图与棋风气质。`;
  }
  const sideJustMoved = payload.moves.length % 2 === 1 ? '白方' : '黑方';
  return `当前棋谱：${fmtMoves(payload.moves)}\n当前局面 FEN：${payload.fen}\n${sideJustMoved}刚走了最新一步：${payload.lastMove}。请解说这一步。`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const okOrigin = ALLOWED_ORIGINS.has(origin);
    const cors = corsHeaders(origin);
    const requestId = request.headers.get('CF-Ray') || crypto.randomUUID();

    if (request.method === 'OPTIONS') {
      return okOrigin ? reply(null, 204, cors) : reply('Forbidden', 403, cors);
    }
    if (request.method !== 'POST') return reply('Method Not Allowed', 405, cors, { Allow: 'POST, OPTIONS' });
    if (!okOrigin) {
      logEvent('request_rejected', requestId, { reason: 'origin', status: 403 });
      return reply('Forbidden', 403, cors);
    }
    if (typeof env?.DEEPSEEK_API_KEY !== 'string' || !env.DEEPSEEK_API_KEY.trim()) {
      logEvent('service_unavailable', requestId, { reason: 'configuration', status: 503 });
      return reply('Service unavailable', 503, cors, { 'Retry-After': '60' });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (locallyRateLimited(ip)) {
      logEvent('request_rejected', requestId, { reason: 'rate_limit', status: 429 });
      return reply('Too Many Requests', 429, cors, { 'Retry-After': '60' });
    }

    let payload;
    try {
      payload = validatePayload(await readJson(request));
    } catch (error) {
      const status = error instanceof RequestProblem ? error.status : 400;
      const reason = error instanceof RequestProblem ? error.reason : 'bad_request';
      logEvent('request_rejected', requestId, { reason, status });
      return reply(status === 413 ? 'Payload Too Large' : 'Bad Request', status, cors);
    }

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);
    const startedAt = Date.now();
    let upstream;
    try {
      upstream = await fetch(UPSTREAM_URL, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          stream: true,
          thinking: { type: 'disabled' },
          max_tokens: 120,
          temperature: 1.0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: promptFor(payload) },
          ],
        }),
      });
    } catch (error) {
      logEvent('upstream_failed', requestId, {
        reason: signal.aborted ? 'aborted_or_timeout' : 'network',
        status: 502,
        durationMs: Date.now() - startedAt,
      });
      return reply('Upstream error', 502, cors);
    }

    const upstreamType = upstream.headers.get('Content-Type') || '';
    if (!upstream.ok || !upstream.body || !upstreamType.toLowerCase().startsWith('text/event-stream')) {
      logEvent('upstream_failed', requestId, {
        reason: 'response',
        upstreamStatus: upstream.status,
        status: 502,
        durationMs: Date.now() - startedAt,
      });
      return reply('Upstream error', 502, cors);
    }

    logEvent('request_completed', requestId, { status: 200, durationMs: Date.now() - startedAt });
    return new Response(upstream.body, {
      headers: {
        ...cors,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  },
};
