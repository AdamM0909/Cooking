'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../assets/lib.js');

const flour = { amount: 1.5, unit: 'cup', grams_per_cup: 125 };

test('parseAmount handles fractions, mixed numbers, unicode and ranges', () => {
  assert.equal(L.parseAmount('1 1/2'), 1.5);
  assert.equal(L.parseAmount('3/4'), 0.75);
  assert.equal(L.parseAmount('0.5'), 0.5);
  assert.equal(L.parseAmount('1½'), 1.5);
  assert.equal(L.parseAmount('¼'), 0.25);
  assert.equal(L.parseAmount('1-2'), 1);
  assert.equal(L.parseAmount('1-1/2'), 1.5);
  assert.ok(Number.isNaN(L.parseAmount('')));
  assert.ok(Number.isNaN(L.parseAmount('abc')));
  assert.ok(Number.isNaN(L.parseAmount('0')));
});

test('parseIngredientLine splits amount, unit and name', () => {
  assert.deepEqual(L.parseIngredientLine('1 1/2 cups flour'), { amount: 1.5, unit: 'cup', name: 'flour' });
  assert.deepEqual(L.parseIngredientLine('- 200 g chocolate chips'), { amount: 200, unit: 'g', name: 'chocolate chips' });
  assert.deepEqual(L.parseIngredientLine('1 large egg'), { amount: 1, unit: '', name: 'large egg' });
  assert.deepEqual(L.parseIngredientLine('½ tsp salt'), { amount: 0.5, unit: 'tsp', name: 'salt' });
  assert.deepEqual(L.parseIngredientLine('2 fl oz milk'), { amount: 2, unit: 'fl_oz', name: 'milk' });
  assert.deepEqual(L.parseIngredientLine('a few basil leaves'), { amount: '', unit: '', name: 'a few basil leaves' });
  assert.equal(L.parseIngredientLine('   '), null);
});

test('conversion: exact at written size, density-based otherwise', () => {
  assert.equal(L.formatAmount(flour, 1, 'cups'), '1 ½ cups');
  assert.equal(L.formatAmount(flour, 1, 'metric'), '188 g');
  assert.equal(L.formatAmount(flour, 1, 'oz'), '6.6 oz');
  assert.equal(L.formatAmount(flour, 2, 'cups'), '3 cups');
  assert.equal(L.formatAmount({ amount: 1.25, unit: 'cup' }, 1, 'metric'), '296 ml');
  assert.equal(L.formatAmount({ amount: 1.25, unit: 'cup' }, 1, 'oz'), '10 fl oz');
  assert.equal(L.formatAmount({ amount: 200, unit: 'g' }, 1, 'cups'), '200 g'); // no density: keeps family
  assert.equal(L.formatAmount({ amount: 1, unit: '' }, 1.5, 'cups'), '1 ½');
  assert.equal(L.formatAmount({ amount: 3, unit: 'tbsp', grams_per_cup: 227 }, 1.5, 'cups'), '4 ½ tbsp');
});

test('normalize accepts a good recipe and keeps only known fields', () => {
  const r = L.normalize({
    title: ' Soup ', base_servings: 4, evil: '<script>', tags: ['Dinner', 'dinner', ' Soup '],
    ingredients: [{ id: '0001', name: 'carrot', amount: 2 }],
    steps: [{ title: '', text: 'Chop {0001}.', timer_seconds: 60 }],
    sources: [{ title: 'x', url: 'javascript:alert(1)' }, { title: 'ok', url: 'https://example.com' }],
    photo: 'data:image/jpeg;base64,AAAA', image: '../secret.png'
  });
  assert.ok(r.recipe, r.error);
  assert.equal(r.recipe.title, 'Soup');
  assert.equal(r.recipe.evil, undefined);
  assert.deepEqual(r.recipe.tags, ['dinner', 'soup']);
  assert.deepEqual(r.recipe.sources, [{ title: 'ok', url: 'https://example.com' }]);
  assert.equal(r.recipe.steps[0].title, 'Step 1');
  assert.equal(r.recipe.photo, 'data:image/jpeg;base64,AAAA');
  assert.equal(r.recipe.image, undefined);
});

test('normalize rejects bad recipes with a readable message', () => {
  const ok = { title: 'T', base_servings: 2, ingredients: [{ id: '0001', name: 'a', amount: 1 }], steps: [{ text: 'x' }] };
  assert.ok(L.normalize(ok).recipe);
  assert.match(L.normalize({ ...ok, title: '' }).error, /title/);
  assert.match(L.normalize({ ...ok, base_servings: 0 }).error, /Servings/);
  assert.match(L.normalize({ ...ok, ingredients: [] }).error, /ingredient/);
  assert.match(L.normalize({ ...ok, ingredients: [{ id: '0001', name: 'a', amount: 0 }] }).error, /amount/);
  assert.match(L.normalize({ ...ok, ingredients: [{ id: '0001', name: 'a', amount: 1, unit: 'bucket' }] }).error, /unit/);
  assert.match(L.normalize({ ...ok, steps: [{ text: 'use {0009}' }] }).error, /removed/);
  assert.match(L.normalize({ ...ok, steps: [{ text: '' }] }).error, /text/);
  assert.match(L.normalize(null).error, /Not a recipe/);
});

test('parseRecipeText reads a pasted recipe', () => {
  const r = L.parseRecipeText(`Grandma's Pancakes
Serves 6

Ingredients
1 1/2 cups flour
For the topping:
2 tbsp butter
1 egg

Instructions
1. Mix the flour and egg.
2) Cook in the butter.

Notes
Good cold too.`);
  assert.equal(r.title, "Grandma's Pancakes");
  assert.equal(r.base_servings, 6);
  assert.equal(r.ingredients.length, 3);
  assert.equal(r.ingredients[0].id, '0001');
  assert.equal(r.steps.length, 2);
  assert.equal(r.steps[0].text, 'Mix the flour and egg.');
  assert.equal(r.notes, 'Good cold too.');
});

test('combineIngredients merges across recipes and folds volume into weight', () => {
  const a = { base_servings: 2, ingredients: [
    { id: '0001', name: 'flour, sifted', amount: 1, unit: 'cup', grams_per_cup: 125 },
    { id: '0002', name: 'large egg', amount: 1 }] };
  const b = { base_servings: 4, ingredients: [
    { id: '0001', name: 'Flour', amount: 250, unit: 'g' },
    { id: '0002', name: 'large egg', amount: 3 },
    { id: '0003', name: 'milk', amount: 1, unit: 'cup' }] };
  const out = L.combineIngredients([{ recipe: a, servings: 4 }, { recipe: b, servings: 4 }]);
  const byName = Object.fromEntries(out.map(x => [x.name.toLowerCase(), x]));
  assert.equal(byName.flour.items.length, 1);
  assert.equal(Math.round(byName.flour.items[0].amount), 500); // 2 cups = 250 g, plus 250 g
  assert.equal(byName['large egg'].items[0].amount, 5);          // 2 + 3
  assert.equal(L.formatAmount(byName.milk.items[0], 1, 'cups'), '1 cup');
});

test('combineIngredients rounds partial countable items up', () => {
  const a = { base_servings: 4, ingredients: [{ id: '0001', name: 'egg', amount: 1 }] };
  const out = L.combineIngredients([{ recipe: a, servings: 6 }]);
  assert.equal(out[0].items[0].amount, 2);
});

test('share links round-trip and reject junk', () => {
  const r = L.normalize({ title: 'Café ☕', base_servings: 2, ingredients: [{ id: '0001', name: 'beans', amount: 1, unit: 'cup' }], steps: [{ text: 'Use {0001}.' }] }).recipe;
  const code = L.encodeShare(r);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(L.decodeShare(code), r);
  assert.equal(L.decodeShare('not-a-recipe'), null);
  assert.equal(L.decodeShare(''), null);
});

test('slugs are unique and safe', () => {
  assert.equal(L.slugify("Grandma's Cookies!"), 'grandma-s-cookies');
  assert.equal(L.slugify('!!!'), 'recipe');
  assert.equal(L.uniqueSlug('Soup', { soup: 1, 'soup-2': 1 }), 'soup-3');
});

test('shopping list treats common qualifiers as the same ingredient', () => {
  const a = { base_servings: 1, ingredients: [{ id: '0001', name: 'all-purpose flour', amount: 100, unit: 'g' }, { id: '0002', name: 'large egg', amount: 1 }] };
  const b = { base_servings: 1, ingredients: [{ id: '0001', name: 'flour', amount: 50, unit: 'g' }, { id: '0002', name: 'egg', amount: 1 }, { id: '0003', name: 'unsalted butter', amount: 10, unit: 'g' }, { id: '0004', name: 'salted butter', amount: 10, unit: 'g' }] };
  const out = L.combineIngredients([{ recipe: a, servings: 1 }, { recipe: b, servings: 1 }]);
  assert.equal(out.length, 4); // flour, egg, salted butter, unsalted butter stay distinct
  assert.equal(out.find(x => /flour/.test(x.name)).items[0].amount, 150);
  assert.equal(out.find(x => /egg/.test(x.name)).items[0].amount, 2);
});

test('a recipe may be saved with no steps yet', () => {
  const r = L.normalize({ title: 'Sauce parts', base_servings: 2, ingredients: [{ id: '0001', name: 'a', amount: 1 }], steps: [] });
  assert.ok(r.recipe, r.error);
  assert.deepEqual(r.recipe.steps, []);
  assert.match(L.normalize({ title: 'x', base_servings: 2, ingredients: [{ id: '0001', name: 'a', amount: 1 }] }).error, /Steps/);
});

test('small spoon amounts stay in spoons in the Ounces view; big volumes become fluid ounces', () => {
  assert.equal(L.formatAmount({ amount: 1, unit: 'tsp' }, 1, 'oz'), '1 tsp');
  assert.equal(L.formatAmount({ amount: 2, unit: 'tbsp' }, 1, 'oz'), '2 tbsp');
  assert.equal(L.formatAmount({ amount: 1, unit: 'tsp' }, 3, 'oz'), '1 tbsp');
  assert.equal(L.formatAmount({ amount: 1, unit: 'cup' }, 1, 'oz'), '8 fl oz');
  assert.equal(L.formatAmount({ amount: 1, unit: 'tsp', grams_per_cup: 230 }, 1, 'oz'), '0.2 oz'); // with a weight, ounces by weight
});
