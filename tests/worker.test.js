'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const built = path.join(__dirname, '..', 'worker', 'recipe-reader.js');
const page = fs.readFileSync(path.join(__dirname, 'fixtures', 'page-with-jsonld.html'), 'utf8');

test('worker/recipe-reader.js is up to date (run npm run build:worker)', async () => {
  const { build } = await import(pathToFileURL(path.join(__dirname, '..', 'tools', 'build-worker.mjs')).href);
  assert.equal(fs.readFileSync(built, 'utf8'), build());
});

async function loadWorker() {
  // The built file is an ES module that registers KitchenLib on `self`, like it does in Workers.
  const tmp = path.join(require('node:os').tmpdir(), 'kitchen-worker-' + process.pid + '.mjs');
  fs.writeFileSync(tmp, fs.readFileSync(built, 'utf8'));
  return (await import(pathToFileURL(tmp).href)).default;
}

function req(url, headers) { return new Request('https://reader.example.workers.dev/?url=' + encodeURIComponent(url), { headers }); }

test('worker returns recipe data for a page, and refuses private addresses and other origins', async () => {
  const worker = await loadWorker();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { const r = new Response(page, { status: 200 }); Object.defineProperty(r, 'url', { value: String(u) }); return r; };
  try {
    const ok = await worker.fetch(req('https://example.com/banana-bread'), {});
    const body = await ok.json();
    assert.equal(ok.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.recipe.name, 'Banana Bread &amp; Walnuts');

    for (const bad of ['http://localhost/x', 'http://127.0.0.1/', 'http://192.168.1.5/', 'http://10.0.0.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'ftp://example.com/', 'http://intranet/']) {
      const r = await worker.fetch(req(bad), {});
      assert.equal(r.status, 400, bad);
    }
    const noUrl = await worker.fetch(new Request('https://reader.example.workers.dev/'), {});
    assert.equal(noUrl.status, 400);

    const locked = { ALLOWED_ORIGIN: 'https://me.github.io' };
    const wrong = await worker.fetch(req('https://example.com/x', { Origin: 'https://evil.example' }), locked);
    assert.equal(wrong.status, 403);
    const right = await worker.fetch(req('https://example.com/x', { Origin: 'https://me.github.io' }), locked);
    assert.equal(right.status, 200);
    assert.equal(right.headers.get('Access-Control-Allow-Origin'), 'https://me.github.io');
    const pre = await worker.fetch(new Request('https://reader.example.workers.dev/', { method: 'OPTIONS' }), locked);
    assert.equal(pre.status, 204);
  } finally { globalThis.fetch = realFetch; }
});
