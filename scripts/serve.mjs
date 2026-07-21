import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIME = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
]);

const PUBLIC_PREFIXES = ['/assets/', '/css/', '/js/'];
const PUBLIC_FILES = new Set(['/index.html', '/manifest.json']);

export function resolvePublicPath(pathname, root) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded === '/') decoded = '/index.html';
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/');
  if (segments.some((part) => part === '.' || part === '..')) return null;
  if (!PUBLIC_FILES.has(decoded) && !PUBLIC_PREFIXES.some((prefix) => decoded.startsWith(prefix))) return null;

  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, '.' + decoded);
  if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot + path.sep)) return null;
  return candidate;
}

export function createDevServer(root) {
  return createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const file = resolvePublicPath(pathname, root);
    if (!['GET', 'HEAD'].includes(request.method || '') || !file) {
      response.writeHead(file ? 405 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(file ? 'Method Not Allowed' : 'Not Found');
      return;
    }

    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      response.writeHead(200, {
        'Content-Type': MIME.get(path.extname(file)) || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
    }
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const port = Number(process.argv[2] || 8173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1–65535 的整数');
  createDevServer(root).listen(port, '127.0.0.1', () => {
    console.log(`ChesSight: http://127.0.0.1:${port}`);
  });
}
