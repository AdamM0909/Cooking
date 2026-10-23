// Checks every recipe in recipes/ using the same rules the app uses (assets/lib.js).
// Usage: node tools/validate.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'recipes');
const { normalize } = createRequire(import.meta.url)(join(root, 'assets', 'lib.js'));

const slugs = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
let errors = 0;
const fail = (slug, msg) => { errors++; console.error(`${slug}: ${msg}`); };

const onDisk = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => f.slice(0, -5));
for (const f of onDisk) if (!slugs.includes(f)) fail(f, 'file exists but is not listed in recipes/index.json');
if (new Set(slugs).size !== slugs.length) fail('index.json', 'contains duplicate slugs');

for (const slug of slugs) {
  if (!/^[\w-]+$/.test(slug)) { fail(slug, 'slug may only use letters, numbers, - and _'); continue; }
  let r;
  try { r = JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8')); }
  catch (e) { fail(slug, `cannot read or parse (${e.message})`); continue; }

  const res = normalize(r);
  if (!res.recipe) { fail(slug, res.error); continue; }
  if (r.image && !existsSync(join(root, r.image)) && !existsSync(join(dir, r.image))) fail(slug, `image "${r.image}" not found`);

  // Gentle hints, summarised so a normal recipe does not print a wall of text.
  const used = new Set(r.steps.flatMap(s => [...s.text.matchAll(/\{(\d{4})\}/g)].map(m => m[1])));
  const unlinked = res.recipe.ingredients.filter(i => !used.has(i.id));
  if (unlinked.length && res.recipe.steps.length) {
    console.warn(`${slug}: ${unlinked.length} of ${res.recipe.ingredients.length} ingredients are not linked into a step with {id}, so their amounts will not show or scale inside the steps (fine for seasonings): ${unlinked.slice(0, 5).map(i => i.name).join(', ')}${unlinked.length > 5 ? ', ...' : ''}`);
  }
  const noWeight = res.recipe.ingredients.filter(i => ['cup', 'tbsp', 'tsp'].includes(i.unit) && !i.grams_per_cup
    && !/oil|milk|water|juice|vinegar|stock|broth|cream|wine|extract|sauce|syrup|honey|salt|pepper|powder|spice|paprika|cayenne|seasoning/i.test(i.name));
  if (noWeight.length) console.warn(`${slug}: no grams_per_cup for ${noWeight.map(i => i.name).join(', ')}, so these cannot switch to grams or ounces exactly`);
}
console.log(errors ? `${errors} problem(s) found` : `${slugs.length} recipe(s) OK`);
process.exit(errors ? 1 : 0);
