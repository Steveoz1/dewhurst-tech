/* Burway V2.0 REVIEW COPY — live margin comments, saved in Firestore (BURWEB, brief V00.05 §13, DL-519).
   Store: the existing Firebase project burway-sbh-2026 (the Race Timer's), collection "bwcReview" — one document per comment,
   id "<PAGE>__<PAGE>-Cnn". Reviewers sign in with the shared admin login (DL-520) before they can read or post others' comments.
   Editorial (Claude) comments built into each page show without signing in.

   ── WEBSITE fills in the four values below from the Race Timer's own Firebase config (they are public by design; the
      protection is the security rules and the browser-key restriction to dewhurst.tech). Nothing else needs changing. ── */
window.BWC_REVIEW = {
  firebase: {
    apiKey:     'AIzaSyBHYqZ0HfdZiXoYTfw_s1zN_EyEHGo2Opo',   // same as the Race Timer (filled by WEBSITE, 7 Nov 2026)
    authDomain: 'burway-sbh-2026.firebaseapp.com',
    projectId:  'burway-sbh-2026',
    appId:      '1:928608538460:web:376cd82532fd84aa493b99'  // same as the Race Timer (filled by WEBSITE, 7 Nov 2026)
  },
  collection:    'bwcReview',
  reviewerEmail: 'sbh-admin@dewhurst.tech',  // reviewers use the Race Timer admin login for now (Steve, DL-520); they type only the password
  sdk:           'https://www.gstatic.com/firebasejs/10.14.1/'
};

(function () {
  'use strict';
  var CFG = window.BWC_REVIEW, doc = document;
  if (!CFG || !CFG.firebase || !CFG.firebase.apiKey) {           // not connected yet: say so plainly, fall back to this browser
    doc.addEventListener('DOMContentLoaded', function () {
      var w = doc.getElementById('bwc-warn');
      if (w) { w.textContent = 'Live comments are not connected yet — anything you add stays in this browser only.'; w.hidden = false; }
    });
    window.BWC_BACKEND = null;
    return;
  }

  var COL = CFG.collection, X = null, user = null, waiters = [], authKnown = false, authWaiters = [];
  function boot() {
    if (X) return X;
    X = Promise.all([import(CFG.sdk + 'firebase-app.js'), import(CFG.sdk + 'firebase-auth.js'), import(CFG.sdk + 'firebase-firestore.js')])
      .then(function (m) {
        var app = m[0].initializeApp(CFG.firebase, 'bwc-review');
        var x = { A: m[1], F: m[2], auth: m[1].getAuth(app), db: m[2].getFirestore(app) };
        x.A.onAuthStateChanged(x.auth, function (u) {
          user = u || null; authKnown = true;
          authWaiters.splice(0).forEach(function (f) { f(); });
          if (user) waiters.splice(0).forEach(function (f) { f(); });
          paint();
        });
        return x;
      });
    return X;
  }
  function authReady() { return boot().then(function (x) { return authKnown ? x : new Promise(function (r) { authWaiters.push(function () { r(x); }); }); }); }
  function signedIn()  { return boot().then(function (x) { return user ? x : new Promise(function (r) { waiters.push(function () { r(x); }); }); }); }

  var KEEP = ['id', 'level', 'block', 'title', 'text', 'author', 'date', 'status', 'replies', 'seed'];
  function clean(d) { var o = {}; KEEP.forEach(function (k) { if (d[k] !== undefined) o[k] = d[k]; }); return o; }
  function rows(snap) { var out = []; snap.forEach(function (d) { out.push(clean(d.data())); }); return out; }
  function q(x, page) { return x.F.query(x.F.collection(x.db, COL), x.F.where('page', '==', page)); }
  function rkey(r) { return [r.author, r.date, r.text].join('\u0001'); }
  function unionReplies(a, b) {                  // two reviewers replying at once both keep their reply
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (r) { var k = rkey(r); if (!seen[k]) { seen[k] = 1; out.push(r); } });
    return out;
  }
  function same(cur, rec) { return cur.text === rec.text && cur.author === rec.author && cur.date === rec.date; }

  window.BWC_BACKEND = {
    name: 'firestore',
    load: function (page) {
      return authReady().then(function (x) { return user ? x.F.getDocs(q(x, page)).then(rows) : []; });
    },
    subscribe: function (page, cb) {
      var latest = null, timer = null;
      function deliver() {                       // don't redraw the list under someone half-way through typing a reply
        timer = null;
        var ta = doc.querySelector('.cm-rform textarea');
        if (ta && (ta.value.trim() || doc.activeElement === ta)) { timer = setTimeout(deliver, 1500); return; }
        cb(latest);
      }
      signedIn().then(function (x) { x.F.onSnapshot(q(x, page), function (snap) { latest = rows(snap); if (!timer) deliver(); }); });
    },
    save: function (page, rec) {
      if (!user) { ask('Sign in with the reviewer password to save comments.'); return Promise.reject(new Error('not signed in')); }
      return boot().then(function (x) {
        var F = x.F;
        return F.runTransaction(x.db, function (t) {
          var id = rec.id, tries = 0;
          function attempt() {
            var ref = F.doc(x.db, COL, page + '__' + id);
            return t.get(ref).then(function (s) {
              var cur = s.exists() ? s.data() : null;
              // a new comment whose number another reviewer took a moment earlier: move to the next free number
              if (cur && !rec.seed && !same(cur, rec) && tries < 30) {
                tries++; var m = /-C(\d+)$/.exec(id); id = page + '-C' + String(+m[1] + 1).padStart(2, '0');
                return attempt();
              }
              var out = clean(rec); out.id = id;
              out.replies = unionReplies(cur && cur.replies, rec.replies);
              out.page = page; out.by = user.email; out.updatedAt = F.serverTimestamp();
              t.set(ref, out);
            });
          }
          return attempt();
        });
      });
    }
  };

  /* ---------- sign-in box, in the comments margin ---------- */
  var box;
  function ask(msg) { paint(); var p = box && box.querySelector('input[type=password]'); if (p) p.focus(); var m = box && box.querySelector('.bwc-auth-msg'); if (m && msg) m.textContent = msg; }
  function paint() {
    if (!box) return;
    box.textContent = '';
    if (user) {
      var s = doc.createElement('span'); s.textContent = 'Signed in as a reviewer. ';
      var o = doc.createElement('a'); o.href = '#'; o.textContent = 'Sign out';
      o.addEventListener('click', function (e) { e.preventDefault(); boot().then(function (x) { x.A.signOut(x.auth); }); });
      box.appendChild(s); box.appendChild(o); return;
    }
    var h = doc.createElement('b'); h.textContent = 'Reviewers: sign in to comment';
    var em = doc.createElement('input'); em.type = 'email'; em.value = CFG.reviewerEmail; em.setAttribute('aria-label', 'Reviewer login');
    var pw = doc.createElement('input'); pw.type = 'password'; pw.placeholder = 'Reviewer password'; pw.setAttribute('aria-label', 'Reviewer password');
    var b = doc.createElement('button'); b.type = 'button'; b.className = 'bwc-btn'; b.textContent = 'Sign in';
    var msg = doc.createElement('p'); msg.className = 'bwc-auth-msg';
    function go() {
      msg.textContent = 'Signing in…';
      boot().then(function (x) { return x.A.signInWithEmailAndPassword(x.auth, em.value.trim(), pw.value); })
        .then(function () { msg.textContent = ''; }, function () { msg.textContent = 'That password did not work — check it with Steve.'; });
    }
    b.addEventListener('click', go);
    pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    [h, em, pw, b, msg].forEach(function (n) { box.appendChild(n); });
  }
  function mount() {
    var bar = doc.querySelector('.bwc-bar'); if (!bar || box) return;
    box = doc.createElement('div'); box.className = 'bwc-auth';
    var mode = doc.getElementById('bwc-mode');
    bar.insertBefore(box, mode ? mode.nextSibling : bar.firstChild);
    var nb = doc.getElementById('bwc-new');              // "+ New comment" asks for sign-in first
    if (nb) nb.addEventListener('click', function (e) { if (!user) { e.preventDefault(); e.stopImmediatePropagation(); ask('Sign in first, then add your comment.'); } });
    var sb = doc.getElementById('bwc-submit');           // same for Submit (the form can also open from a block tag)
    if (sb) sb.addEventListener('click', function (e) { if (!user) { e.preventDefault(); e.stopImmediatePropagation(); ask('Sign in first — your comment is still in the box.'); } });
    paint();
    boot().catch(function () { var w = doc.getElementById('bwc-warn'); if (w) { w.textContent = 'Could not reach the comment store — check your connection.'; w.hidden = false; } });
  }
  // the margin sits above this script in every page, so mount now: our sign-in check must run before comments.js's own handlers
  if (doc.querySelector('.bwc-bar')) mount(); else doc.addEventListener('DOMContentLoaded', mount);
})();
