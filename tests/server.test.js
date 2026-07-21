import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolvePublicPath } from '../scripts/serve.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);

test('the development server exposes only public application files', () => {
  assert.equal(resolvePublicPath('/', root), path.join(root, 'index.html'));
  assert.equal(resolvePublicPath('/css/style.css', root), path.join(root, 'css/style.css'));
  assert.equal(resolvePublicPath('/js/main.js', root), path.join(root, 'js/main.js'));
  assert.equal(resolvePublicPath('/assets/icon.svg', root), path.join(root, 'assets/icon.svg'));
  assert.equal(resolvePublicPath('/DS.env', root), null);
  assert.equal(resolvePublicPath('/worker/src/index.js', root), null);
  assert.equal(resolvePublicPath('/.git/config', root), null);
  assert.equal(resolvePublicPath('/../DS.env', root), null);
  assert.equal(resolvePublicPath('/%2e%2e/DS.env', root), null);
});
