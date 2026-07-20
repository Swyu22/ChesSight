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

const boardEl = document.getElementById('board');
const board = createBoard(boardEl);

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

// ---- 走子交互：点击 + 拖拽（Chess.com 式），统一用 Pointer Events ----
// 按下己方子 → 立即选中并可拖拽；位移超过阈值进入拖拽（浮动棋子跟随指针、
// origin 半透明、悬停格白框）；松手落在合法格即走子，否则弹回并保持选中。
// 未发生位移即普通点击：再点已选中的子取消选中，点合法落点走子，点其他处取消。
let drag = null; // { from, wasSelected, moved, ghost, over, pointerId, startX, startY, src }

boardEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const sqEl = e.target.closest('[data-square]');
  if (!sqEl || isLocked()) return;
  const sq = sqEl.dataset.square;
  const piece = chess.get(sq);
  if (piece && piece.color === chess.turn()) {
    const wasSelected = selected === sq;
    select(sq);
    renderAll();
    drag = {
      from: sq, wasSelected, moved: false, ghost: null, over: null,
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      src: `./assets/pieces/${piece.color}${piece.type.toUpperCase()}.svg`,
    };
    try { boardEl.setPointerCapture(e.pointerId); } catch { /* 合成事件等无效 pointerId 时忽略 */ }
  } else if (selected) {
    if (!tryMove(sq)) clearSelection();
    renderAll();
  }
});

boardEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
    drag.moved = true;
    const ghost = document.createElement('img');
    ghost.src = drag.src;
    ghost.className = 'drag-ghost';
    const size = boardEl.clientWidth / 8;
    ghost.style.width = size + 'px';
    ghost.style.height = size + 'px';
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    boardEl.querySelector(`[data-square="${drag.from}"]`).classList.add('drag-origin');
  }
  drag.ghost.style.left = e.clientX + 'px';
  drag.ghost.style.top = e.clientY + 'px';
  const over = board.squareAt(e.clientX, e.clientY);
  if (drag.over !== over) {
    if (drag.over) boardEl.querySelector(`[data-square="${drag.over}"]`).classList.remove('drag-over');
    drag.over = over;
    if (over) boardEl.querySelector(`[data-square="${over}"]`).classList.add('drag-over');
  }
});

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  if (d.ghost) d.ghost.remove();
  boardEl.querySelectorAll('.drag-origin, .drag-over').forEach((el) => el.classList.remove('drag-origin', 'drag-over'));
  if (cancelled) {
    renderAll();
    return;
  }
  if (d.moved) {
    const dest = board.squareAt(e.clientX, e.clientY);
    if (dest && dest !== d.from) tryMove(dest); // 不合法则自然弹回，选中与落点提示保留
    renderAll();
  } else if (d.wasSelected) {
    clearSelection(); // 原地点击已选中的子 → 取消选中
    renderAll();
  }
}
boardEl.addEventListener('pointerup', (e) => endDrag(e, false));
boardEl.addEventListener('pointercancel', (e) => endDrag(e, true));

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

// F1 快捷键触发引擎提示（拦截浏览器默认帮助）
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1') {
    e.preventDefault();
    if (!btnHint.disabled) btnHint.click();
  }
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
