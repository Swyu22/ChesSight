import test from 'node:test';
import assert from 'node:assert/strict';

class Param {
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
}

class FakeNode {
  constructor() { this.disconnectCount = 0; }
  connect(node) { return node; }
  disconnect() { this.disconnectCount++; }
}

class FakeSource extends FakeNode {
  constructor(kind, owner) {
    super();
    this.kind = kind;
    this.owner = owner;
    this.onended = null;
  }
  start(time = 0) { this.startTime = time; }
  stop() {}
}

class FakeAudioContext {
  constructor() {
    FakeAudioContext.last = this;
    this.state = FakeAudioContext.initialState;
    this.destination = new FakeNode();
    this.sampleRate = 8000;
    this.oscillators = [];
    this.sources = [];
    this._clock = 100;
  }
  get currentTime() { return this._clock++; }
  createOscillator() {
    const node = new FakeSource('oscillator', this);
    node.frequency = new Param();
    this.oscillators.push(node);
    return node;
  }
  createGain() { const node = new FakeNode(); node.gain = new Param(); return node; }
  createBuffer() { return { getChannelData: () => new Float32Array(64) }; }
  createBufferSource() {
    const node = new FakeSource('buffer', this);
    this.sources.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeNode();
    node.frequency = { value: 0 };
    node.Q = { value: 0 };
    return node;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
}
FakeAudioContext.initialState = 'running';

async function loadSound(state = 'running') {
  FakeAudioContext.initialState = state;
  globalThis.window = { AudioContext: FakeAudioContext };
  return (await import(`../js/sound.js?test=${crypto.randomUUID()}`)).sound;
}

test('disabling sound clears a pending first sound', async () => {
  const sound = await loadSound('suspended');
  sound.move();
  sound.setEnabled(false);
  await Promise.resolve();
  assert.equal(FakeAudioContext.last.oscillators.length, 0);
});

test('multi-hit voices share one currentTime reference', async () => {
  const sound = await loadSound();
  sound.capture();
  const starts = FakeAudioContext.last.oscillators.map((node) => node.startTime);
  assert.equal(starts.length, 2);
  assert.ok(Math.abs((starts[1] - starts[0]) - 0.022) < 0.0001, starts.join(', '));
});

test('short-lived audio nodes disconnect when their source ends', async () => {
  const sound = await loadSound();
  sound.move();
  const context = FakeAudioContext.last;
  for (const source of [...context.oscillators, ...context.sources]) {
    assert.equal(typeof source.onended, 'function');
    source.onended();
    assert.ok(source.disconnectCount > 0);
  }
});

test('sound safely degrades when AudioContext is unavailable', async () => {
  globalThis.window = {};
  const sound = (await import(`../js/sound.js?test=${crypto.randomUUID()}`)).sound;
  assert.doesNotThrow(() => sound.move());
  assert.equal(sound.unlock(), false);
});
