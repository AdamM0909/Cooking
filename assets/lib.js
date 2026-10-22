// Pure logic for Our Kitchen: units, conversion, parsing, validation, shopping-list
// merging and share links. No DOM access, so it runs in the browser and under node:test.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KitchenLib = factory();
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Bump with `npm run bump` whenever the site changes: it keeps the page URLs, service worker cache and footer in step.
  var VERSION = '2026.10.22-6';

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
    // Nobody measures a teaspoon of salt in fluid ounces: small volumes stay in spoons.
    if (mode === 'oz' && kind === 'v' && base < 60) mode = 'cups';
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
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', pinch: 'pinch', stick: 'stick', sticks: 'stick'
  };

  var STICK_TBSP = 8; // tablespoons in a US stick of butter

  // "1 1/2 cups flour, sifted" -> { amount: 1.5, unit: 'cup', name: 'flour, sifted' }
  // "1 cup (125 g) flour" also gives grams_per_cup: 125 so the weight is remembered.
  // Loose wording is turned into an amount and flagged in `estimated`: "salt to taste",
  // "splash of hot sauce". "1/2-1 tsp" keeps the lower figure and the range in the name.
  function parseIngredientLine(line) {
    var s = String(line).replace(/^[\s\-*•]+/, '').trim();
    if (!s) return null;
    var sp = /^(?:a\s+)?(splash|drizzle)\s+of\s+(.+)$/i.exec(s);
    if (sp) {
      // Unmeasured by nature: it belongs in the step that uses it, not in the ingredient list.
      var what = tidyName(sp[2].trim());
      return { amount: '', unit: '', name: what, unmeasured: 'a ' + sp[1].toLowerCase() + ' of ' + what };
    }
    var m = /^([\d\s/.¼-¾⅐-⅞-]+)(.*)$/.exec(s);
    var amount = NaN, rest = s, unit = '', rangeText = '';
    if (m) {
      amount = parseAmount(m[1]);
      if (isFinite(amount)) {
        rest = m[2].trim();
        var t = m[1].trim();
        if (!/^\d+-\d+\/\d+$/.test(t) && /\d\s*(?:-|–|to)\s*[\d¼-¾⅐-⅞]/i.test(t)) rangeText = t;
      } else rest = s;
    }
    if (!isFinite(amount)) {
      // "a pinch of salt", "an egg", "a cup of milk", "half a lemon"
      var wordy = /^(a|an|one|half(?: a| an)?)\s+(.+)$/i.exec(s);
      if (wordy && !/^(little|few|bit|couple|splash|handful|drizzle|sprinkle|knob|squeeze|glug|touch|lot|dollop|sprig)\b/i.test(wordy[2])) {
        amount = /^half/i.test(wordy[1]) ? 0.5 : 1; rest = wordy[2];
        var pd = /^(pinch|dash)\s+of\s+/i.exec(rest);
        if (pd) { unit = 'pinch'; rest = rest.slice(pd[0].length); }
      }
    }
    var fl = /^fl\.?\s*oz\.?\s+/i.exec(rest);
    if (unit) { /* already found ("a pinch of") */ }
    else if (fl) { unit = 'fl_oz'; rest = rest.slice(fl[0].length); }
    else {
      var w = /^([a-zA-Z]+)\.?(?:\s+|$)/.exec(rest);
      if (w && UNIT_WORDS[w[1].toLowerCase()] && isFinite(amount)) {
        unit = UNIT_WORDS[w[1].toLowerCase()];
        rest = rest.slice(w[0].length);
      }
    }
    if (unit === 'stick') { unit = 'tbsp'; amount *= STICK_TBSP; }
    rest = rest.replace(/^of\s+/i, '').trim();
    var gpc;
    rest = rest.replace(/\(\s*([\d.]+)\s*(g|grams?|oz|ounces?)\.?\s*\)/i, function (all, n, u) {
      var spoon = unit === 'cup' || unit === 'tbsp' || unit === 'tsp';
      if (spoon && isFinite(amount)) {
        var grams = parseFloat(n) * (/^o/i.test(u) ? UNITS.oz.f : 1), ml = amount * UNITS[unit].f;
        var d = Math.round(grams / ml * UNITS.cup.f);
        if (d >= 20 && d <= 400) gpc = d;
      }
      return '';
    });
    rest = rest.replace(/\(\s*[\d./\s¼-¾⅐-⅞-]+\s*(?:ml|l|g|kg|oz|lb|lbs|cups?|tbsp|tsp|fl\.?\s*oz)\.?\s*\)/gi, '');
    rest = rest.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
    if (rangeText) rest += ' (' + rangeText + (unit ? ' ' + LABEL[unit] : '') + ')';
    rest = tidyName(rest);
    var out = { amount: isFinite(amount) ? amount : '', unit: unit, name: rest };
    if (!isFinite(amount) && /\bto taste\b/i.test(rest)) {
      var base = tidyName(rest.replace(/\s*,?\s*\bto taste\b/i, '').trim());
      out = { amount: 0.25, unit: 'tsp', name: base + ' (to taste)', estimated: base + ' to taste = 1/4 tsp to start' };
    }
    if (gpc) out.grams_per_cup = gpc;
    return out;
  }

  // "Dill pickles" -> "dill pickles", but keep "AP flour" and "Hidden Valley Ranch seasoning".
  function tidyName(n) {
    n = String(n).trim();
    return /^[A-Z][a-z]+(?:\s|$)/.test(n) && !/[A-Z]/.test(n.slice(1).replace(/^[a-z]+/, '')) ? n.charAt(0).toLowerCase() + n.slice(1) : n;
  }

  function cleanGroup(t) {
    t = String(t).replace(/[:\-]+\s*$/, '').replace(/^for\s+(?:the\s+)?/i, '').replace(/\s+/g, ' ').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  // One pasted line can mean several ingredients:
  //   "1 tsp: salt, pepper, paprika"            -> three ingredients at 1 tsp each
  //   "Salt and pepper to taste"                -> two ingredients
  //   "Garlic butter (1/2 stick butter, 2 cloves garlic, parsley)" -> a small group
  //   "Optional: 1/2 tsp msg"                   -> marked (optional)
  function expandIngredientLine(line) {
    var s = String(line).replace(/^[\s\-*•]+/, '').trim(), optional = false, items = [], m;
    if (!s) return items;
    s = s.replace(/^\(?optional\)?\s*[:\-]?\s*/i, function () { optional = true; return ''; });
    function one(text) {
      var q = parseIngredientLine(text);
      if (q && q.name) {
        if (optional) q.name = /\)$/.test(q.name) ? q.name.slice(0, -1) + ', optional)' : q.name + ' (optional)';
        items.push(q);
      }
    }
    m = /^([^()]{2,60}?)\s*\(([^()]*,[^()]*)\)\s*$/.exec(s);
    if (m) {
      var parts = m[2].split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      var counted = parts.filter(function (x) { return /^[\d¼-¾⅐-⅞]/.test(x); }).length;
      if (counted >= 2) {
        var g = cleanGroup(m[1]);
        parts.forEach(one);
        items.forEach(function (q) { if (g) q.group = g; });
        return items;
      }
    }
    var amt = '(?:\\d[\\d\\s/.]*|[\\u00BC-\\u00BE\\u2150-\\u215E])';
    m = new RegExp('^(' + amt + '(?:\\s*(?:-|\\u2013|to)\\s*' + amt + ')?)\\s*([a-zA-Z]+\\.?)?\\s*:\\s*(.+)$', 'i').exec(s);
    if (m) {
      var uw = m[2] ? m[2].replace(/\.$/, '') : '';
      if (!uw || UNIT_WORDS[uw.toLowerCase()]) {
        m[3].split(/\s*,\s*|\s+and\s+/i).forEach(function (n) {
          n = n.trim();
          if (n) one(m[1].trim() + (uw ? ' ' + uw : '') + ' ' + n);
        });
        return items;
      }
    }
    m = /^(.+?)\s*,?\s+to taste$/i.exec(s);
    if (m && !/\d/.test(m[1])) {
      m[1].split(/\s*,\s*|\s+and\s+/i).forEach(function (n) { n = n.trim(); if (n) one(n + ' to taste'); });
      return items;
    }
    one(s);
    return items;
  }

  // Typical grams in one US cup for common dry or solid ingredients, used only when the
  // recipe does not give its own weight. Liquids are left out on purpose (ml suits them).
  var TYPICAL_G_PER_CUP = [
    [/\bpeanut butter\b/i, 258], [/\bcream cheese\b/i, 232], [/\bbrown sugar\b/i, 213],
    [/\b(powdered|confectioners'?|icing) sugar\b/i, 120], [/\bbread flour\b/i, 127], [/\bwhole[- ]wheat flour\b/i, 120],
    [/\balmond flour\b/i, 96], [/\bcornstarch|corn starch\b/i, 128], [/\b(?:flour|ap flour)\b/i, 125],
    [/\bbaking powder\b/i, 230], [/\bbaking soda\b/i, 288],
    [/\bsugar\b/i, 200], [/\bbutter\b/i, 227], [/\bcocoa\b/i, 85], [/\b(?:rolled )?oats\b/i, 90],
    [/\bmayo(?:nnaise)?\b/i, 220], [/\bsour cream\b/i, 230], [/\brice\b/i, 185]
  ];
  function typicalGramsPerCup(name) {
    for (var i = 0; i < TYPICAL_G_PER_CUP.length; i++) if (TYPICAL_G_PER_CUP[i][0].test(name)) return TYPICAL_G_PER_CUP[i][1];
    return 0;
  }

  // 0.3333 -> "1/3", 1.5 -> "1 1/2", 2 -> "2": friendlier to read and edit than raw decimals.
  function amountToInput(x) {
    x = Number(x);
    if (!(x > 0)) return '';
    var whole = Math.floor(x + 1e-9), rest = x - whole, dens = [2, 3, 4, 8];
    if (rest < 0.005) return String(whole);
    for (var i = 0; i < dens.length; i++) {
      var d = dens[i], n = Math.round(rest * d);
      if (n > 0 && n < d && Math.abs(rest - n / d) < 0.005) return (whole ? whole + ' ' : '') + n + '/' + d;
    }
    return String(Math.round(x * 1000) / 1000);
  }

  function pad4(n) { return ('000' + n).slice(-4); }

  function addIngredientLine(out, line, group) {
    var added = 0;
    expandIngredientLine(line).forEach(function (q) {
      if (q.unmeasured) { out.unmeasured.push({ text: q.unmeasured, name: q.name, group: group }); return; }
      q.id = pad4(out.ingredients.length + 1);
      if (!q.group && group) q.group = group;
      out.ingredients.push(q);
      added++;
    });
    return added;
  }

  var ING_HEAD = /^#*\s*ingredients?\s*:?$/i;
  var STEP_HEAD = /^#*\s*(?:instructions?|directions?|method|steps?|preparation|procedure|how to make(?: it)?)\s*:?$/i;
  var NOTE_HEAD = /^#*\s*(?:notes?|tips?)\s*:?$/i;
  var NUMBERED = /^(?:step\s*)?\d+\s*[.):]\s+\S/i;

  // Turns pasted text into form-ready data, sorting each line into the title, an ingredient
  // (under an optional section heading), a step or a note. Works with or without
  // "Ingredients" / "Instructions" headings: bullets, "Dredge:" style headings, numbered lines
  // and plain sentences are all recognised. Anything it cannot place is left for the person.
  function parseRecipeText(text) {
    var out = { title: '', base_servings: '', ingredients: [], unmeasured: [], steps: [], notes: '', headings: false };
    var section = '', group = '', pending = '', sinceHeading = 0, stepTitle = '', noteLines = [];

    function pushStep(t) {
      t = t.replace(BULLET, '').replace(/^(?:step\s*)?\d+\s*[.):]\s*/i, '').trim();
      if (!t) return;
      out.steps.push({ title: stepTitle, text: t });
      stepTitle = '';
    }
    function enterSteps() {
      if (section !== 'step') {
        section = 'step';
        if (pending && sinceHeading === 0) stepTitle = pending; // "Marinate the chicken:" titled the method, not a group
        pending = '';
      }
    }

    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/\s+/g, ' ').trim(), m;
      if (!line || (line.length < 60 && NOISE.test(line))) return;
      if (ING_HEAD.test(line)) { section = 'ing'; out.headings = true; return; }
      if (STEP_HEAD.test(line)) { section = 'step'; out.headings = true; stepTitle = ''; pending = ''; return; }
      if (NOTE_HEAD.test(line)) { section = 'note'; return; }
      if (section !== 'step' && section !== 'note' && (m = /^(?:serves|servings|yield|makes)\s*:?\s*(\d+)/i.exec(line))) {
        if (!out.base_servings) out.base_servings = Number(m[1]);
        return;
      }
      var bullet = BULLET.test(line), numbered = !bullet && NUMBERED.test(line);

      if (!bullet && !numbered && isGroupHeading(line)) {
        if (section === 'step') { stepTitle = cleanGroup(line); return; }
        if (section === 'note') { noteLines.push(line); return; }
        group = cleanGroup(line); pending = group; sinceHeading = 0; section = 'ing';
        return;
      }
      if (section === 'note') { noteLines.push(line); return; }
      if (numbered) { enterSteps(); pushStep(line); return; }
      if (section === 'step') { pushStep(line); return; }

      // before any method: title, then ingredients; a sentence means the method has begun
      if (!out.title && section === '' && !bullet && !ING_START.test(line) && line.length <= 80 && !/[.!?:]$/.test(line)) {
        out.title = line.replace(/^#+\s*/, ''); return;
      }
      var sentence = !bullet && /[.!?]$/.test(line) && line.length >= 20;
      var bulletStep = bullet && (line.length > 100 || (/[.!?]$/.test(line) && line.length > 45));
      if (sentence || bulletStep) {
        if (out.ingredients.length || section === 'ing') { enterSteps(); pushStep(line); }
        return; // otherwise it is intro chatter before the recipe starts
      }
      if (bullet || section === 'ing' || ING_START.test(line)) {
        sinceHeading += addIngredientLine(out, line, group) || 1;
        section = 'ing';
      }
    });
    out.notes = noteLines.join('\n');
    return out;
  }

  // ---------- making sense of pasted text, pages and structured data ----------
  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾',
                   deg: '°', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...' };
  function decodeEntities(str) {
    return String(str).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, function (all, e) {
      if (e.charAt(0) === '#') {
        var code = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : all;
    });
  }

  function htmlToText(html) {
    return decodeEntities(String(html)
      .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|ul|ol|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '))
      .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function isRecipeNode(x) {
    var t = x && x['@type'];
    return !!t && (t === 'Recipe' || (Array.isArray(t) && t.indexOf('Recipe') >= 0));
  }
  function findRecipeNode(x, depth) {
    if (!x || typeof x !== 'object' || (depth || 0) > 6) return null;
    if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) { var f = findRecipeNode(x[i], (depth || 0) + 1); if (f) return f; } return null; }
    if (isRecipeNode(x)) return x;
    return findRecipeNode(x['@graph'], (depth || 0) + 1) || findRecipeNode(x.mainEntity, (depth || 0) + 1);
  }
  // Most recipe sites embed schema.org Recipe data in a JSON-LD script tag.
  function extractJsonLdRecipe(html) {
    var re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, m;
    while ((m = re.exec(String(html)))) {
      try { var f = findRecipeNode(JSON.parse(m[1].trim()), 0); if (f) return f; } catch (e) { /* not valid JSON, try the next block */ }
    }
    return null;
  }

  function firstText(v) {
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (Array.isArray(v)) return firstText(v[0]);
    return firstText(v.text || v.name || '');
  }
  function flattenInstructions(v, out) {
    if (!v) return out;
    if (typeof v === 'string') {
      var parts = decodeEntities(v.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' ')).split(/\r?\n+/);
      if (parts.length === 1 && parts[0].length > 200) parts = parts[0].split(/(?<=[.!?])\s+(?=[A-Z])/);
      parts.forEach(function (t) { t = t.replace(/\s+/g, ' ').trim(); if (t) out.push({ title: '', text: t }); });
    } else if (Array.isArray(v)) v.forEach(function (x) { flattenInstructions(x, out); });
    else if (typeof v === 'object') {
      if (v.itemListElement) flattenInstructions(v.itemListElement, out);
      else flattenInstructions(v.text || v.name, out);
    }
    return out;
  }

  // "bake 25 to 30 minutes" -> 1500 (the lower figure); undefined when no sensible time is found.
  function detectTimer(text) {
    var m = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?)\b/i.exec(text);
    if (!m) return undefined;
    var secs = Math.round(parseFloat(m[1]) * (/^h/i.test(m[2]) ? 3600 : 60));
    return secs >= 60 && secs <= 86400 ? secs : undefined;
  }

  function escapeRe(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Puts {id} in front of the first mention of each ingredient so amounts in the steps scale.
  function autoLinkSteps(ings, steps) {
    var linked = {}, count = 0, lastWords = {}, keyCount = {};
    ings.forEach(function (ing) { var k = nameKey(ing.name), w = k.split(' ').pop(); lastWords[w] = (lastWords[w] || 0) + 1; keyCount[k] = (keyCount[k] || 0) + 1; });
    var out = steps.map(function (st) {
      var text = st.text;
      ings.forEach(function (ing) {
        if (linked[ing.id] || !(Number(ing.amount) > 0)) return;
        var key = nameKey(ing.name);
        // the same or a similar ingredient elsewhere (two "butter"s, "salt" in two sections): ambiguous, leave it
        if (key.length < 3 || keyCount[key] > 1 || lastWords[key.split(' ').pop()] > 1) return;
        var m = null, candidates = [key], last = key.split(' ').pop();
        if (last !== key && last.length >= 4 && lastWords[last] === 1) candidates.push(last);
        for (var c = 0; c < candidates.length && !m; c++) {
          m = new RegExp('\\b(?:(?:all the|all of the|the|your)\\s+)?' + escapeRe(candidates[c]) + 's?\\b', 'i').exec(text);
        }
        if (!m || m.index === 0) return;
        var before = text.slice(0, m.index);
        if (/\b(remaining|rest of|more|extra|additional|reserved|another|other|leftover)\s+(the\s+)?$/i.test(before)) return;
        text = before + '{' + ing.id + '} ' + m[0].replace(/^(?:all the|all of the|the|your)\s+/i, '') + text.slice(m.index + m[0].length);
        linked[ing.id] = true; count++;
      });
      return { title: st.title, text: text };
    });
    return { steps: out, linked: count };
  }

  function looksLikeUrl(text) { return /^https?:\/\/[^\s]+$/i.test(String(text).trim()); }

  function recipeFromJsonLd(node, sourceUrl) {
    var p = { title: decodeEntities(firstText(node.name)).trim(), base_servings: '', ingredients: [], steps: [], notes: '', credit: '', tags: [], sources: [] };
    var y = /\d+/.exec(firstText(node.recipeYield));
    if (y) p.base_servings = Number(y[0]);
    (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : []).forEach(function (line, i) {
      var q = parseIngredientLine(decodeEntities(String(line)));
      if (q && q.name) { q.id = pad4(i + 1); p.ingredients.push(q); }
    });
    p.ingredients.forEach(function (q, i) { q.id = pad4(i + 1); });
    p.steps = flattenInstructions(node.recipeInstructions, []);
    p.notes = decodeEntities(firstText(node.description)).replace(/\s+/g, ' ').trim().slice(0, 600);
    var author = node.author && (Array.isArray(node.author) ? node.author[0] : node.author);
    var an = decodeEntities(firstText(author && typeof author === 'object' ? author.name : author)).trim();
    if (an) p.credit = 'From ' + an;
    var kw = []
      .concat(typeof node.keywords === 'string' ? node.keywords.split(',') : (Array.isArray(node.keywords) ? node.keywords : []))
      .concat(Array.isArray(node.recipeCategory) ? node.recipeCategory : (node.recipeCategory ? [node.recipeCategory] : []));
    kw.forEach(function (k) { k = decodeEntities(String(k)).trim().toLowerCase(); if (k && k.length <= 20 && p.tags.indexOf(k) < 0 && p.tags.length < 4) p.tags.push(k); });
    if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
      var host = sourceUrl.replace(/^https?:\/\//i, '').split('/')[0];
      p.sources.push({ title: host, url: sourceUrl });
    }
    p.how = 'structured';
    return p;
  }

  var NOISE = /^(print( recipe)?|pin( it| recipe)?|share|save( recipe)?|jump to( recipe)?|skip to|rate( this)?|review|reviews?|comments?|leave a (comment|review)|advertisement|ads?|subscribe|sign up|nutrition( facts| information)?|calories|prep(aration)? time|cook time|total time|course|cuisine|author|print|email|facebook|twitter|instagram|tweet|home|menu|search|recipes?|like|reply|\d+(\.\d+)? ?(stars?|ratings?|votes?|reviews?)|\(\d+\))\b.*$/i;
  var ING_START = /^(?:[-*•]\s*)?(?:\d|[¼-¾⅐-⅞]|(?:a|an|one|two|three|half|pinch|dash|handful|splash)\s)/i;
  var BULLET = /^\s*[-*•]\s+/;

  // A line like "Dredge:" or "For the sauce" that names a part of the recipe.
  function isGroupHeading(line) {
    return !BULLET.test(line) && line.length <= 60 && !/\d/.test(line) && (/:$/.test(line) || /^for (?:the )?\S/i.test(line));
  }

  function listNames(names, max) {
    var shown = names.slice(0, max).join(', ');
    return names.length > max ? shown + ' and ' + (names.length - max) + ' more' : shown;
  }

  // Takes whatever was pasted (page source, JSON-LD, a copied page, a recipe typed out) and
  // returns form-ready data plus plain-language notes about what was guessed.
  function smartParse(input, sourceUrl) {
    var text = String(input == null ? '' : input).trim(), p = null, warnings = [];
    if (/ld\+json|"Recipe"/i.test(text)) {
      var node = extractJsonLdRecipe(text);
      if (!node) { try { node = findRecipeNode(JSON.parse(text), 0); } catch (e) { node = null; } }
      if (node) p = recipeFromJsonLd(node, sourceUrl);
    }
    if (!p) {
      if (/<(div|p|li|span|h[1-6]|body|html)\b/i.test(text)) text = htmlToText(text);
      p = parseRecipeText(text);
      p.how = p.headings ? 'headings' : 'guess';
      if (!p.headings && (p.ingredients.length || p.steps.length)) {
        warnings.push('There were no "Ingredients" and "Instructions" headings, so I worked out which lines are ingredients and which are steps. Please check them.');
      }
      p.credit = ''; p.tags = []; p.sources = [];
      if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) p.sources.push({ title: sourceUrl.replace(/^https?:\/\//i, '').split('/')[0], url: sourceUrl });
    }
    p.unmeasured = p.unmeasured || [];

    var groups = [];
    p.ingredients.forEach(function (i) { if (i.group && groups.indexOf(i.group) < 0) groups.push(i.group); });
    if (groups.length) warnings.push('Kept ' + groups.length + ' ingredient section' + (groups.length === 1 ? '' : 's') + ': ' + groups.join(', ') + '.');

    // typical weights for dry ingredients so cups, grams and ounces can switch
    var typical = [];
    p.ingredients.forEach(function (i) {
      if (i.grams_per_cup || !(i.unit === 'cup' || i.unit === 'tbsp' || i.unit === 'tsp')) return;
      var d = typicalGramsPerCup(i.name);
      if (d) { i.grams_per_cup = d; typical.push(i.name.replace(/\s*\(.*$/, '').replace(/,.*$/, '')); }
    });
    if (typical.length) warnings.push('Filled in typical weights per cup for ' + listNames(typical, 4) + ' so cups, grams and ounces can switch. Edit them if yours differ.');

    var linked = autoLinkSteps(p.ingredients, p.steps);
    p.steps = linked.steps;
    var timers = 0;
    p.steps.forEach(function (st) { var t = detectTimer(st.text); if (t) { st.timer_seconds = t; timers++; } });
    if (linked.linked) warnings.push('Linked ' + linked.linked + ' amount' + (linked.linked === 1 ? '' : 's') + ' inside the steps so they scale. Check that they read sensibly.');
    if (timers) warnings.push('Added ' + timers + ' timer' + (timers === 1 ? '' : 's') + ' from the times in the steps. Clear any you do not want.');

    var est = [];
    p.ingredients.forEach(function (i) { if (i.estimated && est.indexOf(i.estimated) < 0) est.push(i.estimated); });
    if (est.length) warnings.push('Estimated amounts for loose wording (change them if you like): ' + est.join('; ') + '.');
    var noAmt = p.ingredients.filter(function (i) { return i.amount === ''; }).map(function (i) { return i.name; });
    if (noAmt.length) warnings.push(noAmt.length + ' ingredient' + (noAmt.length === 1 ? ' has' : 's have') + ' no amount and need one before saving: ' + listNames(noAmt, 5) + '.');
    var withG = p.ingredients.filter(function (i) { return i.grams_per_cup; }).length - typical.length;
    if (withG > 0) warnings.push('Picked up weights for ' + withG + ' ingredient' + (withG === 1 ? '' : 's') + ' from the brackets, so they can switch exactly between cups and grams.');
    if (p.ingredients.length && !p.steps.length) warnings.push('No steps found. Add the method below.');
    if (!p.title) warnings.push('No title found. Give it one above.');
    if (p.ingredients.length && !p.base_servings) warnings.push('It did not say how many it serves. Set the number above.');
    // "a splash of hot sauce" stays out of the ingredient list; it belongs in the step that uses it
    p.unmeasured.forEach(function (u) {
      var re = new RegExp('\\b' + escapeRe(nameKey(u.name)) + 's?\\b', 'i'), at = -1;
      p.steps.forEach(function (st, i) { if (at < 0 && re.test(st.text)) at = i; });
      if (at >= 0) warnings.push('Left "' + u.text + '" out of the ingredient list because step ' + (at + 1) + ' mentions it.');
      else {
        p.notes = (p.notes ? p.notes + '\n' : '') + 'Also: ' + u.text + (u.group ? ' (' + u.group + ')' : '') + '.';
        warnings.push('Left "' + u.text + '" out of the ingredient list. No step mentions it, so I put it in Notes. Add it to the right step.');
      }
    });
    p.warnings = warnings;
    return p;
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
      if (typeof x.group === 'string' && x.group.trim()) ing.group = x.group.trim().slice(0, 60);
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
    if (!Array.isArray(r.steps)) return { error: 'Steps must be a list.' };
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
    VERSION: VERSION, UNITS: UNITS, LABEL: LABEL, FAMILY: FAMILY, fractionString: fractionString, decimalString: decimalString,
    convert: convert, formatAmount: formatAmount, parseAmount: parseAmount, parseIngredientLine: parseIngredientLine,
    parseRecipeText: parseRecipeText, normalize: normalize, slugify: slugify, uniqueSlug: uniqueSlug,
    combineIngredients: combineIngredients, encodeShare: encodeShare, decodeShare: decodeShare, nameKey: nameKey,
    smartParse: smartParse, amountToInput: amountToInput, expandIngredientLine: expandIngredientLine, recipeFromJsonLd: recipeFromJsonLd, extractJsonLdRecipe: extractJsonLdRecipe, htmlToText: htmlToText,
    decodeEntities: decodeEntities, detectTimer: detectTimer, autoLinkSteps: autoLinkSteps, looksLikeUrl: looksLikeUrl
  };
});
