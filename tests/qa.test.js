'use strict';
// Broad hardening tests: real-world ingredient wording, hostile input, speed, limits and conversion consistency.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../assets/lib.js');

const line = (s) => { const r = L.parseIngredientLine(s); if (r) delete r.estimated; return r; };

test('real-world ingredient lines', () => {
  const cases = {
    '1 (14 oz) can crushed tomatoes': { amount: 1, unit: '', name: 'can crushed tomatoes (14 oz)' },
    '1 (8 ounce) package cream cheese, softened': { amount: 1, unit: '', name: 'package cream cheese (8 oz), softened' },
    '1 14-ounce can coconut milk': { amount: 1, unit: '', name: 'can coconut milk (14 oz)' },   // not "1 to 14" = 15 ounces
    '2 (400 g) cans tomatoes': { amount: 2, unit: '', name: 'cans tomatoes (400 g)' },
    '2 pounds chicken thighs (about 4)': { amount: 2, unit: 'lb', name: 'chicken thighs (about 4)' },
    '3-4 cloves garlic': { amount: 3, unit: '', name: 'cloves garlic (3-4)' },
    '1 1/2 lbs ground beef': { amount: 1.5, unit: 'lb', name: 'ground beef' },
    '1½ cups flour': { amount: 1.5, unit: 'cup', name: 'flour' },
    '1⁄₂ cup sugar': { amount: 0.5, unit: 'cup', name: 'sugar' },        // fraction slash + subscript two
    '1 1/2 cups milk': { amount: 1.5, unit: 'cup', name: 'milk' },        // non-breaking spaces
    '1,5 dl milk': { amount: 150, unit: 'ml', name: 'milk' },                        // decimal comma, decilitres
    '1,000 g flour': { amount: 1000, unit: 'g', name: 'flour' },
    '1 / 2 tsp salt': { amount: 0.5, unit: 'tsp', name: 'salt' },
    '1 Tbsp. butter': { amount: 1, unit: 'tbsp', name: 'butter' },
    '1 T butter': { amount: 1, unit: 'tbsp', name: 'butter' },
    '1 t vanilla': { amount: 1, unit: 'tsp', name: 'vanilla' },
    '2 c. flour': { amount: 2, unit: 'cup', name: 'flour' },
    '1 cup/240 ml milk': { amount: 1, unit: 'cup', name: 'milk' },
    '1/4 cup (60 ml) olive oil': { amount: 0.25, unit: 'cup', name: 'olive oil' },
    '8 oz (225 g) butter': { amount: 8, unit: 'oz', name: 'butter' },
    '1 tablespoon plus 1 teaspoon sugar': { amount: 4, unit: 'tsp', name: 'sugar' },
    '1 cup plus 2 tablespoons flour': { amount: 56, unit: 'tbsp', name: 'flour' }, // overridden below: 1 cup + 2 tbsp = 18 tbsp
    '2 cups all-purpose flour, plus more for dusting': { amount: 2, unit: 'cup', name: 'all-purpose flour, plus more for dusting' },
    '500g pasta': { amount: 500, unit: 'g', name: 'pasta' },
    '250ml cream': { amount: 250, unit: 'ml', name: 'cream' },
    '2.5 kg potatoes': { amount: 2.5, unit: 'kg', name: 'potatoes' },
    '1 stick butter': { amount: 8, unit: 'tbsp', name: 'butter' },
    'two eggs': { amount: 2, unit: '', name: 'eggs' },
    'a pinch of saffron': { amount: 1, unit: 'pinch', name: 'saffron' },
    'half a lemon': { amount: 0.5, unit: '', name: 'lemon' },
    'Juice of 1 lemon': { amount: '', unit: '', name: 'juice of 1 lemon' },
    'Kosher salt': { amount: '', unit: '', name: 'kosher salt' },
    '12 slices bacon': { amount: 12, unit: '', name: 'slices bacon' },
  };
  cases['1 cup plus 2 tablespoons flour'] = { amount: 18, unit: 'tbsp', name: 'flour' };
  for (const [input, want] of Object.entries(cases)) {
    const got = line(input), g = { amount: got.amount, unit: got.unit, name: got.name };
    assert.deepEqual(g, want, input);
  }
  assert.equal(line('1 cup (125 g) flour').grams_per_cup, 125);
  assert.equal(line('1 stick (113 g) butter').grams_per_cup, 226);
  assert.equal(L.parseIngredientLine('1 tablespoon plus 1 teaspoon sugar').amount, 4);       // no floating-point residue
});

test('amounts: accepted forms, rejected garbage', () => {
  const good = { '1': 1, '1/2': 0.5, '1 1/2': 1.5, '1 / 2': 0.5, '1½': 1.5, '¼': 0.25, '1,5': 1.5, '1,000': 1000, '.5': 0.5, '2.5': 2.5, '1-2': 1, '1 to 2': 1, '1–2': 1, '1-1/2': 1.5, '1⁄2': 0.5 };
  for (const [s, n] of Object.entries(good)) assert.ok(Math.abs(L.parseAmount(s) - n) < 1e-9, s + ' -> ' + L.parseAmount(s));
  for (const bad of ['', ' ', 'a', '0', '-1', '1/0', '0/0', '1//2', '..5', '1.5.5', '1e3', '0x10', 'Infinity', 'NaN', '1/2/3', '1 2 x', 'x'.repeat(100), null, undefined]) assert.ok(Number.isNaN(L.parseAmount(bad)), String(bad));
});

test('look-alike and invisible characters are cleaned', () => {
  assert.equal(L.parseAmount('1 ½'), 1.5);
  assert.equal(L.parseIngredientLine('1​ cup‌ flour').name, 'flour');
  assert.equal(L.parseIngredientLine('‮1 cup flour').amount, 1);
  const p = L.smartParse('Soup\u0000\u0007\nServes 4\nIngredients\n1 cup stock\n−');
  assert.equal(p.title, 'Soup'); assert.equal(p.base_servings, 4); assert.equal(p.ingredients[0].unit, 'cup');
});

test('names that look like built-in JavaScript properties are ordinary words', () => {
  const bad = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf'];
  for (const w of bad) {
    assert.ok(!L.normalize({ title: 't', base_servings: 1, ingredients: [{ id: '0001', name: 'a', amount: 1, unit: w }], steps: [] }).recipe, 'unit ' + w);
    assert.equal(L.parseIngredientLine(`2 ${w} parts`).unit, '', w);
    assert.equal(L.formatAmount({ amount: 1, unit: 'cup' }, 1, w), '1 cup', 'mode ' + w);
    assert.equal(L.uniqueSlug(w, {}).length > 0, true);
  }
  const out = L.combineIngredients([{ recipe: { base_servings: 1, ingredients: bad.map((n, i) => ({ id: ('000' + (i + 1)).slice(-4), name: n, amount: 1 })) }, servings: 1 }]);
  assert.equal(out.length, bad.length, 'no ingredient is dropped from the shopping list');
  assert.equal(L.uniqueSlug('constructor', { constructor: 1 }), 'constructor-2');
  assert.equal(L.htmlToText('<constructor>kept</constructor> text'), 'kept text');
  assert.equal(L.htmlToText('<__proto__>x</__proto__>'), '<__proto__>x</__proto__>'); // not a valid tag name, so it is just text
  assert.equal(L.autoLinkSteps([{ id: '0001', name: 'constructor', amount: 1 }], [{ title: '', text: 'Add the constructor now' }]).steps[0].text, 'Add {0001} constructor now');
  assert.equal(({}).polluted, undefined);
  L.smartParse('Ingredients\n1 cup __proto__\n1 cup constructor\nInstructions\nMix __proto__ and constructor well together.');
  assert.equal(({}).polluted, undefined);
});

// ---------- random input ----------
const PIECES = ['1', '2', '1/2', '1 1/2', '½', '⅓', '3/4', ' ', '  ', '\n', '\r\n', '\t', 'cup', 'cups', 'tbsp', 'tsp', 'g', 'oz', 'lb', 'stick', 'pinch', 'a', 'an', 'of', 'to taste', 'optional:', ':', '(', ')', '(125 g)', '- ', '* ', '• ', 'Ingredients', 'Instructions:', 'Directions', 'Notes', 'Serves 4', 'For the sauce:', 'salt', 'flour', 'butter', 'egg', 'sugar', '1. ', '2) ', 'Step 1:', 'bake for 25 minutes', 'Mix well.', '<div>', '</p>', '<script>', '&amp;', ' ', '⁄', '–', '-', '1-2', 'Splash of hot sauce', 'Salt and pepper to taste', 'flour, sifted', '{0001}', '{9999}', '"', '\\', '%', '$', '\u0000', '😀', '‮', 'constructor', '__proto__', 'plus', '1,5', '14-ounce can'];
function generator(seed) { let x = seed >>> 0; const rnd = () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; return (n) => { let s = ''; for (let i = 0; i < n; i++) s += PIECES[Math.floor(rnd() * PIECES.length)] + (rnd() < 0.3 ? ' ' : ''); return s; }; }

test('random text never breaks smartParse and always yields consistent data', () => {
  const gen = generator(20261022);
  for (let i = 0; i < 2500; i++) {
    const text = gen(5 + (i % 60));
    const p = L.smartParse(text);                                           // must not throw
    const ids = new Set();
    for (const ing of p.ingredients) {
      assert.match(ing.id, /^\d{4}$/); assert.ok(!ids.has(ing.id), 'duplicate id'); ids.add(ing.id);
      assert.ok(typeof ing.name === 'string' && ing.name.trim(), 'name');
      assert.ok(ing.amount === '' || (typeof ing.amount === 'number' && ing.amount > 0 && isFinite(ing.amount)), 'amount ' + ing.amount);
      assert.ok(!ing.unit || Object.keys(L.UNITS).includes(ing.unit), 'unit ' + ing.unit);
    }
    for (const st of p.steps) { assert.ok(st.text.trim()); for (const m of st.text.matchAll(/\{(\d{4})\}/g)) assert.ok(ids.has(m[1]), 'dangling placeholder in ' + JSON.stringify(st.text)); }
    const filled = { title: p.title || 'T', base_servings: p.base_servings || 2, ingredients: p.ingredients.map(i => ({ ...i, amount: i.amount === '' ? 1 : i.amount })), steps: p.steps };
    if (p.ingredients.length) assert.ok(L.normalize(filled).recipe, 'normalizable: ' + L.normalize(filled).error + ' <- ' + JSON.stringify(text.slice(0, 120)));
  }
});

test('random recipes survive a share-link round trip and renormalising', () => {
  const rnd = (() => { let x = 7; return () => (x = (x * 1103515245 + 12345) >>> 0) / 4294967296; })();
  const units = [undefined, ...Object.keys(L.UNITS)];
  for (let i = 0; i < 300; i++) {
    const r = L.normalize({ title: 'Résumé ☕ ' + i, base_servings: 1 + Math.floor(rnd() * 12),
      ingredients: Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, k) => ({ id: ('000' + (k + 1)).slice(-4), name: 'item ' + k + ' ü', amount: Math.round((0.125 + rnd() * 20) * 8) / 8, unit: units[Math.floor(rnd() * units.length)], group: rnd() < 0.3 ? 'Sec ' + k : undefined })),
      steps: [{ title: 'S', text: 'Use {0001} now.', timer_seconds: rnd() < 0.5 ? 60 * (1 + Math.floor(rnd() * 90)) : undefined }], tags: ['a', 'b'] }).recipe;
    assert.ok(r);
    assert.deepEqual(L.decodeShare(L.encodeShare(r)), r);
    assert.deepEqual(L.normalize(r).recipe, r);                             // normalising is idempotent
  }
});

// ---------- speed and size limits ----------
function fast(label, fn, ms = 2500) { const t = Date.now(); const r = fn(); const dt = Date.now() - t; assert.ok(dt < ms, `${label} took ${dt} ms (limit ${ms})`); return r; }
const rep = (s, n) => s.repeat(n);

test('broken or huge input cannot freeze the parser', () => {
  fast('2 MB of unclosed <script', () => L.htmlToText(rep('<script ', 250000)));
  fast('unclosed <nav> x 300k', () => L.htmlToText(rep('<nav>x', 300000)));
  fast('< without > x 600k', () => L.htmlToText(rep('<a ', 600000)));
  fast('2 MB of valid markup', () => L.htmlToText(rep('<p>hi</p>', 250000)));
  fast('unclosed ld+json x 70k', () => L.extractJsonLdRecipe(rep('<script type="application/ld+json">{', 70000)));
  fast('1 MB of &', () => L.decodeEntities(rep('&', 1000000)));
  fast('digits and spaces', () => L.smartParse(rep('1 ', 30000) + ': a'));
  fast('slashes', () => L.smartParse(rep('1/', 30000) + ':'));
  fast('brackets', () => L.smartParse(rep('(', 60000)));
  fast('Optional: prefixes', () => L.smartParse(rep('Optional: ', 20000) + 'x'));
  fast('300 KB single line', () => L.smartParse(rep('a', 300000)));
  fast('200 KB ordinary recipe text', () => L.smartParse(rep('1 cup flour\nMix the flour and sugar well in a bowl.\n', 4000)));
  fast('5000 ingredients and 2000 steps as structured data', () => L.smartParse('<script type="application/ld+json">' + JSON.stringify({ '@type': 'Recipe', name: 'x', recipeIngredient: Array.from({ length: 5000 }, (_, i) => `${i + 1} cups flour ${i}`), recipeInstructions: Array.from({ length: 2000 }, (_, i) => 'Step ' + i + '. Mix.') }) + '</script>'));
});

test('size limits are enforced with plain messages', () => {
  const ok = { title: 'T', base_servings: 2, ingredients: [{ id: '0001', name: 'a', amount: 1 }], steps: [{ text: 'x' }] };
  assert.ok(L.normalize(ok).recipe);
  assert.match(L.normalize({ ...ok, base_servings: 5000 }).error, /Servings/);
  assert.match(L.normalize({ ...ok, ingredients: [{ id: '0001', name: 'a', amount: 1e30 }] }).error, /looks wrong/);
  assert.match(L.normalize({ ...ok, ingredients: [{ id: '0001', name: 'a', amount: 1e-9 }] }).error, /looks wrong/);
  assert.match(L.normalize({ ...ok, ingredients: Array.from({ length: 301 }, (_, i) => ({ id: ('000' + (i + 1)).slice(-4), name: 'a' + i, amount: 1 })) }).error, /Too many ingredients/);
  assert.match(L.normalize({ ...ok, steps: Array.from({ length: 201 }, () => ({ text: 'x' })) }).error, /Too many steps/);
  assert.match(L.normalize({ ...ok, steps: [{ text: 'x'.repeat(5001) }] }).error, /too long/);
  assert.equal(L.normalize({ ...ok, notes: 'n'.repeat(20000) }).recipe.notes.length, 10000);
  const huge = L.smartParse(rep('1 cup flour\n', 1000) + 'Instructions\n' + rep('Stir it well until it is smooth.\n', 1000));
  assert.equal(huge.ingredients.length, 300); assert.equal(huge.steps.length, 200);
  assert.match(huge.warnings.join('\n'), /first 300 ingredients/);
  const long = L.smartParse('Soup\nIngredients\n1 cup stock\nInstructions\n' + rep('Stir well. ', 2000));
  assert.ok(long.steps[0].text.length <= 5000);
  const braces = L.smartParse('Soup\nIngredients\n1 cup stock\nInstructions\nAdd the stock {0001} and {0042} slowly.');
  assert.ok(!/\{0042\}/.test(braces.steps[0].text), 'a typed {0042} is neutralised');
  assert.ok(L.normalize({ title: 'S', base_servings: 2, ingredients: braces.ingredients, steps: braces.steps }).recipe, 'typed {0042} must not become a broken placeholder');
});

// ---------- conversions ----------
test('every unit, mode, scale and density converts to a sensible, physically equal amount', () => {
  const units = Object.keys(L.UNITS), modes = ['cups', 'metric', 'oz'], amounts = [0.125, 1 / 3, 0.5, 1, 1.5, 3, 12.5, 250, 2500];
  for (const unit of units) for (const mode of modes) for (const scale of [0.25, 0.5, 1, 2, 3.5, 10]) for (const amount of amounts) for (const gpc of [undefined, 125]) {
    const ing = { amount, unit, grams_per_cup: gpc };
    const out = L.formatAmount(ing, scale, mode);
    assert.ok(!/NaN|undefined|Infinity|null/.test(out) && out.trim() && !/^0(\.0+)?( |$)/.test(out), JSON.stringify([ing, scale, mode, out]));
    if (unit === 'pinch') continue;
    const c = L.convert(ing, scale, mode), u = L.UNITS[unit], u2 = L.UNITS[c.unit];
    if (!u2) continue;
    const orig = amount * scale * u.f, got = c.amount * u2.f;
    if (u.kind === u2.kind) assert.ok(Math.abs(got - orig) / orig < 1e-9, 'same kind ' + JSON.stringify([ing, scale, mode, c]));
    else { assert.ok(gpc, 'only an ingredient with a weight may change between volume and weight'); const want = u.kind === 'v' ? orig * gpc / 236.588 : orig * 236.588 / gpc; assert.ok(Math.abs(got - want) / want < 1e-9, 'bridge ' + JSON.stringify([ing, scale, mode, c])); }
  }
});

test('page text extraction keeps recipe text and drops page furniture', () => {
  const html = '<header>Site</header><nav><a>Home</a></nav><!-- note --><h1>Soup</h1><script>var x = "<p>fake</p>"</script><style>p{}</style><ul><li>1 cup stock</li><li>2 carrots</li></ul><p>Simmer for 20 minutes.</p><form><input></form><footer>Contact</footer>';
  assert.equal(L.htmlToText(html), 'Soup\n1 cup stock\n2 carrots\n\nSimmer for 20 minutes.');
  assert.equal(L.htmlToText('<nav>unclosed menu <p>but the recipe is still here</p>'), 'unclosed menu but the recipe is still here');
  assert.equal(L.htmlToText('1 < 2 and 3 > 2'), '1 < 2 and 3 > 2');
  assert.equal(L.htmlToText('Tom &amp; Jerry&#39;s &frac12; cup'), "Tom & Jerry's ½ cup");
});
