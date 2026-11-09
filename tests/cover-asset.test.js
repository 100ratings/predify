import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
test('supplied Aleatoriedades thumbnail is a real WebP asset cached with app shell', () => {
  const cover = new URL('../icons/aleatoriedades-demian.webp',import.meta.url);
  const bytes = readFileSync(cover);
  assert.equal(bytes.subarray(0,4).toString('ascii'), 'RIFF');
  assert.equal(bytes.subarray(8,12).toString('ascii'), 'WEBP');
  assert.ok(statSync(cover).size > 2000);
  const sw = readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  assert.match(sw, /'\.\/icons\/aleatoriedades-demian\.webp'/);
});
