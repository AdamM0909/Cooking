// Damaged, blocked and full browser storage, missing data files, and 100 recipes with photos.
// Needs: a running site (KITCHEN_URL), playwright-core and, for accessibility, axe-core. See e2e/README.md.
const { chromium } = require('playwright-core');
const U = process.env.KITCHEN_URL || 'http://localhost:8000/';
const results = []; const ok = (name, pass, extra) => { results.push(pass); console.log((pass ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const good = (n, photo) => ({ title: 'Recipe ' + n, base_servings: 4, ingredients: [{ id: '0001', name: 'flour', amount: 1.5, unit: 'cup', grams_per_cup: 125 }, { id: '0002', name: 'egg', amount: 2 }], steps: [{ title: 'Mix', text: 'Mix {0001} flour and {0002} eggs.', timer_seconds: 60 }], ...(photo ? { photo } : {}) });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const mk = async (init) => { const ctx = await b.newContext({ viewport: { width: 390, height: 900 } }); if (init) await ctx.addInitScript(init); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept()); return { ctx, p }; };

  // ---- 1. corrupt storage values ----
  const corrupt = {
    'not json': ['{{{', '{{{', '{{{'], 'arrays': ['[1,2]', '[1]', '[1]'], 'null': ['null', 'null', 'null'], 'strings': ['"x"', '"x"', '"x"'], 'numbers': ['42', '42', '42'],
    'recipe missing fields': [JSON.stringify({ a: { title: 'Only a title' }, b: null, c: 5, d: { title: 'x', base_servings: 2, ingredients: [{ name: 'a', amount: 'many' }], steps: [] } }), '{}', '{}'],
    'list with wrong shapes': ['{}', '{}', JSON.stringify({ items: 'no', got: 5, extra: { a: 1 } })],
    'list pointing at deleted recipe': ['{}', '{}', JSON.stringify({ items: [{ ref: 'u:ghost', servings: 3 }, { ref: 'r:nonexistent', servings: 2 }, null, 7, { ref: 5 }], got: {}, extra: ['ok item', 5, null] })],
    'meta with junk': ['{}', JSON.stringify({ 'r:example-pancakes': { fav: 'yes', rating: 99, cooked: 'lots', note: 5, last: 'x' }, 'u:x': 5 }), '{}'],
  };
  for (const [label, [r, m, l]] of Object.entries(corrupt)) {
    const { ctx, p } = await mk(`localStorage.setItem('kitchen.recipes.v1', ${JSON.stringify(r)}); localStorage.setItem('kitchen.meta.v1', ${JSON.stringify(m)}); localStorage.setItem('kitchen.list.v1', ${JSON.stringify(l)});`);
    const seen = [];
    for (const route of ['#/', '#/list', '#/r/example-pancakes', '#/cook/r/example-pancakes', '#/backup', '#/new']) {
      await p.goto(U + route); await p.waitForTimeout(350);
      const txt = (await p.textContent('main')).trim(); seen.push(route + (txt && txt !== 'Loading...' ? '' : ' BLANK'));
    }
    const blank = seen.filter(x => /BLANK/.test(x));
    ok('corrupt storage (' + label + ')', p.errs.length === 0 && blank.length === 0, p.errs.slice(0, 2).join(' | ') + ' ' + blank.join(','));
    await ctx.close();
  }

  // ---- 2. storage completely blocked ----
  {
    const { ctx, p } = await mk(`Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });`);
    await p.goto(U); await p.waitForSelector('.recipe-list li');
    ok('storage blocked: list of built-in recipes still shows', (await p.$$('.recipe-list li')).length >= 1, p.errs.join(' | '));
    await p.goto(U + '#/r/example-pancakes'); await p.waitForSelector('.ingredients li');
    await p.click('text=Grams & ml'); await p.click('[aria-label="More servings"]');
    ok('storage blocked: scaling and unit switching work', (await p.textContent('.stepper output')) === '5', '');
    await p.goto(U + '#/new'); await p.waitForSelector('#f-title');
    await p.fill('#f-title', 'Blocked'); const r = await p.$$('.row.ing'); await (await r[0].$('.amount')).fill('1'); await (await r[0].$('.name')).fill('x'); await p.fill('.stext', 'do it');
    await p.click('text=Save recipe'); await p.waitForTimeout(300);
    ok('storage blocked: saving says so plainly', /would not save/i.test(await p.textContent('.error')), (await p.textContent('.error')).slice(0, 70));
    ok('storage blocked: no uncaught errors', p.errs.length === 0, p.errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---- 3. storage full ----
  {
    const { ctx, p } = await mk(`const real = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(v).length > 3000) { const e = new DOMException('quota', 'QuotaExceededError'); throw e; } return real.call(this, k, v); };`);
    await p.goto(U + '#/new'); await p.waitForSelector('#f-title');
    await p.fill('#f-title', 'Big'); const r = await p.$$('.row.ing'); await (await r[0].$('.amount')).fill('1'); await (await r[0].$('.name')).fill('x');
    await p.fill('.stext', 'y'.repeat(4500)); await p.click('text=Save recipe'); await p.waitForTimeout(300);
    ok('storage full: save fails with a clear message, nothing lost', /would not save/i.test(await p.textContent('.error')) && (await p.inputValue('.stext')).length === 4500, (await p.textContent('.error')).slice(0, 60));
    ok('storage full: no uncaught errors', p.errs.length === 0, p.errs.join(' | '));
    await ctx.close();
  }

  // ---- 4. data files missing or damaged ----
  {
    const { ctx, p } = await mk();
    await p.route('**/recipes/index.json', r => r.fulfill({ status: 404, body: 'nope' }));
    await p.goto(U); await p.waitForTimeout(500);
    ok('index.json missing: page still loads and offers adding recipes', /Add recipe/.test(await p.textContent('main')), (await p.textContent('main')).slice(0, 60));
    await p.unroute('**/recipes/index.json');
    await p.route('**/recipes/index.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: '["example-pancakes","broken","missing"]' }));
    await p.route('**/recipes/broken.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"title": "Broken", "base_servings": 0}' }));
    await p.route('**/recipes/missing.json', r => r.fulfill({ status: 404, body: 'x' }));
    await p.goto(U); await p.waitForSelector('.recipe-list li');
    ok('one damaged and one missing shared recipe: the others still list', (await p.$$eval('.recipe-list li', l => l.length)) === 1, p.errs.join(' | '));
    await ctx.close();
  }

  // ---- 5. a hundred recipes with photos ----
  {
    const px = 'data:image/jpeg;base64,' + 'A'.repeat(25000);
    const recipes = {}; for (let i = 0; i < 100; i++) recipes['recipe-' + i] = good(i, px);
    const { ctx, p } = await mk(`try { localStorage.setItem('kitchen.recipes.v1', ${JSON.stringify(JSON.stringify(recipes))}); } catch (e) { window.__seedFail = String(e); }`);
    const t0 = Date.now(); await p.goto(U); await p.waitForSelector('.recipe-list li');
    const items = await p.$$eval('.recipe-list li', l => l.length); const t1 = Date.now() - t0;
    ok('100 recipes with photos: list renders', items === 101, items + ' items in ' + t1 + ' ms' + (await p.evaluate(() => window.__seedFail || '')));
    ok('list render under 3 s', t1 < 3000, t1 + ' ms');
    await p.fill('input[type=search]', 'recipe 57'); await p.waitForTimeout(100);
    ok('search over 100 recipes', (await p.$$eval('.recipe-list li', l => l.length)) === 1);
    ok('no errors', p.errs.length === 0, p.errs.join(' | '));
    await ctx.close();
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close();
})().catch(e => { console.error('SCRIPT FAIL', e.message.split('\n')[0]); process.exit(1); });
