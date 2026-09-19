import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'public/assets/manifest.json'), 'utf8'));
const errors = [];
const expectedCards = Array.from({ length: 22 }, (_, index) => String(index).padStart(2, '0'));
const cardFiles = await readdir(path.join(root, 'public/assets/tarot/major'));
for (const id of expectedCards) {
  if (cardFiles.filter((file) => file.startsWith(`${id}_`) && file.endsWith('.png')).length !== 1) {
    errors.push(`Card ${id} must have exactly one canonical PNG.`);
  }
}
if (manifest.files.length !== 26) errors.push('Expected 3 masters, 22 tarot fronts and 1 tarot back.');
for (const asset of manifest.files) {
  try {
    const bytes = await readFile(path.join(root, asset.path));
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') errors.push(`${asset.path}: not PNG`);
    if (bytes.length !== asset.bytes) errors.push(`${asset.path}: size changed`);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) errors.push(`${asset.path}: canonical checksum changed`);
    if (bytes.readUInt32BE(16) !== asset.width || bytes.readUInt32BE(20) !== asset.height) errors.push(`${asset.path}: dimensions changed`);
  } catch (error) {
    errors.push(`${asset.path}: ${error.code ?? 'unreadable'}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Assets verified: 3 canonical character masters, 22 Major Arcana fronts, 1 canonical back; PNG signatures, dimensions, bytes and SHA-256 match.');
}
