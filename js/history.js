// 撤销/重做栈：states[0] 为初始局面，此后每步一个条目；
// 回退状态下走出新着法则截断重做尾部（标准 undo/redo 语义）。
export class History {
  constructor(initialFen) {
    this.reset(initialFen);
  }

  reset(initialFen) {
    this.states = [{ fen: initialFen, san: null, from: null, to: null }];
    this.ptr = 0;
  }

  push(move) {
    this.states.length = this.ptr + 1;
    this.states.push({ fen: move.after, san: move.san, from: move.from, to: move.to });
    this.ptr++;
  }

  current() { return this.states[this.ptr]; }
  canUndo() { return this.ptr > 0; }
  canRedo() { return this.ptr < this.states.length - 1; }

  undo() {
    if (!this.canUndo()) return null;
    this.ptr--;
    return this.states[this.ptr];
  }

  redo() {
    if (!this.canRedo()) return null;
    this.ptr++;
    return this.states[this.ptr];
  }
}
