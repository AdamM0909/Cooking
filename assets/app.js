// Our Kitchen: built-in recipes come from recipes/*.json (format in RECIPES.md).
// Recipes added in the app are kept in this browser's localStorage.
(function () {
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

  var app = document.getElementById('app');
  var state = { mode: loadPref('mode') || 'cups' };

  function loadPref(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function savePref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'text') n.textContent = v;
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  // ---------- amount formatting and conversion ----------
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

  // Which units each display mode uses.
  var FAMILY = {
    cups:   ['cup', 'tbsp', 'tsp'],
    metric: ['g', 'kg', 'ml', 'l'],
    oz:     ['oz', 'lb', 'fl_oz']
  };

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

  function formatAmount(ing, scale) {
    var c = convert(ing, scale, state.mode);
    var spoons = c.unit === 'cup' || c.unit === 'tbsp' || c.unit === 'tsp' || !c.unit;
    var text = spoons ? fractionString(c.amount) : decimalString(c.amount);
    var label = c.unit === 'cup' && c.amount > 1 ? 'cups' : LABEL[c.unit];
    return c.unit ? text + ' ' + label : text;
  }

  // ---------- parsing typed amounts and pasted ingredient lines ----------
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
    var s = line.replace(/^[\s\-*•]+/, '').trim();
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

  // ---------- recipe validation (also used for imports) ----------
  // Returns { recipe } with only known fields, or { error }.
  function normalize(r) {
    if (!r || typeof r !== 'object') return { error: 'Not a recipe.' };
    var title = typeof r.title === 'string' ? r.title.trim().slice(0, 200) : '';
    if (!title) return { error: 'The recipe needs a title.' };
    var servings = Number(r.base_servings);
    if (!(servings >= 1)) return { error: 'Servings must be 1 or more.' };
    var ings = [], seen = {};
    if (!Array.isArray(r.ingredients) || !r.ingredients.length) return { error: 'Add at least one ingredient.' };
    for (var i = 0; i < r.ingredients.length; i++) {
      var x = r.ingredients[i] || {}, label = 'Ingredient ' + (i + 1);
      var id = /^\d{4}$/.test(x.id) ? x.id : ('000' + (i + 1)).slice(-4);
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
    var steps = [];
    if (!Array.isArray(r.steps) || !r.steps.length) return { error: 'Add at least one step.' };
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
    if (Array.isArray(r.sources)) {
      var src = r.sources.filter(function (s) { return s && /^https?:\/\//i.test(s.url); })
        .map(function (s) { return { title: String(s.title || s.url), url: s.url }; });
      if (src.length) out.sources = src;
    }
    return { recipe: out };
  }

  // ---------- storage for recipes added in the app ----------
  var KEY = 'kitchen.recipes.v1';
  function loadMine() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || '{}');
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
  }
  function saveMine(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }

  function slugify(t) {
    return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'recipe';
  }
  function uniqueSlug(title, taken) {
    var base = slugify(title), s = base, n = 2;
    while (taken[s]) s = base + '-' + n++;
    return s;
  }

  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- timers ----------
  function fmtTime(s) {
    var m = Math.floor(s / 60), r = s % 60;
    return (m >= 60 ? Math.floor(m / 60) + ':' + pad(m % 60) : String(m)) + ':' + pad(r);
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function beep() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator();
      o.connect(ctx.destination);
      o.frequency.value = 880;
      o.start();
      setTimeout(function () { o.stop(); ctx.close(); }, 600);
    } catch (e) { /* audio unavailable */ }
  }

  function timerButton(seconds) {
    var left = seconds, handle = null;
    var b = el('button', { type: 'button', class: 'timer', text: '⏲ ' + fmtTime(seconds) });
    b.addEventListener('click', function () {
      if (handle) { clearInterval(handle); handle = null; left = seconds; b.textContent = '⏲ ' + fmtTime(seconds); b.classList.remove('done'); return; }
      b.classList.remove('done');
      handle = setInterval(function () {
        left -= 1;
        if (left <= 0) {
          clearInterval(handle); handle = null; left = seconds;
          b.textContent = 'Done! (tap to reset)'; b.classList.add('done'); beep();
        } else {
          b.textContent = '⏸ ' + fmtTime(left) + ' (tap to cancel)';
        }
      }, 1000);
      b.textContent = '⏸ ' + fmtTime(left) + ' (tap to cancel)';
    });
    return b;
  }

  // ---------- views ----------
  function fetchJSON(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error(path + ' returned ' + r.status);
      return r.json();
    });
  }

  function loadBuiltIns() {
    return fetchJSON('recipes/index.json').then(function (slugs) {
      return Promise.all(slugs.map(function (s) {
        return fetchJSON('recipes/' + s + '.json').then(function (r) { r.slug = s; return r; });
      }));
    });
  }

  function showList() {
    document.title = 'Our Kitchen';
    app.textContent = 'Loading...';
    loadBuiltIns().catch(function () { return []; }).then(function (built) {
      var mine = loadMine();
      var all = built.map(function (r) { return { r: r, href: '#/r/' + r.slug, tag: r.example ? 'Example' : '' }; });
      Object.keys(mine).forEach(function (slug) {
        all.push({ r: mine[slug], href: '#/u/' + slug, tag: 'Mine' });
      });
      all.sort(function (a, b) { return a.r.title.localeCompare(b.r.title); });

      app.textContent = '';
      app.appendChild(el('h1', { text: 'Recipes' }));
      app.appendChild(el('div', { class: 'toolbar' }, [
        el('a', { class: 'btn primary', href: '#/new', text: '+ Add recipe' }),
        el('a', { class: 'btn', href: '#/backup', text: 'Backup & restore' })
      ]));
      var search = el('input', { type: 'search', placeholder: 'Search recipes or ingredients', 'aria-label': 'Search recipes' });
      var ul = el('ul', { class: 'recipe-list' });
      var empty = el('p', { class: 'muted', text: 'No recipes match.' });
      app.appendChild(search);
      app.appendChild(ul);
      app.appendChild(empty);
      if (Object.keys(mine).length) {
        app.appendChild(el('p', { class: 'muted small', text: 'Recipes marked Mine are stored in this browser on this device. Back them up from Backup & restore.' }));
      }

      function draw() {
        var q = search.value.trim().toLowerCase(), shown = 0;
        ul.textContent = '';
        all.forEach(function (item) {
          var hay = (item.r.title + ' ' + item.r.ingredients.map(function (i) { return i.name; }).join(' ')).toLowerCase();
          if (q && hay.indexOf(q) < 0) return;
          shown++;
          var meta = 'Serves ' + item.r.base_servings + (item.r.credit ? ' · ' + item.r.credit : '');
          var top = el('div', { class: 'title-line' }, [el('span', { text: item.r.title }), item.tag ? el('span', { class: 'badge', text: item.tag }) : null]);
          ul.appendChild(el('li', {}, [el('a', { href: item.href }, [top, el('div', { class: 'meta', text: meta })])]));
        });
        empty.hidden = shown > 0;
        empty.textContent = all.length ? 'No recipes match.' : 'No recipes yet. Add your first one!';
      }
      search.addEventListener('input', draw);
      draw();
    });
  }

  function showRecipe(kind, slug) {
    app.textContent = 'Loading...';
    var load = kind === 'u'
      ? Promise.resolve(loadMine()[slug]).then(function (r) { if (!r) throw new Error('That recipe is not in this browser.'); return r; })
      : fetchJSON('recipes/' + encodeURIComponent(slug) + '.json');
    load.then(function (r) {
      document.title = r.title + ' | Our Kitchen';
      var servings = r.base_servings, checked = {}, wake = null;
      var byId = {};
      r.ingredients.forEach(function (i) { byId[i.id] = i; });

      var out = el('output', { text: String(servings) });
      var minus = el('button', { type: 'button', 'aria-label': 'Fewer servings', text: '−', onclick: function () { servings = Math.max(1, servings - 1); render(); } });
      var plus = el('button', { type: 'button', 'aria-label': 'More servings', text: '+', onclick: function () { servings += 1; render(); } });

      var modeBtns = {};
      [['cups', 'Cups & spoons'], ['metric', 'Grams & ml'], ['oz', 'Ounces']].forEach(function (m) {
        modeBtns[m[0]] = el('button', { type: 'button', text: m[1], onclick: function () { state.mode = m[0]; savePref('mode', m[0]); render(); } });
      });

      var controls = el('div', { class: 'controls' }, [
        el('div', { class: 'stepper' }, [el('span', { text: 'Servings' }), minus, out, plus]),
        el('div', { class: 'segmented' }, Object.keys(modeBtns).map(function (k) { return modeBtns[k]; }))
      ]);

      var ingList = el('ul', { class: 'ingredients' });
      var stepList = el('ol', { class: 'steps' });
      var listOut = el('pre', { class: 'listout', hidden: 'hidden' });

      function shoppingText() {
        var scale = servings / r.base_servings;
        return r.title + ' (serves ' + servings + ')\n' + r.ingredients.map(function (i) {
          return '- ' + formatAmount(i, scale) + ' ' + i.name;
        }).join('\n');
      }

      var toolbar = el('div', { class: 'toolbar' });
      var copyBtn = el('button', { type: 'button', text: 'Copy shopping list', onclick: function () {
        var text = shoppingText();
        function fallback() { listOut.textContent = text; listOut.hidden = false; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { copyBtn.textContent = 'Copied!'; setTimeout(function () { copyBtn.textContent = 'Copy shopping list'; }, 1500); }, fallback);
        } else fallback();
      } });
      toolbar.appendChild(copyBtn);
      if (navigator.wakeLock && navigator.wakeLock.request) {
        var wakeBtn = el('button', { type: 'button', 'aria-pressed': 'false', text: 'Keep screen on', onclick: function () {
          if (wake) { wake.release(); wake = null; wakeBtn.setAttribute('aria-pressed', 'false'); return; }
          navigator.wakeLock.request('screen').then(function (l) {
            wake = l; wakeBtn.setAttribute('aria-pressed', 'true');
            l.addEventListener('release', function () { wake = null; wakeBtn.setAttribute('aria-pressed', 'false'); });
          }, function () { wakeBtn.textContent = 'Screen lock unavailable'; });
        } });
        toolbar.appendChild(wakeBtn);
      }
      toolbar.appendChild(el('button', { type: 'button', text: 'Print', onclick: function () { window.print(); } }));
      toolbar.appendChild(el('button', { type: 'button', text: 'Download JSON', onclick: function () {
        var c = normalize(r); download((kind === 'u' ? slug : slug) + '.json', JSON.stringify(c.recipe || r, null, 2) + '\n');
      } }));
      if (kind === 'u') {
        toolbar.appendChild(el('a', { class: 'btn', href: '#/edit/' + slug, text: 'Edit' }));
        toolbar.appendChild(el('button', { type: 'button', class: 'danger', text: 'Delete', onclick: function () {
          if (!confirm('Delete "' + r.title + '" from this browser? This cannot be undone.')) return;
          var m = loadMine(); delete m[slug]; saveMine(m); location.hash = '#/';
        } }));
      } else {
        toolbar.appendChild(el('button', { type: 'button', text: 'Copy to my recipes', onclick: function () {
          var m = loadMine(), c = normalize(r);
          if (!c.recipe) return;
          var ns = uniqueSlug(r.title, m);
          m[ns] = c.recipe;
          if (!saveMine(m)) { alert('This browser would not let me save. Check that storage is not blocked.'); return; }
          location.hash = '#/edit/' + ns;
        } }));
      }

      function render() {
        var scale = servings / r.base_servings;
        out.textContent = String(servings);
        Object.keys(modeBtns).forEach(function (k) { modeBtns[k].setAttribute('aria-pressed', String(state.mode === k)); });

        ingList.textContent = '';
        r.ingredients.forEach(function (i) {
          var cb = el('input', { type: 'checkbox', checked: checked[i.id], onchange: function () { checked[i.id] = cb.checked; li.classList.toggle('got', cb.checked); } });
          var li = el('li', { class: checked[i.id] ? 'got' : '' }, [
            el('label', {}, [cb, el('span', { class: 'amt', text: formatAmount(i, scale) }), document.createTextNode(' ' + i.name)])
          ]);
          ingList.appendChild(li);
        });

        stepList.textContent = '';
        r.steps.forEach(function (s) {
          var p = el('p', {});
          s.text.split(/\{(\d{4})\}/).forEach(function (part, idx) {
            if (idx % 2 === 0) { if (part) p.appendChild(document.createTextNode(part)); return; }
            var ing = byId[part];
            p.appendChild(ing ? el('span', { class: 'amt', text: formatAmount(ing, scale) })
                              : document.createTextNode('{' + part + '}'));
          });
          var li = el('li', {}, [el('h3', { text: s.title }), p]);
          if (s.timer_seconds) li.appendChild(timerButton(s.timer_seconds));
          stepList.appendChild(li);
        });
        listOut.hidden = true;
      }

      app.textContent = '';
      app.appendChild(el('p', {}, [el('a', { href: '#/', text: '← All recipes' })]));
      app.appendChild(el('h1', { text: r.title }));
      if (r.example) app.appendChild(el('span', { class: 'example-flag', text: 'Example recipe, replace me' }));
      if (r.credit) app.appendChild(el('p', { class: 'muted', text: r.credit }));
      app.appendChild(toolbar);
      app.appendChild(listOut);
      app.appendChild(controls);
      app.appendChild(el('h2', { text: 'Ingredients' }));
      app.appendChild(ingList);
      app.appendChild(el('h2', { text: 'Steps' }));
      app.appendChild(stepList);
      if (r.notes) {
        app.appendChild(el('h2', { text: 'Notes' }));
        app.appendChild(el('p', { class: 'pre-wrap', text: r.notes }));
      }
      if (r.sources && r.sources.length) {
        app.appendChild(el('h2', { text: 'Sources' }));
        var ul = el('ul', {});
        r.sources.forEach(function (src) {
          ul.appendChild(el('li', {}, [el('a', { href: src.url, rel: 'noopener', text: src.title || src.url })]));
        });
        app.appendChild(ul);
      }
      render();
    }).catch(showError);
  }

  // ---------- add / edit form ----------
  function showEditor(slug) {
    var mine = loadMine(), base = slug ? mine[slug] : null;
    if (slug && !base) { showError(new Error('That recipe is not in this browser.')); return; }
    document.title = (slug ? 'Edit recipe' : 'Add recipe') + ' | Our Kitchen';

    var nextId = 1;
    if (base) base.ingredients.forEach(function (i) { nextId = Math.max(nextId, parseInt(i.id, 10) + 1); });

    var title = el('input', { type: 'text', id: 'f-title', value: base ? base.title : '', maxlength: '200', required: 'required' });
    var credit = el('input', { type: 'text', id: 'f-credit', value: base && base.credit ? base.credit : '', placeholder: "e.g. Grandma's" });
    var servings = el('input', { type: 'number', id: 'f-serv', min: '1', step: '1', value: base ? base.base_servings : 4 });
    var source = el('input', { type: 'url', id: 'f-src', value: base && base.sources && base.sources[0] ? base.sources[0].url : '', placeholder: 'https://... (optional)' });
    var notes = el('textarea', { id: 'f-notes', rows: '3', placeholder: 'Storage, make-ahead, swaps...' });
    notes.value = base && base.notes ? base.notes : '';

    var ingBox = el('div', { class: 'rows' });
    var stepBox = el('div', { class: 'rows' });
    var errBox = el('p', { class: 'error', role: 'alert', hidden: 'hidden' });

    function unitSelect(value) {
      var sel = el('select', { 'aria-label': 'Unit' }, [el('option', { value: '', text: '(none)' })]
        .concat(Object.keys(UNITS).map(function (u) { return el('option', { value: u, text: LABEL[u] }); })));
      sel.value = value || '';
      return sel;
    }

    function addIngRow(ing) {
      var id = ing && ing.id ? ing.id : ('000' + nextId++).slice(-4);
      var row = el('div', { class: 'row ing', 'data-id': id });
      var amount = el('input', { type: 'text', inputmode: 'decimal', class: 'amount', 'aria-label': 'Amount', placeholder: '1 1/2', value: ing && ing.amount !== '' && ing.amount != null ? String(ing.amount) : '' });
      var unit = unitSelect(ing && ing.unit);
      var name = el('input', { type: 'text', class: 'name', 'aria-label': 'Ingredient', placeholder: 'all-purpose flour', value: ing ? ing.name : '' });
      var gpc = el('input', { type: 'text', inputmode: 'decimal', class: 'gpc', 'aria-label': 'Grams per cup (optional)', title: 'Grams in one US cup of this ingredient (optional, lets you switch cups to grams)', placeholder: 'g/cup', value: ing && ing.grams_per_cup ? String(ing.grams_per_cup) : '' });
      var rm = el('button', { type: 'button', 'aria-label': 'Remove ingredient', text: '×', onclick: function () { row.remove(); } });
      [amount, unit, name, gpc, rm].forEach(function (c) { row.appendChild(c); });
      ingBox.appendChild(row);
      return row;
    }

    function ingredientOptions() {
      return Array.prototype.map.call(ingBox.querySelectorAll('.row'), function (row) {
        return { id: row.getAttribute('data-id'), name: row.querySelector('.name').value.trim() || '(unnamed)' };
      });
    }

    function addStepRow(st) {
      var row = el('div', { class: 'row step' });
      var stitle = el('input', { type: 'text', class: 'stitle', 'aria-label': 'Step title', placeholder: 'Step title, e.g. Knead', value: st ? st.title : '' });
      var text = el('textarea', { class: 'stext', 'aria-label': 'Step instructions', rows: '3', placeholder: 'What to do. Use "Insert ingredient" to add an amount that scales.' });
      text.value = st ? st.text : '';
      var mins = el('input', { type: 'number', class: 'smins', 'aria-label': 'Timer minutes', min: '0', step: '0.5', placeholder: 'timer min', value: st && st.timer_seconds ? String(st.timer_seconds / 60) : '' });
      var ins = el('select', { 'aria-label': 'Insert ingredient amount' });
      function refill() {
        ins.textContent = '';
        ins.appendChild(el('option', { value: '', text: 'Insert ingredient amount…' }));
        ingredientOptions().forEach(function (o) { ins.appendChild(el('option', { value: o.id, text: o.name })); });
      }
      refill();
      ins.addEventListener('focus', refill);
      ins.addEventListener('mousedown', refill);
      ins.addEventListener('change', function () {
        if (!ins.value) return;
        text.setRangeText('{' + ins.value + '}', text.selectionStart, text.selectionEnd, 'end');
        text.focus(); refill();
      });
      var rm = el('button', { type: 'button', 'aria-label': 'Remove step', text: '×', onclick: function () { row.remove(); } });
      var head = el('div', { class: 'step-head' }, [stitle, mins, rm]);
      row.appendChild(head); row.appendChild(text); row.appendChild(ins);
      stepBox.appendChild(row);
    }

    if (base) {
      base.ingredients.forEach(addIngRow);
      base.steps.forEach(addStepRow);
    } else { addIngRow(); addIngRow(); addStepRow(); }

    var paste = el('textarea', { id: 'f-paste', rows: '5', placeholder: '1 1/2 cups flour\n3 tbsp butter, melted\n1 large egg' });
    var pasteBtn = el('button', { type: 'button', text: 'Add these as ingredients', onclick: function () {
      var added = 0;
      paste.value.split(/\r?\n/).forEach(function (line) {
        var p = parseIngredientLine(line);
        if (!p || !p.name) return;
        addIngRow(p); added++;
      });
      if (added) {
        paste.value = '';
        // drop untouched blank starter rows
        Array.prototype.forEach.call(ingBox.querySelectorAll('.row'), function (row) {
          if (!row.querySelector('.name').value && !row.querySelector('.amount').value) row.remove();
        });
      }
    } });

    function collect() {
      var ingredients = Array.prototype.map.call(ingBox.querySelectorAll('.row'), function (row) {
        var raw = row.querySelector('.amount').value;
        return { id: row.getAttribute('data-id'), name: row.querySelector('.name').value, amount: parseAmount(raw),
                 unit: row.querySelector('select').value, grams_per_cup: row.querySelector('.gpc').value.trim() ? parseAmount(row.querySelector('.gpc').value) : undefined };
      }).filter(function (i) { return i.name.trim() || isFinite(i.amount); });
      var steps = Array.prototype.map.call(stepBox.querySelectorAll('.row'), function (row) {
        var mins = parseFloat(row.querySelector('.smins').value);
        return { title: row.querySelector('.stitle').value, text: row.querySelector('.stext').value, timer_seconds: mins > 0 ? Math.round(mins * 60) : undefined };
      }).filter(function (s) { return s.text.trim() || s.title.trim(); });
      var sources = source.value.trim() ? [{ title: (function () { try { return new URL(source.value.trim()).hostname; } catch (e) { return source.value.trim(); } })(), url: source.value.trim() }] : [];
      return { title: title.value, credit: credit.value, base_servings: Number(servings.value), ingredients: ingredients, steps: steps, notes: notes.value, sources: sources };
    }

    function save() {
      var res = normalize(collect());
      if (!res.recipe) { errBox.textContent = res.error; errBox.hidden = false; errBox.scrollIntoView({ block: 'center' }); return; }
      var m = loadMine(), key = slug || uniqueSlug(res.recipe.title, m);
      m[key] = res.recipe;
      if (!saveMine(m)) {
        errBox.textContent = 'This browser would not save the recipe (storage may be blocked or full). Use Download JSON on a recipe to keep a copy.';
        errBox.hidden = false; return;
      }
      location.hash = '#/u/' + key;
    }

    app.textContent = '';
    app.appendChild(el('p', {}, [el('a', { href: slug ? '#/u/' + slug : '#/', text: '← Cancel' })]));
    app.appendChild(el('h1', { text: slug ? 'Edit recipe' : 'Add a recipe' }));
    var form = el('form', { class: 'editor', novalidate: 'novalidate' }, [
      el('label', { for: 'f-title', text: 'Title' }), title,
      el('label', { for: 'f-credit', text: 'Credit (optional)' }), credit,
      el('label', { for: 'f-serv', text: 'Serves' }), servings,
      el('h2', { text: 'Ingredients' }),
      el('p', { class: 'muted small', text: 'Amounts can be written like 1 1/2, 3/4 or 0.5. Grams per cup is optional: fill it in for dry ingredients to switch exactly between cups, grams and ounces (flour is about 125, sugar 200, butter 227).' }),
      ingBox,
      el('button', { type: 'button', text: '+ Add ingredient', onclick: function () { addIngRow().querySelector('.amount').focus(); } }),
      el('details', {}, [el('summary', { text: 'Paste a list of ingredients' }), paste, pasteBtn]),
      el('h2', { text: 'Steps' }),
      stepBox,
      el('button', { type: 'button', text: '+ Add step', onclick: function () { addStepRow(); } }),
      el('h2', { text: 'Extras' }),
      el('label', { for: 'f-notes', text: 'Notes (optional)' }), notes,
      el('label', { for: 'f-src', text: 'Source link (optional)' }), source,
      errBox,
      el('div', { class: 'toolbar' }, [el('button', { type: 'submit', class: 'primary', text: 'Save recipe' })])
    ]);
    form.addEventListener('submit', function (e) { e.preventDefault(); save(); });
    app.appendChild(form);
    title.focus();
  }

  // ---------- backup and restore ----------
  function showBackup() {
    document.title = 'Backup | Our Kitchen';
    var mine = loadMine(), count = Object.keys(mine).length;
    var msg = el('p', { role: 'status' });
    var file = el('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Backup file' });
    file.addEventListener('change', function () {
      var f = file.files[0]; if (!f) return;
      f.text().then(function (t) {
        var data = JSON.parse(t), list;
        if (Array.isArray(data)) list = data;
        else if (data && data.recipes && typeof data.recipes === 'object') list = Object.keys(data.recipes).map(function (k) { return data.recipes[k]; });
        else if (data && data.title) list = [data];
        else list = Object.keys(data || {}).map(function (k) { return data[k]; });
        var m = loadMine(), ok = 0, bad = 0;
        list.forEach(function (r) {
          var c = normalize(r);
          if (!c.recipe) { bad++; return; }
          m[uniqueSlug(c.recipe.title, m)] = c.recipe; ok++;
        });
        if (ok && !saveMine(m)) throw new Error('Browser storage is blocked or full.');
        msg.textContent = 'Imported ' + ok + ' recipe' + (ok === 1 ? '' : 's') + (bad ? ', skipped ' + bad + ' that were not valid' : '') + '.';
      }).catch(function (e) { msg.textContent = 'Could not import: ' + e.message; });
    });
    app.textContent = '';
    app.appendChild(el('p', {}, [el('a', { href: '#/', text: '← All recipes' })]));
    app.appendChild(el('h1', { text: 'Backup & restore' }));
    app.appendChild(el('p', { text: 'Recipes you add here are stored in this browser on this device only. Clearing site data, or using another phone or computer, will not carry them over. Download a backup now and then, and import it to restore or move them.' }));
    app.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { type: 'button', class: 'primary', text: 'Download all my recipes (' + count + ')', onclick: function () {
        if (!count) { msg.textContent = 'You have not added any recipes yet.'; return; }
        download('our-kitchen-backup.json', JSON.stringify({ version: 1, recipes: loadMine() }, null, 2) + '\n');
      } })
    ]));
    app.appendChild(el('h2', { text: 'Restore' }));
    app.appendChild(el('p', { class: 'muted small', text: 'Choose a backup file, or a single recipe JSON. Recipes are added next to the ones you already have.' }));
    app.appendChild(file);
    app.appendChild(msg);
    app.appendChild(el('h2', { text: 'Share with everyone' }));
    app.appendChild(el('p', { text: 'To make a recipe show up for everyone who visits the site, open it, choose Download JSON, and add the file to the recipes folder in the repository (see RECIPES.md). Or send it to Claude and ask for it to be added.' }));
  }

  function showError(err) {
    app.textContent = '';
    app.appendChild(el('p', { text: 'Could not load that page.' }));
    app.appendChild(el('p', { class: 'muted', text: String(err.message || err) }));
    app.appendChild(el('p', {}, [el('a', { href: '#/', text: 'Back to recipes' })]));
  }

  function route() {
    var h = location.hash, m = /^#\/(r|u|edit)\/([\w-]+)$/.exec(h);
    window.scrollTo(0, 0);
    if (m && m[1] === 'edit') showEditor(m[2]);
    else if (m) showRecipe(m[1], m[2]);
    else if (h === '#/new') showEditor(null);
    else if (h === '#/backup') showBackup();
    else showList();
  }
  window.addEventListener('hashchange', route);
  route();
})();
