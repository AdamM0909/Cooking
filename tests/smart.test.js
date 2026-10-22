'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../assets/lib.js');

const page = fs.readFileSync(path.join(__dirname, 'fixtures', 'page-with-jsonld.html'), 'utf8');

test('page source with schema.org data becomes a recipe', () => {
  const p = L.smartParse(page, 'https://example.com/banana-bread');
  assert.equal(p.how, 'structured');
  assert.equal(p.title, 'Banana Bread & Walnuts');
  assert.equal(p.base_servings, 10);
  assert.equal(p.credit, 'From Pat Example');
  assert.deepEqual(p.tags, ['bread', 'breakfast', 'banana', 'dessert']);
  assert.deepEqual(p.sources, [{ title: 'example.com', url: 'https://example.com/banana-bread' }]);
  assert.equal(p.ingredients.length, 6);
  assert.deepEqual(p.ingredients[1], { amount: 1, unit: 'cup', name: 'all-purpose flour', grams_per_cup: 125, id: '0002' });
  assert.equal(p.ingredients[2].grams_per_cup, 200);            // 1/2 cup = 100 g
  assert.equal(p.ingredients[5].name, 'melted butter');          // "(80 ml)" dropped
  assert.equal(p.steps.length, 4);                               // section flattened
  assert.match(p.steps[0].text, /350°F/);                   // entity decoded
  assert.equal(p.steps[3].timer_seconds, 55 * 60);               // lower end of the range
  assert.equal(p.steps[0].timer_seconds, undefined);
});

test('amounts in steps are linked once, to the first mention only', () => {
  const p = L.smartParse(page);
  const mash = p.steps[1].text;
  assert.match(mash, /^Mash \{0001\} bananas /);   // last-word fallback: step says "bananas", ingredient is "ripe bananas"
  assert.match(p.steps[2].text, /\{0002\} flour/);
  assert.doesNotMatch(p.steps[3].text, /\{000[1-6]\}/ ) ;
  // the result is a valid recipe once amounts exist
  const r = L.normalize({ title: p.title, base_servings: p.base_servings, ingredients: p.ingredients, steps: p.steps });
  assert.ok(r.recipe, r.error);
});

test('a copied web page with headings and blog clutter is understood', () => {
  const text = `Skip to content
Grandma's Easy Pancakes
Print Recipe
5 stars (123 reviews)
Prep time: 10 mins
My grandma made these every Sunday. They are fluffy and quick!
Serves 6
Ingredients
2 cups all-purpose flour
2 tbsp sugar
1 1/2 cups milk
1 egg
Instructions
1. Whisk the flour and sugar together.
2. Add the milk and egg, then stir until just mixed.
3. Cook on a hot buttered pan for 3 minutes per side.
Notes
Great with berries.`;
  const p = L.smartParse(text);
  assert.equal(p.how, 'headings');
  assert.equal(p.title, "Grandma's Easy Pancakes"); // page chrome such as "Skip to content" is ignored
  assert.equal(p.base_servings, 6);
  assert.equal(p.ingredients.length, 4);
  assert.equal(p.steps.length, 3);
  assert.equal(p.steps[2].timer_seconds, 180);
  assert.equal(p.notes, 'Great with berries.');
});

test('no headings: ingredients and steps are guessed line by line', () => {
  const text = `Quick Tomato Pasta
Serves 2
200 g spaghetti
2 cloves garlic, minced
1 can crushed tomatoes
Salt and pepper
Boil the spaghetti in salted water for 10 minutes, then drain it.
Meanwhile, fry the garlic in a little oil and add the tomatoes. Simmer for 8 minutes.
Toss the pasta through the sauce and serve.`;
  const p = L.smartParse(text);
  assert.equal(p.how, 'guess');
  assert.equal(p.title, 'Quick Tomato Pasta');
  assert.equal(p.base_servings, 2);
  assert.equal(p.ingredients.length, 4);       // "Salt and pepper" stays, flagged for an amount
  assert.equal(p.ingredients[0].unit, 'g');
  assert.equal(p.steps.length, 3);
  assert.equal(p.steps[0].timer_seconds, 600);
  assert.ok(p.warnings.some(w => /worked out/.test(w)));
});

test('pasted HTML without structured data is turned into text first', () => {
  const html = '<html><body><h1>Toast</h1><h2>Ingredients</h2><ul><li>2 slices bread</li><li>1 tbsp butter</li></ul><h2>Instructions</h2><ol><li>Toast the bread for 2 minutes.</li><li>Butter it.</li></ol></body></html>';
  const p = L.smartParse(html);
  assert.equal(p.title, 'Toast');
  assert.equal(p.ingredients.length, 2);
  assert.equal(p.steps.length, 2);
});

test('smartParse of nonsense returns an empty result instead of throwing', () => {
  const p = L.smartParse('hello there');
  assert.equal(p.ingredients.length + p.steps.length, 0);
  assert.equal(L.smartParse('').ingredients.length, 0);
});

test('helpers: timers, entities, urls, linking guards', () => {
  assert.equal(L.detectTimer('Bake 25 to 30 minutes'), 1500);
  assert.equal(L.detectTimer('Rest for 1.5 hours'), 5400);
  assert.equal(L.detectTimer('Cook for 30 seconds'), undefined);
  assert.equal(L.detectTimer('no time here'), undefined);
  assert.equal(L.decodeEntities('Tom &amp; Jerry&#39;s &frac12; cup &#x2014;'), "Tom & Jerry's ½ cup —");
  assert.ok(L.looksLikeUrl(' https://example.com/a?b=1 '));
  assert.ok(!L.looksLikeUrl('see https://example.com'));
  const ings = [{ id: '0001', name: 'butter', amount: 2, unit: 'tbsp' }, { id: '0002', name: 'flour', amount: 1, unit: 'cup' }];
  const r = L.autoLinkSteps(ings, [{ title: '', text: 'Melt the butter, then add the remaining flour and more butter.' }]);
  assert.equal(r.steps[0].text, 'Melt {0001} butter, then add the remaining flour and more butter.');
});

test('page text extraction drops scripts and navigation', () => {
  const t = L.htmlToText('<nav>Menu</nav><script>var x=1</script><p>Hello&nbsp;<b>world</b></p><style>p{}</style><div>Next</div>');
  assert.equal(t, 'Hello world\nNext');
});

test('last-word fallback is skipped when two ingredients share the word', () => {
  const ings = [{ id: '0001', name: 'brown sugar', amount: 1, unit: 'cup' }, { id: '0002', name: 'white sugar', amount: 1, unit: 'cup' }];
  const r = L.autoLinkSteps(ings, [{ title: '', text: 'Cream the butter with the sugar.' }]);
  assert.equal(r.steps[0].text, 'Cream the butter with the sugar.');
  assert.equal(r.linked, 0);
});

test('wordy amounts: "a pinch of", "an egg", "half a lemon"', () => {
  assert.deepEqual(L.parseIngredientLine('a pinch of chili flakes'), { amount: 1, unit: 'pinch', name: 'chili flakes' });
  assert.deepEqual(L.parseIngredientLine('an egg'), { amount: 1, unit: '', name: 'egg' });
  assert.deepEqual(L.parseIngredientLine('a cup of milk'), { amount: 1, unit: 'cup', name: 'milk' });
  assert.deepEqual(L.parseIngredientLine('half a lemon'), { amount: 0.5, unit: '', name: 'lemon' });
  assert.deepEqual(L.parseIngredientLine('a little salt'), { amount: '', unit: '', name: 'a little salt' });
  assert.deepEqual(L.parseIngredientLine('a few basil leaves'), { amount: '', unit: '', name: 'a few basil leaves' });
});

test('amountToInput gives readable text that parses back', () => {
  for (const [n, t] of [[1 / 3, '1/3'], [1.5, '1 1/2'], [2, '2'], [0.25, '1/4'], [2 / 3, '2/3'], [0.125, '1/8'], [3.75, '3 3/4'], [0.1, '0.1']]) {
    assert.equal(L.amountToInput(n), t);
    assert.ok(Math.abs(L.parseAmount(L.amountToInput(n)) - n) < 0.005);
  }
  assert.equal(L.amountToInput(0), '');
  assert.equal(L.amountToInput('x'), '');
});

// A real pasted recipe: bulleted lists under "Name:" headings, shared-unit lines, no steps, no title.
test('bulleted recipe with sections, shared units and loose wording is read correctly', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'fried-chicken-sliders.txt'), 'utf8');
  const p = L.smartParse(text);
  const names = (g) => p.ingredients.filter(i => i.group === g).map(i => i.name);
  const find = (n) => p.ingredients.find(i => i.name === n);

  // nothing is invented: no title, no steps, no servings
  assert.equal(p.title, '');
  assert.equal(p.steps.length, 0);
  assert.equal(p.base_servings, '');
  assert.equal(p.ingredients.length, 42); // 43 lines, minus "splash of hot sauce" which belongs in a step
  assert.deepEqual([...new Set(p.ingredients.map(i => i.group))],
    ['Chicken marinade', 'Dredge', 'Hot honey glaze', 'Homemade buttermilk ranch', 'Sliders', 'Garlic butter']);

  // "1 tsp: a, b, c" becomes separate ingredients at 1 tsp each
  assert.deepEqual(names('Chicken marinade').slice(2, 9),
    ['salt', 'pepper', 'chicken bouillon powder', 'cayenne', 'garlic powder', 'onion powder', 'paprika']);
  assert.deepEqual(p.ingredients.filter(i => i.group === 'Dredge' && i.unit === 'tsp').map(i => i.amount), [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(p.ingredients[2].amount, 0.5);

  // loose wording becomes flagged estimates, optional items are marked
  // "Splash of hot sauce" is not an ingredient row; with no step to carry it, it is kept in Notes
  assert.equal(p.ingredients.find(i => /splash/.test(i.name)), undefined);
  assert.equal(p.ingredients.filter(i => i.name === 'hot sauce').length, 0);
  assert.equal(p.notes, 'Also: a splash of hot sauce (Chicken marinade).');
  assert.equal(find('msg (optional)').amount, 0.5);
  assert.equal(p.ingredients[10].name, 'egg');
  assert.equal(find('cayenne (1/2-1 tsp, optional)').amount, 0.5);
  assert.equal(find('salt (to taste)').amount, 0.25);
  assert.ok(find('pepper (to taste)'));

  // a stick of butter is 8 tablespoons, with a typical weight filled in
  const butter = p.ingredients.find(i => i.name === 'unsalted butter');
  assert.equal(butter.amount, 4); assert.equal(butter.unit, 'tbsp'); assert.equal(butter.grams_per_cup, 227);
  assert.equal(p.ingredients.find(i => i.name === 'AP flour').grams_per_cup, 125);
  assert.equal(p.ingredients.find(i => i.name === 'honey').grams_per_cup, undefined); // liquids stay in ml

  // "Name (a, b, c)" expands into its own section
  assert.deepEqual(names('Garlic butter'), ['butter', 'cloves grated garlic', 'minced parsley']);
  assert.equal(names('Sliders').length, 2);

  // capitals are tidied only when safe
  assert.ok(find('Hidden Valley Ranch seasoning'));
  assert.ok(find('dill pickles'));

  // the person is told what still needs attention, once each
  const w = p.warnings.join('\n');
  assert.match(w, /6 ingredient sections/);
  assert.match(w, /No steps found/);
  assert.match(w, /No title found/);
  assert.match(w, /how many it serves/);
  assert.match(w, /3 ingredients have no amount/);
  assert.match(w, /Left "a splash of hot sauce" out of the ingredient list/);
  assert.equal((w.match(/salt to taste = 1\/4 tsp/g) || []).length, 1);
  assert.equal(p.ingredients.filter(i => i.name.includes('(to taste)') && i.estimated).length, 3); // hot sauce already has an amount
});

test('groups survive validation and shopping list merging ignores them', () => {
  const r = L.normalize({ title: 'T', base_servings: 2,
    ingredients: [{ id: '0001', name: 'butter', amount: 1, unit: 'tbsp', group: 'Sauce' }, { id: '0002', name: 'butter', amount: 2, unit: 'tbsp', group: 'Dough' }],
    steps: [{ text: 'Cook.' }] });
  assert.ok(r.recipe, r.error);
  assert.equal(r.recipe.ingredients[0].group, 'Sauce');
  const out = L.combineIngredients([{ recipe: r.recipe, servings: 2 }]);
  assert.equal(out.length, 1);
  assert.equal(Math.round(out[0].items[0].amount), 44); // 3 tbsp of butter in ml
});

test('shared-unit and wording helpers', () => {
  const names = (s) => L.expandIngredientLine(s).map(i => i.name);
  assert.deepEqual(names('2 tbsp: sugar, salt and pepper'), ['sugar', 'salt', 'pepper']);
  assert.deepEqual(names('Salt, pepper and paprika to taste'), ['salt (to taste)', 'pepper (to taste)', 'paprika (to taste)']);
  assert.deepEqual(names('Optional: fresh chives'), ['fresh chives (optional)']);
});


// The same ingredients with a method after them, written in the shapes people actually use.
const ingredientsText = fs.readFileSync(path.join(__dirname, 'fixtures', 'fried-chicken-sliders.txt'), 'utf8');

test('method under an "Instructions:" heading with numbered steps', () => {
  const p = L.smartParse(ingredientsText + `
Instructions:
1. Whisk the buttermilk, pickle juice, egg, seasonings and a splash of hot sauce. Add the chicken and marinate for at least 4 hours.
2. Mix the dredge in a wide dish. Dredge each thigh twice, pressing firmly.
3. Fry at 350F for 6 to 8 minutes per side until the chicken reaches 165F.
4. Melt the butter with the honey and hot sauce, then simmer for 3 minutes.
5. Stir the ranch ingredients together and chill.
6. Build the sliders with a thigh, pickles and ranch on the garlic buttered buns.
`);
  assert.equal(p.ingredients.length, 42);          // the method did not leak into the ingredients
  assert.equal(p.steps.length, 6);
  assert.match(p.steps[0].text, /^Whisk the buttermilk/);
  assert.equal(p.steps[0].timer_seconds, 4 * 3600);
  assert.equal(p.steps[2].timer_seconds, 6 * 60);
  assert.equal(p.notes, '');                       // the splash is in step 1, so nothing extra is added
  assert.match(p.warnings.join('\n'), /Left "a splash of hot sauce" out of the ingredient list because step 1 mentions it/);
  assert.doesNotMatch(p.warnings.join('\n'), /No steps found/);
  assert.equal(p.ingredients.filter(i => i.group === 'Instructions').length, 0);
});

test('method as plain paragraphs under sub-headings, no numbers', () => {
  const p = L.smartParse(ingredientsText + `
Marinate the chicken:
Whisk the buttermilk, pickle juice, egg, spices and a splash of hot sauce together. Add the thighs and refrigerate overnight.

Fry the chicken:
Heat oil to 350F. Dredge the thighs and fry for 7 minutes per side.

Make the glaze:
Melt the butter, stir in the honey and hot sauce and simmer for 3 minutes.
`);
  assert.equal(p.ingredients.length, 42);
  assert.equal(p.steps.length, 3);
  assert.deepEqual(p.steps.map(s => s.title), ['Marinate the chicken', 'Fry the chicken', 'Make the glaze']);
  assert.equal(p.steps[1].timer_seconds, 7 * 60);
});

test('numbered steps with no heading at all, and a "Directions" heading with bullets', () => {
  const a = L.smartParse(ingredientsText + '\n1. Marinate the chicken overnight.\n2. Dredge and fry until golden, about 12 minutes.\n3. Toss in the glaze.\n');
  assert.equal(a.steps.length, 3);
  assert.equal(a.ingredients.length, 42);
  const b = L.smartParse(ingredientsText + '\nDirections\n* Marinate the chicken overnight.\n* Dredge and fry until golden.\n');
  assert.equal(b.steps.length, 2);
  assert.equal(b.steps[0].text, 'Marinate the chicken overnight.');
  assert.equal(b.ingredients.length, 42);
});

test('an ingredient that appears in several sections is not auto-linked in the steps', () => {
  const ings = [{ id: '0001', name: 'salt', amount: 1, unit: 'tsp' }, { id: '0002', name: 'salt', amount: 2, unit: 'tsp' }, { id: '0003', name: 'flour', amount: 1, unit: 'cup' }];
  const r = L.autoLinkSteps(ings, [{ title: '', text: 'Season the chicken with salt, then add the flour.' }]);
  assert.equal(r.steps[0].text, 'Season the chicken with salt, then add {0003} flour.');
});

test('intro text before the recipe is ignored, not turned into steps', () => {
  const p = L.smartParse(`Sunday Pancakes
My grandmother made these every single Sunday morning without fail.
Serves 4
2 cups flour
1 egg
Mix everything together until smooth.`);
  assert.equal(p.steps.length, 1);
  assert.equal(p.ingredients.length, 2);
  assert.equal(p.title, 'Sunday Pancakes');
});

test('"butter" is not linked when another ingredient is also a butter', () => {
  const ings = [{ id: '0001', name: 'unsalted butter', amount: 4, unit: 'tbsp' }, { id: '0002', name: 'butter', amount: 4, unit: 'tbsp' }, { id: '0003', name: 'honey', amount: 0.5, unit: 'cup' }];
  const r = L.autoLinkSteps(ings, [{ title: '', text: 'Melt the butter with the honey.' }]);
  assert.equal(r.steps[0].text, 'Melt the butter with {0003} honey.');
});
