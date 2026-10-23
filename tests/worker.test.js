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

test('worker is closed until locked to a site, then returns recipe data and refuses private addresses', async () => {
  const worker = await loadWorker();
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async (u) => { fetched++; const r = new Response(page, { status: 200 }); Object.defineProperty(r, 'url', { value: String(u) }); return r; };
  try {
    // not configured: nothing is fetched for anyone, and the message says what to do
    for (const env of [{}, undefined, { ALLOWED_ORIGIN: '' }]) {
      const r = await worker.fetch(req('https://example.com/x', { Origin: 'https://me.github.io' }), env);
      assert.equal(r.status, 503);
      assert.match((await r.json()).error, /ALLOWED_ORIGIN/);
    }
    assert.equal(fetched, 0);

    const locked = { ALLOWED_ORIGIN: 'https://me.github.io' }, from = { Origin: 'https://me.github.io' };
    const ok = await worker.fetch(req('https://example.com/banana-bread', from), locked);
    const body = await ok.json();
    assert.equal(ok.status, 200); assert.equal(body.ok, true); assert.equal(body.recipe.name, 'Banana Bread &amp; Walnuts');
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://me.github.io');

    const blocked = ['http://localhost/x', 'http://localhost./x', 'http://LOCALHOST/', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://user@127.0.0.1/',
      'http://192.168.1.5/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://169.254.169.254/latest', 'http://100.64.0.1/', 'http://192.0.0.1/', 'http://198.18.0.1/', 'http://0.0.0.0/',
      'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://intranet/', 'http://printer.local/', 'http://metadata.internal/'];
    const before = fetched;
    for (const bad of blocked) assert.equal((await worker.fetch(req(bad, from), locked)).status, 400, bad);
    assert.equal(fetched, before, 'nothing blocked was ever fetched');
    assert.equal((await worker.fetch(new Request('https://reader.example.workers.dev/', { headers: from }), locked)).status, 400);

    // other sites and other methods are refused
    assert.equal((await worker.fetch(req('https://example.com/x', { Origin: 'https://evil.example' }), locked)).status, 403);
    assert.equal((await worker.fetch(req('https://example.com/x'), locked)).status, 403);
    assert.equal((await worker.fetch(new Request('https://reader.example.workers.dev/?url=https://example.com', { method: 'POST', headers: from }), locked)).status, 405);
    const pre = await worker.fetch(new Request('https://reader.example.workers.dev/', { method: 'OPTIONS' }), locked);
    assert.equal(pre.status, 204);

    // a redirect that lands on a private address is refused
    globalThis.fetch = async () => { const r = new Response(page, { status: 200 }); Object.defineProperty(r, 'url', { value: 'http://169.254.169.254/latest/meta-data' }); return r; };
    assert.equal((await worker.fetch(req('https://example.com/redirects', from), locked)).status, 400);

    // an upstream failure and a page that is too large are reported, not thrown
    globalThis.fetch = async (u) => { const r = new Response('nope', { status: 403 }); Object.defineProperty(r, 'url', { value: String(u) }); return r; };
    assert.equal((await worker.fetch(req('https://example.com/blocked-us', from), locked)).status, 502);
    globalThis.fetch = async () => { throw new Error('network down'); };
    assert.equal((await worker.fetch(req('https://example.com/down', from), locked)).status, 502);
    globalThis.fetch = async (u) => { const r = new Response('x'.repeat(3000001), { status: 200 }); Object.defineProperty(r, 'url', { value: String(u) }); return r; };
    assert.equal((await worker.fetch(req('https://example.com/huge', from), locked)).status, 413);

    // a page with no structured data returns its text instead
    globalThis.fetch = async (u) => { const r = new Response('<html><body><h1>Toast</h1><p>2 slices bread</p></body></html>', { status: 200 }); Object.defineProperty(r, 'url', { value: String(u) }); return r; };
    const plain = await (await worker.fetch(req('https://example.com/plain', from), locked)).json();
    assert.equal(plain.ok, true); assert.match(plain.text, /2 slices bread/); assert.equal(plain.recipe, undefined);
  } finally { globalThis.fetch = realFetch; }
});
