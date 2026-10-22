// Our Kitchen: renders recipes/*.json (format documented in RECIPES.md).
(function () {
  'use strict';

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
      if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  // ---- amount formatting ----
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
    return pick(base, kind, mode);
  }

  function formatAmount(ing, scale) {
    var c = convert(ing, scale, state.mode);
    var spoons = c.unit === 'cup' || c.unit === 'tbsp' || c.unit === 'tsp' || !c.unit;
    var text = spoons ? fractionString(c.amount) : decimalString(c.amount);
    var label = c.unit === 'cup' && c.amount > 1 ? 'cups' : LABEL[c.unit];
    return c.unit ? text + ' ' + label : text;
  }

  // ---- timers ----
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

  // ---- views ----
  function fetchJSON(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error(path + ' returned ' + r.status);
      return r.json();
    });
  }

  function showList() {
    document.title = 'Our Kitchen';
    app.textContent = 'Loading...';
    fetchJSON('recipes/index.json').then(function (slugs) {
      return Promise.all(slugs.map(function (s) {
        return fetchJSON('recipes/' + s + '.json').then(function (r) { r.slug = s; return r; });
      }));
    }).then(function (recipes) {
      app.textContent = '';
      app.appendChild(el('h1', { text: 'Recipes' }));
      if (!recipes.length) { app.appendChild(el('p', { class: 'muted', text: 'No recipes yet.' })); return; }
      var ul = el('ul', { class: 'recipe-list' });
      recipes.forEach(function (r) {
        var meta = 'Serves ' + r.base_servings + (r.credit ? ' · ' + r.credit : '');
        var a = el('a', { href: '#/r/' + r.slug }, [el('div', { text: r.title }), el('div', { class: 'meta', text: meta })]);
        ul.appendChild(el('li', {}, [a]));
      });
      app.appendChild(ul);
    }).catch(showError);
  }

  function showRecipe(slug) {
    app.textContent = 'Loading...';
    fetchJSON('recipes/' + encodeURIComponent(slug) + '.json').then(function (r) {
      document.title = r.title + ' | Our Kitchen';
      var servings = r.base_servings;
      var byId = {};
      r.ingredients.forEach(function (i) { byId[i.id] = i; });

      var out = el('output', { text: String(servings) });
      function stepper(delta) {
        servings = Math.max(1, servings + delta);
        render();
      }
      var minus = el('button', { type: 'button', 'aria-label': 'Fewer servings', text: '−' });
      var plus = el('button', { type: 'button', 'aria-label': 'More servings', text: '+' });
      minus.addEventListener('click', function () { stepper(-1); });
      plus.addEventListener('click', function () { stepper(1); });

      var modeBtns = {};
      [['cups', 'Cups & spoons'], ['metric', 'Grams & ml'], ['oz', 'Ounces']].forEach(function (m) {
        var b = el('button', { type: 'button', text: m[1] });
        b.addEventListener('click', function () { state.mode = m[0]; savePref('mode', m[0]); render(); });
        modeBtns[m[0]] = b;
      });

      var controls = el('div', { class: 'controls' }, [
        el('div', { class: 'stepper' }, [el('span', { text: 'Servings' }), minus, out, plus]),
        el('div', { class: 'segmented' }, Object.keys(modeBtns).map(function (k) { return modeBtns[k]; }))
      ]);

      var ingList = el('ul', { class: 'ingredients' });
      var stepList = el('ol', { class: 'steps' });

      function render() {
        var scale = servings / r.base_servings;
        out.textContent = String(servings);
        Object.keys(modeBtns).forEach(function (k) { modeBtns[k].setAttribute('aria-pressed', String(state.mode === k)); });

        ingList.textContent = '';
        r.ingredients.forEach(function (i) {
          ingList.appendChild(el('li', {}, [
            el('span', { class: 'amt', text: formatAmount(i, scale) }),
            document.createTextNode(' ' + i.name)
          ]));
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
      }

      app.textContent = '';
      app.appendChild(el('p', {}, [el('a', { href: '#/', text: '← All recipes' })]));
      var h = el('h1', { text: r.title });
      app.appendChild(h);
      if (r.example) app.appendChild(el('span', { class: 'example-flag', text: 'Example recipe, replace me' }));
      if (r.credit) app.appendChild(el('p', { class: 'muted', text: r.credit }));
      app.appendChild(controls);
      app.appendChild(el('h2', { text: 'Ingredients' }));
      app.appendChild(ingList);
      app.appendChild(el('h2', { text: 'Steps' }));
      app.appendChild(stepList);
      if (r.notes) {
        app.appendChild(el('h2', { text: 'Notes' }));
        app.appendChild(el('p', { text: r.notes }));
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

  function showError(err) {
    app.textContent = '';
    app.appendChild(el('p', { text: 'Could not load that page.' }));
    app.appendChild(el('p', { class: 'muted', text: String(err.message || err) }));
    app.appendChild(el('p', {}, [el('a', { href: '#/', text: 'Back to recipes' })]));
  }

  function route() {
    var m = /^#\/r\/([\w-]+)$/.exec(location.hash);
    if (m) showRecipe(m[1]); else showList();
  }
  window.addEventListener('hashchange', route);
  route();
})();
