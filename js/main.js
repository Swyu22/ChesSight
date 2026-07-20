import { Chess } from './vendor/chess.js'; // chess.js@1.4.0 ESM 构建，本地 vendor（离线可用，无外部请求）
import { createBoard } from './board.js';
import { analyze, attackLines, analyzeBoard, attackLinesForBoard } from './analysis.js';
import { History } from './history.js';
import { createEngine } from './engine.js';
import { OPENINGS } from './openings.js';
import { sound } from './sound.js';

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
let autoHint = false; // 持续提示：每次局面变化后自动分析

// 自由摆棋模式
let setupMode = false;
let setupBoard = null; // 与 chess.board() 同形的 8×8 数组（行0=第8横排）
let removed = null;    // 备选框计数徽章：已从棋盘移出的数量

const $id = (id) => document.getElementById(id);
const appEl = document.querySelector('.app');
const statusEl = $id('status');
const hintEl = $id('hint');
const btnNew = $id('btn-new');
const btnFlip = $id('btn-flip');
const btnUndo = $id('btn-undo');
const btnRedo = $id('btn-redo');
const btnControl = $id('btn-control');
const btnSafety = $id('btn-safety');
const btnXray = $id('btn-xray');
const btnSound = $id('btn-sound');
const btnHint = $id('btn-hint');
const chkAuto = $id('chk-auto');
const btnSetup = $id('btn-setup');
const trayEl = $id('tray');
const trayPieces = $id('tray-pieces');
const setupTurnSel = $id('setup-turn');
const btnClear = $id('btn-clear');
const btnStartPos = $id('btn-start-pos');
const btnDone = $id('btn-done');
const openingSelect = $id('opening-select');
const openingInfo = $id('opening-info');
const openingName = $id('opening-name');
const openingOrigin = $id('opening-origin');
const openingPros = $id('opening-pros');
const openingCons = $id('opening-cons');

const boardEl = $id('board');
const board = createBoard(boardEl);

for (const op of OPENINGS) {
  const o = document.createElement('option');
  o.value = op.id;
  o.textContent = op.name;
  openingSelect.appendChild(o);
}

// 备选框 12 个槽位：左列白方、右列黑方（K Q R B N P）
const TYPES = ['k', 'q', 'r', 'b', 'n', 'p'];
for (const color of ['w', 'b']) {
  for (const t of TYPES) {
    const slot = document.createElement('div');
    slot.className = 'tray-slot zero';
    slot.dataset.color = color;
    slot.dataset.type = t;
    const img = document.createElement('img');
    img.src = `./assets/pieces/${color}${t.toUpperCase()}.svg`;
    img.alt = '';
    img.draggable = false;
    const badge = document.createElement('span');
    badge.className = 'tray-badge';
    slot.appendChild(img);
    slot.appendChild(badge);
    trayPieces.appendChild(slot);
  }
}

function clearSelection() {
  selected = null;
  legalMoves = [];
}

function clearHint() {
  hint = null;
  hintEl.hidden = true;
}

function select(sq) {
  selected = sq;
  legalMoves = chess.moves({ square: sq, verbose: true });
}

// 仅将杀/逼和锁盘（PRD 边界规则）；三次重复、50步等"可判和"不锁
function isLocked() {
  return chess.isCheckmate() || chess.isStalemate();
}

function playMoveSound(mv) {
  if (chess.isCheckmate() || chess.isStalemate()) sound.gameEnd();
  else if (chess.inCheck()) sound.check();
  else if (mv && mv.san && mv.san.startsWith('O-O')) sound.castle();
  else if (mv && mv.promotion) sound.promote();
  else if (mv && mv.captured) sound.capture();
  else sound.move();
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
  playMoveSound(made);
  return true;
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
  if (setupMode) {
    const a = analyzeBoard(setupBoard);
    board.render({
      position: setupBoard,
      lastMove: null,
      control: showControl ? a.control : null,
      safety: showSafety ? a.safety : null,
      hints: [],
      selected: null,
      xrayLines: showXray ? attackLinesForBoard(setupBoard) : null,
      hintMove: null,
    });
    statusEl.textContent = '自由摆棋中 — 拖动摆放棋子，完成后点「完成」';
    statusEl.classList.remove('alert');
    trayPieces.querySelectorAll('.tray-slot').forEach((slot) => {
      const n = removed[slot.dataset.color][slot.dataset.type];
      slot.querySelector('.tray-badge').textContent = n > 0 ? n : '';
      slot.classList.toggle('zero', n === 0);
    });
  } else {
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
  }
  btnNew.disabled = setupMode;
  btnUndo.disabled = setupMode || !history.canUndo();
  btnRedo.disabled = setupMode || !history.canRedo();
  btnHint.disabled = setupMode || thinking || isLocked();
  openingSelect.disabled = setupMode;
}

// ---- 引擎提示（单次 + 持续） ----
async function runEngineHint() {
  if (thinking || setupMode || isLocked()) return;
  thinking = true;
  renderAll();
  hintEl.hidden = false;
  hintEl.textContent = '💡 引擎思考中…';
  const requestFen = chess.fen();
  try {
    const uci = await engine.bestMove(requestFen, 1200);
    thinking = false;
    if (setupMode) {
      hintEl.hidden = true;
    } else if (chess.fen() !== requestFen) {
      // 思考期间局面已变：持续提示模式下立即分析新局面
      if (autoHint && !isLocked()) {
        renderAll();
        return runEngineHint();
      }
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
    thinking = false;
    hintEl.textContent = '引擎加载失败：' + (err && err.message ? err.message : err);
  }
  renderAll();
}

// 每次局面变化后的统一出口：重绘 + 持续提示自动分析
function afterPositionChange() {
  renderAll();
  if (autoHint && !setupMode && !isLocked()) runEngineHint();
}

// ---- 摆棋模式 ----
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const sqIdx = (sq) => [8 - +sq[1], FILES.indexOf(sq[0])];
const getSetup = (sq) => { const [i, j] = sqIdx(sq); return setupBoard[i][j]; };
const setSetup = (sq, p) => { const [i, j] = sqIdx(sq); setupBoard[i][j] = p; };
const emptyCounts = () => ({
  w: { k: 0, q: 0, r: 0, b: 0, n: 0, p: 0 },
  b: { k: 0, q: 0, r: 0, b: 0, n: 0, p: 0 },
});
const boardSnapshot = (c) => c.board().map((row) => row.map((x) => (x ? { type: x.type, color: x.color } : null)));

function enterSetup() {
  setupMode = true;
  setupBoard = boardSnapshot(chess);
  removed = emptyCounts();
  setupTurnSel.value = chess.turn();
  clearSelection();
  clearHint();
  appEl.classList.add('setup');
  trayEl.hidden = false;
  btnSetup.classList.add('active');
  btnSetup.textContent = '完成摆棋';
  renderAll();
}

function buildFen() {
  const placement = setupBoard
    .map((row) => {
      let s = '';
      let run = 0;
      for (const c of row) {
        if (!c) { run++; continue; }
        if (run) { s += run; run = 0; }
        s += c.color === 'w' ? c.type.toUpperCase() : c.type;
      }
      if (run) s += run;
      return s;
    })
    .join('/');
  // 易位权半自动推断：王与车均在初始位即保留
  const has = (sq, color, type) => {
    const p = getSetup(sq);
    return p && p.color === color && p.type === type;
  };
  let castle = '';
  if (has('e1', 'w', 'k')) {
    if (has('h1', 'w', 'r')) castle += 'K';
    if (has('a1', 'w', 'r')) castle += 'Q';
  }
  if (has('e8', 'b', 'k')) {
    if (has('h8', 'b', 'r')) castle += 'k';
    if (has('a8', 'b', 'r')) castle += 'q';
  }
  return `${placement} ${setupTurnSel.value} ${castle || '-'} - 0 1`;
}

function leaveSetupUI() {
  setupMode = false;
  appEl.classList.remove('setup');
  trayEl.hidden = true;
  btnSetup.classList.remove('active');
  btnSetup.textContent = '自由摆棋';
}

function exitSetup() {
  try {
    chess.load(buildFen());
  } catch (err) {
    statusEl.textContent = '局面不合法，无法完成：' + (err && err.message ? err.message.replace(/^Invalid FEN:\s*/i, '') : err);
    statusEl.classList.add('alert');
    return;
  }
  leaveSetupUI();
  history.reset(chess.fen());
  openingSelect.value = '';
  openingInfo.hidden = true;
  sound.move();
  afterPositionChange();
}

btnSetup.addEventListener('click', () => (setupMode ? exitSetup() : enterSetup()));
btnDone.addEventListener('click', exitSetup);
btnClear.addEventListener('click', () => {
  for (const row of setupBoard) {
    for (let j = 0; j < 8; j++) {
      const c = row[j];
      if (c) {
        removed[c.color][c.type]++;
        row[j] = null;
      }
    }
  }
  renderAll();
});
btnStartPos.addEventListener('click', () => {
  setupBoard = boardSnapshot(new Chess());
  removed = emptyCounts();
  renderAll();
});

// ---- 走子交互：点击 + 拖拽（Chess.com 式），统一用 Pointer Events ----
// 对局模式：按下己方子选中并可拖拽，位移超阈值进入拖拽，落合法格走子否则弹回。
// 摆棋模式：任意子任意拖，可拖入备选框；备选框可无限取子拖回棋盘（无限调色板）。
let drag = null; // { source:'board'|'tray', from, piece, wasSelected, moved, ghost, over, pointerId, startX, startY, src }

function makeGhost(src) {
  const ghost = document.createElement('img');
  ghost.src = src;
  ghost.className = 'drag-ghost';
  const size = boardEl.clientWidth / 8;
  ghost.style.width = size + 'px';
  ghost.style.height = size + 'px';
  document.body.appendChild(ghost);
  return ghost;
}

const pieceSrc = (p) => `./assets/pieces/${p.color}${p.type.toUpperCase()}.svg`;
const inTray = (x, y) => {
  if (trayEl.hidden) return false;
  const r = trayEl.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

boardEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const sqEl = e.target.closest('[data-square]');
  if (!sqEl) return;
  const sq = sqEl.dataset.square;

  if (setupMode) {
    const piece = getSetup(sq);
    if (!piece) return;
    drag = {
      source: 'board', from: sq, piece, wasSelected: false, moved: false, ghost: null, over: null,
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, src: pieceSrc(piece),
    };
    try { boardEl.setPointerCapture(e.pointerId); } catch { /* 忽略无效 pointerId */ }
    return;
  }

  if (isLocked()) return;
  const piece = chess.get(sq);
  if (piece && piece.color === chess.turn()) {
    const wasSelected = selected === sq;
    select(sq);
    renderAll();
    drag = {
      source: 'board', from: sq, piece, wasSelected, moved: false, ghost: null, over: null,
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, src: pieceSrc(piece),
    };
    try { boardEl.setPointerCapture(e.pointerId); } catch { /* 忽略无效 pointerId */ }
  } else if (selected) {
    if (tryMove(sq)) afterPositionChange();
    else {
      clearSelection();
      renderAll();
    }
  }
});

trayEl.addEventListener('pointerdown', (e) => {
  if (!setupMode) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const slot = e.target.closest('.tray-slot');
  if (!slot) return;
  const piece = { color: slot.dataset.color, type: slot.dataset.type };
  drag = {
    source: 'tray', from: null, piece, wasSelected: false, moved: false, ghost: null, over: null,
    pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, src: pieceSrc(piece),
  };
  try { trayEl.setPointerCapture(e.pointerId); } catch { /* 忽略无效 pointerId */ }
  e.preventDefault();
});

function dragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
    drag.moved = true;
    drag.ghost = makeGhost(drag.src);
    if (drag.source === 'board') {
      const el = boardEl.querySelector(`[data-square="${drag.from}"]`);
      if (el) el.classList.add('drag-origin');
    }
  }
  drag.ghost.style.left = e.clientX + 'px';
  drag.ghost.style.top = e.clientY + 'px';
  const over = board.squareAt(e.clientX, e.clientY);
  if (drag.over !== over) {
    if (drag.over) {
      const el = boardEl.querySelector(`[data-square="${drag.over}"]`);
      if (el) el.classList.remove('drag-over');
    }
    drag.over = over;
    if (over) boardEl.querySelector(`[data-square="${over}"]`).classList.add('drag-over');
  }
}

function dragEnd(e, cancelled) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  if (d.ghost) d.ghost.remove();
  boardEl.querySelectorAll('.drag-origin, .drag-over').forEach((el) => el.classList.remove('drag-origin', 'drag-over'));
  if (cancelled) {
    renderAll();
    return;
  }

  if (setupMode) {
    const droppedInTray = inTray(e.clientX, e.clientY);
    const dest = droppedInTray ? null : board.squareAt(e.clientX, e.clientY);
    if (d.source === 'board' && d.moved) {
      if (droppedInTray) {
        setSetup(d.from, null);
        removed[d.piece.color][d.piece.type]++;
        sound.move();
      } else if (dest && dest !== d.from) {
        const occ = getSetup(dest);
        if (occ) removed[occ.color][occ.type]++; // 被替换的子进备选框
        setSetup(dest, d.piece);
        setSetup(d.from, null);
        sound.move();
      }
    } else if (d.source === 'tray' && d.moved && dest) {
      const occ = getSetup(dest);
      if (occ) removed[occ.color][occ.type]++;
      setSetup(dest, { type: d.piece.type, color: d.piece.color });
      const n = removed[d.piece.color][d.piece.type];
      if (n > 0) removed[d.piece.color][d.piece.type] = n - 1; // 无限调色板：0 时保持 0
      sound.move();
    }
    renderAll();
    return;
  }

  if (d.moved) {
    const dest = board.squareAt(e.clientX, e.clientY);
    if (dest && dest !== d.from && tryMove(dest)) {
      afterPositionChange();
      return;
    }
    renderAll(); // 不合法则自然弹回，选中与落点提示保留
  } else if (d.wasSelected) {
    clearSelection(); // 原地点击已选中的子 → 取消选中
    renderAll();
  }
}

boardEl.addEventListener('pointermove', dragMove);
boardEl.addEventListener('pointerup', (e) => dragEnd(e, false));
boardEl.addEventListener('pointercancel', (e) => dragEnd(e, true));
trayEl.addEventListener('pointermove', dragMove);
trayEl.addEventListener('pointerup', (e) => dragEnd(e, false));
trayEl.addEventListener('pointercancel', (e) => dragEnd(e, true));

// ---- 面板按钮 ----
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
  afterPositionChange();
});

btnFlip.addEventListener('click', () => {
  board.setOrientation(board.getOrientation() === 'w' ? 'b' : 'w');
  renderAll();
});

btnUndo.addEventListener('click', () => {
  if (setupMode || !history.canUndo()) return;
  chess.undo();
  history.undo();
  clearSelection();
  clearHint();
  sound.move();
  afterPositionChange();
});

btnRedo.addEventListener('click', () => {
  if (setupMode) return;
  const entry = history.redo();
  if (!entry) return;
  const mv = chess.move(entry.san); // 重放存储的 SAN，保持引擎内部历史一致
  clearSelection();
  clearHint();
  playMoveSound(mv);
  afterPositionChange();
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
bindToggle(btnSound, () => sound.isEnabled(), (v) => sound.setEnabled(v));

btnHint.addEventListener('click', runEngineHint);

chkAuto.addEventListener('change', () => {
  autoHint = chkAuto.checked;
  if (autoHint && !setupMode && !isLocked()) runEngineHint();
});

// F1 快捷键触发引擎提示（拦截浏览器默认帮助）
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1') {
    e.preventDefault();
    if (!btnHint.disabled) runEngineHint();
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
  sound.move();
  afterPositionChange();
});

// 摆题/开发钩子：window.app.loadFen('...')
window.app = {
  chess,
  renderAll,
  loadFen(fen) {
    if (setupMode) leaveSetupUI(); // 钩子载入直接放弃摆棋中的局面
    resetTo(fen);
    openingSelect.value = '';
    openingInfo.hidden = true;
    afterPositionChange();
  },
};

renderAll();
