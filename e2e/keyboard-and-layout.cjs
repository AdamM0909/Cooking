// Keyboard-only use, accessible names, reduced motion and no sideways scrolling from 320 to 1920 px.
// Needs: a running site (KITCHEN_URL), playwright-core and, for accessibility, axe-core. See e2e/README.md.
const { chromium } = require('playwright-core');
const fs = require('fs');
const U = process.env.KITCHEN_URL || 'http://localhost:8000/';
const L = require('../assets/lib.js');
const seed = L.normalize({ title: 'Hot Honey Chicken', base_servings: 6, ingredients: [{ id: '0001', name: 'chicken thighs', amount: 1.5, unit: 'lb', group: 'Marinade' }, { id: '0002', name: 'flour', amount: 1.5, unit: 'cup', grams_per_cup: 125, group: 'Dredge' }],
  steps: [{ title: 'Marinate', text: 'Soak {0001} chicken.', timer_seconds: 3600 }, { title: 'Fry', text: 'Dredge in {0002} flour and fry.', timer_seconds: 480 }] }).recipe;
const init = `localStorage.setItem('kitchen.recipes.v1', ${JSON.stringify(JSON.stringify({ 'hot-honey-chicken': seed }))});`;
const results = []; const ok = (name, pass, extra) => { results.push(pass); console.log((pass ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  // ---- widths ----
  const over = [];
  for (const w of [320, 360, 768, 1024, 1920]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 } }); await ctx.addInitScript(init); const p = await ctx.newPage();
    for (const h of ['#/', '#/u/hot-honey-chicken', '#/r/example-pancakes', '#/cook/u/hot-honey-chicken', '#/list', '#/new', '#/edit/hot-honey-chicken', '#/backup']) {
      await p.goto(U + h); await p.waitForTimeout(250); await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
      if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) over.push(w + 'px ' + h);
    }
    await ctx.close();
  }
  ok('no horizontal scrolling at 320, 360, 768, 1024, 1920 px on 8 screens', over.length === 0, over.join(', '));

  // ---- keyboard only ----
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(init); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(U); await p.waitForSelector('.recipe-list li');
  const focusPath = []; for (let i = 0; i < 12; i++) { await p.keyboard.press('Tab'); focusPath.push(await p.evaluate(() => { const e = document.activeElement; return (e.getAttribute('aria-label') || e.textContent || e.placeholder || e.tagName).trim().slice(0, 22); })); }
  console.log('   tab order on list:', focusPath.join(' > '));
  ok('first Tab stop is the skip link', focusPath[0] === 'Skip to content', focusPath[0]);
  // open a recipe with the keyboard
  await p.goto(U); await p.waitForSelector('.recipe-list li');
  await p.focus('.recipe-list a'); await p.keyboard.press('Enter'); await p.waitForSelector('.ingredients li');
  ok('Enter opens a recipe', /#\/(u|r)\//.test(await p.evaluate(() => location.hash)));
  await p.focus('[aria-label="More servings"]'); await p.keyboard.press('Enter'); await p.keyboard.press('Space');
  const serv = await p.textContent('.stepper output');
  ok('servings stepper works with Enter and Space', Number(serv) >= 3, 'servings now ' + serv);
  await p.focus('button:has-text("Grams & ml")'); await p.keyboard.press('Space');
  ok('unit switch works with Space, state exposed to assistive tech', (await p.getAttribute('button:has-text("Grams & ml")', 'aria-pressed')) === 'true');
  await p.focus('input[type=checkbox]'); await p.keyboard.press('Space');
  ok('ingredient tick works with Space', await p.evaluate(() => document.querySelector('.ingredients li.got') !== null));
  // star rating by keyboard
  await p.focus('.star[aria-label="3 stars"]'); await p.keyboard.press('Enter');
  ok('star rating works with Enter', (await p.textContent('.ratingbox')).includes('★★★'));
  // cook mode by keyboard
  await p.goto(U + '#/cook/u/hot-honey-chicken'); await p.waitForSelector('.cook-stage h2');
  await p.keyboard.press('ArrowRight'); ok('ArrowRight goes to the next step', (await p.textContent('.cook-count')).includes('Step 2'));
  await p.keyboard.press('ArrowLeft'); ok('ArrowLeft goes back', (await p.textContent('.cook-count')).includes('Step 1'));
  await p.focus('.cook-stage .timer'); await p.keyboard.press('Enter'); await p.waitForSelector('.timer-chip');
  ok('timer starts with Enter and is announced (role=status)', (await p.getAttribute('#timers', 'role')) === 'status');
  await p.focus('.timer-chip button'); await p.keyboard.press('Enter'); ok('timer can be dismissed by keyboard', (await p.$$('.timer-chip')).length === 0);
  // form: Enter in the title field submits; focus lands on the error
  await p.goto(U + '#/new'); await p.waitForSelector('#f-title'); await p.focus('#f-title'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok('form submits with Enter and reports the problem in an alert region', /title/i.test(await p.textContent('[role=alert]')));
  // every interactive element has an accessible name
  await p.goto(U + '#/new'); await p.waitForSelector('#f-title');
  const unnamed = await p.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, textarea')].filter(e => { const n = (e.getAttribute('aria-label') || e.textContent || '').trim() || (e.labels && e.labels.length) || e.getAttribute('placeholder') || e.getAttribute('title'); return !n && e.type !== 'hidden'; }).map(e => e.outerHTML.slice(0, 80)));
  ok('every control on the Add page has a name', unnamed.length === 0, unnamed.slice(0, 3).join(' | '));
  // reduced motion
  for (const [pref, expectNone] of [['reduce', true], ['no-preference', false]]) {
    const rctx = await b.newContext({ reducedMotion: pref }); await rctx.addInitScript(init); const rp = await rctx.newPage();
    await rp.goto(U + '#/cook/u/hot-honey-chicken'); await rp.waitForSelector('.cook-stage .timer');
    await rp.evaluate(() => { const c = document.createElement('div'); c.className = 'timer-chip done'; c.id = 'probe'; document.body.appendChild(c); });
    const anim = await rp.evaluate(() => getComputedStyle(document.getElementById('probe')).animationName);
    ok('alarm flash animation with reduced-motion=' + pref, expectNone ? anim === 'none' : anim !== 'none', 'animation-name: ' + anim);
    await rctx.close();
  }
  ok('no uncaught errors', p.errs.length === 0, p.errs.join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close();
})().catch(e => { console.error('SCRIPT FAIL', e.message.split('\n')[0]); process.exit(1); });
