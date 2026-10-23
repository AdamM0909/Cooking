// A real pasted recipe followed by a method in several layouts; footer version and the update banner.
// Needs: a running site (KITCHEN_URL), playwright-core and, for accessibility, axe-core. See e2e/README.md.
const { chromium } = require('playwright-core');
const fs = require('fs');
const U = process.env.KITCHEN_URL || 'http://localhost:8000/';
const base = fs.readFileSync(require('path').join(__dirname, '..', 'tests', 'fixtures', 'fried-chicken-sliders.txt'), 'utf8');
let step = '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const rowsOf = () => p.$$eval('.row.ing', rs => rs.map(r => r.querySelector('.name').value));
  const stepsOf = () => p.$$eval('.row.step', rs => rs.map(r => [r.querySelector('.stitle').value, r.querySelector('.stext').value.slice(0, 50), r.querySelector('.smins').value].join(' | ')));

  step = 'method with heading';
  await p.goto(U + '#/new'); await p.waitForSelector('#f-whole');
  await p.fill('#f-whole', base + `
Instructions:
1. Whisk the buttermilk, pickle juice, egg, seasonings and a splash of hot sauce. Add the chicken and marinate for at least 4 hours.
2. Mix the dredge in a wide dish. Dredge each thigh twice, pressing firmly.
3. Fry at 350F for 6 to 8 minutes per side until the chicken reaches 165F.
4. Melt the butter with the honey and hot sauce, then simmer for 3 minutes.
5. Stir the ranch ingredients together and chill.
6. Build the sliders with a thigh, pickles and ranch on the garlic buttered buns.
`);
  await p.click('text=Make sense of it'); await p.waitForSelector('.quick ul li');
  const ings = await rowsOf();
  console.log('ingredient rows:', ings.length, '| any splash row:', ings.some(n => /splash/i.test(n)), '| any "Instructions" junk:', ings.some(n => /instruction|whisk|fry/i.test(n)));
  console.log('steps:\n  ' + (await stepsOf()).join('\n  '));
  console.log('notes field:', JSON.stringify(await p.inputValue('#f-notes')));
  console.log('summary:', (await p.$$eval('.quick [role=status] li', l => l.map(x => x.textContent))).filter(x => /splash|Added|Linked|steps/.test(x)));

  step = 'method as sub-headed paragraphs';
  await p.goto(U + '#/new'); await p.waitForSelector('#f-whole');
  await p.fill('#f-whole', base + `
Marinate the chicken:
Whisk the buttermilk, pickle juice, egg, spices and a splash of hot sauce together. Add the thighs and refrigerate overnight.

Fry the chicken:
Heat oil to 350F. Dredge the thighs and fry for 7 minutes per side.

Make the glaze:
Melt the butter, stir in the honey and hot sauce and simmer for 3 minutes.
`);
  await p.click('text=Make sense of it'); await p.waitForSelector('.quick ul li');
  console.log('\nsub-headed -> ingredient rows:', (await rowsOf()).length, '| steps:\n  ' + (await stepsOf()).join('\n  '));

  step = 'ingredients only (what was pasted before)';
  await p.goto(U + '#/new'); await p.waitForSelector('#f-whole');
  await p.fill('#f-whole', base); await p.click('text=Make sense of it'); await p.waitForSelector('.quick ul li');
  console.log('\ningredients only -> rows:', (await rowsOf()).length, '| steps rows:', (await p.$$('.row.step')).length, '| notes:', JSON.stringify(await p.inputValue('#f-notes')));

  step = 'footer + update banner';
  await p.goto(U); await p.waitForSelector('.recipe-list li');
  console.log('\nfooter:', await p.textContent('#ver'));
  await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForSelector('.recipe-list li');
  console.log('controlled by service worker:', await p.evaluate(() => !!navigator.serviceWorker.controller));
  await p.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  console.log('update banner shown:', await p.isVisible('#update-banner'), '|', (await p.textContent('#update-banner')).trim());
  const urls = await p.$$eval('script[src],link[rel=stylesheet]', n => n.map(x => x.getAttribute('src') || x.getAttribute('href')));
  console.log('asset urls:', urls);
  console.log('errors:', errs);
  await b.close();
})().catch(e => { console.error('FAIL at', step, '->', e.message.split('\n')[0]); process.exit(1); });
