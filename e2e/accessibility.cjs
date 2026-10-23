// axe-core on every screen, light and dark, phone and desktop.
// Needs: a running site (KITCHEN_URL), playwright-core and, for accessibility, axe-core. See e2e/README.md.
const { chromium } = require('playwright-core');
const fs = require('fs');
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const U = process.env.KITCHEN_URL || 'http://localhost:8000/';
const L = require('../assets/lib.js');
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP8z8Dwn4EIwDiqEAA9Uwf8KfE0JwAAAABJRU5ErkJggg==';
const seed = L.normalize({ title: 'Hot Honey Chicken', credit: 'Test', base_servings: 6, tags: ['dinner', 'spicy'], photo,
  ingredients: [{ id: '0001', name: 'chicken thighs', amount: 1.5, unit: 'lb', group: 'Marinade' }, { id: '0002', name: 'buttermilk', amount: 1, unit: 'cup', group: 'Marinade' },
                { id: '0003', name: 'flour', amount: 1.5, unit: 'cup', grams_per_cup: 125, group: 'Dredge' }, { id: '0004', name: 'egg', amount: 1 }],
  steps: [{ title: 'Marinate', text: 'Soak {0001} chicken in {0002} buttermilk.', timer_seconds: 3600 }, { title: 'Fry', text: 'Dredge in {0003} flour and fry.', timer_seconds: 480 }], notes: 'Great cold.' }).recipe;
const init = `localStorage.setItem('kitchen.recipes.v1', ${JSON.stringify(JSON.stringify({ 'hot-honey-chicken': seed }))}); localStorage.setItem('kitchen.meta.v1', ${JSON.stringify(JSON.stringify({ 'u:hot-honey-chicken': { fav: true, rating: 4, cooked: 2, last: 1, note: 'Used oat milk' } }))}); localStorage.setItem('kitchen.list.v1', ${JSON.stringify(JSON.stringify({ items: [{ ref: 'u:hot-honey-chicken', servings: 6 }, { ref: 'r:example-pancakes', servings: 4 }], got: {}, extra: ['paper towels'] }))});`;
const share = L.encodeShare(seed);
const pages = { list: '#/', recipe: '#/u/hot-honey-chicken', example: '#/r/example-pancakes', cook: '#/cook/u/hot-honey-chicken', shopping: '#/list', add: '#/new', edit: '#/edit/hot-honey-chicken', backup: '#/backup', import: '#/import/' + share, filtered: '#/?tag=dinner' };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const seen = new Map(); let pagesChecked = 0;
  for (const scheme of ['light', 'dark']) for (const [w, h] of [[390, 844], [1280, 800]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, bypassCSP: true }); await ctx.addInitScript(init);
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    for (const [name, hash] of Object.entries(pages)) {
      await p.goto(U + hash); await p.waitForTimeout(450);
      // open the optional sections so their contents are checked too
      await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
      await p.addScriptTag({ content: axeSrc });
      const res = await p.evaluate(async () => await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] }));
      pagesChecked++;
      for (const v of res.violations) {
        const key = v.id + ' | ' + v.impact + ' | ' + v.help;
        const e = seen.get(key) || { pages: new Set(), nodes: [] }; e.pages.add(`${name}/${scheme}/${w}`);
        if (e.nodes.length < 2) e.nodes.push(v.nodes[0].target.join(' ') + '  ::  ' + (v.nodes[0].failureSummary || '').split('\n').slice(0, 3).join(' ').slice(0, 220));
        seen.set(key, e);
      }
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) { const k = 'HORIZONTAL OVERFLOW | ' + name; const e = seen.get(k) || { pages: new Set(), nodes: [] }; e.pages.add(`${scheme}/${w}`); seen.set(k, e); }
    }
    if (p.errs.length) console.log('page errors', scheme, w, p.errs.slice(0, 3));
    await ctx.close();
  }
  console.log(`axe checked ${pagesChecked} page views (${Object.keys(pages).length} screens x light/dark x phone/desktop)\n`);
  if (!seen.size) console.log('NO VIOLATIONS');
  for (const [k, v] of [...seen.entries()].sort()) { console.log('VIOLATION  ' + k + '\n   on: ' + [...v.pages].slice(0, 6).join(', ') + (v.pages.size > 6 ? ` (+${v.pages.size - 6} more)` : '')); v.nodes.forEach(n => console.log('   ' + n)); }
  await b.close();
})().catch(e => { console.error('SCRIPT FAIL', e.message.split('\n')[0]); process.exit(1); });
