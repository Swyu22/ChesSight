import { Chess } from './vendor/chess.js'; // chess.js@1.4.0 ESM 构建，本地 vendor（离线可用，无外部请求）
import { createBoard } from './board.js';
import { analyze, attackLines, analyzeBoard, attackLinesForBoard } from './analysis.js';
import { History } from './history.js';
import { createEngine } from './engine.js';
import { OPENINGS } from './openings.js';
import { sound } from './sound.js';
import { commentate, abortCommentary } from './commentary.js';

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
let autoHint = true; // 持续提示：每次局面变化后自动分析（默认开启）
let showCommentary = true; // AI 实时解说：每步走完自动解说（默认开启）

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
const cmtList = $id('cmt-list');
const btnCommentary = $id('btn-commentary');
const openingSelect = $id('opening-select');
const openingInfo = $id('opening-info');
const openingName = $id('opening-name');
const openingSide = $id('opening-side');
const openingOrigin = $id('opening-origin');
const openingPros = $id('opening-pros');
const openingCons = $id('opening-cons');

const boardEl = $id('board');
const board = createBoard(boardEl);

for (const op of OPENINGS) {
  const o = document.createElement('option');
  o.value = op.id;
  o.textContent = (op.side === 'w' ? '⚪ ' : '⚫ ') + op.name; // 标注白方开局 / 黑方防御
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

// 返回 'moved'（已走子）| 'promo'（已弹出升变选子框）| false（非法落点）
function tryMove(to) {
  const legal = legalMoves.find((m) => m.to === to);
  if (!legal) return false;
  if (legal.promotion) {
    pendingPromotion = { from: selected, to };
    clearSelection();
    showPromoPicker(to, chess.turn());
    return 'promo';
  }
  let made;
  try {
    made = chess.move({ from: selected, to });
  } catch {
    return false; // 已用合法着法预校验，正常不会到这里
  }
  history.push(made);
  clearSelection();
  clearHint();
  playMoveSound(made);
  requestCommentary(made);
  return 'moved';
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
      endBadges: null,
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
    // 终局徽章（Chess.com 式）：将杀 = 败方王红罩+#、胜方王绿冠；逼和 = 双王灰 =
    let endBadges = null;
    if (chess.isCheckmate() || chess.isStalemate()) {
      const kings = {};
      const rows = chess.board();
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          const c = rows[i][j];
          if (c && c.type === 'k') kings[c.color] = FILES[j] + (8 - i);
        }
      }
      endBadges = chess.isCheckmate()
        ? [
            { square: kings[chess.turn()], kind: 'mate' },
            { square: kings[chess.turn() === 'w' ? 'b' : 'w'], kind: 'win' },
          ]
        : [
            { square: kings.w, kind: 'draw' },
            { square: kings.b, kind: 'draw' },
          ];
    }
    board.render({
      position: chess.board(),
      lastMove: cur.from ? [cur.from, cur.to] : null,
      control: showControl ? control : null,
      safety: showSafety ? safety : null,
      hints: legalMoves.map((m) => ({ to: m.to, capture: !!chess.get(m.to) })),
      selected,
      xrayLines: showXray ? attackLines(chess) : null,
      hintMove: hint,
      endBadges,
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

// ---- AI 实时解说 ----
function clearCommentary() {
  abortCommentary();
  cmtList.replaceChildren();
  const p = document.createElement('p');
  p.className = 'cmt-empty';
  p.textContent = '走一步棋，听听 AI 怎么说 ♟';
  cmtList.appendChild(p);
}

function addCmtItem(label) {
  const empty = cmtList.querySelector('.cmt-empty');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'cmt-item';
  const mv = document.createElement('span');
  mv.className = 'cmt-move';
  mv.textContent = label;
  const txt = document.createElement('span');
  txt.className = 'cmt-text';
  txt.textContent = '…';
  item.appendChild(mv);
  item.appendChild(txt);
  cmtList.appendChild(item);
  cmtList.scrollTop = cmtList.scrollHeight;
  return txt;
}

function streamCommentary(label, payload) {
  const el = addCmtItem(label);
  let text = '';
  commentate(payload, {
    onDelta: (t) => {
      text += t;
      el.textContent = text;
      cmtList.scrollTop = cmtList.scrollHeight;
    },
    onDone: () => {
      if (!text) el.textContent = '（无解说）';
    },
    onError: () => {
      el.textContent = '解说暂不可用';
      el.classList.add('cmt-fail');
    },
  });
}

// 走完一步后调用（此时该着已入 chess 历史）
function requestCommentary(mv) {
  if (!showCommentary || setupMode) return;
  const n = chess.history().length;
  const label = Math.ceil(n / 2) + (n % 2 === 1 ? '.' : '...') + ' ' + mv.san;
  streamCommentary(label, { moves: chess.history(), lastMove: mv.san, fen: chess.fen() });
}

function requestOpeningCommentary(op) {
  if (!showCommentary) return;
  streamCommentary('📖 ' + op.name, { opening: op.name, moves: op.moves, fen: chess.fen() });
}

// ---- 升变选子（后/马/象/车，Chess.com 式弹窗） ----
let pendingPromotion = null; // { from, to }
let promoEl = null;

function showPromoPicker(to, color) {
  removePromoPicker();
  const sqEl = boardEl.querySelector(`[data-square="${to}"]`);
  const picker = document.createElement('div');
  picker.className = 'promo-picker';
  picker.style.left = sqEl.offsetLeft + 'px';
  picker.style.width = sqEl.offsetWidth + 'px';
  if (sqEl.offsetTop < boardEl.clientHeight / 2) picker.style.top = sqEl.offsetTop + 'px';
  else picker.style.bottom = (boardEl.clientHeight - sqEl.offsetTop - sqEl.offsetHeight) + 'px';
  picker.addEventListener('pointerdown', (e) => e.stopPropagation()); // 防止棋盘监听把点击当作"点空白取消"
  for (const t of ['q', 'n', 'b', 'r']) { // 后、马、象、车
    const b = document.createElement('button');
    b.type = 'button';
    const img = document.createElement('img');
    img.src = `./assets/pieces/${color}${t.toUpperCase()}.svg`;
    img.alt = t;
    img.draggable = false;
    b.appendChild(img);
    b.addEventListener('click', () => completePromotion(t));
    picker.appendChild(b);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'promo-cancel';
  x.textContent = '✕';
  x.addEventListener('click', cancelPromotion);
  picker.appendChild(x);
  boardEl.appendChild(picker);
  promoEl = picker;
}

function removePromoPicker() {
  if (promoEl) {
    promoEl.remove();
    promoEl = null;
  }
}

// 静默中止（局面导航/翻转/摆棋时调用）
function abortPromotion() {
  pendingPromotion = null;
  removePromoPicker();
}

function cancelPromotion() {
  abortPromotion();
  renderAll();
}

function completePromotion(t) {
  const p = pendingPromotion;
  abortPromotion();
  if (!p) return;
  let made;
  try {
    made = chess.move({ from: p.from, to: p.to, promotion: t });
  } catch {
    renderAll();
    return;
  }
  history.push(made);
  clearHint();
  playMoveSound(made);
  requestCommentary(made);
  afterPositionChange();
}

// ---- 引擎提示（单次 + 持续） ----
// 防重复：过滤会回到已出现过局面的着法（若全部着法都会重复则不过滤），
// 结果经 UCI searchmoves 交给引擎，在剩余着法中选最佳
function nonRepeatingMoves() {
  const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
  const seen = new Set();
  const hist = chess.history({ verbose: true });
  if (hist.length) seen.add(key(hist[0].before));
  for (const m of hist) seen.add(key(m.after));
  const legal = chess.moves({ verbose: true });
  const safe = legal.filter((m) => !seen.has(key(m.after)));
  return safe.length && safe.length < legal.length ? safe.map((m) => m.lan) : null;
}

async function runEngineHint() {
  if (thinking || setupMode || isLocked()) return;
  thinking = true;
  renderAll();
  hintEl.hidden = false;
  hintEl.textContent = '💡 引擎思考中…';
  const requestFen = chess.fen();
  try {
    const uci = await engine.bestMove(requestFen, 1200, nonRepeatingMoves(), (p) => {
      hintEl.textContent = `💡 正在加载引擎 ${p}（首次使用需下载约 7MB）…`;
    });
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
    hintEl.textContent = '⚠ ' + (err && err.message ? err.message : err) + ' — 点击💡或按 F1 重试';
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
  abortPromotion();
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
  clearCommentary();
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
  if (pendingPromotion) { cancelPromotion(); return; } // 升变选择中：点棋盘任意处取消
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
    const r = tryMove(sq);
    if (r === 'moved') afterPositionChange();
    else if (r === 'promo') renderAll();
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
    const r = dest && dest !== d.from ? tryMove(dest) : false;
    if (r === 'moved') {
      afterPositionChange();
      return;
    }
    renderAll(); // promo：弹出选子框；非法：自然弹回，选中与落点提示保留
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
  abortPromotion();
  if (fen) chess.load(fen);
  else chess.reset();
  history.reset(chess.fen());
  clearSelection();
  clearHint();
  clearCommentary();
}

btnNew.addEventListener('click', () => {
  resetTo();
  openingSelect.value = '';
  openingInfo.hidden = true;
  afterPositionChange();
});

btnFlip.addEventListener('click', () => {
  abortPromotion(); // 翻转后选子框坐标失效，直接取消
  board.setOrientation(board.getOrientation() === 'w' ? 'b' : 'w');
  renderAll();
});

btnUndo.addEventListener('click', () => {
  if (setupMode || !history.canUndo()) return;
  abortPromotion();
  abortCommentary(); // 在途解说随局面回退作废；已有解说保留
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
  abortPromotion();
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
bindToggle(btnCommentary, () => showCommentary, (v) => {
  showCommentary = v;
  if (!v) abortCommentary();
});

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
  openingSide.textContent = op.side === 'w' ? '执白 · 白方开局' : '执黑 · 黑方防御';
  openingSide.className = 'opening-side ' + op.side;
  requestOpeningCommentary(op); // 开局摆盘：整体解说一次开局意图
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
  engine, // 调试钩子：可直接验证 searchmoves 等 UCI 行为
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
if (autoHint) runEngineHint(); // 默认开启持续提示：载入即分析初始局面
