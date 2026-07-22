// 重新计算 scripts/check.mjs 固定哈希清单中列出文件的 SHA-256，并同步改写
// scripts/check.mjs 与 VENDOR.md 里的对应条目，消除升级 vendor 时的手抄错误。
// 仅手动执行：npm run check:update-hashes
// 固定哈希是供应链闸门：本脚本只保证"抄写正确"，不能代替对内容变化本身的
// 人工审查——运行后必须 review diff（确认变化的文件与预期一致）再提交。
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkPath = path.join(root, 'scripts', 'check.mjs');
const vendorPath = path.join(root, 'VENDOR.md');

const checkSource = await readFile(checkPath, 'utf8');
// 单一事实源：文件清单直接取自 check.mjs 的 expectedHashes 字面量
const entries = [...checkSource.matchAll(/\['([^']+)', '([0-9a-f]{64})'\]/g)]
  .map(([, file, hash]) => ({ file, hash }));
if (entries.length === 0) throw new Error('scripts/check.mjs 中未找到固定哈希清单');

let updatedCheck = checkSource;
let updatedVendor = await readFile(vendorPath, 'utf8');
const changes = [];
for (const { file, hash } of entries) {
  const digest = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
  if (digest === hash) continue;
  changes.push(file);
  updatedCheck = updatedCheck.replace(`'${file}', '${hash}'`, `'${file}', '${digest}'`);
  // VENDOR.md 中同一哈希以 `反引号` 形式出现（SVG 表用 basename、vendor 表用完整路径），
  // 按旧哈希值替换对文件名写法不敏感；未列入 check.mjs 的哈希（如上游对照值）不受影响。
  updatedVendor = updatedVendor.split('`' + hash + '`').join('`' + digest + '`');
}

if (changes.length === 0) {
  console.log(`update-hashes: ${entries.length} 条固定哈希均已是最新，未做改动`);
} else {
  await writeFile(checkPath, updatedCheck);
  await writeFile(vendorPath, updatedVendor);
  console.log(`update-hashes: 已更新 ${changes.length} 条哈希（scripts/check.mjs 与 VENDOR.md）：`);
  for (const file of changes) console.log(`  - ${file}`);
  console.log('update-hashes: 请 review diff 确认内容变化符合预期后再提交');
}
