// Paste, save, edit, backup, restore, export, share and delete leave the data exact.
// Needs: a running site (KITCHEN_URL), playwright-core and, for accessibility, axe-core. See e2e/README.md.
const { chromium } = require('playwright-core');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync } = require('child_process');
const U = process.env.KITCHEN_URL || 'http://localhost:8000/';
const L = require('../assets/lib.js');
const base = fs.readFileSync(require('path').join(__dirname, '..', 'tests', 'fixtures', 'fried-chicken-sliders.txt'), 'utf8');
const method = `
Instructions:
1. Whisk the buttermilk, pickle juice, egg, seasonings and a splash of hot sauce. Add the chicken and marinate for at least 4 hours.
2. Mix the dredge in a wide dish. Dredge each thigh twice, pressing firmly.
3. Fry at 350F for 6 to 8 minutes per side until the chicken reaches 165F.
4. Melt the butter with the honey and hot sauce, then simmer for 3 minutes.
5. Stir the ranch ingredients together and chill.
6. Build the sliders with a thigh, pickles and ranch on the garlic buttered buns.
`;
const results = []; const ok = (name, pass, extra) => { results.push(pass); console.log((pass ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  const stored = () => p.evaluate(() => JSON.parse(localStorage.getItem('kitchen.recipes.v1') || '{}'));

  // 1. paste -> fill amounts -> save
  await p.goto(U + '#/new'); await p.waitForSelector('#f-whole'); await p.fill('#f-whole', base + method); await p.click('text=Make sense of it'); await p.waitForSelector('.quick ul li');
  await p.fill('#f-title', 'Hot Honey Fried Chicken Sliders'); await p.fill('#f-serv', '6');
  for (const r of await p.$$('.row.ing')) { if (!(await r.$eval('.amount', e => e.value))) await (await r.$('.amount')).fill('1'); }
  await p.click('text=Save recipe'); await p.waitForSelector('.ingredients li');
  const slug = (await p.evaluate(() => location.hash)).replace('#/u/', '');
  const saved1 = (await stored())[slug];
  ok('saved recipe is valid and complete', !!L.normalize(saved1).recipe && saved1.ingredients.length === 42 && saved1.steps.length === 6 && new Set(saved1.ingredients.map(i => i.group)).size === 6, saved1.ingredients.length + ' ingredients, ' + saved1.steps.length + ' steps');

  // 2. what is displayed matches what is stored (scale 1, written units)
  await p.click('button:has-text("Cups & spoons")');
  const shown = await p.$$eval('.ingredients li:not(.group-h)', l => l.length);
  ok('every stored ingredient is displayed (42 rows)', shown === 42, shown + ' rows');
  // 3. reload keeps everything; opening the editor and saving without changes keeps the recipe identical
  await p.reload(); await p.waitForSelector('.ingredients li');
  await p.goto(U + '#/edit/' + slug); await p.waitForSelector('#f-title'); await p.click('text=Save recipe'); await p.waitForSelector('.ingredients li');
  const saved2 = (await stored())[slug];
  ok('editing and saving with no changes leaves the recipe byte-identical', eq(saved1, saved2), eq(saved1, saved2) ? '' : 'first difference: ' + JSON.stringify(Object.keys(saved1).filter(k => !eq(saved1[k], saved2[k]))));
  // 4. change one thing; only that changes
  await p.goto(U + '#/edit/' + slug); await p.waitForSelector('#f-title'); await p.fill('#f-serv', '8'); await p.click('text=Save recipe'); await p.waitForSelector('.ingredients li');
  const saved3 = (await stored())[slug];
  ok('changing servings changes only servings', saved3.base_servings === 8 && eq({ ...saved3, base_servings: 6 }, saved1));
  await p.goto(U + '#/edit/' + slug); await p.waitForSelector('#f-title'); await p.fill('#f-serv', '6'); await p.click('text=Save recipe'); await p.waitForSelector('.ingredients li');

  // 5. favourites, rating, notes, cooked, shopping list survive an edit and a backup/restore
  await p.click('button.fav'); await p.click('.star[aria-label="5 stars"]'); await p.click('text=I cooked this');
  await p.fill('textarea[aria-label="My notes"]', 'Double the glaze'); await p.dispatchEvent('textarea[aria-label="My notes"]', 'change'); await p.click('text=Add to shopping list');
  const [dl] = await Promise.all([p.waitForEvent('download'), (async () => { await p.goto(U + '#/backup'); await p.click('text=Download all my recipes'); })()]);
  const backupPath = await dl.path(); const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  ok('backup contains the recipe, favourite, rating, cooked count and note', backup.version === 2 && backup.recipes[slug] && backup.meta['u:' + slug].fav && backup.meta['u:' + slug].rating === 5 && backup.meta['u:' + slug].cooked === 1 && backup.meta['u:' + slug].note === 'Double the glaze');

  // 6. restore into a brand new browser profile
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 900 } }); const q = await ctx2.newPage(); q.errs = []; q.on('pageerror', e => q.errs.push(e.message)); q.on('dialog', d => d.accept());
  await q.goto(U + '#/backup'); await q.setInputFiles('input[type=file]', backupPath); await q.waitForFunction(() => /Imported/.test(document.querySelector('[role=status]').textContent));
  const restored = await q.evaluate(() => ({ r: JSON.parse(localStorage.getItem('kitchen.recipes.v1')), m: JSON.parse(localStorage.getItem('kitchen.meta.v1')) }));
  const rslug = Object.keys(restored.r)[0];
  ok('restore into a fresh browser gives an identical recipe', eq(restored.r[rslug], saved1));
  ok('restore brings back favourite, rating, cooked count and note', eq(restored.m['u:' + rslug], backup.meta['u:' + slug]));
  await q.goto(U + '#/u/' + rslug); await q.waitForSelector('.ingredients li');
  ok('restored recipe displays the same ingredient rows', (await q.$$eval('.ingredients li:not(.group-h)', l => l.length)) === 42);
  // restoring twice does not overwrite: it adds a copy
  await q.goto(U + '#/backup'); await q.setInputFiles('input[type=file]', backupPath); await q.waitForFunction(() => /Imported 1/.test(document.querySelector('[role=status]').textContent));
  ok('restoring the same backup again adds a copy instead of overwriting', Object.keys(await q.evaluate(() => JSON.parse(localStorage.getItem('kitchen.recipes.v1')))).length === 2);

  // 7. single-recipe export is accepted by the repo's own validator (as it would be if added to recipes/)
  await p.goto(U + '#/u/' + slug); await p.waitForSelector('.ingredients li'); await p.evaluate(() => { document.querySelector('details.more').open = true; });
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('text=Download JSON')]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-validate-')); fs.cpSync(require('path').join(__dirname, '..', 'recipes'), path.join(tmp, 'recipes'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'tools')); fs.mkdirSync(path.join(tmp, 'assets')); fs.copyFileSync(require('path').join(__dirname, '..', 'tools', 'validate.mjs'), path.join(tmp, 'tools/validate.mjs')); fs.copyFileSync(require('path').join(__dirname, '..', 'assets', 'lib.js'), path.join(tmp, 'assets/lib.js'));
  fs.copyFileSync(await dl2.path(), path.join(tmp, 'recipes', slug + '.json'));
  fs.writeFileSync(path.join(tmp, 'recipes/index.json'), JSON.stringify([...JSON.parse(fs.readFileSync(path.join(tmp, 'recipes/index.json'))), slug]));
  let validatorOut = ''; let validatorOk = true; try { validatorOut = execFileSync('node', [path.join(tmp, 'tools/validate.mjs')], { encoding: 'utf8' }); } catch (e) { validatorOk = false; validatorOut = (e.stdout || '') + (e.stderr || ''); }
  ok('downloaded recipe JSON passes the repository validator', validatorOk, validatorOut.trim().split('\n').slice(-2).join(' / '));

  // 8. share link round trip into another browser
  const code = await p.evaluate((s) => KitchenLib.encodeShare(JSON.parse(localStorage.getItem('kitchen.recipes.v1'))[s]), slug);
  const ctx3 = await b.newContext(); const r3 = await ctx3.newPage(); r3.on('dialog', d => d.accept());
  await r3.goto(U + '#/import/' + code); await r3.waitForSelector('text=Save to my recipes'); await r3.click('text=Save to my recipes'); await r3.waitForSelector('.ingredients li');
  const shared = Object.values(await r3.evaluate(() => JSON.parse(localStorage.getItem('kitchen.recipes.v1'))))[0];
  ok('share link carries the whole recipe unchanged (sections, amounts, steps, timers)', eq(shared, saved1), 'link length ' + code.length + ' chars');

  // 9. delete cascades: recipe, list entry and meta all go
  await p.goto(U + '#/u/' + slug); await p.waitForSelector('.ingredients li'); await p.evaluate(() => { document.querySelector('details.more').open = true; }); await p.click('button:has-text("Delete")'); await p.waitForSelector('.recipe-list');
  const after = await p.evaluate((s) => ({ r: Object.keys(JSON.parse(localStorage.getItem('kitchen.recipes.v1') || '{}')), m: Object.keys(JSON.parse(localStorage.getItem('kitchen.meta.v1') || '{}')), l: JSON.parse(localStorage.getItem('kitchen.list.v1') || '{"items":[]}').items.map(i => i.ref) }), slug);
  ok('delete removes the recipe, its ratings and its shopping-list entry', !after.r.includes(slug) && !after.m.includes('u:' + slug) && !after.l.includes('u:' + slug), JSON.stringify(after));
  ok('no uncaught errors anywhere', p.errs.length === 0 && q.errs.length === 0, p.errs.concat(q.errs).join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close();
})().catch(e => { console.error('SCRIPT FAIL', e.message.split('\n')[0]); process.exit(1); });
