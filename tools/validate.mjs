// Checks every recipe in recipes/ against the format in RECIPES.md.
// Usage: node tools/validate.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'recipes');
const UNITS = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'fl_oz', 'oz', 'lb', 'pinch'];
const slugs = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
let errors = 0;
const fail = (slug, msg) => { errors++; console.error(`${slug}: ${msg}`); };

for (const slug of slugs) {
  let r;
  try { r = JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8')); }
  catch (e) { fail(slug, `cannot read or parse (${e.message})`); continue; }

  if (!r.title) fail(slug, 'missing title');
  if (!Number.isFinite(r.base_servings) || r.base_servings < 1) fail(slug, 'base_servings must be a number >= 1');
  const ids = new Set();
  for (const i of r.ingredients ?? []) {
    if (!/^\d{4}$/.test(i.id)) fail(slug, `bad ingredient id "${i.id}"`);
    if (ids.has(i.id)) fail(slug, `duplicate ingredient id ${i.id}`);
    ids.add(i.id);
    if (!i.name) fail(slug, `ingredient ${i.id} has no name`);
    if (typeof i.amount !== 'number' || !(i.amount > 0)) fail(slug, `ingredient ${i.id} amount must be a positive number`);
    if (i.unit !== undefined && !UNITS.includes(i.unit)) fail(slug, `ingredient ${i.id} has unknown unit "${i.unit}"`);
  }
  if (!ids.size) fail(slug, 'no ingredients');
  const used = new Set();
  for (const [n, s] of (r.steps ?? []).entries()) {
    if (!s.title || !s.text) fail(slug, `step ${n + 1} needs title and text`);
    for (const m of (s.text ?? '').matchAll(/\{(\d{4})\}/g)) {
      used.add(m[1]);
      if (!ids.has(m[1])) fail(slug, `step ${n + 1} references unknown ingredient {${m[1]}}`);
    }
    if (s.timer_seconds !== undefined && !(s.timer_seconds > 0)) fail(slug, `step ${n + 1} timer_seconds must be > 0`);
  }
  if (!(r.steps ?? []).length) fail(slug, 'no steps');
  for (const id of ids) if (!used.has(id)) console.warn(`${slug}: ingredient ${id} is never referenced in a step (fine, but check)`);
}
console.log(errors ? `${errors} problem(s) found` : `${slugs.length} recipe(s) OK`);
process.exit(errors ? 1 : 0);
