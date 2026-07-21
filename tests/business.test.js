import test from 'node:test';
import assert from 'node:assert/strict';

import { Chess } from '../js/vendor/chess.js';
import { analyze, analyzeBoard, attackLines } from '../js/analysis.js';
import { History } from '../js/history.js';
import { OPENINGS } from '../js/openings.js';

test('all bundled openings are legal from the initial position', () => {
  assert.equal(OPENINGS.length, 14);
  for (const opening of OPENINGS) {
    const chess = new Chess();
    for (const san of opening.moves) {
      assert.doesNotThrow(() => chess.move(san), `${opening.id}: ${san}`);
    }
    assert.equal(chess.history().length, opening.moves.length, opening.id);
  }
});

test('analysis is stable and classifies the initial position', () => {
  const chess = new Chess();
  const first = analyze(chess);
  assert.equal(analyze(chess), first, 'same FEN should use the memoized result');
  assert.equal(first.safety.a2, 'defended');
  assert.equal(first.safety.a1, 'undefended');
  assert.equal(first.control.e4, undefined);
  assert.ok(attackLines(chess).length > 0);
});

test('free-setup analysis works without requiring a legal chess position', () => {
  const rows = Array.from({ length: 8 }, () => Array(8).fill(null));
  rows[7][0] = { type: 'r', color: 'w' }; // a1
  rows[0][0] = { type: 'r', color: 'b' }; // a8
  const result = analyzeBoard(rows);
  assert.equal(result.safety.a1, 'attacked');
  assert.equal(result.safety.a8, 'attacked');
});

test('history truncates the redo branch after a new move', () => {
  const chess = new Chess();
  const history = new History(chess.fen());
  history.push(chess.move('e4'));
  history.push(chess.move('e5'));
  assert.equal(history.undo().san, 'e4');
  chess.load(history.current().fen);
  history.push(chess.move('c5'));
  assert.equal(history.canRedo(), false);
  assert.equal(history.current().san, 'c5');
});
