import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePublicPath } from '../scripts/serve.mjs';

// fileURLToPath 而非 URL.pathname：后者在含空格路径下是百分号编码伪路径、
// 在 Windows 下带 /C:/ 前导斜杠，均不是合法文件系统路径。
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

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
