// 棋盘渲染与点击交互。渲染层级由每格内的 DOM 顺序保证（自下而上）：
// 格子底色 → 最后一步高亮 → 攻击范围覆盖 → 落点提示 → 棋子 → 安全状态框 → 选中描边
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE_NAMES = { p: '兵', n: '马', b: '象', r: '车', q: '后', k: '王' };

export function createBoard(container, onSquareClick) {
  const squares = new Map(); // 'e4' -> { el, img }

  for (let rank = 8; rank >= 1; rank--) {
    for (let f = 0; f < 8; f++) {
      const name = FILES[f] + rank;
      const el = document.createElement('div');
      el.className = 'square ' + ((f + rank) % 2 === 0 ? 'light' : 'dark');
      el.dataset.square = name;

      for (const layer of ['last', 'ctrl', 'hint']) {
        const ly = document.createElement('div');
        ly.className = 'ly ' + layer;
        el.appendChild(ly);
      }
      const img = document.createElement('img');
      img.className = 'piece';
      img.alt = '';
      img.draggable = false;
      el.appendChild(img);
      for (const layer of ['safety', 'sel']) {
        const ly = document.createElement('div');
        ly.className = 'ly ' + layer;
        el.appendChild(ly);
      }
      if (f === 0) {
        const c = document.createElement('span');
        c.className = 'coord rank';
        c.textContent = rank;
        el.appendChild(c);
      }
      if (rank === 1) {
        const c = document.createElement('span');
        c.className = 'coord file';
        c.textContent = FILES[f];
        el.appendChild(c);
      }
      container.appendChild(el);
      squares.set(name, { el, img });
    }
  }

  container.addEventListener('click', (e) => {
    const sq = e.target.closest('[data-square]');
    if (sq) onSquareClick(sq.dataset.square);
  });

  // 全量幂等重绘：64 格 class 切换 + img src，无 diff
  function render({ position, lastMove, control, safety, hints, selected }) {
    const hintMap = new Map();
    if (hints) for (const h of hints) hintMap.set(h.to, h.capture);
    const last = new Set(lastMove || []);

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const name = FILES[j] + (8 - i);
        const { el, img } = squares.get(name);
        const cell = position[i][j];

        el.classList.toggle('last', last.has(name));
        el.classList.toggle('sel', selected === name);

        el.classList.remove('ctrl-w', 'ctrl-b', 'ctrl-wb');
        if (control && control[name]) el.classList.add('ctrl-' + control[name]);

        el.classList.remove('hint-dot', 'hint-ring');
        if (hintMap.has(name)) el.classList.add(hintMap.get(name) ? 'hint-ring' : 'hint-dot');

        el.classList.remove('safety-attacked', 'safety-defended', 'safety-undefended');
        if (safety && safety[name]) el.classList.add('safety-' + safety[name]);

        if (cell) {
          const src = `./assets/pieces/${cell.color}${cell.type.toUpperCase()}.svg`;
          if (img.getAttribute('src') !== src) img.setAttribute('src', src);
          img.alt = (cell.color === 'w' ? '白' : '黑') + PIECE_NAMES[cell.type];
          img.classList.add('show');
        } else {
          img.classList.remove('show');
          img.alt = '';
        }
      }
    }
  }

  return { render };
}
