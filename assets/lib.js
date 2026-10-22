// Pure logic for Our Kitchen: units, conversion, parsing, validation, shopping-list
// merging and share links. No DOM access, so it runs in the browser and under node:test.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KitchenLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- units ----------
  // Every unit converts through a base of grams (weight) or millilitres (volume).
  var UNITS = {
    g:     { sys: 'metric', kind: 'w', f: 1 },
    kg:    { sys: 'metric', kind: 'w', f: 1000 },
    ml:    { sys: 'metric', kind: 'v', f: 1 },
    l:     { sys: 'metric', kind: 'v', f: 1000 },
    tsp:   { sys: 'us', kind: 'v', f: 4.92892 },
    tbsp:  { sys: 'us', kind: 'v', f: 14.7868 },
    cup:   { sys: 'us', kind: 'v', f: 236.588 },
    fl_oz: { sys: 'us', kind: 'v', f: 29.5735 },
    oz:    { sys: 'us', kind: 'w', f: 28.3495 },
    lb:    { sys: 'us', kind: 'w', f: 453.592 },
    pinch: { sys: 'both', kind: 'c', f: 1 }
  };
  var LABEL = { g: 'g', kg: 'kg', ml: 'ml', l: 'l', tsp: 'tsp', tbsp: 'tbsp', cup: 'cup', fl_oz: 'fl oz', oz: 'oz', lb: 'lb', pinch: 'pinch' };

  // Which units each display mode uses.
  var FAMILY = {
    cups:   ['cup', 'tbsp', 'tsp'],
    metric: ['g', 'kg', 'ml', 'l'],
    oz:     ['oz', 'lb', 'fl_oz']
  };

  // ---------- formatting and conversion ----------
  var FRACS = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
               [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];

  function fractionString(x) {
    var whole = Math.floor(x), rest = x - whole, best = FRACS[0], bestD = Infinity;
    FRACS.forEach(function (f) {
      var d = Math.abs(rest - f[0]);
      if (d < bestD) { bestD = d; best = f; }
    });
    if (best[0] === 1) { whole += 1; best = FRACS[0]; }
    if (whole === 0 && best[0] === 0) return '⅛'; // never show 0 for a real amount
    return (whole ? String(whole) : '') + (whole && best[1] ? ' ' : '') + best[1];
  }

  function decimalString(x) {
    if (x >= 10) return String(Math.round(x));
    return String(Math.round(x * 10) / 10);
  }

  // base is grams (kind 'w') or millilitres (kind 'v'); pick a sensible unit in the mode.
  function pick(base, kind, mode) {
    if (mode === 'metric') {
      if (kind === 'w') return base >= 1000 ? { amount: base / 1000, unit: 'kg' } : { amount: base, unit: 'g' };
      return base >= 1000 ? { amount: base / 1000, unit: 'l' } : { amount: base, unit: 'ml' };
    }
    if (mode === 'oz' || kind === 'w') {
      if (kind === 'w') return base >= UNITS.lb.f ? { amount: base / UNITS.lb.f, unit: 'lb' } : { amount: base / UNITS.oz.f, unit: 'oz' };
      return { amount: base / UNITS.fl_oz.f, unit: 'fl_oz' };
    }
    if (base >= UNITS.cup.f / 3 - 0.5) return { amount: base / UNITS.cup.f, unit: 'cup' };
    if (base >= 14) return { amount: base / UNITS.tbsp.f, unit: 'tbsp' };
    return { amount: base / UNITS.tsp.f, unit: 'tsp' };
  }

  // Ingredients with grams_per_cup convert between volume and weight exactly.
  // At the written serving size, a unit already in the chosen mode is shown as written.
  function convert(ing, scale, mode) {
    var amount = ing.amount * scale, u = ing.unit && UNITS[ing.unit];
    if (!u || u.sys === 'both') return { amount: amount, unit: ing.unit || '' };
    if (scale === 1 && FAMILY[mode].indexOf(ing.unit) >= 0) return { amount: amount, unit: ing.unit };
    var kind = u.kind, base = amount * u.f, d = ing.grams_per_cup;
    if (d) {
      var grams = kind === 'w' ? base : base * d / UNITS.cup.f;
      if (mode === 'cups') { kind = 'v'; base = grams * UNITS.cup.f / d; } else { kind = 'w'; base = grams; }
    }
    // Weights with no cup equivalent keep the family they were written in.
    if (mode === 'cups' && kind === 'w') mode = u.sys === 'metric' ? 'metric' : 'oz';
    return pick(base, kind, mode);
  }

  function formatAmount(ing, scale, mode) {
    var c = convert(ing, scale, mode);
    var spoons = c.unit === 'cup' || c.unit === 'tbsp' || c.unit === 'tsp' || !c.unit;
    var text = spoons ? fractionString(c.amount) : decimalString(c.amount);
    var label = c.unit === 'cup' && c.amount > 1 ? 'cups' : LABEL[c.unit];
    return c.unit ? text + ' ' + label : text;
  }

  // ---------- parsing typed amounts and pasted lines ----------
  var VULGAR = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
                 '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

  // "1 1/2", "3/4", "1.5", "1½", "1-2" (lower end) -> number, or NaN.
  function parseAmount(str) {
    var s = String(str == null ? '' : str).trim().toLowerCase();
    if (!s) return NaN;
    s = s.replace(/[¼-¾⅓⅔⅛-⅞]/g, function (c) { return ' ' + VULGAR[c] + ' '; });
    s = s.replace(/^(\d+)-(\d+\/\d+)$/, '$1 $2');
    s = s.split(/\s*(?:-|–|to)\s*/)[0].trim();
    var total = 0, tokens = s.split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i], v;
      if (t.indexOf('/') > 0) {
        var p = t.split('/');
        v = parseFloat(p[0]) / parseFloat(p[1]);
      } else v = Number(t);
      if (!isFinite(v)) return NaN;
      total += v;
    }
    return total > 0 ? total : NaN;
  }

  var UNIT_WORDS = {
    cup: 'cup', cups: 'cup', c: 'cup', tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
    tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilogram: 'kg',
    kilograms: 'kg', ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
    l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l', oz: 'oz', ounce: 'oz', ounces: 'oz',
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', pinch: 'pinch'
  };

  // "1 1/2 cups flour, sifted" -> { amount: 1.5, unit: 'cup', name: 'flour, sifted' }
  function parseIngredientLine(line) {
    var s = String(line).replace(/^[\s\-*•]+/, '').trim();
    if (!s) return null;
    var m = /^([\d\s/.¼-¾⅐-⅞-]+)(.*)$/.exec(s);
    var amount = NaN, rest = s;
    if (m) {
      amount = parseAmount(m[1]);
      if (isFinite(amount)) rest = m[2].trim(); else rest = s;
    }
    var unit = '';
    var fl = /^fl\.?\s*oz\.?\s+/i.exec(rest);
    if (fl) { unit = 'fl_oz'; rest = rest.slice(fl[0].length); }
    else {
      var w = /^([a-zA-Z]+)\.?(?:\s+|$)/.exec(rest);
      if (w && UNIT_WORDS[w[1].toLowerCase()] && isFinite(amount)) {
        unit = UNIT_WORDS[w[1].toLowerCase()];
        rest = rest.slice(w[0].length);
      }
    }
    rest = rest.replace(/^of\s+/i, '').trim();
    return { amount: isFinite(amount) ? amount : '', unit: unit, name: rest };
  }

  function pad4(n) { return ('000' + n).slice(-4); }

  // Turns a pasted recipe (title, then "Ingredients" and "Instructions" sections) into
  // form-ready data. Anything it cannot place is left for the person to fix by hand.
  function parseRecipeText(text) {
    var out = { title: '', base_servings: '', ingredients: [], steps: [], notes: '' };
    var section = '', n = 1, noteLines = [];
    var ingH = /^#*\s*ingredients?\s*:?$/i;
    var stepH = /^#*\s*(instructions?|directions?|method|steps?|preparation|procedure)\s*:?$/i;
    var noteH = /^#*\s*(notes?|tips?)\s*:?$/i;
    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim(), m;
      if (!line) return;
      if (ingH.test(line)) { section = 'ing'; return; }
      if (stepH.test(line)) { section = 'step'; return; }
      if (noteH.test(line)) { section = 'note'; return; }
      if (section !== 'step' && (m = /^(?:serves|servings|yield|makes)\s*:?\s*(\d+)/i.exec(line))) {
        if (!out.base_servings) out.base_servings = Number(m[1]);
        return;
      }
      if (!section) { if (!out.title) out.title = line.replace(/^#+\s*/, ''); return; }
      if (section === 'ing') {
        if (/:$/.test(line)) return; // sub-heading such as "For the sauce:"
        var p = parseIngredientLine(line);
        if (p && p.name) { p.id = pad4(n++); out.ingredients.push(p); }
      } else if (section === 'step') {
        var t = line.replace(/^(?:step\s*)?\d+\s*[.):-]\s*/i, '');
        if (t) out.steps.push({ title: '', text: t });
      } else noteLines.push(line);
    });
    out.notes = noteLines.join('\n');
    return out;
  }

  // ---------- validation ----------
  // Returns { recipe } containing only known fields, or { error }.
  function normalize(r) {
    if (!r || typeof r !== 'object') return { error: 'Not a recipe.' };
    var title = typeof r.title === 'string' ? r.title.trim().slice(0, 200) : '';
    if (!title) return { error: 'The recipe needs a title.' };
    var servings = Number(r.base_servings);
    if (!(servings >= 1)) return { error: 'Servings must be 1 or more.' };
    if (!Array.isArray(r.ingredients) || !r.ingredients.length) return { error: 'Add at least one ingredient.' };
    var ings = [], seen = {};
    for (var i = 0; i < r.ingredients.length; i++) {
      var x = r.ingredients[i] || {}, label = 'Ingredient ' + (i + 1);
      var id = /^\d{4}$/.test(x.id) ? x.id : pad4(i + 1);
      if (seen[id]) return { error: label + ' has a duplicate id.' };
      seen[id] = true;
      var name = typeof x.name === 'string' ? x.name.trim() : '';
      if (!name) return { error: label + ' needs a name.' };
      var amount = Number(x.amount);
      if (!(amount > 0)) return { error: label + ' (' + name + ') needs an amount above 0.' };
      var ing = { id: id, name: name, amount: amount };
      if (x.unit) {
        if (!UNITS[x.unit]) return { error: label + ' (' + name + ') has an unknown unit.' };
        ing.unit = x.unit;
      }
      if (x.grams_per_cup !== undefined && x.grams_per_cup !== '' && x.grams_per_cup !== null) {
        var g = Number(x.grams_per_cup);
        if (!(g > 0)) return { error: label + ' (' + name + '): grams per cup must be above 0.' };
        ing.grams_per_cup = g;
      }
      ings.push(ing);
    }
    if (!Array.isArray(r.steps) || !r.steps.length) return { error: 'Add at least one step.' };
    var steps = [];
    for (var j = 0; j < r.steps.length; j++) {
      var st = r.steps[j] || {}, text = typeof st.text === 'string' ? st.text.trim() : '';
      var stitle = typeof st.title === 'string' && st.title.trim() ? st.title.trim() : 'Step ' + (j + 1);
      if (!text) return { error: 'Step ' + (j + 1) + ' needs some text.' };
      var refs = text.match(/\{\d{4}\}/g) || [];
      for (var k = 0; k < refs.length; k++) {
        if (!seen[refs[k].slice(1, 5)]) return { error: 'Step ' + (j + 1) + ' uses an ingredient that was removed.' };
      }
      var step = { title: stitle, text: text };
      if (Number(st.timer_seconds) > 0) step.timer_seconds = Math.round(Number(st.timer_seconds));
      steps.push(step);
    }
    var out = { title: title, base_servings: servings, ingredients: ings, steps: steps };
    if (typeof r.credit === 'string' && r.credit.trim()) out.credit = r.credit.trim();
    if (typeof r.notes === 'string' && r.notes.trim()) out.notes = r.notes.trim();
    if (Array.isArray(r.tags)) {
      var tags = [];
      r.tags.forEach(function (t) {
        t = typeof t === 'string' ? t.trim().toLowerCase().slice(0, 30) : '';
        if (t && tags.indexOf(t) < 0 && tags.length < 8) tags.push(t);
      });
      if (tags.length) out.tags = tags;
    }
    if (Array.isArray(r.sources)) {
      var src = r.sources.filter(function (s) { return s && /^https?:\/\//i.test(s.url); })
        .map(function (s) { return { title: String(s.title || s.url), url: s.url }; });
      if (src.length) out.sources = src;
    }
    // Photos: a small embedded JPEG/PNG/WebP, or a relative path to a file in the repo.
    if (typeof r.photo === 'string' && r.photo.length <= 600000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.photo)) out.photo = r.photo;
    if (typeof r.image === 'string' && /^[\w][\w./-]*$/.test(r.image) && r.image.indexOf('..') < 0) out.image = r.image;
    return { recipe: out };
  }

  // ---------- slugs ----------
  function slugify(t) {
    return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'recipe';
  }
  function uniqueSlug(title, taken) {
    var base = slugify(title), s = base, n = 2;
    while (taken[s]) s = base + '-' + n++;
    return s;
  }

  // ---------- shopping list ----------
  // Same ingredient written slightly differently ("all-purpose flour", "large egg") shares a key.
  function nameKey(name) {
    var k = String(name).toLowerCase().replace(/\([^)]*\)/g, '').split(',')[0]
      .replace(/\b(all[- ]purpose|plain|large|medium|small|fresh)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return k || String(name).toLowerCase().trim();
  }
  function displayName(name) {
    return String(name).replace(/\([^)]*\)/g, '').split(',')[0].replace(/\s+/g, ' ').trim();
  }

  // entries: [{ recipe, servings }]. Same ingredient across recipes is summed. With a known
  // grams_per_cup, volumes are folded into weight; otherwise volume and weight stay separate.
  function combineIngredients(entries) {
    var map = {}, order = [];
    entries.forEach(function (e) {
      var scale = e.servings / e.recipe.base_servings;
      e.recipe.ingredients.forEach(function (ing) {
        var key = nameKey(ing.name), u = ing.unit && UNITS[ing.unit];
        var g = map[key];
        if (!g) { g = map[key] = { key: key, name: displayName(ing.name), g: 0, ml: 0, count: 0, pinch: 0, density: 0 }; order.push(key); }
        var amt = ing.amount * scale;
        if (!u) g.count += amt;
        else if (u.kind === 'c') g.pinch += amt;
        else if (u.kind === 'w') g.g += amt * u.f;
        else g.ml += amt * u.f;
        if (ing.grams_per_cup && !g.density) g.density = ing.grams_per_cup;
      });
    });
    return order.map(function (k) {
      var g = map[k], items = [], grams = g.g, ml = g.ml;
      if (g.density && ml > 0) { grams += ml * g.density / UNITS.cup.f; ml = 0; }
      if (grams > 0) items.push({ amount: grams, unit: 'g', grams_per_cup: g.density || undefined });
      if (ml > 0) items.push({ amount: ml, unit: 'ml' });
      if (g.count > 0) items.push({ amount: Math.ceil(g.count - 1e-9), unit: '' });
      if (g.pinch > 0) items.push({ amount: g.pinch, unit: 'pinch' });
      return { key: g.key, name: g.name, items: items };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // ---------- share links ----------
  function encodeShare(recipe) {
    var c = normalize(recipe);
    if (!c.recipe) return '';
    delete c.recipe.photo; // keep links short
    var bytes = new TextEncoder().encode(JSON.stringify(c.recipe)), bin = '';
    for (var i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeShare(str) {
    try {
      var b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var c = normalize(JSON.parse(new TextDecoder().decode(bytes)));
      return c.recipe || null;
    } catch (e) { return null; }
  }

  return {
    UNITS: UNITS, LABEL: LABEL, FAMILY: FAMILY, fractionString: fractionString, decimalString: decimalString,
    convert: convert, formatAmount: formatAmount, parseAmount: parseAmount, parseIngredientLine: parseIngredientLine,
    parseRecipeText: parseRecipeText, normalize: normalize, slugify: slugify, uniqueSlug: uniqueSlug,
    combineIngredients: combineIngredients, encodeShare: encodeShare, decodeShare: decodeShare, nameKey: nameKey
  };
});
