import test from 'node:test';
import assert from 'node:assert/strict';

function sse(text = '好棋') {
  const event = JSON.stringify({ choices: [{ delta: { content: text } }] });
  return new Response(`data: ${event}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function client(options = {}) {
  const module = await import(`../js/commentary.js?test=${crypto.randomUUID()}`);
  assert.equal(typeof module.createCommentaryClient, 'function');
  return module.createCommentaryClient(options);
}

function waitForJob(clientApi, payload = {}) {
  return new Promise((resolve) => {
    clientApi.enqueueCommentary(payload, {
      onText() {},
      onDone: (text) => resolve({ kind: 'done', text }),
      onError: () => resolve({ kind: 'error' }),
    });
  });
}

function fakeStreamResponse(reader) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    body: { getReader: () => reader },
  };
}

test('does not retry permanent 4xx failures', async () => {
  let calls = 0;
  const api = await client({
    fetchImpl: async () => { calls++; return new Response('bad', { status: 400 }); },
    sleepImpl: async () => {},
  });
  assert.deepEqual(await waitForJob(api), { kind: 'error' });
  assert.equal(calls, 1);
});

test('retries one transient failure and parses a completed SSE stream', async () => {
  let calls = 0;
  const api = await client({
    fetchImpl: async () => (++calls === 1 ? new Response('busy', { status: 503 }) : sse()),
    sleepImpl: async () => {},
  });
  assert.deepEqual(await waitForJob(api), { kind: 'done', text: '好棋' });
  assert.equal(calls, 2);
});

test('a timed-out request cannot permanently block the next queued job', async () => {
  let calls = 0;
  const api = await client({
    fetchImpl: async (_url, { signal }) => {
      calls++;
      if (calls === 1) {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      return sse('下一条');
    },
    totalTimeoutMs: 20,
    retryLimit: 0,
    sleepImpl: async () => {},
  });
  const first = waitForJob(api, { id: 1 });
  const second = waitForJob(api, { id: 2 });
  assert.deepEqual(await Promise.race([
    Promise.all([first, second]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('queue deadline')), 250)),
  ]), [{ kind: 'error' }, { kind: 'done', text: '下一条' }]);
});

test('parses multiline SSE and a UTF-8 tail without a final newline', async () => {
  const encoded = new TextEncoder().encode(
    'data: {"choices":[{"delta":\ndata: {"content":"尾声"}}]}',
  );
  const multibyte = encoded.findIndex((byte) => byte >= 0x80);
  const chunks = [encoded.slice(0, multibyte + 1), encoded.slice(multibyte + 1)];
  let released = 0;
  const reader = {
    async read() {
      return chunks.length ? { done: false, value: chunks.shift() } : { done: true };
    },
    async cancel() {},
    releaseLock() { released++; },
  };
  const api = await client({ fetchImpl: async () => fakeStreamResponse(reader), retryLimit: 0 });
  assert.deepEqual(await waitForJob(api), { kind: 'done', text: '尾声' });
  assert.equal(released, 1);
});

test('idle streams are cancelled and released without poisoning the queue', async () => {
  let cancelled = 0;
  let released = 0;
  let calls = 0;
  const stalledReader = {
    read: async () => new Promise(() => {}),
    async cancel() { cancelled++; },
    releaseLock() { released++; },
  };
  const api = await client({
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? fakeStreamResponse(stalledReader) : sse('恢复');
    },
    idleTimeoutMs: 15,
    totalTimeoutMs: 100,
    retryLimit: 0,
  });
  const first = waitForJob(api, { id: 1 });
  const second = waitForJob(api, { id: 2 });
  assert.deepEqual(await Promise.all([first, second]), [
    { kind: 'error' },
    { kind: 'done', text: '恢复' },
  ]);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('an early DONE event cancels and releases the remaining stream', async () => {
  const chunk = new TextEncoder().encode('data: [DONE]\n\n');
  let cancelled = 0;
  let released = 0;
  const reader = {
    async read() { return { done: false, value: chunk }; },
    async cancel() { cancelled++; },
    releaseLock() { released++; },
  };
  const api = await client({ fetchImpl: async () => fakeStreamResponse(reader), retryLimit: 0 });
  assert.deepEqual(await waitForJob(api), { kind: 'done', text: '' });
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});
