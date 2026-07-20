import { Chess } from './vendor/chess.js'; // chess.js@1.4.0 ESM 构建，本地 vendor（离线可用，无外部请求）
import { createBoard } from './board.js';
import { analyze } from './analysis.js';
import { History } from './history.js';

const chess = new Chess();
const history = new History(chess.fen());

let selected = null;
let legalMoves = [];
let showControl = true;
let showSafety = true;

const statusEl = document.getElementById('status');
const btnNew = document.getElementById('btn-new');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnControl = document.getElementById('btn-control');
const btnSafety = document.getElementById('btn-safety');

const board = createBoard(document.getElementById('board'), onSquareClick);

function clearSelection() {
  selected = null;
  legalMoves = [];
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
  });
  statusEl.textContent = statusText();
  statusEl.classList.toggle('alert', chess.inCheck() || isLocked());
  btnUndo.disabled = !history.canUndo();
  btnRedo.disabled = !history.canRedo();
}

btnNew.addEventListener('click', () => {
  chess.reset();
  history.reset(chess.fen());
  clearSelection();
  renderAll();
});

btnUndo.addEventListener('click', () => {
  if (!history.canUndo()) return;
  chess.undo();
  history.undo();
  clearSelection();
  renderAll();
});

btnRedo.addEventListener('click', () => {
  const entry = history.redo();
  if (!entry) return;
  chess.move(entry.san); // 重放存储的 SAN，保持引擎内部历史一致（三次重复等判定不失真）
  clearSelection();
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

// 摆题/开发钩子：window.app.loadFen('...')
window.app = {
  chess,
  renderAll,
  loadFen(fen) {
    chess.load(fen);
    history.reset(chess.fen());
    clearSelection();
    renderAll();
  },
};

renderAll();
