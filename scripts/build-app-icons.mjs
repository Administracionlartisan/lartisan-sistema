// Deterministic format conversion of the original, vector L’ARTISAN wordmark.
// Source: https://www.lartisantaller.com/images/logo.svg (retrieved 2026-09-09).
// sharp is already available through the project's existing Next.js dependency.
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = await readFile(new URL('../app/icon.svg', import.meta.url));
await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const size of [32, 180, 192, 512]) {
  const target = size === 180 ? '../public/apple-touch-icon.png' : `../public/icons/lartisan-${size}.png`;
  await sharp(source).resize(size, size).flatten({ background: '#203d70' }).removeAlpha()
    .png().toFile(fileURLToPath(new URL(target, import.meta.url)));
}
