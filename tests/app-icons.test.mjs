import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const size of [32, 180, 192, 512]) {
  test(`brand PNG ${size}px is square and opaque`, () => {
    const path = size === 180 ? '../public/apple-touch-icon.png' : `../public/icons/lartisan-${size}.png`;
    const png = readFileSync(new URL(path, import.meta.url));
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.equal(png[25], 2, 'RGB without an alpha channel');
    assert.ok(png.length > 300, 'not an empty placeholder');
  });
}

test('Apple metadata explicitly references the local PNG, not the SVG favicon', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /apple: \[\{ url: "\/apple-touch-icon\.png\?brand=20260909", sizes: "180x180", type: "image\/png" \}\]/);
  assert.match(layout, /appleWebApp: \{ capable: true, statusBarStyle: "default" \}/);
  // Do not replace the Admin/Ventas-specific page title with one shared shortcut title.
  assert.doesNotMatch(layout, /appleWebApp:\s*\{[^}]*title:/);
});

test('both favicon locations preserve the original full wordmark', () => {
  const icon = readFileSync(new URL('../app/icon.svg', import.meta.url), 'utf8');
  const fallback = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  assert.equal(icon, fallback);
  assert.equal((icon.match(/<path /g) || []).length, 9);
  assert.match(icon, /Original wordmark: https:\/\/www.lartisantaller.com\/images\/logo.svg/);
  assert.doesNotMatch(icon, /<(?:image|script|foreignObject)\b/);
});
