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
