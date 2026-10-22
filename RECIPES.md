# Adding recipes

There are two ways recipes get onto the site.

**In the app (just for you, on this device).** Open the site and tap **+ Add recipe**.
Type the fields, or open "Paste a list of ingredients" and paste lines like
`1 1/2 cups flour`. They are stored in your browser, so they will not appear on other
devices and are lost if you clear site data. Use **Backup & restore** to download a
backup, restore it, or move recipes to another device. To make one show for everyone,
open it, choose **Download JSON**, and add the file to `recipes/` as described below.

**In the repository (for everyone).** The rest of this page.

Every recipe is one JSON file in `recipes/`, plus its slug in `recipes/index.json`.
The format comes from the Recipe Card skill, so you can hand Claude a recipe
(pasted text, a link, a dish name, or your own family version) and ask it to
"add this to the site using the recipe-card skill". Claude should write the file,
add the slug to `index.json`, and run `node tools/validate.mjs`.

## File format

```json
{
  "title": "Grandma's Soup",
  "credit": "Optional family credit or note",
  "base_servings": 4,
  "ingredients": [
    { "id": "0001", "name": "carrots, diced", "amount": 2.5, "unit": "cup" },
    { "id": "0002", "name": "large egg", "amount": 1 }
  ],
  "steps": [
    { "title": "Simmer", "text": "Cook {0001} carrots until soft.", "timer_seconds": 900 }
  ],
  "notes": "Storage, make-ahead, substitutions, any estimated amounts.",
  "sources": [{ "title": "Site name", "url": "https://example.com/recipe" }]
}
```

Rules (same as the skill):

- `id` is 4 digits and unique per recipe. `amount` is a number (1/2 = 0.5, 1/3 = 0.333).
- `unit` is one of: g, kg, ml, l, tsp, tbsp, cup, fl_oz, oz, lb, pinch. Leave it out
  for countable things (eggs, cloves) and put the noun in the name.
- `grams_per_cup` (optional, number) is the weight of one US cup of that ingredient
  (flour about 125, sugar 200, butter 227). Give it to every dry or solid ingredient
  measured by volume or weight, so the site can switch exactly between cups, grams and
  ounces. Skip it for liquids (they use ml and fl oz). If it is an estimate, say so in `notes`.
- Use the unit the source uses. The site converts between US and metric itself, so
  never write both units into `name`.
- `{0001}` in step text is replaced by the scaled, converted amount (for example
  "2 1/2 cup"). Write the ingredient name yourself after it.
- Same ingredient in two places? Make two entries: "sugar (filling)", "sugar (dough)".
- `timer_seconds` adds a start/cancel timer button to waiting, baking or resting steps.
- Web recipes are paraphrased and get a `sources` list. Family recipes keep their
  own wording and have no `sources`.
- `"example": true` marks a placeholder recipe. Remove it for real ones.

## Known limits

- The three unit views are Cups & spoons, Grams & ml, and Ounces. At the written
  serving size, amounts already in the chosen view show exactly as written.
- Without `grams_per_cup`, an ingredient keeps volume as volume and weight as weight
  (1 cup milk becomes 237 ml or 8 fl oz, never grams).
- Scaling does not adjust pan size or bake time. Mention those in `notes`.

## Preview and publish

- Preview: `python3 -m http.server` in this folder, then open http://localhost:8000
  (opening `index.html` as a file will not work because the page fetches JSON).
- Publish: GitHub repo Settings > Pages, deploy from the branch root.
