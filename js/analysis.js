// 控制格与子力安全状态计算（F1/F2 共用同一口径：几何控制 / 伪合法）。
// chess.js 的 attackers(square, color) 正是该口径：兵仅斜吃方向（不含直进格）、
// 滑子止于首个阻挡格且含该格、被牵制的子照常计入、含对己方子的保护、含王。
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const ALL_SQUARES = [];
for (let rank = 1; rank <= 8; rank++) {
  for (let f = 0; f < 8; f++) ALL_SQUARES.push(FILES[f] + rank);
}

let cachedFen = null;
let cachedResult = null;

export function analyze(chess) {
  const fen = chess.fen();
  if (fen === cachedFen) return cachedResult;

  const control = {}; // sq -> 'w' | 'b' | 'wb'（无人控制则不设键）
  const counts = {};
  for (const sq of ALL_SQUARES) {
    const w = chess.attackers(sq, 'w').length;
    const b = chess.attackers(sq, 'b').length;
    counts[sq] = { w, b };
    if (w && b) control[sq] = 'wb';
    else if (w) control[sq] = 'w';
    else if (b) control[sq] = 'b';
  }

  // 方案 A 优先级 红 > 绿 > 黄：被攻击 → attacked；否则有保护 → defended；否则 undefended
  const safety = {}; // sq -> 'attacked' | 'defended' | 'undefended'（仅有子格）
  const rows = chess.board();
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const cell = rows[i][j];
      if (!cell) continue;
      const name = FILES[j] + (8 - i);
      if (cell.type === 'k') {
        // 王不参与绿/黄判定；被将军时标红（只有行棋方的王可能处于被将军状态）
        if (cell.color === chess.turn() && chess.inCheck()) safety[name] = 'attacked';
        continue;
      }
      const c = counts[name];
      const enemy = cell.color === 'w' ? c.b : c.w;
      const own = cell.color === 'w' ? c.w : c.b;
      safety[name] = enemy >= 1 ? 'attacked' : own >= 1 ? 'defended' : 'undefended';
    }
  }

  cachedFen = fen;
  cachedResult = { control, safety };
  return cachedResult;
}

// X-Ray 杀伤线：每个棋子按几何控制口径给出攻击射线（与 F1/F2 同口径）。
// 滑子每个方向合并为一条线（终点=首个阻挡格或棋盘边缘）；马/王/兵为逐目标短线。
const SLIDE_DIRS = {
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
};
const KNIGHT_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_OFFSETS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

export function attackLines(chess) {
  const rows = chess.board();
  const occ = new Set();
  const pieces = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const cell = rows[i][j];
      if (!cell) continue;
      const name = FILES[j] + (8 - i);
      occ.add(name);
      pieces.push({ name, f: j, r: 8 - i, type: cell.type, color: cell.color });
    }
  }
  const sq = (f, r) => FILES[f] + r;
  const on = (f, r) => f >= 0 && f < 8 && r >= 1 && r <= 8;
  const lines = [];
  for (const p of pieces) {
    if (p.type === 'q' || p.type === 'r' || p.type === 'b') {
      const dirs = p.type === 'q' ? [...SLIDE_DIRS.r, ...SLIDE_DIRS.b] : SLIDE_DIRS[p.type];
      for (const [df, dr] of dirs) {
        let f = p.f + df;
        let r = p.r + dr;
        let last = null;
        while (on(f, r)) {
          last = sq(f, r);
          if (occ.has(last)) break; // 首个阻挡格计入后截止
          f += df;
          r += dr;
        }
        if (last) lines.push({ from: p.name, to: last, color: p.color });
      }
    } else if (p.type === 'n' || p.type === 'k') {
      for (const [df, dr] of (p.type === 'n' ? KNIGHT_OFFSETS : KING_OFFSETS)) {
        const f = p.f + df;
        const r = p.r + dr;
        if (on(f, r)) lines.push({ from: p.name, to: sq(f, r), color: p.color });
      }
    } else if (p.type === 'p') {
      const dr = p.color === 'w' ? 1 : -1;
      for (const df of [-1, 1]) {
        const f = p.f + df;
        const r = p.r + dr;
        if (on(f, r)) lines.push({ from: p.name, to: sq(f, r), color: p.color });
      }
    }
  }
  return lines;
}
