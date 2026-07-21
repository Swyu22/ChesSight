import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromRoot = (name) => path.join(root, name);

async function filesUnder(directory, extension) {
  const result = [];
  for (const entry of await readdir(fromRoot(directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(relative, extension));
    else if (!extension || relative.endsWith(extension)) result.push(relative);
  }
  return result;
}

const jsFiles = [
  ...await filesUnder('js', '.js'),
  ...await filesUnder('worker/src', '.js'),
  ...await filesUnder('scripts', '.mjs'),
];
for (const relative of jsFiles) {
  const checked = spawnSync(process.execPath, ['--check', fromRoot(relative)], { encoding: 'utf8' });
  assert.equal(checked.status, 0, `${relative}: ${checked.stderr}`);
}

for (const relative of ['manifest.json', 'package.json', 'worker/wrangler.jsonc']) {
  JSON.parse(await readFile(fromRoot(relative), 'utf8'));
}

const html = await readFile(fromRoot('index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)) {
  await stat(fromRoot(match[1]));
}

const manifest = JSON.parse(await readFile(fromRoot('manifest.json'), 'utf8'));
for (const icon of manifest.icons) await stat(fromRoot(icon.src.replace(/^\.\//, '')));

for (const relative of await filesUnder('assets', '.svg')) {
  const svg = await readFile(fromRoot(relative), 'utf8');
  assert.match(svg, /<svg\b/i, `${relative}: missing svg root`);
  assert.doesNotMatch(svg, /<script\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i, `${relative}: active or external content`);
}

const wasm = await readFile(fromRoot('js/vendor/stockfish-18-lite-single.wasm'));
assert.deepEqual([...wasm.subarray(0, 4)], [0, 97, 115, 109], 'invalid WASM magic');

const expectedHashes = new Map([
  ['assets/pieces/bB.svg', 'ba67da76ce919addc60ecb8b46801def073dd54149b2c038a2d07a16d904d5e4'],
  ['assets/pieces/bK.svg', '025eea92e0ef8eb1fd06b1c58d0d112948f08bf66cea6b5d003659569949b41c'],
  ['assets/pieces/bN.svg', '735cc58315b123a56632d4877a6b976c827481fa97bf9a5c8f459ec969bc2549'],
  ['assets/pieces/bP.svg', '4413bf7c18a341f9723d97e6f92c985e30b6167b037e80842cea59b7541bb074'],
  ['assets/pieces/bQ.svg', '70191a3fbc729ef629661e2419a66ab8024c49277aab8ccae3a5ef61372ab802'],
  ['assets/pieces/bR.svg', '6abf617a9e26902e0734d85897c9ca55e29d7be2928142aa21032c38967e34ba'],
  ['assets/pieces/wB.svg', '1d7beace24d455c923ee80d27125963eaf0287b956c5576dbf790c97ac0b97eb'],
  ['assets/pieces/wK.svg', '56f55c784843b1ac272b8745d740aa2a3e6c585513ef889978916f88e5d0b70b'],
  ['assets/pieces/wN.svg', '5486791207156f7ae8b8678187648df45085d726334c2862e73b077dea00641e'],
  ['assets/pieces/wP.svg', 'cc7de30708dcec8f4d593a89d10893d5f9c063682039a1c441e86c44cf2096db'],
  ['assets/pieces/wQ.svg', 'b72b864e2a5b6c8f8afb7f260130c10e649ff063f4ef58190c00a35c56364327'],
  ['assets/pieces/wR.svg', '4d42ab45afd862c704eb9b35317102d453a7a6b9b71d40f18958c8eadc829e4b'],
  ['js/vendor/chess.js', '76c7c34f0e2e9ab076521a5d6fe786a9cce537bb1b6f29d32a9c9970b5b232d2'],
  ['js/vendor/stockfish-18-lite-single.js', '5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391'],
  ['js/vendor/stockfish-18-lite-single.wasm', 'a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1'],
]);
for (const [relative, expected] of expectedHashes) {
  const digest = createHash('sha256').update(await readFile(fromRoot(relative))).digest('hex');
  assert.equal(digest, expected, `${relative}: vendor checksum changed`);
}

console.log(`check: ${jsFiles.length} JS/MJS files, JSON, references, SVG, WASM, and ${expectedHashes.size} fixed hashes passed`);
