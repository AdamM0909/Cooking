// Add by pasting, photo upload, tags, shopping list merge, cook mode with timers, share link, backup and offline reload.
// Needs: a running site (KITCHEN_URL), playwright-core and, for accessibility, axe-core. See e2e/README.md.
const { chromium } = require('playwright-core');
const fs = require('fs');
const U = process.env.KITCHEN_URL || 'http://localhost:8000/';
// 2x2 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP8z8Dwn4EIwDiqEAA9Uwf8KfE0JwAAAABJRU5ErkJggg==', 'base64');
let step = 'start';
const log = (...a) => console.log(...a);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const txt = sel => p.$$eval(sel, l => l.map(x => x.textContent.trim()));

  step = 'list + tags';
  await p.goto(U); await p.waitForSelector('.recipe-list li');
  log('chips:', await txt('.chips .chip'));
  await p.click('.chip:has-text("breakfast")'); await p.waitForSelector('.chip[aria-current="true"]:has-text("breakfast")'); log('breakfast filter ->', (await txt('.recipe-list li')).length);
  await p.click('.chip:has-text("Favorites")'); await p.waitForSelector('.chip[aria-current="true"]:has-text("Favorites")'); log('favorites filter (none yet) ->', (await txt('.recipe-list li')).length, '|', await p.textContent('main p.muted'));

  step = 'recipe meta';
  await p.goto(U + '#/r/example-pancakes'); await p.waitForSelector('.ingredients li');
  await p.click('.star[aria-label="4 stars"]'); await p.click('button.fav'); await p.click('text=I cooked this');
  await p.fill('textarea[aria-label="My notes"]', 'Used oat milk'); await p.dispatchEvent('textarea[aria-label="My notes"]', 'change');
  await p.reload(); await p.waitForSelector('.ingredients li');
  log('persisted:', await p.$eval('button.fav', e => e.textContent), '|', await p.$eval('.ratingbox', e => e.textContent), '|', await p.inputValue('textarea[aria-label="My notes"]'));
  await p.click('text=Add to shopping list');
  log('nav badge:', await p.$eval('#list-count', e => e.textContent));

  step = 'paste whole recipe + photo';
  await p.goto(U + '#/new'); await p.waitForSelector('#f-whole', { state: 'attached' });
  
  await p.fill('#f-whole', "Grandma's Cookies\nServes 12\n\nIngredients\n1 1/2 cups flour\n1 large egg\n2 tbsp butter, melted\n\nDirections\n1. Mix the flour and egg.\n2. Bake 12 minutes.\n\nNotes\nBest warm.");
  await p.click('text=Make sense of it');
  log('filled:', await p.inputValue('#f-title'), await p.inputValue('#f-serv'), '|', (await p.$$eval('.row.ing .name', l => l.map(x => x.value))).join(','), '|', await p.$$eval('.row.step', l => l.length), 'steps');
  await p.setInputFiles('#f-photo', { name: 'p.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('.photo-preview img');
  await p.fill('#f-tags', 'dessert, Baking, dessert');
  const gp = await p.$$('.row.ing .gpc'); await gp[0].fill('125');
  await p.focus('.row.step select'); await p.selectOption('.row.step select', { label: 'flour' });
  await p.click('text=Save recipe'); await p.waitForSelector('.hero');
  log('saved with photo, tags:', await txt('.chips .chip'), 'first step:', await p.$eval('.steps li p', e => e.textContent));
  await p.click('text=Add to shopping list');

  step = 'shopping';
  await p.goto(U + '#/list'); await p.waitForSelector('.shop li');
  log('recipes on list:', await txt('.list-recipes li a'));
  log('items:', await txt('.shop li'));
  await p.fill('input[aria-label="Add an item"]', 'paper towels'); await p.press('input[aria-label="Add an item"]', 'Enter');
  await p.click('.shop li:first-child input'); await p.click('text=Grams & ml');
  log('grams view:', await txt('.shop li'));
  await p.reload(); await p.waitForSelector('.shop li');
  log('ticked persisted:', await p.$$eval('.shop li.got', l => l.length));
  await p.click('text=Untick all'); log('after untick:', (await txt('.shop li')).length, 'rows');

  step = 'cook mode';
  await p.goto(U + '#/cook/r/example-pancakes?s=8'); await p.waitForSelector('.cook-stage h2');
  log('cook step1:', await p.$eval('.cook-stage', e => e.textContent), '|', await p.textContent('.cook-count'));
  await p.click('text=Next'); await p.click('text=Next');
  await p.click('.cook-stage .timer');
  log('timer chip:', await p.$eval('.timer-chip', e => e.textContent));
  await p.click('text=Next'); log('timer persists on next step:', await p.$$eval('.timer-chip', l => l.length), '|', await p.$eval('.cook-stage h2', e => e.textContent));
  await p.keyboard.press('ArrowLeft'); log('arrow left ->', await p.$eval('.cook-stage h2', e => e.textContent));
  await p.keyboard.press('ArrowRight'); await p.click('text=Finish');
  await p.waitForSelector('.ratingbox');
  log('cooked count now:', await p.$eval('.ratingbox', e => e.textContent));

  step = 'share';
  const code = await p.evaluate(() => KitchenLib.encodeShare(KitchenLib.normalize(JSON.parse(localStorage.getItem('kitchen.recipes.v1'))['grandma-s-cookies']).recipe));
  const ctx2 = await b.newContext(); const q = await ctx2.newPage(); q.on('dialog', d => d.accept());
  await q.goto(U + '#/import/' + code); await q.waitForSelector('text=Save to my recipes');
  log('share preview:', await q.$eval('h1', e => e.textContent), '| ings', (await q.$$('.ingredients li')).length);
  await q.click('text=Save to my recipes'); await q.waitForSelector('.ingredients li');
  log('friend saved ->', await q.evaluate(() => location.hash));
  await q.goto(U + '#/import/garbage'); log('bad link ->', (await q.textContent('main')).slice(0, 60));
  await ctx2.close();

  step = 'backup';
  await p.goto(U + '#/backup');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('text=Download all my recipes')]);
  const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  log('backup v' + data.version, Object.keys(data.recipes), Object.keys(data.meta));

  step = 'offline';
  await p.goto(U); await p.waitForSelector('.recipe-list li');
  await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(800);
  await ctx.setOffline(true); await p.reload(); await p.waitForSelector('.recipe-list li', { timeout: 8000 });
  log('offline reload shows:', (await txt('.recipe-list li')).length, 'recipes');
  await ctx.setOffline(false);

  step = 'layout';
  await p.goto(U + '#/r/example-pancakes'); await p.waitForSelector('.ingredients li');
  log('horizontal overflow at 390px:', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));



  log('errors:', errs);
  await b.close();
})().catch(e => { console.error('FAIL at', step, '->', e.message.split('\n')[0]); process.exit(1); });
