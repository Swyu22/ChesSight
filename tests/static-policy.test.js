import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('HTML preserves zoom, uses local assets, and exposes landmarks and AI disclosure', async () => {
  const html = await read('index.html');
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /<main\b/);
  assert.match(html, /棋谱.*发送.*AI|AI.*棋谱/);
});

test('responsive policy has no 1025px board-size cliff or forced orientation lock', async () => {
  const [css, main, board] = await Promise.all([
    read('css/style.css'),
    read('js/main.js'),
    read('js/board.js'),
  ]);
  assert.match(css, /@media \(max-width: 1340px\)/);
  assert.doesNotMatch(main, /orientation\?\.lock|orientation\.lock/);
  assert.match(main, /innerWidth <= 1340/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(board, /classList\.toggle\('has-piece',\s*Boolean\(cell\)\)/);
  assert.match(css, /\.square\.has-piece\s*\{\s*touch-action:\s*none/);
  assert.match(css, /\.tray-slot\s*\{[^}]*touch-action:\s*none/s);
});

test('secret-file variants are ignored and local docs use the allowlisted server', async () => {
  const [ignore, readme, packageRaw] = await Promise.all([
    read('.gitignore'),
    read('README.md'),
    read('package.json'),
  ]);
  const packageJson = JSON.parse(packageRaw);
  assert.match(ignore, /^\.env\*$/m);
  assert.match(ignore, /^\.dev\.vars\*$/m);
  assert.equal(packageJson.scripts.serve, 'node scripts/serve.mjs');
  assert.match(readme, /npm run serve/);
  assert.match(readme, /不要[\s\S]*python3 -m http\.server/);
  assert.match(readme, /DS\.env/);
});

test('manifest and Worker config declare delivery and runtime safeguards', async () => {
  const [manifestRaw, wrangler] = await Promise.all([read('manifest.json'), read('worker/wrangler.jsonc')]);
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.description);
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert.match(wrangler, /enable_request_signal/);
  assert.match(wrangler, /observability/);
});

test('board and promotion controls expose state and accessible names', async () => {
  const [board, main] = await Promise.all([read('js/board.js'), read('js/main.js')]);
  assert.match(board, /setAttribute\('aria-label'.*PIECE_NAMES/s);
  assert.match(main, /role', 'dialog'/);
  assert.match(main, /aria-modal/);
  assert.match(main, /Escape/);
  assert.match(main, /备选.*tabIndex|tabIndex.*备选/s);
  assert.match(main, /btnStartPos[\s\S]*setupTurnSel\.value = 'w'/);
});

test('safety markers use uniform state-colored outlines and continuous hints start enabled', async () => {
  const [css, html, main] = await Promise.all([
    read('css/style.css'),
    read('index.html'),
    read('js/main.js'),
  ]);
  const safetyStyles = css.match(
    /\.square\.safety-attacked\s+\.ly\.safety,[\s\S]*?\/\* 选中描边/,
  )?.[0] ?? '';

  assert.match(safetyStyles, /border:\s*6px solid var\(--state-color\)/);
  assert.doesNotMatch(safetyStyles, /#(?:000|111)(?:000|111)?\b|\bblack\b/i);
  assert.doesNotMatch(safetyStyles, /border-(?:style|width)|box-shadow|\b(?:double|dashed)\b/);
  assert.match(safetyStyles, /\.square\.safety-attacked\s+\.ly\.safety\s*\{\s*--state-color:\s*var\(--safe-red\);\s*\}/);
  assert.match(safetyStyles, /\.square\.safety-defended\s+\.ly\.safety\s*\{\s*--state-color:\s*var\(--safe-green\);\s*\}/);
  assert.match(safetyStyles, /\.square\.safety-undefended\s+\.ly\.safety\s*\{\s*--state-color:\s*var\(--safe-yellow\);\s*\}/);
  assert.match(css, /\.square\.sel \.ly\.sel\s*\{[^}]*inset:\s*7px/s);
  assert.match(html, /<input\s+type="checkbox"\s+id="chk-auto"\s+checked>/);
  assert.match(main, /let autoHint = true;/);
  assert.match(main, /renderAll\(\);\s*if \(autoHint\) runEngineHint\(\);/);
});

test('vendor provenance and automated delivery checks are documented', async () => {
  const [vendor, workflow] = await Promise.all([read('VENDOR.md'), read('.github/workflows/ci.yml')]);
  assert.match(vendor, /SHA-256/);
  assert.match(vendor, /chess\.js.*1\.4\.0/s);
  assert.match(vendor, /Stockfish\.js.*18/s);
  assert.match(workflow, /npm test/);
});
