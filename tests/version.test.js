'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../assets/lib.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the version is the same in lib.js, index.html and the service worker (run npm run bump)', () => {
  const html = read('index.html');
  const stamps = [...html.matchAll(/\?v=([\w.-]+)/g)].map(m => m[1]);
  assert.equal(stamps.length, 3, 'style, lib and app URLs all carry a version');
  for (const s of stamps) assert.equal(s, L.VERSION);
  assert.match(read('sw.js'), new RegExp(`our-kitchen-${L.VERSION.replace(/\./g, '\\.')}'`));
});

test('every file the page loads is also in the offline list', () => {
  const html = read('index.html'), sw = read('sw.js');
  for (const m of html.matchAll(/(?:src|href)="(assets\/[^"?]+)/g)) assert.ok(sw.includes(`'${m[1]}'`), m[1]);
});
