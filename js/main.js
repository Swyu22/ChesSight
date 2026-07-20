import { Chess } from './vendor/chess.js'; // chess.js@1.4.0 ESM 构建，本地 vendor（离线可用，无外部请求）
import { createBoard } from './board.js';
import { analyze, attackLines } from './analysis.js';
import { History } from './history.js';
import { createEngine } from './engine.js';
import { OPENINGS } from './openings.js';

const chess = new Chess();
const history = new History(chess.fen());
const engine = createEngine('./js/vendor/stockfish-18-lite-single.js'); // Stockfish 18 lite，懒加载

let selected = null;
let legalMoves = [];
let showControl = true;
let showSafety = true;
let showXray = true;
let hint = null; // { from, to, san }：引擎提示的最佳走法
let thinking = false;

const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const btnNew = document.getElementById('btn-new');
const btnFlip = document.getElementById('btn-flip');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnControl = document.getElementById('btn-control');
const btnSafety = document.getElementById('btn-safety');
const btnXray = document.getElementById('btn-xray');
const btnHint = document.getElementById('btn-hint');
const openingSelect = document.getElementById('opening-select');
const openingInfo = document.getElementById('opening-info');
const openingName = document.getElementById('opening-name');
const openingOrigin = document.getElementById('opening-origin');
const openingPros = document.getElementById('opening-pros');
const openingCons = document.getElementById('opening-cons');

const board = createBoard(document.getElementById('board'), onSquareClick);

for (const op of OPENINGS) {
  const o = document.createElement('option');
  o.value = op.id;
  o.textContent = op.name;
  openingSelect.appendChild(o);
}

function clearSelection() {
  selected = null;
  legalMoves = [];
}

// 局面变化后引擎提示随之失效
function clearHint() {
  hint = null;
  hintEl.hidden = true;
}

function select(sq) {
  selected = sq;
  legalMoves = chess.moves({ square: sq, verbose: true });
}

function tryMove(to) {
  const legal = legalMoves.find((m) => m.to === to);
  if (!legal) return false;
  let made;
  try {
    made = chess.move({ from: selected, to, promotion: 'q' }); // v1 升变默认后
  } catch {
    return false; // 已用合法着法预校验，正常不会到这里
  }
  history.push(made);
  clearSelection();
  clearHint();
  return true;
}

// 仅将杀/逼和锁盘（PRD 边界规则）；三次重复、50步等"可判和"不锁，
// 避免左右互搏练习中来回挪子误触判和导致锁盘
function isLocked() {
  return chess.isCheckmate() || chess.isStalemate();
}

function onSquareClick(sq) {
  if (isLocked()) return; // 终局锁盘（派生状态，撤销后自动解锁）
  const piece = chess.get(sq);
  if (selected) {
    if (sq === selected) {
      clearSelection();
    } else if (!tryMove(sq)) {
      if (piece && piece.color === chess.turn()) select(sq);
      else clearSelection();
    }
  } else if (piece && piece.color === chess.turn()) {
    select(sq);
  } else {
    return; // 未选中时点空格/敌子：无操作
  }
  renderAll();
}

function statusText() {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? '将杀！黑方获胜' : '将杀！白方获胜';
  if (chess.isStalemate()) return '逼和 — 和棋';
  const side = chess.turn() === 'w' ? '轮到白方' : '轮到黑方';
  if (chess.inCheck()) return side + ' — 将军！';
  if (chess.isDraw()) return side + '（可判和）'; // 三次重复 / 50步 / 子力不足，不锁盘
  return side;
}

function renderAll() {
  const { control, safety } = analyze(chess);
  const cur = history.current();
  board.render({
    position: chess.board(),
    lastMove: cur.from ? [cur.from, cur.to] : null,
    control: showControl ? control : null,
    safety: showSafety ? safety : null,
    hints: legalMoves.map((m) => ({ to: m.to, capture: !!chess.get(m.to) })),
    selected,
    xrayLines: showXray ? attackLines(chess) : null,
    hintMove: hint,
  });
  statusEl.textContent = statusText();
  statusEl.classList.toggle('alert', chess.inCheck() || isLocked());
  btnUndo.disabled = !history.canUndo();
  btnRedo.disabled = !history.canRedo();
  btnHint.disabled = thinking || isLocked();
}

function resetTo(fen) {
  if (fen) chess.load(fen);
  else chess.reset();
  history.reset(chess.fen());
  clearSelection();
  clearHint();
}

btnNew.addEventListener('click', () => {
  resetTo();
  openingSelect.value = '';
  openingInfo.hidden = true;
  renderAll();
});

btnFlip.addEventListener('click', () => {
  board.setOrientation(board.getOrientation() === 'w' ? 'b' : 'w');
  renderAll();
});

btnUndo.addEventListener('click', () => {
  if (!history.canUndo()) return;
  chess.undo();
  history.undo();
  clearSelection();
  clearHint();
  renderAll();
});

btnRedo.addEventListener('click', () => {
  const entry = history.redo();
  if (!entry) return;
  chess.move(entry.san); // 重放存储的 SAN，保持引擎内部历史一致（三次重复等判定不失真）
  clearSelection();
  clearHint();
  renderAll();
});

function bindToggle(btn, get, set) {
  btn.addEventListener('click', () => {
    set(!get());
    btn.classList.toggle('active', get());
    btn.setAttribute('aria-pressed', String(get()));
    renderAll();
  });
}
bindToggle(btnControl, () => showControl, (v) => { showControl = v; });
bindToggle(btnSafety, () => showSafety, (v) => { showSafety = v; });
bindToggle(btnXray, () => showXray, (v) => { showXray = v; });

btnHint.addEventListener('click', async () => {
  if (thinking || isLocked()) return;
  thinking = true;
  btnHint.disabled = true;
  hintEl.hidden = false;
  hintEl.textContent = '💡 引擎思考中…（首次使用需加载引擎）';
  const requestFen = chess.fen();
  try {
    const uci = await engine.bestMove(requestFen, 1200);
    if (chess.fen() !== requestFen) {
      // 思考期间局面已变，提示作废
      hintEl.hidden = true;
    } else if (!uci || uci === '(none)') {
      hintEl.textContent = '当前局面无可走着法';
    } else {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci[4];
      const probe = new Chess(requestFen); // 克隆局面求 SAN，不动主局面
      const mv = probe.move({ from, to, promotion });
      hint = { from, to, san: mv.san };
      hintEl.textContent = `💡 Stockfish 18 最佳走法：${mv.san}（${from} → ${to}）`;
    }
  } catch (err) {
    hintEl.textContent = '引擎加载失败：' + (err && err.message ? err.message : err);
  }
  thinking = false;
  renderAll();
});

openingSelect.addEventListener('change', () => {
  const op = OPENINGS.find((o) => o.id === openingSelect.value);
  if (!op) {
    openingInfo.hidden = true;
    return;
  }
  resetTo();
  for (const san of op.moves) {
    const mv = chess.move(san);
    history.push(mv);
  }
  openingName.textContent = op.name;
  openingOrigin.textContent = op.origin;
  openingPros.textContent = op.pros;
  openingCons.textContent = op.cons;
  openingInfo.hidden = false;
  renderAll();
});

// 摆题/开发钩子：window.app.loadFen('...')
window.app = {
  chess,
  renderAll,
  loadFen(fen) {
    resetTo(fen);
    openingSelect.value = '';
    openingInfo.hidden = true;
    renderAll();
  },
};

renderAll();
