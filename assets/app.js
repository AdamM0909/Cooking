// Our Kitchen: built-in recipes come from recipes/*.json (format in RECIPES.md).
// Recipes, favourites, ratings, notes and the shopping list added in the app are kept
// in this browser's localStorage. Pure logic lives in lib.js.
(function () {
  'use strict';

  var L = window.KitchenLib;
  var UNITS = L.UNITS, LABEL = L.LABEL;
  var app = document.getElementById('app');

  // ---------- small helpers ----------
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
  function clear(n) { n.textContent = ''; return n; }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function fmtTime(s) {
    var m = Math.floor(s / 60), r = s % 60;
    return (m >= 60 ? Math.floor(m / 60) + ':' + pad(m % 60) : String(m)) + ':' + pad(r);
  }

  // ---------- storage ----------
  var KEYS = { recipes: 'kitchen.recipes.v1', meta: 'kitchen.meta.v1', list: 'kitchen.list.v1' };
  function readObj(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
    } catch (e) { return fallback; }
  }
  function writeObj(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function loadPref(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function savePref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  var state = { mode: loadPref('mode') || 'cups' };
  function loadMine() { return readObj(KEYS.recipes, {}); }
  function saveMine(o) { return writeObj(KEYS.recipes, o); }
  function loadMeta() { return readObj(KEYS.meta, {}); }
  function getMeta(ref) { return loadMeta()[ref] || {}; }
  function setMeta(ref, patch) {
    var all = loadMeta(), cur = all[ref] || {};
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    all[ref] = cur;
    return writeObj(KEYS.meta, all);
  }
  function loadList() {
    var l = readObj(KEYS.list, {});
    return { items: Array.isArray(l.items) ? l.items : [], got: l.got && typeof l.got === 'object' ? l.got : {}, extra: Array.isArray(l.extra) ? l.extra : [] };
  }
  function saveList(l) { var ok = writeObj(KEYS.list, l); updateNav(); return ok; }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }

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
  // ref is 'r:slug' (built in) or 'u:slug' (added in the app)
  function loadByRef(ref) {
    var kind = ref.charAt(0), slug = ref.slice(2);
    if (kind === 'u') {
      var r = loadMine()[slug];
      return r ? Promise.resolve(r) : Promise.reject(new Error('That recipe is not in this browser.'));
    }
    return fetchJSON('recipes/' + encodeURIComponent(slug) + '.json');
  }
  function imageOf(r) { return r.photo || r.image || ''; }

  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function copyText(text, onDone, onFail) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(onDone, onFail);
    else onFail();
  }

  // ---------- screen lock ----------
  var wake = null;
  function keepAwake(on) {
    if (!on) { if (wake) { try { wake.release(); } catch (e) { /* gone */ } wake = null; } return Promise.resolve(false); }
    if (wake || !(navigator.wakeLock && navigator.wakeLock.request)) return Promise.resolve(!!wake);
    return navigator.wakeLock.request('screen').then(function (l) {
      wake = l; l.addEventListener('release', function () { if (wake === l) wake = null; });
      return true;
    }, function () { return false; });
  }

  // ---------- timers (shared, survive page changes) ----------
  var timers = [], timerSeq = 0, tick = null, audioCtx = null;
  var timerBar = document.getElementById('timers');

  function beep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.frequency.value = 880; g.gain.value = 0.2;
      o.start(); o.stop(audioCtx.currentTime + 0.6);
    } catch (e) { /* audio unavailable */ }
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) { /* unsupported */ }
  }
  function startTimer(label, seconds) {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* optional */ }
    timers.push({ id: ++timerSeq, label: label, end: Date.now() + seconds * 1000, done: false });
    if (!tick) tick = setInterval(updateTimers, 1000);
    renderTimers();
  }
  function updateTimers() {
    var now = Date.now();
    timers.forEach(function (t) { if (!t.done && now >= t.end) { t.done = true; beep(); } });
    renderTimers();
    if (!timers.length) { clearInterval(tick); tick = null; }
  }
  function renderTimers() {
    clear(timerBar);
    timers.forEach(function (t) {
      var left = Math.max(0, Math.ceil((t.end - Date.now()) / 1000));
      timerBar.appendChild(el('div', { class: 'timer-chip' + (t.done ? ' done' : '') }, [
        el('span', { class: 'tlabel', text: t.label }),
        el('strong', { text: t.done ? 'Done!' : fmtTime(left) }),
        el('button', { type: 'button', 'aria-label': 'Dismiss timer', text: '×', onclick: function () {
          timers = timers.filter(function (x) { return x.id !== t.id; }); renderTimers();
        } })
      ]));
    });
    timerBar.hidden = !timers.length;
  }
  function timerButton(label, seconds) {
    var b = el('button', { type: 'button', class: 'timer', text: '⏲ Start timer ' + fmtTime(seconds) });
    b.addEventListener('click', function () {
      startTimer(label, seconds);
      b.textContent = '✓ Started (' + fmtTime(seconds) + ')';
      setTimeout(function () { b.textContent = '⏲ Start timer ' + fmtTime(seconds); }, 2000);
    });
    return b;
  }

  // ---------- shared pieces ----------
  var MODES = [['cups', 'Cups & spoons'], ['metric', 'Grams & ml'], ['oz', 'Ounces']];

  function modeSwitch(onChange) {
    var btns = {};
    var wrap = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Units' });
    MODES.forEach(function (m) {
      btns[m[0]] = el('button', { type: 'button', text: m[1], onclick: function () { state.mode = m[0]; savePref('mode', m[0]); sync(); onChange(); } });
      wrap.appendChild(btns[m[0]]);
    });
    function sync() { MODES.forEach(function (m) { btns[m[0]].setAttribute('aria-pressed', String(state.mode === m[0])); }); }
    sync();
    return wrap;
  }

  function fmt(ing, scale) { return L.formatAmount(ing, scale, state.mode); }

  function amountSpan(ing, scale) {
    return el('span', { class: 'amt', text: fmt(ing, scale) });
  }

  // Step text with {0001} placeholders -> text plus bold scaled amounts.
  function stepParagraph(step, byId, scale) {
    var p = el('p', {});
    step.text.split(/\{(\d{4})\}/).forEach(function (part, idx) {
      if (idx % 2 === 0) { if (part) p.appendChild(document.createTextNode(part)); return; }
      var ing = byId[part];
      p.appendChild(ing ? amountSpan(ing, scale) : document.createTextNode('{' + part + '}'));
    });
    return p;
  }

  function stepIngredients(step, byId) {
    var seen = {}, out = [];
    (step.text.match(/\{\d{4}\}/g) || []).forEach(function (m) {
      var id = m.slice(1, 5);
      if (!seen[id] && byId[id]) { seen[id] = true; out.push(byId[id]); }
    });
    return out;
  }

  // Lists ingredients with a heading whenever the section changes (marinade, glaze, ...).
  function eachIngredient(ings, addItem, addHeading) {
    var last = '';
    ings.forEach(function (i) {
      var g = i.group || '';
      if (g !== last && (g || last)) addHeading(g || 'Other');
      last = g;
      addItem(i);
    });
  }
  function headingItem(text) { return el('li', { class: 'group-h', text: text }); }

  function eggHint(ing, scale) {
    var a = ing.amount * scale;
    if (ing.unit || !/\begg/i.test(ing.name) || Math.abs(a - Math.round(a)) < 0.05) return null;
    return el('span', { class: 'hint', text: ' (beat an egg and use part of it)' });
  }

  function stars(value, onPick) {
    var wrap = el('div', { class: 'stars', role: 'group', 'aria-label': 'Rating' });
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        wrap.appendChild(el('button', { type: 'button', class: 'star' + (n <= value ? ' on' : ''), 'aria-label': n + ' star' + (n > 1 ? 's' : ''), 'aria-pressed': String(n === value),
          text: n <= value ? '★' : '☆', onclick: function () { onPick(n === value ? 0 : n); } }));
      })(i);
    }
    return wrap;
  }

  function showError(err) {
    clear(app);
    app.appendChild(el('p', { text: 'Could not load that page.' }));
    app.appendChild(el('p', { class: 'muted', text: String(err.message || err) }));
    app.appendChild(el('p', {}, [el('a', { href: '#/', text: 'Back to recipes' })]));
  }

  function updateNav() {
    var n = loadList().items.length, badge = document.getElementById('list-count');
    badge.textContent = String(n); badge.hidden = !n;
    var path = location.hash.split('?')[0];
    var cur = path === '#/list' ? 'list' : path === '#/new' ? 'new' : path === '' || path === '#/' ? 'home' : '';
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) {
      if (a.getAttribute('data-nav') === cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  // ---------- recipe list ----------
  function showList(query) {
    document.title = 'Our Kitchen';
    clear(app).textContent = 'Loading...';
    loadBuiltIns().catch(function () { return []; }).then(function (built) {
      var mine = loadMine(), meta = loadMeta();
      var all = built.map(function (r) { return { r: r, ref: 'r:' + r.slug, tag: r.example ? 'Example' : '' }; });
      Object.keys(mine).forEach(function (slug) { all.push({ r: mine[slug], ref: 'u:' + slug, tag: 'Mine' }); });
      all.forEach(function (it) { it.m = meta[it.ref] || {}; });

      var params = new URLSearchParams(query || '');
      var filter = params.get('tag') || (params.get('fav') ? '__fav' : '');
      var sortKey = loadPref('sort') || 'az';

      var tagSet = {};
      all.forEach(function (it) { (it.r.tags || []).forEach(function (t) { tagSet[t] = true; }); });

      clear(app);
      app.appendChild(el('h1', { text: 'Recipes' }));
      var search = el('input', { type: 'search', placeholder: 'Search recipes or ingredients', 'aria-label': 'Search recipes' });
      var sortSel = el('select', { 'aria-label': 'Sort recipes' }, [
        el('option', { value: 'az', text: 'A to Z' }), el('option', { value: 'rating', text: 'Highest rated' }),
        el('option', { value: 'recent', text: 'Recently cooked' }), el('option', { value: 'most', text: 'Most cooked' })]);
      sortSel.value = sortKey;
      var surprise = el('button', { type: 'button', text: 'Surprise me' });
      app.appendChild(el('div', { class: 'toolbar' }, [
        el('a', { class: 'btn primary', href: '#/new', text: '+ Add recipe' }),
        surprise,
        el('a', { class: 'btn', href: '#/backup', text: 'Backup & restore' })
      ]));
      app.appendChild(search);

      var chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' });
      function chip(label, value) {
        chips.appendChild(el('a', { class: 'chip', href: value ? (value === '__fav' ? '#/?fav=1' : '#/?tag=' + encodeURIComponent(value)) : '#/',
          'aria-current': filter === value ? 'true' : 'false', text: label }));
      }
      chip('All', ''); chip('★ Favorites', '__fav');
      Object.keys(tagSet).sort().forEach(function (t) { chip(t, t); });
      app.appendChild(chips);
      app.appendChild(el('div', { class: 'sortrow' }, [el('label', { for: 'sortsel', class: 'muted small', text: 'Sort ' }), sortSel]));
      sortSel.id = 'sortsel';

      var ul = el('ul', { class: 'recipe-list' });
      var empty = el('p', { class: 'muted' });
      app.appendChild(ul); app.appendChild(empty);
      if (Object.keys(mine).length) {
        app.appendChild(el('p', { class: 'muted small', text: 'Recipes marked Mine are stored in this browser on this device. Back them up from Backup & restore.' }));
      }

      var visible = [];
      function draw() {
        var q = search.value.trim().toLowerCase();
        visible = all.filter(function (it) {
          if (filter === '__fav' && !it.m.fav) return false;
          if (filter && filter !== '__fav' && (it.r.tags || []).indexOf(filter) < 0) return false;
          if (!q) return true;
          var hay = it.r.title + ' ' + (it.r.tags || []).join(' ') + ' ' + it.r.ingredients.map(function (i) { return i.name; }).join(' ');
          return hay.toLowerCase().indexOf(q) >= 0;
        });
        var by = {
          az: function (a, b) { return a.r.title.localeCompare(b.r.title); },
          rating: function (a, b) { return (b.m.rating || 0) - (a.m.rating || 0) || a.r.title.localeCompare(b.r.title); },
          recent: function (a, b) { return (b.m.last || 0) - (a.m.last || 0) || a.r.title.localeCompare(b.r.title); },
          most: function (a, b) { return (b.m.cooked || 0) - (a.m.cooked || 0) || a.r.title.localeCompare(b.r.title); }
        };
        visible.sort(by[sortSel.value] || by.az);
        clear(ul);
        visible.forEach(function (it) {
          var bits = ['Serves ' + it.r.base_servings];
          if (it.r.credit) bits.push(it.r.credit);
          if (it.m.cooked) bits.push('cooked ' + it.m.cooked + '×');
          var head = el('div', { class: 'title-line' }, [
            el('span', { text: (it.m.fav ? '★ ' : '') + it.r.title }),
            it.tag ? el('span', { class: 'badge', text: it.tag }) : null,
            it.m.rating ? el('span', { class: 'rating-mini', 'aria-label': it.m.rating + ' of 5 stars', text: '★'.repeat(it.m.rating) }) : null]);
          var body = el('div', { class: 'item-body' }, [head, el('div', { class: 'meta', text: bits.join(' · ') })]);
          var img = imageOf(it.r);
          var a = el('a', { href: '#/' + it.ref.replace(':', '/') }, [img ? el('img', { class: 'thumb', src: img, alt: '', loading: 'lazy' }) : null, body]);
          ul.appendChild(el('li', {}, [a]));
        });
        empty.hidden = visible.length > 0;
        empty.textContent = all.length ? 'No recipes match.' : 'No recipes yet. Add your first one!';
      }
      search.addEventListener('input', draw);
      sortSel.addEventListener('change', function () { savePref('sort', sortSel.value); draw(); });
      surprise.addEventListener('click', function () {
        if (!visible.length) return;
        location.hash = '#/' + visible[Math.floor(Math.random() * visible.length)].ref.replace(':', '/');
      });
      draw();
    });
  }

  // ---------- recipe page ----------
  function showRecipe(kind, slug) {
    var ref = kind + ':' + slug;
    clear(app).textContent = 'Loading...';
    loadByRef(ref).then(function (r) {
      document.title = r.title + ' | Our Kitchen';
      var servings = r.base_servings, checked = {};
      var byId = {};
      r.ingredients.forEach(function (i) { byId[i.id] = i; });

      var out = el('output', { text: String(servings) });
      var minus = el('button', { type: 'button', 'aria-label': 'Fewer servings', text: '−', onclick: function () { servings = Math.max(1, servings - 1); render(); } });
      var plus = el('button', { type: 'button', 'aria-label': 'More servings', text: '+', onclick: function () { servings += 1; render(); } });
      var controls = el('div', { class: 'controls' }, [
        el('div', { class: 'stepper' }, [el('span', { text: 'Servings' }), minus, out, plus]),
        modeSwitch(function () { render(); })
      ]);

      var ingList = el('ul', { class: 'ingredients' });
      var stepList = el('ol', { class: 'steps' });
      var flash = el('p', { class: 'flash', role: 'status', hidden: 'hidden' });
      var listOut = el('pre', { class: 'listout', hidden: 'hidden' });
      function say(msg) { flash.textContent = msg; flash.hidden = false; setTimeout(function () { flash.hidden = true; }, 2500); }

      function shoppingText() {
        var scale = servings / r.base_servings;
        var lines = [];
        eachIngredient(r.ingredients, function (i) { lines.push('- ' + fmt(i, scale) + ' ' + i.name); }, function (g) { lines.push(g + ':'); });
        return r.title + ' (serves ' + servings + ')\n' + lines.join('\n');
      }

      // header: photo, favourite, rating
      var meta = getMeta(ref);
      var favBtn = el('button', { type: 'button', class: 'fav', 'aria-pressed': String(!!meta.fav), 'aria-label': 'Favorite', text: meta.fav ? '★ Favorite' : '☆ Favorite',
        onclick: function () { meta = getMeta(ref); var v = !meta.fav; setMeta(ref, { fav: v }); favBtn.setAttribute('aria-pressed', String(v)); favBtn.textContent = v ? '★ Favorite' : '☆ Favorite'; } });
      var ratingBox = el('div', { class: 'ratingbox' });
      function drawRating() {
        clear(ratingBox);
        var m = getMeta(ref);
        ratingBox.appendChild(stars(m.rating || 0, function (n) { setMeta(ref, { rating: n }); drawRating(); }));
        var cooked = el('button', { type: 'button', text: 'I cooked this' + (m.cooked ? ' (' + m.cooked + '×)' : ''), onclick: function () {
          var c = getMeta(ref); setMeta(ref, { cooked: (c.cooked || 0) + 1, last: Date.now() }); drawRating(); say('Logged. Nice work!');
        } });
        ratingBox.appendChild(cooked);
      }
      drawRating();

      // main actions
      var cookBtn = el('button', { type: 'button', class: 'primary', text: 'Start cooking', onclick: function () { location.hash = '#/cook/' + kind + '/' + slug + '?s=' + servings; } });
      if (!r.steps.length) { cookBtn.disabled = true; cookBtn.title = 'Add steps to use cook mode'; }
      var listBtn = el('button', { type: 'button', text: 'Add to shopping list', onclick: function () {
        var l = loadList(), ex = l.items.filter(function (x) { return x.ref === ref; })[0];
        if (ex) ex.servings = servings; else l.items.push({ ref: ref, servings: servings });
        saveList(l); say('On your shopping list for ' + servings + '.');
      } });
      var more = el('details', { class: 'more' }, [el('summary', { text: 'More' })]);
      var moreBar = el('div', { class: 'toolbar' });
      more.appendChild(moreBar);
      function add(btn) { moreBar.appendChild(btn); }

      add(el('button', { type: 'button', text: 'Copy ingredient list', onclick: function () {
        var text = shoppingText();
        copyText(text, function () { say('Copied.'); }, function () { listOut.textContent = text; listOut.hidden = false; });
      } }));
      if (navigator.wakeLock && navigator.wakeLock.request) {
        var wakeBtn = el('button', { type: 'button', 'aria-pressed': String(!!wake), text: 'Keep screen on', onclick: function () {
          keepAwake(!wake).then(function () { wakeBtn.setAttribute('aria-pressed', String(!!wake)); });
        } });
        add(wakeBtn);
      }
      add(el('button', { type: 'button', text: 'Print', onclick: function () { window.print(); } }));
      add(el('button', { type: 'button', text: 'Share link', onclick: function () {
        var code = L.encodeShare(r), url = location.href.split('#')[0] + '#/import/' + code;
        if (!code) return;
        if (navigator.share) navigator.share({ title: r.title, url: url }).catch(function () { /* cancelled */ });
        else copyText(url, function () { say('Link copied. Anyone who opens it can save the recipe.'); }, function () { listOut.textContent = url; listOut.hidden = false; });
      } }));
      add(el('button', { type: 'button', text: 'Download JSON', onclick: function () {
        var c = L.normalize(r); download(slug + '.json', JSON.stringify(c.recipe || r, null, 2) + '\n');
      } }));
      function copyToMine(thenEdit) {
        var m = loadMine(), c = L.normalize(r);
        if (!c.recipe) return;
        var ns = L.uniqueSlug(r.title + (kind === 'u' ? ' copy' : ''), m);
        m[ns] = c.recipe;
        if (!saveMine(m)) { alert('This browser would not let me save. Check that storage is not blocked.'); return; }
        location.hash = thenEdit ? '#/edit/' + ns : '#/u/' + ns;
      }
      if (kind === 'u') {
        add(el('a', { class: 'btn', href: '#/edit/' + slug, text: 'Edit' }));
        add(el('button', { type: 'button', text: 'Duplicate', onclick: function () { copyToMine(true); } }));
        add(el('button', { type: 'button', class: 'danger', text: 'Delete', onclick: function () {
          if (!confirm('Delete "' + r.title + '" from this browser? This cannot be undone.')) return;
          var m = loadMine(); delete m[slug]; saveMine(m);
          var l = loadList(); l.items = l.items.filter(function (x) { return x.ref !== ref; }); saveList(l);
          var all = loadMeta(); delete all[ref]; writeObj(KEYS.meta, all);
          location.hash = '#/';
        } }));
      } else {
        add(el('button', { type: 'button', text: 'Copy to my recipes', onclick: function () { copyToMine(true); } }));
      }

      var notesBox = el('textarea', { rows: '3', 'aria-label': 'My notes', placeholder: 'Your own notes: what you changed, how it turned out...' });
      notesBox.value = meta.note || '';
      notesBox.addEventListener('change', function () { setMeta(ref, { note: notesBox.value }); say('Notes saved.'); });

      function render() {
        var scale = servings / r.base_servings;
        out.textContent = String(servings);
        clear(ingList);
        eachIngredient(r.ingredients, function (i) {
          var cb = el('input', { type: 'checkbox', checked: checked[i.id], onchange: function () { checked[i.id] = cb.checked; li.classList.toggle('got', cb.checked); } });
          var li = el('li', { class: checked[i.id] ? 'got' : '' }, [
            el('label', {}, [cb, amountSpan(i, scale), document.createTextNode(' ' + i.name), eggHint(i, scale)])
          ]);
          ingList.appendChild(li);
        }, function (g) { ingList.appendChild(headingItem(g)); });
        clear(stepList);
        r.steps.forEach(function (s) {
          var li = el('li', {}, [el('h3', { text: s.title }), stepParagraph(s, byId, scale)]);
          if (s.timer_seconds) li.appendChild(timerButton(r.title + ': ' + s.title, s.timer_seconds));
          stepList.appendChild(li);
        });
        listOut.hidden = true;
      }

      clear(app);
      app.appendChild(el('p', {}, [el('a', { href: '#/', text: '← All recipes' })]));
      var photo = imageOf(r);
      if (photo) app.appendChild(el('img', { class: 'hero', src: photo, alt: r.title }));
      app.appendChild(el('h1', { text: r.title }));
      if (r.example) app.appendChild(el('span', { class: 'example-flag', text: 'Example recipe, replace me' }));
      if (r.credit) app.appendChild(el('p', { class: 'muted', text: r.credit }));
      if (r.tags && r.tags.length) {
        app.appendChild(el('div', { class: 'chips' }, r.tags.map(function (t) { return el('a', { class: 'chip', href: '#/?tag=' + encodeURIComponent(t), text: t }); })));
      }
      app.appendChild(el('div', { class: 'toolbar' }, [cookBtn, listBtn, favBtn]));
      app.appendChild(ratingBox);
      app.appendChild(more);
      app.appendChild(flash);
      app.appendChild(listOut);
      app.appendChild(controls);
      app.appendChild(el('h2', { text: 'Ingredients' }));
      app.appendChild(ingList);
      app.appendChild(el('h2', { text: 'Steps' }));
      if (r.steps.length) app.appendChild(stepList);
      else app.appendChild(el('p', { class: 'muted' }, [document.createTextNode('No steps yet. '), kind === 'u' ? el('a', { href: '#/edit/' + slug, text: 'Add the method' }) : null]));
      if (r.notes) {
        app.appendChild(el('h2', { text: 'Notes' }));
        app.appendChild(el('p', { class: 'pre-wrap', text: r.notes }));
      }
      app.appendChild(el('h2', { text: 'My notes' }));
      app.appendChild(notesBox);
      if (r.sources && r.sources.length) {
        app.appendChild(el('h2', { text: 'Sources' }));
        var ul = el('ul', {});
        r.sources.forEach(function (src) { ul.appendChild(el('li', {}, [el('a', { href: src.url, rel: 'noopener', text: src.title || src.url })])); });
        app.appendChild(ul);
      }
      render();
    }).catch(showError);
  }

  // ---------- cook mode ----------
  function showCook(kind, slug, query) {
    var ref = kind + ':' + slug;
    clear(app).textContent = 'Loading...';
    loadByRef(ref).then(function (r) {
      document.title = 'Cooking: ' + r.title;
      var s = parseInt(new URLSearchParams(query || '').get('s'), 10);
      var servings = s >= 1 ? s : r.base_servings, scale = servings / r.base_servings;
      var byId = {}; r.ingredients.forEach(function (i) { byId[i.id] = i; });
      var idx = 0, total = r.steps.length;
      if (!total) { clear(app); app.appendChild(el('p', { text: 'This recipe has no steps yet.' })); app.appendChild(el('p', {}, [el('a', { href: '#/' + kind + '/' + slug, text: 'Back to the recipe' })])); return; }
      keepAwake(true);

      var stage = el('div', { class: 'cook-stage' });
      var progress = el('div', { class: 'cook-progress', 'aria-hidden': 'true' });
      var count = el('p', { class: 'muted small cook-count' });
      var prev = el('button', { type: 'button', class: 'big', text: '← Back', onclick: function () { go(-1); } });
      var next = el('button', { type: 'button', class: 'big primary', onclick: function () { go(1); } });

      function go(d) {
        if (idx + d < 0) return;
        if (idx + d >= total) {
          setMeta(ref, { cooked: (getMeta(ref).cooked || 0) + 1, last: Date.now() });
          location.hash = '#/' + kind + '/' + slug; return;
        }
        idx += d; draw(); window.scrollTo(0, 0);
      }

      function draw() {
        var st = r.steps[idx];
        clear(stage);
        stage.appendChild(el('h2', { text: st.title }));
        stage.appendChild(stepParagraph(st, byId, scale));
        var used = stepIngredients(st, byId);
        if (used.length) {
          stage.appendChild(el('ul', { class: 'cook-ings' }, used.map(function (i) {
            return el('li', {}, [amountSpan(i, scale), document.createTextNode(' ' + i.name)]);
          })));
        }
        if (st.timer_seconds) stage.appendChild(timerButton(r.title + ': ' + st.title, st.timer_seconds));
        count.textContent = 'Step ' + (idx + 1) + ' of ' + total;
        clear(progress);
        for (var i = 0; i < total; i++) progress.appendChild(el('span', { class: i <= idx ? 'on' : '' }));
        prev.disabled = idx === 0;
        next.textContent = idx === total - 1 ? 'Finish ✓' : 'Next →';
      }

      function onKey(e) {
        if (location.hash.indexOf('#/cook/') !== 0) { document.removeEventListener('keydown', onKey); return; }
        if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
      }
      document.addEventListener('keydown', onKey);
      var x0 = null;
      stage.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      stage.addEventListener('touchend', function (e) {
        if (x0 === null) return;
        var dx = e.changedTouches[0].clientX - x0; x0 = null;
        if (Math.abs(dx) > 70) go(dx < 0 ? 1 : -1);
      }, { passive: true });

      var ingDetails = el('details', { class: 'cook-all' }, [
        el('summary', { text: 'All ingredients (serves ' + servings + ')' }),
        modeSwitch(function () { draw(); redrawAll(); }),
        el('ul', { class: 'ingredients' })
      ]);
      function redrawAll() {
        var ul = ingDetails.querySelector('ul'); clear(ul);
        eachIngredient(r.ingredients, function (i) { ul.appendChild(el('li', {}, [amountSpan(i, scale), document.createTextNode(' ' + i.name)])); },
          function (g) { ul.appendChild(headingItem(g)); });
      }

      clear(app);
      app.classList.add('cooking');
      app.appendChild(el('div', { class: 'cook-top' }, [el('a', { href: '#/' + kind + '/' + slug, text: '✕ Exit' }), el('strong', { text: r.title })]));
      app.appendChild(progress);
      app.appendChild(count);
      app.appendChild(ingDetails);
      app.appendChild(stage);
      app.appendChild(el('div', { class: 'cook-nav' }, [prev, next]));
      redrawAll(); draw();
    }).catch(showError);
  }

  // ---------- shopping list ----------
  function showShopping() {
    document.title = 'Shopping list | Our Kitchen';
    clear(app).textContent = 'Loading...';
    var list = loadList();
    Promise.all(list.items.map(function (it) {
      return loadByRef(it.ref).then(function (r) { return { ref: it.ref, recipe: r, servings: it.servings }; }, function () { return null; });
    })).then(function (loaded) {
      var entries = loaded.filter(Boolean);
      if (entries.length !== list.items.length) { list.items = list.items.filter(function (it) { return entries.some(function (e) { return e.ref === it.ref; }); }); saveList(list); }

      var box = el('div', {});
      function draw() {
        clear(box);
        var merged = L.combineIngredients(entries.map(function (e) { return { recipe: e.recipe, servings: e.servings }; }));

        box.appendChild(el('h2', { text: 'Recipes on this list' }));
        if (!entries.length) box.appendChild(el('p', { class: 'muted', text: 'No recipes yet. Open a recipe and choose Add to shopping list.' }));
        var rl = el('ul', { class: 'list-recipes' });
        entries.forEach(function (e) {
          rl.appendChild(el('li', {}, [
            el('a', { href: '#/' + e.ref.replace(':', '/'), text: e.recipe.title }),
            el('span', { class: 'stepper' }, [
              el('button', { type: 'button', 'aria-label': 'Fewer servings of ' + e.recipe.title, text: '−', onclick: function () { e.servings = Math.max(1, e.servings - 1); persist(); draw(); } }),
              el('output', { text: e.servings + ' servings' }),
              el('button', { type: 'button', 'aria-label': 'More servings of ' + e.recipe.title, text: '+', onclick: function () { e.servings += 1; persist(); draw(); } }),
              el('button', { type: 'button', 'aria-label': 'Remove ' + e.recipe.title, text: '×', onclick: function () { entries = entries.filter(function (x) { return x !== e; }); persist(); draw(); } })
            ])
          ]));
        });
        box.appendChild(rl);

        box.appendChild(el('h2', { text: 'Shopping' }));
        var ul = el('ul', { class: 'ingredients shop' });
        merged.forEach(function (m) {
          var text = m.items.map(function (it) { return L.formatAmount(it, 1, state.mode); }).join(' + ') + ' ' + m.name;
          var cb = el('input', { type: 'checkbox', checked: list.got[m.key], onchange: function () { list.got[m.key] = cb.checked; saveList(list); li.classList.toggle('got', cb.checked); } });
          var li = el('li', { class: list.got[m.key] ? 'got' : '' }, [el('label', {}, [cb, document.createTextNode(text)])]);
          ul.appendChild(li);
        });
        list.extra.forEach(function (x, i) {
          var key = 'x:' + x;
          var cb = el('input', { type: 'checkbox', checked: list.got[key], onchange: function () { list.got[key] = cb.checked; saveList(list); li.classList.toggle('got', cb.checked); } });
          var li = el('li', { class: list.got[key] ? 'got' : '' }, [
            el('label', {}, [cb, document.createTextNode(x)]),
            el('button', { type: 'button', class: 'x', 'aria-label': 'Remove ' + x, text: '×', onclick: function () { list.extra.splice(i, 1); saveList(list); draw(); } })
          ]);
          ul.appendChild(li);
        });
        if (!merged.length && !list.extra.length) ul.appendChild(el('li', { class: 'muted', text: 'Nothing to buy yet.' }));
        box.appendChild(ul);

        var extra = el('input', { type: 'text', placeholder: 'Add something else (paper towels...)', 'aria-label': 'Add an item' });
        var form = el('form', { class: 'inline-form' }, [extra, el('button', { type: 'submit', text: 'Add' })]);
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var v = extra.value.trim(); if (!v) return;
          list.extra.push(v); saveList(list); draw();
          app.querySelector('input[aria-label="Add an item"]').focus();
        });
        box.appendChild(form);

        var flash = el('p', { class: 'flash', role: 'status', hidden: 'hidden' });
        var out = el('pre', { class: 'listout', hidden: 'hidden' });
        box.appendChild(el('div', { class: 'toolbar' }, [
          el('button', { type: 'button', class: 'primary', text: 'Copy list', onclick: function () {
            var lines = merged.map(function (m) { return '- ' + m.items.map(function (it) { return L.formatAmount(it, 1, state.mode); }).join(' + ') + ' ' + m.name; })
              .concat(list.extra.map(function (x) { return '- ' + x; }));
            var text = 'Shopping list\n' + lines.join('\n');
            copyText(text, function () { flash.textContent = 'Copied.'; flash.hidden = false; }, function () { out.textContent = text; out.hidden = false; });
          } }),
          el('button', { type: 'button', text: 'Untick all', onclick: function () {
            list.got = {}; saveList(list); draw();
          } }),
          el('button', { type: 'button', class: 'danger', text: 'Clear everything', onclick: function () {
            if (!confirm('Empty the whole shopping list?')) return;
            list = { items: [], got: {}, extra: [] }; entries = []; saveList(list); draw();
          } })
        ]));
        box.appendChild(flash); box.appendChild(out);
      }
      function persist() { list.items = entries.map(function (e) { return { ref: e.ref, servings: e.servings }; }); saveList(list); }

      clear(app);
      app.appendChild(el('h1', { text: 'Shopping list' }));
      app.appendChild(el('div', { class: 'controls' }, [modeSwitch(draw)]));
      app.appendChild(box);
      draw();
    });
  }

  // ---------- add / edit form ----------
  function resizePhoto(file) {
    var sizes = [900, 640, 480];
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        for (var i = 0; i < sizes.length; i++) {
          var s = Math.min(1, sizes[i] / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var data = c.toDataURL('image/jpeg', i === 0 ? 0.72 : 0.6);
          if (data.length <= 400000) return resolve(data);
        }
        reject(new Error('That photo is too large to store. Try a smaller one.'));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  function showEditor(slug) {
    var mine = loadMine(), base = slug ? mine[slug] : null;
    if (slug && !base) { showError(new Error('That recipe is not in this browser.')); return; }
    document.title = (slug ? 'Edit recipe' : 'Add recipe') + ' | Our Kitchen';

    var photo = base && base.photo ? base.photo : '';
    var nextId = 1;
    if (base) base.ingredients.forEach(function (i) { nextId = Math.max(nextId, parseInt(i.id, 10) + 1); });

    var title = el('input', { type: 'text', id: 'f-title', value: base ? base.title : '', maxlength: '200' });
    var credit = el('input', { type: 'text', id: 'f-credit', value: base && base.credit ? base.credit : '', placeholder: "e.g. Grandma's" });
    var servings = el('input', { type: 'number', id: 'f-serv', min: '1', step: '1', value: base ? base.base_servings : 4 });
    var tags = el('input', { type: 'text', id: 'f-tags', value: base && base.tags ? base.tags.join(', ') : '', placeholder: 'dinner, quick, vegetarian' });
    var source = el('input', { type: 'url', id: 'f-src', value: base && base.sources && base.sources[0] ? base.sources[0].url : '', placeholder: 'https://... (optional)' });
    var notes = el('textarea', { id: 'f-notes', rows: '3', placeholder: 'Storage, make-ahead, swaps...' });
    notes.value = base && base.notes ? base.notes : '';

    var preview = el('div', { class: 'photo-preview' });
    var fileInput = el('input', { type: 'file', accept: 'image/*', id: 'f-photo' });
    function drawPhoto() {
      clear(preview);
      if (photo) {
        preview.appendChild(el('img', { src: photo, alt: 'Recipe photo preview' }));
        preview.appendChild(el('button', { type: 'button', text: 'Remove photo', onclick: function () { photo = ''; drawPhoto(); } }));
      }
    }
    fileInput.addEventListener('change', function () {
      var f = fileInput.files[0]; if (!f) return;
      resizePhoto(f).then(function (d) { photo = d; errBox.hidden = true; drawPhoto(); }, function (e) { errBox.textContent = e.message; errBox.hidden = false; });
    });
    drawPhoto();

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
      var amount = el('input', { type: 'text', inputmode: 'decimal', class: 'amount', 'aria-label': 'Amount', placeholder: '1 1/2', value: ing && ing.amount !== '' && ing.amount != null ? L.amountToInput(ing.amount) : '' });
      var unit = unitSelect(ing && ing.unit);
      var name = el('input', { type: 'text', class: 'name', 'aria-label': 'Ingredient', placeholder: 'all-purpose flour', value: ing ? ing.name : '' });
      var gpc = el('input', { type: 'text', inputmode: 'decimal', class: 'gpc', 'aria-label': 'Grams per cup (optional)', title: 'Grams in one US cup of this ingredient (optional, lets you switch cups to grams)', placeholder: 'g/cup', value: ing && ing.grams_per_cup ? String(ing.grams_per_cup) : '' });
      var rm = el('button', { type: 'button', 'aria-label': 'Remove ingredient', text: '×', onclick: function () { row.remove(); } });
      var grp = el('input', { type: 'text', class: 'grp', 'aria-label': 'Section (optional)', list: 'f-sections', placeholder: 'Section, e.g. Marinade (optional)', value: ing && ing.group ? ing.group : '' });
      grp.addEventListener('focus', refreshSections);
      [amount, unit, name, gpc, rm, grp].forEach(function (c) { row.appendChild(c); });
      ingBox.appendChild(row);
      return row;
    }

    var sections = el('datalist', { id: 'f-sections' });
    function refreshSections() {
      clear(sections);
      var seen = {};
      Array.prototype.forEach.call(ingBox.querySelectorAll('.grp'), function (g) {
        var v = g.value.trim();
        if (v && !seen[v]) { seen[v] = true; sections.appendChild(el('option', { value: v })); }
      });
    }

    function ingredientOptions() {
      return Array.prototype.map.call(ingBox.querySelectorAll('.row'), function (row) {
        return { id: row.getAttribute('data-id'), name: row.querySelector('.name').value.trim() || '(unnamed)' };
      });
    }

    function addStepRow(st) {
      var row = el('div', { class: 'row step' });
      var stitle = el('input', { type: 'text', class: 'stitle', 'aria-label': 'Step title', placeholder: 'Step title, e.g. Knead', value: st ? st.title : '' });
      var text = el('textarea', { class: 'stext', 'aria-label': 'Step instructions', rows: '3', placeholder: 'What to do. Use "Insert ingredient amount" to add an amount that scales.' });
      text.value = st ? st.text : '';
      var mins = el('input', { type: 'number', class: 'smins', 'aria-label': 'Timer minutes', min: '0', step: '0.5', placeholder: 'timer min', value: st && st.timer_seconds ? String(st.timer_seconds / 60) : '' });
      var ins = el('select', { 'aria-label': 'Insert ingredient amount' });
      function refill() {
        clear(ins);
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
      row.appendChild(el('div', { class: 'step-head' }, [stitle, mins, rm]));
      row.appendChild(text); row.appendChild(ins);
      stepBox.appendChild(row);
    }

    if (base) { base.ingredients.forEach(addIngRow); base.steps.forEach(addStepRow); }
    else { addIngRow(); addIngRow(); addStepRow(); }

    var paste = el('textarea', { id: 'f-paste', rows: '5', placeholder: '1 1/2 cups flour\n3 tbsp butter, melted\n1 large egg' });
    var pasteBtn = el('button', { type: 'button', text: 'Add these as ingredients', onclick: function () {
      var added = 0;
      paste.value.split(/\r?\n/).forEach(function (line) {
        var p = L.parseIngredientLine(line);
        if (!p || !p.name) return;
        addIngRow(p); added++;
      });
      if (added) {
        paste.value = '';
        Array.prototype.forEach.call(ingBox.querySelectorAll('.row'), function (row) {
          if (!row.querySelector('.name').value && !row.querySelector('.amount').value) row.remove();
        });
      }
    } });

    // Paste anything (a link, a copied page, a typed recipe): fills the form for the person to check.
    var READER_DOC = 'https://github.com/AdamM0909/Cooking/blob/main/docs/LINK_IMPORT.md';
    var whole = el('textarea', { id: 'f-whole', rows: '8', placeholder: 'Paste a link, or paste the recipe itself (a whole copied web page is fine).\n\nExample:\nPancakes\nServes 4\nIngredients\n1 1/2 cups flour\n1 egg\nInstructions\n1. Mix everything.\n2. Cook in a hot pan for 3 minutes.' });
    var wholeMsg = el('div', { class: 'muted small', role: 'status' });
    var readerBox = el('input', { type: 'url', id: 'f-reader', placeholder: 'https://your-reader.your-name.workers.dev', value: loadPref('reader') || '' });
    var readerDetails = el('details', { class: 'reader-setup' }, [
      el('summary', { text: 'Reading links: one-time setup' }),
      el('p', { class: 'muted small', text: 'Browsers are not allowed to open other websites directly, so reading a link needs a small free helper that you set up once. Until then, open the recipe page, select all, copy, and paste the text here instead. That works on any site.' }),
      el('p', { class: 'small' }, [el('a', { href: READER_DOC, target: '_blank', rel: 'noopener', text: 'Step-by-step setup (about 5 minutes)' })]),
      el('label', { for: 'f-reader', class: 'small', text: 'Link reader address' }), readerBox,
      el('button', { type: 'button', text: 'Save address', onclick: function () { savePref('reader', readerBox.value.trim()); wholeMsg.textContent = 'Saved. Now paste a link and press Make sense of it.'; } })
    ]);

    function showResult(p, extra) {
      clear(wholeMsg);
      var made = 'Filled in ' + p.ingredients.length + ' ingredient' + (p.ingredients.length === 1 ? '' : 's') + ' and ' + p.steps.length + ' step' + (p.steps.length === 1 ? '' : 's') + '. Check everything below, then save.';
      wholeMsg.appendChild(el('p', { text: made }));
      var notes = (extra || []).concat(p.warnings || []);
      if (notes.length) wholeMsg.appendChild(el('ul', {}, notes.map(function (w) { return el('li', { text: w }); })));
    }

    function applyParsed(p) {
      if (p.title) title.value = p.title;
      if (p.base_servings) servings.value = p.base_servings;
      if (p.notes) notes.value = notes.value ? notes.value + '\n' + p.notes : p.notes;
      if (p.credit && !credit.value) credit.value = p.credit;
      if (p.tags && p.tags.length) {
        var have = tags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
        p.tags.forEach(function (t) { if (have.indexOf(t) < 0) have.push(t); });
        tags.value = have.join(', ');
      }
      if (p.sources && p.sources[0] && !source.value) source.value = p.sources[0].url;
      clear(ingBox); clear(stepBox); nextId = 1;
      p.ingredients.forEach(function (i) { addIngRow(i); nextId = Math.max(nextId, parseInt(i.id, 10) + 1); });
      p.steps.forEach(addStepRow);
      if (!p.ingredients.length) addIngRow();
      if (!p.steps.length) addStepRow();
    }

    var wholeBtn = el('button', { type: 'button', class: 'primary', text: 'Make sense of it', onclick: function () {
      var v = whole.value.trim();
      if (!v) { wholeMsg.textContent = 'Paste a link or the recipe text first.'; return; }
      function done(p, extra) {
        if (!p.ingredients.length && !p.steps.length) {
          wholeMsg.textContent = 'I could not find a recipe in that. Try copying the whole page (select all, copy) or just the ingredients and steps.';
          return;
        }
        applyParsed(p); showResult(p, extra);
        title.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      if (!L.looksLikeUrl(v)) { done(L.smartParse(v)); return; }

      var reader = (loadPref('reader') || '').trim();
      if (!reader) {
        wholeMsg.textContent = 'That is a link. Reading links needs a one-time setup (below). Until then: open the page, select all, copy, and paste the text here instead.';
        readerDetails.open = true; return;
      }
      wholeBtn.disabled = true; wholeMsg.textContent = 'Reading the page\u2026';
      fetch(reader + (reader.indexOf('?') < 0 ? '?' : '&') + 'url=' + encodeURIComponent(v))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || 'The reader could not load that page.');
          done(L.smartParse(d.recipe ? JSON.stringify(d.recipe) : (d.text || ''), d.url || v),
               d.recipe ? [] : ['This page has no structured recipe data, so I worked from its text. Please check it carefully.']);
        })
        .catch(function (e) {
          wholeMsg.textContent = 'Could not read that link (' + (e && e.message ? e.message : 'no answer') + '). Check the reader address below, or open the page, select all, copy, and paste the text here.';
        })
        .then(function () { wholeBtn.disabled = false; });
    } });

    function collect() {
      var ingredients = Array.prototype.map.call(ingBox.querySelectorAll('.row'), function (row) {
        var gp = row.querySelector('.gpc').value.trim();
        return { id: row.getAttribute('data-id'), name: row.querySelector('.name').value, amount: L.parseAmount(row.querySelector('.amount').value),
                 unit: row.querySelector('select').value, grams_per_cup: gp ? L.parseAmount(gp) : undefined, group: row.querySelector('.grp').value };
      }).filter(function (i) { return i.name.trim() || isFinite(i.amount); });
      var steps = Array.prototype.map.call(stepBox.querySelectorAll('.row'), function (row) {
        var mins = parseFloat(row.querySelector('.smins').value);
        return { title: row.querySelector('.stitle').value, text: row.querySelector('.stext').value, timer_seconds: mins > 0 ? Math.round(mins * 60) : undefined };
      }).filter(function (s) { return s.text.trim() || s.title.trim(); });
      var src = source.value.trim();
      var sources = src ? [{ title: (function () { try { return new URL(src).hostname; } catch (e) { return src; } })(), url: src }] : [];
      return { title: title.value, credit: credit.value, base_servings: Number(servings.value), ingredients: ingredients, steps: steps,
               notes: notes.value, sources: sources, tags: tags.value.split(','), photo: photo };
    }

    function save() {
      var res = L.normalize(collect());
      if (!res.recipe) { errBox.textContent = res.error; errBox.hidden = false; errBox.scrollIntoView({ block: 'center' }); return; }
      var m = loadMine(), key = slug || L.uniqueSlug(res.recipe.title, m);
      m[key] = res.recipe;
      if (!saveMine(m)) {
        errBox.textContent = 'This browser would not save the recipe (storage may be blocked or full, photos use a lot). Try removing the photo, or use Download JSON to keep a copy.';
        errBox.hidden = false; return;
      }
      location.hash = '#/u/' + key;
    }

    clear(app);
    app.appendChild(el('p', {}, [el('a', { href: slug ? '#/u/' + slug : '#/', text: '← Cancel' })]));
    app.appendChild(el('h1', { text: slug ? 'Edit recipe' : 'Add a recipe' }));
    var form = el('form', { class: 'editor', novalidate: 'novalidate' }, [
      slug ? null : el('details', { class: 'quick', open: 'open' }, [
        el('summary', { text: 'Quick start: paste a link or a whole recipe' }),
        el('p', { class: 'muted small', text: 'Paste a link, a copied web page, a message, or your own notes. Ingredients and steps are sorted out for you, amounts in the steps are linked so they scale, and times become timers. Nothing is saved until you press Save.' }),
        whole, wholeBtn, wholeMsg, readerDetails]),
      el('label', { for: 'f-title', text: 'Title' }), title,
      el('label', { for: 'f-credit', text: 'Credit (optional)' }), credit,
      el('label', { for: 'f-serv', text: 'Serves' }), servings,
      el('label', { for: 'f-tags', text: 'Tags (optional, separated by commas)' }), tags,
      el('label', { for: 'f-photo', text: 'Photo (optional)' }), fileInput, preview,
      el('h2', { text: 'Ingredients' }),
      el('p', { class: 'muted small', text: 'Amounts can be written like 1 1/2, 3/4 or 0.5. Grams per cup is optional: fill it in for dry ingredients to switch exactly between cups, grams and ounces (flour is about 125, sugar 200, butter 227).' }),
      ingBox, sections,
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

  // ---------- open a shared link ----------
  function showImport(code) {
    var r = L.decodeShare(code);
    if (!r) { showError(new Error('That share link is damaged or not a recipe.')); return; }
    document.title = r.title + ' | Our Kitchen';
    var byId = {}; r.ingredients.forEach(function (i) { byId[i.id] = i; });
    var msg = el('p', { role: 'status' });
    clear(app);
    app.appendChild(el('h1', { text: r.title }));
    app.appendChild(el('p', { class: 'muted', text: 'Someone shared this recipe with you. It is not saved yet.' }));
    app.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { type: 'button', class: 'primary', text: 'Save to my recipes', onclick: function () {
        var m = loadMine(), slug = L.uniqueSlug(r.title, m);
        m[slug] = r;
        if (!saveMine(m)) { msg.textContent = 'This browser would not let me save.'; return; }
        location.hash = '#/u/' + slug;
      } }),
      el('a', { class: 'btn', href: '#/', text: 'No thanks' })
    ]));
    app.appendChild(msg);
    app.appendChild(el('p', { class: 'muted', text: 'Serves ' + r.base_servings + (r.credit ? ' · ' + r.credit : '') }));
    app.appendChild(el('h2', { text: 'Ingredients' }));
    var previewList = el('ul', { class: 'ingredients' });
    eachIngredient(r.ingredients, function (i) { previewList.appendChild(el('li', {}, [amountSpan(i, 1), document.createTextNode(' ' + i.name)])); },
      function (g) { previewList.appendChild(headingItem(g)); });
    app.appendChild(previewList);
    app.appendChild(el('h2', { text: 'Steps' }));
    app.appendChild(el('ol', { class: 'steps' }, r.steps.map(function (s) {
      return el('li', {}, [el('h3', { text: s.title }), stepParagraph(s, byId, 1)]);
    })));
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
        var data = JSON.parse(t), pairs = [], oldMeta = {};
        if (Array.isArray(data)) pairs = data.map(function (r) { return [null, r]; });
        else if (data && data.recipes && typeof data.recipes === 'object') {
          pairs = Object.keys(data.recipes).map(function (k) { return [k, data.recipes[k]]; });
          oldMeta = data.meta && typeof data.meta === 'object' ? data.meta : {};
        } else if (data && data.title) pairs = [[null, data]];
        else pairs = Object.keys(data || {}).map(function (k) { return [k, data[k]]; });
        var m = loadMine(), meta = loadMeta(), ok = 0, bad = 0;
        pairs.forEach(function (p) {
          var c = L.normalize(p[1]);
          if (!c.recipe) { bad++; return; }
          var ns = L.uniqueSlug(c.recipe.title, m);
          m[ns] = c.recipe; ok++;
          if (p[0] && oldMeta['u:' + p[0]]) meta['u:' + ns] = oldMeta['u:' + p[0]];
        });
        Object.keys(oldMeta).forEach(function (k) { if (k.indexOf('r:') === 0 && !meta[k]) meta[k] = oldMeta[k]; });
        if ((ok || Object.keys(oldMeta).length) && !(saveMine(m) && writeObj(KEYS.meta, meta))) throw new Error('Browser storage is blocked or full.');
        msg.textContent = 'Imported ' + ok + ' recipe' + (ok === 1 ? '' : 's') + (bad ? ', skipped ' + bad + ' that were not valid' : '') + '.';
      }).catch(function (e) { msg.textContent = 'Could not import: ' + e.message; });
    });
    clear(app);
    app.appendChild(el('p', {}, [el('a', { href: '#/', text: '← All recipes' })]));
    app.appendChild(el('h1', { text: 'Backup & restore' }));
    app.appendChild(el('p', { text: 'Recipes you add here are stored in this browser on this device only. Clearing site data, or using another phone or computer, will not carry them over. Download a backup now and then, and import it to restore or move them. Backups include your favorites, ratings, cook counts and notes.' }));
    app.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { type: 'button', class: 'primary', text: 'Download all my recipes (' + count + ')', onclick: function () {
        if (!count) { msg.textContent = 'You have not added any recipes yet.'; return; }
        var meta = loadMeta(), keep = {};
        Object.keys(meta).forEach(function (k) { if (k.charAt(0) === 'u' || k.charAt(0) === 'r') keep[k] = meta[k]; });
        download('our-kitchen-backup.json', JSON.stringify({ version: 2, recipes: loadMine(), meta: keep }, null, 2) + '\n');
      } })
    ]));
    app.appendChild(el('h2', { text: 'Restore' }));
    app.appendChild(el('p', { class: 'muted small', text: 'Choose a backup file, or a single recipe JSON. Recipes are added next to the ones you already have.' }));
    app.appendChild(file);
    app.appendChild(msg);
    app.appendChild(el('h2', { text: 'Share with everyone' }));
    app.appendChild(el('p', { text: 'To make a recipe show up for everyone who visits the site, open it, choose More > Download JSON, and add the file to the recipes folder in the repository (see RECIPES.md). To send one to a friend, use More > Share link.' }));
  }

  // ---------- routing ----------
  function route() {
    var h = location.hash.slice(1), qi = h.indexOf('?');
    var path = qi < 0 ? h : h.slice(0, qi), query = qi < 0 ? '' : h.slice(qi + 1), m;
    window.scrollTo(0, 0);
    app.classList.remove('cooking');
    if (!/^\/cook\//.test(path)) keepAwake(false);
    updateNav();
    if ((m = /^\/edit\/([\w-]+)$/.exec(path))) showEditor(m[1]);
    else if ((m = /^\/(r|u)\/([\w-]+)$/.exec(path))) showRecipe(m[1], m[2]);
    else if ((m = /^\/cook\/(r|u)\/([\w-]+)$/.exec(path))) showCook(m[1], m[2], query);
    else if ((m = /^\/import\/([\w-]+)$/.exec(path))) showImport(m[1]);
    else if (path === '/new') showEditor(null);
    else if (path === '/list') showShopping();
    else if (path === '/backup') showBackup();
    else showList(query);
  }
  window.addEventListener('hashchange', route);
  route();

  // Offline support: only where service workers exist (https or localhost).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ }); });
  }
})();
