# Our Kitchen

A small recipe site that runs entirely in the browser (no server, no build step).

- **Scales servings.** Every amount, including the ones written inside the steps, updates.
- **Three unit views.** Cups & spoons, Grams & ml, or Ounces. Amounts show exactly as written at the
  written serving size. Dry ingredients with a `grams_per_cup` value convert exactly between cups,
  grams and ounces.
- **Cook mode.** One step at a time in big text, swipe or use the arrow keys, the screen stays on, and
  timers keep running while you move between steps (they float at the bottom of the page).
- **Shopping list.** Add several recipes (with their own serving counts) and get one combined list.
  The same ingredient across recipes is added together and shown in your chosen units. Tick items off and
  add your own extras.
- **Your own recipes.** Add, edit, duplicate and delete in the app, with a photo and tags.
- **Paste anything.** A copied web page, page source, a message or your own notes. It finds the title,
  ingredients and steps (even with no headings), ignores page clutter, reads the structured recipe data
  most sites embed, picks up weights from brackets like "1 cup (125 g) flour", links amounts inside the
  steps so they scale, and turns "bake 25 minutes" into timers. You check it before saving.
- **Ingredient sections.** Recipes with parts (marinade, dredge, glaze, sauce) keep them as headings. Pasted
  lines like `1 tsp: salt, pepper, paprika` split into separate ingredients, `1/2 stick butter` becomes
  4 tbsp, `Optional:` and `to taste` are marked, and loose wording like "splash" gets a flagged estimate.
- **Paste a link** (optional one-time setup of a free helper, see [docs/LINK_IMPORT.md](docs/LINK_IMPORT.md)).
- **Favorites, star ratings, "I cooked this" counts and personal notes**, plus search, tag filters,
  sorting and a "Surprise me" button.
- **Share a recipe** with a link a friend can open and save, or download it as JSON.
- **Backup and restore** of everything you added.
- **Installable and offline.** Add it to your phone's home screen; it keeps working without a connection.

## Where things are stored

Recipes added in the app, favorites, ratings, notes and the shopping list live in the browser's local
storage on the device you used. They do not sync between devices, and clearing site data removes them, so
use **Backup & restore** now and then. Recipes in the `recipes/` folder of this repository are shared by
everyone who visits the site. See [RECIPES.md](RECIPES.md) for how to add those.

## Develop

```
npm run serve      # http://localhost:8000 (opening index.html as a file will not work)
npm test           # unit tests for the logic in assets/lib.js (Node 18+, no dependencies)
npm run validate   # checks every file in recipes/
npm run check      # both
npm run e2e        # browser checks (needs a running site and a browser, see e2e/README.md)
npm run build:worker   # regenerate worker/recipe-reader.js after editing lib.js
npm run bump           # new version number in lib.js, index.html and sw.js (do this with every site change)
```

CI runs the tests and the recipe validator on every pull request. Before a release, `npm run e2e` drives the real site in a
browser: security, accessibility, keyboard use, failure modes (blocked or full storage), round trips and more.

## Updates and versions

The footer shows the running version. Every file request bypasses the browser's cache, the page URLs carry a
version stamp, and when a newer version arrives while the app is open an **Update now** banner appears.
Run `npm run bump` with each change (a test checks that the version matches everywhere).

## Safety

Everything typed or pasted is shown as plain text, never as markup. The page also carries a content-security rule (no
inline scripts, no outside code, images only from itself, `data:` and `blob:`). Pasted pages and recipes have size
limits and are read in a single pass so broken input cannot freeze the page. The optional link reader refuses every
request until it is locked to your site and never fetches private addresses.

## Publish

Settings > Pages > Deploy from a branch > `main` / `(root)`. The site then lives at
`https://<user>.github.io/<repo>/`.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Page shell |
| `assets/lib.js` | Pure logic: units, conversion, parsing, validation, list merging, share links |
| `assets/app.js` | Screens, storage, timers, cook mode |
| `assets/style.css` | Styles (light and dark, phone first, print) |
| `recipes/` | Shared recipes (`index.json` lists them) |
| `sw.js`, `manifest.webmanifest` | Offline support and installability |
| `worker/` | Optional link reader for Cloudflare Workers (`recipe-reader.js` is generated) |
| `docs/` | Setup guides |
| `tests/`, `tools/` | Tests, the recipe validator and the worker build script |
