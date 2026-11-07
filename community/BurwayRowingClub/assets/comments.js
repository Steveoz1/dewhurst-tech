/* Burway V2.0 — editorial margin: toggle, block IDs, comments with status and replies.
   Storage is pluggable. Default = this browser only (localStorage). When the review copy is
   published, assets/comments-config.js sets window.BWC_BACKEND = {load(page), save(page, item), subscribe?(page, cb)}
   and every new comment, status change and reply is saved live for every reviewer. Brief §13. */
(function () {
  'use strict';
  var doc = document, body = doc.body;
  var PAGE = body.getAttribute('data-page') || 'PAGE';
  var seedEl = doc.getElementById('bwc-seed');
  var SEED = [];
  try { SEED = JSON.parse(seedEl ? seedEl.textContent : '[]'); } catch (e) { SEED = []; }

  /* ---------- small storage helpers (never throw) ---------- */
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  var Local = {
    name: 'local',
    load: function (page) { return Promise.resolve(lsGet('bwc:' + page, [])); },
    save: function (page, item) {
      var all = lsGet('bwc:' + page, []);
      var i = all.findIndex(function (x) { return x.id === item.id; });
      if (i > -1) all[i] = item; else all.push(item);
      return Promise.resolve(lsSet('bwc:' + page, all));
    }
  };
  var Store = (window.BWC_BACKEND && typeof window.BWC_BACKEND.load === 'function') ? window.BWC_BACKEND : Local;

  /* ---------- toggle ---------- */
  var on = lsGet('bwc:on', true) !== false;
  function setOn(v) {
    on = v; body.classList.toggle('ed-on', on); body.classList.toggle('ed-off', !on);
    lsSet('bwc:on', on);
    [].forEach.call(doc.querySelectorAll('.ed-toggle input'), function (cb) { cb.checked = on; });
  }
  [].forEach.call(doc.querySelectorAll('.ed-toggle input'), function (cb) {
    cb.addEventListener('change', function () { setOn(cb.checked); });
  });

  /* ---------- block IDs ---------- */
  var formBlock = null;
  [].forEach.call(doc.querySelectorAll('[data-bid]'), function (el) {
    var t = doc.createElement('span');
    t.className = 'bid'; t.textContent = el.getAttribute('data-bid');
    t.title = 'Block ' + t.textContent + ' — click to comment on it';
    t.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      openForm(el.getAttribute('data-bid'));
    });
    el.insertBefore(t, el.firstChild);
  });

  /* ---------- comments ---------- */
  var list = doc.getElementById('bwc-list');
  var LEVEL = { g: 'Info', y: 'Needs review', r: 'Showstopper' };
  var STATUS = { open: 'Open', progress: 'In progress', resolved: 'Resolved' };
  var items = [];
  var showResolved = lsGet('bwc:showres', true) !== false;

  function now() { var d = new Date(); return d.toISOString().slice(0, 16).replace('T', ' '); }
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function nextId() {
    var n = 0;
    items.forEach(function (c) { var m = /-C(\d+)$/.exec(c.id); if (m) n = Math.max(n, +m[1]); });
    return PAGE + '-C' + String(n + 1).padStart(2, '0');
  }

  function merge(seed, stored) {
    var byId = {};
    stored.forEach(function (s) { byId[s.id] = s; });
    var out = seed.map(function (s) {
      var st = byId[s.id]; delete byId[s.id];
      if (!st) return Object.assign({ status: 'open', replies: [] }, s);
      return Object.assign({}, s, { status: st.status || 'open', replies: st.replies || [] });
    });
    Object.keys(byId).forEach(function (k) { if (!byId[k].seed) out.push(byId[k]); });
    return out;
  }

  function render() {
    list.innerHTML = '';
    var counts = { open: 0, progress: 0, resolved: 0 };
    items.forEach(function (c) { counts[c.status || 'open']++; });
    var sum = doc.getElementById('bwc-sum');
    if (sum) sum.textContent = counts.open + ' open · ' + counts.progress + ' in progress · ' + counts.resolved + ' resolved';
    items.forEach(function (c) {
      if (!showResolved && c.status === 'resolved') return;
      var card = el('div', 'cm cm-' + (c.level || 'g') + ' st-' + (c.status || 'open'));
      card.id = 'c-' + c.id;
      var h = el('p', 'cm-h');
      h.appendChild(el('span', 'cm-id', c.id));
      h.appendChild(el('span', 'cm-lv', LEVEL[c.level || 'g']));
      if (c.block) {
        var b = el('a', 'cm-blk', '→ ' + c.block);
        b.href = '#'; b.addEventListener('click', function (e) { e.preventDefault(); flash(c.block); });
        h.appendChild(b);
      }
      card.appendChild(h);
      if (c.title) card.appendChild(el('p', 'cm-t', c.title));
      if (c.html) { var bh = el('p', 'cm-b'); bh.innerHTML = c.html; card.appendChild(bh); }   // authored by the build — trusted
      if (c.text) card.appendChild(el('p', 'cm-b', c.text));                                     // typed by a reviewer — never parsed as HTML
      var meta = el('p', 'cm-m', (c.author || 'Editorial') + (c.date ? ' · ' + c.date : ''));
      card.appendChild(meta);
      var sel = el('select', 'cm-st');
      Object.keys(STATUS).forEach(function (k) { var o = el('option', null, STATUS[k]); o.value = k; if ((c.status || 'open') === k) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () { c.status = sel.value; persist(c); render(); });
      var row = el('div', 'cm-row'); row.appendChild(sel);
      var rb = el('button', 'cm-rbtn', 'Reply'); rb.type = 'button'; row.appendChild(rb);
      card.appendChild(row);
      (c.replies || []).forEach(function (r) {
        var rp = el('div', 'cm-rep');
        rp.appendChild(el('p', 'cm-b', r.text));
        rp.appendChild(el('p', 'cm-m', (r.author || '—') + ' · ' + r.date));
        card.appendChild(rp);
      });
      rb.addEventListener('click', function () {
        if (card.querySelector('.cm-rform')) return;
        var f = el('div', 'cm-rform');
        var ta = el('textarea'); ta.rows = 3; ta.placeholder = 'Reply to ' + c.id + '…';
        var go = el('button', 'bwc-btn', 'Submit reply'); go.type = 'button';
        go.addEventListener('click', function () {
          var t = ta.value.trim(); if (!t) return;
          c.replies = c.replies || [];
          c.replies.push({ id: c.id + '.' + (c.replies.length + 1), text: t, author: who(), date: now() });
          if (c.status === 'resolved') c.status = 'open';
          persist(c); render();
        });
        f.appendChild(ta); f.appendChild(go); card.appendChild(f); ta.focus();
      });
      list.appendChild(card);
    });
  }

  function persist(c) {
    var rec = c.seed ? { id: c.id, status: c.status, replies: c.replies || [], seed: true }
                     : { id: c.id, level: c.level, block: c.block, title: c.title, text: c.text, author: c.author,
                         date: c.date, status: c.status, replies: c.replies || [] };
    Store.save(PAGE, rec).catch(function () { warn('Could not save — check your connection.'); });
  }
  function warn(t) { var w = doc.getElementById('bwc-warn'); if (w) { w.textContent = t; w.hidden = false; } }
  function who() { var n = doc.getElementById('bwc-name'); var v = n && n.value.trim(); if (v) lsSet('bwc:name', v); return v || 'Anonymous'; }

  function flash(bid) {
    var t = doc.querySelector('[data-bid="' + bid + '"]'); if (!t) return;
    t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    t.classList.add('bid-flash'); setTimeout(function () { t.classList.remove('bid-flash'); }, 1600);
  }

  /* ---------- new comment form ---------- */
  var form = doc.getElementById('bwc-form');
  function openForm(bid) {
    if (!on) setOn(true);
    form.hidden = false;
    if (bid) doc.getElementById('bwc-block').value = bid;
    doc.getElementById('bwc-text').focus();
  }
  doc.getElementById('bwc-new').addEventListener('click', function () { form.hidden ? openForm() : (form.hidden = true); });
  doc.getElementById('bwc-name').value = lsGet('bwc:name', '');
  doc.getElementById('bwc-submit').addEventListener('click', function () {
    var t = doc.getElementById('bwc-text').value.trim(); if (!t) return;
    var c = { id: nextId(), level: doc.getElementById('bwc-level').value, block: doc.getElementById('bwc-block').value.trim(),
              title: '', text: t, author: who(), date: now(), status: 'open', replies: [] };
    items.push(c); persist(c);
    doc.getElementById('bwc-text').value = ''; doc.getElementById('bwc-block').value = '';
    form.hidden = true; render();
    var n = doc.getElementById('c-' + c.id); if (n) n.scrollIntoView({ block: 'nearest' });
  });
  var sr = doc.getElementById('bwc-showres');
  sr.checked = showResolved;
  sr.addEventListener('change', function () { showResolved = sr.checked; lsSet('bwc:showres', showResolved); render(); });
  doc.getElementById('bwc-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify({ page: PAGE, exported: now(), comments: items }, null, 1)], { type: 'application/json' });
    var a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'comments-' + PAGE + '.json';
    doc.body.appendChild(a); a.click(); a.remove();
  });
  var mode = doc.getElementById('bwc-mode');
  if (mode) {
    if (Store === Local) { mode.textContent = 'Saved in this browser only — not shared with anyone yet.'; mode.className = 'bwc-mode local'; }
    else { mode.textContent = 'Live — comments are shared with every reviewer.'; mode.className = 'bwc-mode live'; }
  }

  /* ---------- start ---------- */
  setOn(on);
  Store.load(PAGE).then(function (stored) {
    items = merge(SEED.map(function (s) { s.seed = true; return s; }), stored || []);
    render();
    if (Store.subscribe) Store.subscribe(PAGE, function (stored2) { items = merge(SEED.map(function (s) { s.seed = true; return s; }), stored2 || []); render(); });
  }).catch(function () { items = merge(SEED, []); render(); warn('Could not load saved comments.'); });
})();
