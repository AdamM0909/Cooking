// Script injection through every field, hostile backup files, prototype names and odd addresses.
// Needs: a running site (KITCHEN_URL), playwright-core and, for accessibility, axe-core. See e2e/README.md.
const { chromium } = require('playwright-core');
const U = process.env.KITCHEN_URL || 'http://localhost:8000/';
const results = []; const ok = (name, pass, extra) => { results.push(pass); console.log((pass ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const XSS = ['<img src=x onerror="window.__xss=(window.__xss||0)+1">', '<script>window.__xss=(window.__xss||0)+1</script>', '"><svg onload="window.__xss=(window.__xss||0)+1">', "'-alert(1)-'", '{{constructor.constructor("window.__xss=1")()}}'];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const mk = async (opts) => { const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, ...(opts || {}) }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.dialogs = []; p.on('dialog', d => { p.dialogs.push(d.message()); d.accept(); }); return { ctx, p }; };

  // ---------- 1. script injection through every text field ----------
  {
    const { ctx, p } = await mk();
    await p.goto(U + '#/new'); await p.waitForSelector('#f-title');
    await p.fill('#f-title', XSS[0]); await p.fill('#f-credit', XSS[1]); await p.fill('#f-serv', '2'); await p.fill('#f-tags', XSS[2] + ', ' + XSS[3]);
    await p.fill('#f-notes', XSS[1] + XSS[0]); await p.fill('#f-src', 'javascript:window.__xss=9');
    const rows = await p.$$('.row.ing');
    await (await rows[0].$('.amount')).fill('1'); await (await rows[0].$('.name')).fill(XSS[0]); await (await rows[0].$('.grp')).fill(XSS[2]);
    await (await rows[1].$('.amount')).fill('2'); await (await rows[1].$('.name')).fill(XSS[4]);
    await p.fill('.stitle', XSS[0]); await p.fill('.stext', XSS[1] + ' ' + XSS[2]);
    await p.click('text=Save recipe'); await p.waitForTimeout(400);
    const hash = await p.evaluate(() => location.hash);
    ok('XSS recipe saved', /^#\/u\//.test(hash), hash);
    const check = async (label) => {
      const x = await p.evaluate(() => window.__xss);
      const injected = await p.evaluate(() => !!document.querySelector('main img[onerror], main script, main svg[onload], main [onerror], main [onload]'));
      ok('no script ran / no injected elements: ' + label, !x && !injected && p.dialogs.length === 0, 'xss=' + x + ' injected=' + injected + ' dialogs=' + p.dialogs.length);
    };
    await check('recipe page');
    ok('javascript: source link dropped', await p.evaluate(() => !document.querySelector('a[href^="javascript"]')));
    await p.click('text=Add to shopping list'); await p.goto(U + '#/list'); await p.waitForSelector('.shop li'); await check('shopping list');
    await p.goto(U + hash.replace('#/u/', '#/cook/u/')); await p.waitForTimeout(300); await check('cook mode');
    await p.goto(U + '#/'); await p.waitForSelector('.recipe-list li'); await check('recipe list');
    await p.goto(U + '#/?tag=' + encodeURIComponent('"><img src=x onerror=window.__xss=3>')); await p.waitForTimeout(400); await check('hostile ?tag= in address');
    await p.goto(U + '#/backup'); await check('backup page');
    await ctx.close();
  }

  // ---------- 2. hostile backup file ----------
  {
    const { ctx, p } = await mk();
    await p.goto(U + '#/backup'); await p.waitForSelector('input[type=file]');
    const good = { title: 'Safe', base_servings: 2, ingredients: [{ id: '0001', name: 'a', amount: 1 }], steps: [{ text: 'x' }] };
    const files = {
      'proto.json': JSON.stringify({ version: 2, recipes: JSON.parse('{"__proto__": {"polluted": "yes"}, "constructor": ' + JSON.stringify(good) + ', "toString": ' + JSON.stringify(good) + '}'), meta: JSON.parse('{"__proto__": {"polluted2": "yes"}, "u:constructor": {"fav": true}}') }),
      'wrongtypes.json': JSON.stringify([1, 'a', null, { title: 5 }, { title: 'x', base_servings: 'many', ingredients: 'no', steps: 7 }, good]),
      'huge-amount.json': JSON.stringify([{ ...good, ingredients: [{ id: '0001', name: 'a', amount: 1e30 }] }]),
      'notjson.json': 'this is not json {{{',
      'empty.json': '', 'null.json': 'null', 'string.json': '"hello"', 'number.json': '42',
    };
    for (const [name, body] of Object.entries(files)) {
      await p.setInputFiles('input[type=file]', { name, mimeType: 'application/json', buffer: Buffer.from(body) });
      await p.waitForFunction(() => document.querySelector('[role=status]').textContent.length > 0, null, { timeout: 4000 }).catch(() => {});
      const msg = await p.textContent('[role=status]');
      console.log('   import', name.padEnd(18), '->', msg.slice(0, 90));
      await p.evaluate(() => { document.querySelector('[role=status]').textContent = ''; });
    }
    ok('Object.prototype not polluted', await p.evaluate(() => ({}).polluted === undefined && ({}).polluted2 === undefined));
    ok('no uncaught errors during hostile imports', p.errs.length === 0, p.errs.join(' | '));
    await p.goto(U + '#/'); await p.waitForSelector('.recipe-list, p');
    ok('list still renders after hostile imports', await p.isVisible('.recipe-list'), (await p.$$eval('.recipe-list li', l => l.length)) + ' items');
    await ctx.close();
  }

  // ---------- 3. strange addresses ----------
  {
    const { ctx, p } = await mk();
    await p.goto(U); await p.waitForSelector('.recipe-list li');
    const routes = ['#/u/constructor', '#/u/__proto__', '#/u/toString', '#/u/hasOwnProperty', '#/r/constructor', '#/r/__proto__', '#/edit/constructor', '#/edit/__proto__', '#/cook/u/constructor', '#/cook/r/missing', '#/r/missing', '#/u/missing', '#/edit/missing', '#/import/%%%', '#/import/AAAA', '#/import/' + 'A'.repeat(50000), '#/nonsense/path', '#/r/../../etc/passwd', '#/r/%2e%2e%2fsecret', '#/cook/u/x?s=-5', '#/cook/r/example-pancakes?s=abc', '#/cook/r/example-pancakes?s=999999999', '#/?tag=%E0%A4%A', '#/?fav=1&tag=x', '#//', '#', '#/list?x=1'];
    for (const r of routes) {
      const before = p.errs.length;
      await p.evaluate((h) => { location.hash = h; }, r); await p.waitForTimeout(250);
      const text = (await p.textContent('main')).trim();
      const crashed = p.errs.length > before || text === 'Loading...' || text === '';
      ok('route ' + r.slice(0, 40), !crashed, crashed ? (p.errs.slice(before).join(' | ') || 'blank/loading: ' + text.slice(0, 40)) : text.slice(0, 50).replace(/\s+/g, ' '));
    }
    await ctx.close();
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close();
})().catch(e => { console.error('SCRIPT FAIL', e.message.split('\n')[0]); process.exit(1); });
