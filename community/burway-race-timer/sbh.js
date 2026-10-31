/* =====================================================================
   sbh.js - Burway Rowing Club Race Timer (grew out of the SBH 2026 fallback timing system)
   Shared core: connection, sign-in, clock, data helpers (brief T-B2).
   Specs of record: "SBH 2026 Timing System - Design Brief (V00.01).md" (how one race works) and
   "Burway Race Timer - Multi-Race Design Brief (V00.02).md" (races; everything here works on ONE race,
   the one named in ?race= - multi-race brief Part F).
   Plain ES module, no build step (T-B1).
   ===================================================================== */

/* ---- 1. Firebase web config (public by design - brief T-S3) -------- */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBHYqZ0HfdZiXoYTfw_s1zN_EyEHGo2Opo",
  authDomain: "burway-sbh-2026.firebaseapp.com",
  projectId: "burway-sbh-2026",
  storageBucket: "burway-sbh-2026.firebasestorage.app",
  messagingSenderId: "928608538460",
  appId: "1:928608538460:web:376cd82532fd84aa493b99"
};
const FB_VERSION = "12.19.0";               // pinned (T-B1)

/* ---- 2. Race constants ------------------------------------------- */
export const ROLE_EMAIL = {
  admin:     "sbh-admin@dewhurst.tech",
  raceadmin: "sbh-raceadmin@dewhurst.tech",   // multi-race brief Part O: runs the races it owns
  starter:   "sbh-starter@dewhurst.tech",
  finisher:  "sbh-finisher@dewhurst.tech"
};
export const ROLE_LABEL = { admin: "Admin", raceadmin: "RaceAdmin", starter: "Starter", finisher: "Finisher" };
/* Divisions and their times now come from the race's own record (Race Setup, multi-race brief F2/F-SU3).
   These stay exported under the same names and are filled in place when the race record arrives, so every page
   that used DIVS / DIV_STARTS works unchanged. (SBH 2026: [1,2,3]; 10:00 / 11:30 / 13:30.) */
export const DIVS = [];
export const DIV_STARTS = {};
export const STATUSES = ["", "DNS", "DNF", "DSQ", "Withdrawn"];
const UNDO_FREE_MS   = 30000;               // F-S5
const OFFSET_WARN_MS = 2000;                // T-T3
const OFFSET_EVERY   = 5 * 60 * 1000;       // T-T2
const TZ = "Europe/London";                 // T-T5

/* ---- 2b. Which race (multi-race brief F-X1) ------------------------- */
const QS = new URLSearchParams(location.search);
export const RACE_ID = (QS.get("race") || "").trim().toLowerCase();
export const RACE_OK = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(RACE_ID);
const RP = p => `races/${RACE_ID}/${p}`;                       // every race record lives under races/<raceId>/ (F-X4)
const abs = p => /^(races|clock|deletedRaces)\//.test(p) ? p : RP(p);
export const rkey = k => `sbh.${RACE_ID}.${k}`;                // on-phone settings are per race (F-X5)
export const raceHref = (page, extra = "") => `${page}?race=${encodeURIComponent(RACE_ID)}${extra}`;
export const csvName = what => {                               // F-X7: race ID (and date) in every export name
  const d = (S.raceDoc && S.raceDoc.date) || ""; return `${RACE_ID}${d && !RACE_ID.startsWith(d) ? "_" + d : ""}_${what}.csv`;
};
export const RACE_STATUS_LABEL = { draft: "Draft — timing closed", live: "Live", finished: "Finished", archived: "Archived — read only" };

/* ---- 3. Small utilities ------------------------------------------ */
export const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
const SS = {
  get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function rid(n = 20) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return Array.from(b, x => a[x % a.length]).join("");
}

/* ---- 4. Shared state --------------------------------------------- */
export const S = {
  backend: null, mock: false,
  user: null, role: null,
  deviceId: LS.get("sbh.deviceId", null) || (() => { const d = rid(6); LS.set("sbh.deviceId", d); return d; })(),
  offset: LS.get("sbh.offset", null),        // { ms, rtt, at }
  entries: {},                                // bow(string) -> entry
  race: {},                                   // config/race: { official: "A"|"B" }
  timings: { A: {}, B: {} },                  // bow(string) -> { start, startTap, finish, finishTap, status, statusTap }
  instance: LS.get(rkey("instance"), "A") === "B" ? "B" : "A",     // per race (F-X5)
  division: SS.get(rkey("div"), null),        // null = automatic (F-C3); per race (F-X5)
  raceDoc: null,                              // races/<raceId>: title, date, divisions, status, owner, resultsPublic... (I2)
  raceState: "loading",                       // loading | ok | invalid | denied (Hidden race, signed out) | offline
  authUser: null, realRole: null,             // the signed-in account and its role; S.user / S.role are what this race's pages see
  fromCache: true,
  page: document.body ? (document.body.dataset.page || "") : "",
  ledgerError: null,
  pointerDown: false
};
if (["start", "finish"].includes(S.page) && ["A", "B"].includes((QS.get("i") || "").toUpperCase())) {   // F-X9: instance in the link
  S.instance = QS.get("i").toUpperCase(); LS.set(rkey("instance"), S.instance);
}
const subs = new Set();                       // re-render callbacks
export function onChange(fn) { subs.add(fn); }
let renderQueued = false;
export function changed() {
  if (renderQueued) return; renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; subs.forEach(f => { try { f(); } catch (e) { console.error(e); } }); updateLight(); });
}

/* ---- 5. Clocks (T-T1, T-T2, T-T5) -------------------------------- */
let devSkew = 0;                              // only ever non-zero in local test mode
export const deviceNow = () => Date.now() + devSkew;
export const serverNow = () => deviceNow() + (S.offset ? S.offset.ms : 0);

const fmtHMS = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export function fmtClock(ms) {                // HH:MM:SS.s, UK local time
  if (ms == null || !isFinite(ms)) return "";
  return fmtHMS.format(new Date(ms)) + "." + Math.floor((((ms % 1000) + 1000) % 1000) / 100);
}
export function raceTenths(start, finish) {   // integer tenths of a second, or null
  if (start == null || finish == null) return null;
  return Math.round((finish - start) / 100);
}
export function fmtRace(tenths) {             // M:SS.s
  if (tenths == null) return "";
  const neg = tenths < 0; let t = Math.abs(tenths);
  const m = Math.floor(t / 600), s = Math.floor((t % 600) / 10), d = t % 10;
  return (neg ? "-" : "") + m + ":" + String(s).padStart(2, "0") + "." + d;
}
function ukMinutesNow() {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(serverNow()));
  const [h, m] = p.split(":").map(Number); return h * 60 + m;
}
export function autoDivision() {              // F-C3: current or next division by start time
  const now = ukMinutesNow(); let d = DIVS[0] ?? 1;
  for (const k of DIVS) { const s = hm(DIV_STARTS[k]); if (s != null && now >= s) d = k; }
  return d;
}
export function currentDivision() { return S.division == null ? autoDivision() : S.division; }

/* Time of a tap, taken from the pointer event itself (T-T1).
   Date.now() is read first; event.timeStamp tells us how long ago the finger
   actually went down, so we subtract any delay before the handler ran. */
export function tapTime(e) {
  const now = deviceNow();
  let lag = 0;
  if (e && typeof e.timeStamp === "number" && e.timeStamp > 0 && e.timeStamp < 1e11) {
    lag = performance.now() - e.timeStamp;
    if (!(lag >= 0 && lag < 1000)) lag = 0;
  }
  return Math.round(now - lag);
}

/* Bind a big tap button. The time is captured at pointerdown; the tap only
   counts if the finger lifts without scrolling (stops accidental taps while
   scrolling the list). Keyboard / accessibility clicks also work. */
export function bindTap(el, onTap) {
  let st = null;
  el.addEventListener("pointerdown", e => {
    const t = tapTime(e);
    if (e.button != null && e.button > 0) return;
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, t };
    S.pointerDown = true; el.classList.add("pressed");
  });
  el.addEventListener("pointermove", e => {
    if (st && e.pointerId === st.id && (Math.abs(e.clientX - st.x) > 14 || Math.abs(e.clientY - st.y) > 14)) end();
  });
  const end = () => { st = null; S.pointerDown = false; el.classList.remove("pressed"); changed(); };
  el.addEventListener("pointercancel", end);
  el.addEventListener("pointerleave", e => { if (st && e.pointerType === "mouse") end(); });
  el.addEventListener("pointerup", e => {
    if (!st || e.pointerId !== st.id) return;
    const t = st.t; end(); markActivity();
    onTap(t);
  });
  el.addEventListener("click", e => { if (e.detail === 0) { markActivity(); onTap(deviceNow()); } });   // keyboard
  el.addEventListener("contextmenu", e => e.preventDefault());
}
let lastActivity = 0;
export function markActivity() { lastActivity = Date.now(); }
export function idleFor() { return Date.now() - lastActivity; }

/* ---- 6. Backend ---------------------------------------------------- */
function wantMock() {
  const q = new URLSearchParams(location.search);
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (local && q.has("mock")) try { sessionStorage.setItem("sbhmock.on", "1"); } catch (e) {}
  return local && (q.has("mock") || /^PASTE/.test(FIREBASE_CONFIG.apiKey) || (() => { try { return sessionStorage.getItem("sbhmock.on") === "1"; } catch (e) { return false; } })());     // test mode only ever on a local machine
}

async function firebaseBackend(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [appM, fs, au] = await Promise.all([
    import(base + "firebase-app.js"), import(base + "firebase-firestore.js"), import(base + "firebase-auth.js")
  ]);
  const app = appM.initializeApp(cfg);
  // ROLLED BACK 22 Oct 13:05 to the connection settings that worked on iPhones (multi-tab cache, Firebase's normal
  // connection). The 22 Oct morning experiments - single-tab cache + releasing it on page exit, then forced long
  // polling - broke every iPhone/iPad while still working on a PC. Safe mode (no on-device cache) stays available
  // by choice from the red banner.
  const safe = (LS.get("sbh.safeMode", 0) || 0) > Date.now();
  let db, persistent = !safe;
  try {
    db = safe
      ? fs.initializeFirestore(app, { localCache: fs.memoryLocalCache() })
      : fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    console.warn("Persistent cache unavailable, using memory", e); persistent = false; noteError(e);
    db = fs.initializeFirestore(app, { localCache: fs.memoryLocalCache() });
  }
  const auth = au.getAuth(app);
  const ref = p => fs.doc(db, ...p.split("/"));
  return {
    kind: "firebase", persistent, safe,
    newId: () => fs.doc(fs.collection(db, "taps")).id,
    onAuth(cb) { au.onAuthStateChanged(auth, u => cb(u ? { email: u.email, uid: u.uid } : null)); },
    signIn: (email, pw) => au.signInWithEmailAndPassword(auth, email, pw),
    reauth: pw => au.reauthenticateWithCredential(auth.currentUser, au.EmailAuthProvider.credential(auth.currentUser.email, pw)),
    signOut: () => au.signOut(auth),
    watchDoc(path, cb, onErr) {                // returns the function that stops listening
      return fs.onSnapshot(ref(path), { includeMetadataChanges: true },
        snap => cb(snap.exists() ? snap.data() : {}, { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache, exists: snap.exists() }),
        err => { console.error(path, err); noteError(err); onErr && onErr(err); });
    },
    async getOnce(path) { const s = await fs.getDoc(ref(path)); return s.exists() ? s.data() : {}; },
    commit(ops) {
      const b = fs.writeBatch(db);
      for (const op of ops) {
        if (op.create) b.set(ref(op.path), { ...op.data, createdAt: fs.serverTimestamp() });
        else if (op.del) b.delete(ref(op.path));                    // only for deleting an archived race (multi-race brief I4)
        else if (op.replace) b.set(ref(op.path), op.data);           // whole document replaced (system reset)
        else b.set(ref(op.path), op.data, { merge: true });
      }
      return b.commit();
    },
    async exists(path) { return (await fs.getDocFromServer(ref(path))).exists(); },
    pendingDone: () => fs.waitForPendingWrites(db),
    async clockProbe(id) {
      const r = ref("clock/" + id);
      const t0 = deviceNow();
      await fs.setDoc(r, { t: fs.serverTimestamp(), d: t0 });
      const t1 = deviceNow();
      const snap = await fs.getDocFromServer(r);
      return { server: snap.data().t.toMillis(), t0, t1 };
    },
    watchTapsOfKind(col, kind, cb) {          // live list of one kind of record from a race's audit log (issues tracker)
      return fs.onSnapshot(fs.query(fs.collection(db, ...col.split("/")), fs.where("kind", "==", kind)),
        snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => { console.error("taps " + kind, err); noteError(err); });
    },
    async tapsFor(col, instance, bow) {
      const q = fs.query(fs.collection(db, ...col.split("/")), fs.where("instance", "==", instance), fs.where("bow", "==", Number(bow)));
      const r = await fs.getDocs(q); return r.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async query(col, where = {}) {            // Races page, export, migration: documents of one collection, optional equality filters
      let q = fs.collection(db, ...col.split("/"));
      const w = Object.entries(where); if (w.length) q = fs.query(q, ...w.map(([k, v]) => fs.where(k, "==", v)));
      const r = await fs.getDocs(q); return r.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  };
}

/* Last error seen, shown to signed-in officials in the status panel (helps diagnose a phone on the day) */
export function noteError(e) {
  const msg = (e && (e.code || e.name) ? (e.code || e.name) + ": " : "") + (e && e.message ? e.message : String(e));
  S.lastError = { msg: msg.slice(0, 200), at: Date.now() }; try { changed(); } catch (x) {}
}
addEventListener("unhandledrejection", ev => noteError(ev.reason));
addEventListener("error", ev => { if (ev.error) noteError(ev.error); });

/* ---- 7. Start-up --------------------------------------------------- */
let readyResolve; export const ready = new Promise(r => (readyResolve = r));
let authReadyResolve; export const authReady = new Promise(r => (authReadyResolve = r));

/* ---- 7a. The race record (multi-race brief F-X1, I2) ---------------- */
let raceUnsub = null, raceFirstResolve, offlineTimer = null;
const raceFirst = new Promise(r => (raceFirstResolve = r));
const halt = () => new Promise(() => {});                    // stops the page script: nothing else is drawn
/** Which role this race's pages see. Admin, Starter and Finisher as before; the RaceAdmin account counts as this
    race's admin only on races it owns (Part O) and is otherwise treated as not signed in here. */
function applyRole() {
  const u = S.authUser;
  const base = u ? (Object.keys(ROLE_EMAIL).find(r => ROLE_EMAIL[r] === (u.email || "").toLowerCase()) || null) : null;
  S.realRole = base;
  if (RACELESS) { S.user = u; S.role = base; return; }
  if (base === "raceadmin") {
    const own = !!(S.raceDoc && String(S.raceDoc.owner || "").toLowerCase() === u.email.toLowerCase());
    S.user = own ? u : null; S.role = own ? "admin" : null;
  } else { S.user = u; S.role = base; }
}
export const raceStatus = () => (S.raceDoc && S.raceDoc.status) || "draft";
export const isLive = () => raceStatus() === "live";
export const isArchived = () => raceStatus() === "archived";
export const RIVER_DEFAULT_MIN = 13, RESULTS_NOTE_DEFAULT = "Provisional - subject to penalties and handicaps.";
export const riverMs = () => (Number(S.raceDoc && S.raceDoc.riverMinutes) > 0 ? Number(S.raceDoc.riverMinutes) : RIVER_DEFAULT_MIN) * 60000;
export const resultsNote = () => (S.raceDoc && typeof S.raceDoc.resultsNote === "string" && S.raceDoc.resultsNote.trim()) ? S.raceDoc.resultsNote.trim() : RESULTS_NOTE_DEFAULT;
export const resultsPublic = () => !!(S.raceDoc && S.raceDoc.resultsPublic === true);
export const raceTitle = () => (S.raceDoc && (S.raceDoc.title || "")) || "";
export const raceShort = () => (S.raceDoc && (S.raceDoc.shortName || S.raceDoc.title)) || "Burway Race Timer";
function applyRaceDoc(d) {
  S.raceDoc = d || null;
  const divs = (Array.isArray(d && d.divisions) ? d.divisions : []).filter(x => x && Number(x.n) >= 1).sort((a, b) => a.n - b.n);
  DIVS.splice(0, DIVS.length, ...divs.map(x => Number(x.n)));
  for (const o of [DIV_STARTS, DIV_FIRST_BOAT]) for (const k of Object.keys(o)) delete o[k];
  for (const x of divs) { DIV_STARTS[x.n] = x.start || ""; if (x.firstBoating) DIV_FIRST_BOAT[x.n] = x.firstBoating; }
  applyRole(); paintRaceChrome();
}
function watchRace() {
  if (raceUnsub) try { raceUnsub(); } catch (e) {}
  raceUnsub = S.backend.watchDoc("races/" + RACE_ID, (d, meta) => {
    if (meta.exists) { applyRaceDoc(d); S.raceState = "ok"; raceFirstResolve(); }
    else if (!meta.fromCache) { const was = S.raceState; S.raceDoc = null; applyRole(); S.raceState = "invalid"; raceFirstResolve(); if (was === "ok") showInvalid(); }
    else if (!offlineTimer && S.raceState === "loading") offlineTimer = setTimeout(() => { if (S.raceState === "loading") { S.raceState = "offline"; showInvalid("offline"); } }, 15000);
    changed();
  }, err => {
    if (/permission/i.test((err && err.code) || "")) { S.raceDoc = null; applyRole(); S.raceState = "denied"; }   // a Hidden race, signed out (brief I3 note, D6)
    raceFirstResolve(); changed();
  });
}
/** F-X1: no race, or an unknown or deleted one - a plain message and nothing else. */
export function showInvalid(kind) {
  const main = document.querySelector("main"); if (!main) return;
  main.innerHTML = kind === "offline"
    ? `<p class="sbh-invalid">This phone hasn't opened this race before and there's no signal. Try again with signal.</p>`
    : `<p class="sbh-invalid">This race link isn't valid — ask the race admin for a new one.</p>`;
  const sp = document.querySelector(".bbanner span"); if (sp) sp.textContent = "Burway Race Timer";
  const a = document.querySelector(".bbanner a"); if (a) a.removeAttribute("href");
  document.title = "Burway Race Timer";
}
/** Race name in the banner and the browser tab (F2: replaces the hard-coded "Burway Small Boats Head 2026"). */
function paintRaceChrome() {
  const name = raceTitle() || "Burway Race Timer";
  const sp = document.querySelector(".bbanner span"); if (sp) sp.textContent = name;
  const a = document.querySelector(".bbanner a"); if (a) a.setAttribute("aria-label", name);
  const page = document.title.split(" · ")[0]; document.title = page + " · " + raceShort();
}
/** F-X2: every link to another page of this race carries the race ID ("./" = this race's hub). Links added later
    by the page scripts are caught too, so no page script needs to change. */
function raceLink(a) {
  const h = a.getAttribute("href"); if (!RACE_ID || h == null || /[?&]race=/.test(h) || /^(index|results-list)\.html/.test(h)) return;
  const m = /^(?:\.\/|([a-z-]+\.html))(\?[^#]*)?(#.*)?$/.exec(h); if (!m) return;
  a.setAttribute("href", raceHref(m[1] || "home.html", (m[2] ? "&" + m[2].slice(1) : "") + (m[3] || "")));
}
function raceLinks(root = document) {
  if (root.tagName === "A") raceLink(root);
  root.querySelectorAll && root.querySelectorAll("a[href]").forEach(raceLink);
}

let RACELESS = false;
/** Pages above a race (Races, a new race's Setup, the public Results list): sign-in, clock and sync light, no race. */
export async function bootRaceless() {
  RACELESS = true; S.raceState = "ok";
  document.documentElement.style.scrollBehavior = "auto";
  await connect();
  replayLedger(); readyResolve();
}
let connected = false;
async function connect(onFirstAuth) {
  if (connected) return; connected = true;
  S.mock = wantMock();
  if (S.mock) {
    const m = await import("./sbh-mock.js");
    S.backend = await m.mockBackend();
    devSkew = LS.get("sbhmock.skew", 0);
    document.documentElement.classList.add("sbh-mock");
  } else {
    S.backend = await firebaseBackend(FIREBASE_CONFIG);
  }
  let firstAuth = true;
  S.backend.onAuth(u => {
    S.authUser = u; applyRole();
    if (u) { measureOffset(); replayLedger(); }
    if (!RACELESS && (!firstAuth || S.raceState !== "ok")) watchRace();   // sign-in changed or still unread: read the race record again (a Hidden race becomes readable)
    firstAuth = false;
    authReadyResolve();
    changed();
  });
  addEventListener("online", () => { replayLedger(); changed(); });
  addEventListener("offline", changed);
  setInterval(() => { if (S.user) measureOffset(); }, OFFSET_EVERY);
  setInterval(updateLight, 2000);
}

export async function boot({ watch = ["entries", "A", "B"] } = {}) {
  document.documentElement.style.scrollBehavior = "auto";     // site.css sets smooth; rows must not drift under a finger
  if (!RACE_OK || QS.get("bad") === "1") { showInvalid(); return halt(); }   // bad=1: a short link with an unknown page name (404.html)
  raceLinks(); new MutationObserver(ms => ms.forEach(m => m.type === "attributes" ? raceLink(m.target) : m.addedNodes.forEach(n => n.nodeType === 1 && raceLinks(n))))
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["href"] });
  await connect();
  watchRace();
  await raceFirst;
  if (S.raceState === "invalid") { showInvalid(); return halt(); }
  if (watch.includes("entries")) watchEntries();
  S.backend.watchDoc(RP("config/race"), (data, meta) => { S.race = data || {}; dropStaleLedger(); changed(); });
  onChange(paintWho);
  for (const item of ledger()) overlayAdd(item.id, item.ops);   // taps still waiting to send show as done after a reload (S-2)
  for (const i of ["A", "B"]) if (watch.includes(i)) watchTimings(i);
  if (watch.includes("entries") && watch.includes("A")) onChange(keepCounts);
  /* Watchdog: if the page still hasn't reached the database 15 s after opening while the phone says it's online,
     say so, and offer safe mode (no on-device database cache). Not automatic: on a weak river-bank signal the
     on-device cache is what lets a page open with its crew list. */
  if (!S.mock) setTimeout(() => {
    if (S.fromCache && navigator.onLine) {
      noteError({ code: "no-connection", message: "Couldn't reach the race database within 15 s of opening" });
      const ban = document.querySelector(".sbh-banner");
      if (ban && S.user) {
        ban.className = "sbh-banner red"; ban.hidden = false; ban.dataset.auto = ""; ban.dataset.conn = "1";
        ban.innerHTML = S.backend.safe
          ? `Can't reach the race database. Check the signal, then pull down to refresh.`
          : `Can't reach the race database. Check the signal. If other phones are fine, <button type="button" class="link gosafe" style="color:inherit;font-weight:800">try safe mode</button>.`;
        ban.querySelector(".gosafe")?.addEventListener("click", () => { LS.set("sbh.safeMode", Date.now() + 12 * 3600 * 1000); location.reload(); });
      }
    }
  }, 15000);
  readyResolve();
}

const watching = {};
function noteMeta(meta) { S.fromCache = meta.fromCache; }
export function watchEntries() {
  if (watching.entries) return; watching.entries = true;
  S.backend.watchDoc(RP("config/entries"), (data, meta) => {
    const out = {};
    for (const [k, v] of Object.entries(data || {})) if (v && typeof v === "object" && v.bow != null) out[k] = v;
    S.entries = out; noteMeta(meta); changed();
  }, () => showBanner("Can't read the entries table. Check the connection.", "red"));
}
export function watchTimings(inst) {
  if (watching[inst]) return; watching[inst] = true;
  S.backend.watchDoc(RP("timings/" + inst), (data, meta) => {
    S.timings[inst] = data || {}; settleOverlay(inst); noteMeta(meta); changed();
  });
}

/* Snag S-2 (club test 22 Oct): show a tap on screen the moment it is stored on this phone, not when the
   server (or the database's own cache) gets round to confirming it. Each start/finish/status write is laid
   over the received timings until the received data shows the same value, or the write is confirmed or refused. */
const overlay = { A: {}, B: {} };             // inst -> bow -> field -> { v, id }
function overlayAdd(id, ops) {
  for (const op of ops) {
    const m = op.path.startsWith(RP("timings/")) ? /^(A|B)$/.exec(op.path.slice(RP("timings/").length)) : null; if (!m) continue;   // this race only
    for (const [bow, fields] of Object.entries(op.data || {})) for (const [f, v] of Object.entries(fields || {}))
      if (v === null || typeof v !== "object") ((overlay[m[1]][bow] ||= {})[f] = { v, id });
  }
  for (const i of ["A", "B"]) applyOverlay(i);
}
function overlayDrop(id) {
  for (const i of ["A", "B"]) for (const [bow, fs] of Object.entries(overlay[i])) {
    for (const f of Object.keys(fs)) if (fs[f].id === id) delete fs[f];
    if (!Object.keys(fs).length) delete overlay[i][bow];
  }
}
function settleOverlay(inst) {                // drop what the received data already shows, then lay the rest on top
  const T = S.timings[inst] || {};
  for (const [bow, fs] of Object.entries(overlay[inst])) {
    for (const [f, o] of Object.entries(fs)) if ((T[bow] || {})[f] === o.v || ((T[bow] || {})[f] == null && o.v == null)) delete fs[f];
    if (!Object.keys(fs).length) delete overlay[inst][bow];
  }
  applyOverlay(inst);
}
function applyOverlay(inst) {
  const T = S.timings[inst] = { ...(S.timings[inst] || {}) };
  for (const [bow, fs] of Object.entries(overlay[inst])) {
    const row = { ...(T[bow] || {}) };
    for (const [f, o] of Object.entries(fs)) row[f] = o.v;
    T[bow] = row;
  }
}

function paintWho() {
  const w = document.getElementById("who"); if (!w) return;
  if (!S.authUser) { w.innerHTML = "Not signed in"; return; }
  const r = S.realRole ? ROLE_LABEL[S.realRole] : S.authUser.email;
  w.innerHTML = `Signed in: <b>${esc(r)}</b> <button type="button" class="link">Sign out</button>`;
  w.querySelector("button").onclick = async () => { if (await confirmBox("Sign out?", "You'll need the password to sign back in.", "Sign out")) S.backend.signOut(); };
}
export const officialInstance = () => "A";      // Steve, 21 Oct: the public sees instance A only
/* After a system reset, anything this phone still holds from before it is thrown away, so old test taps can't come back. */
function dropStaleLedger() {
  const at = S.race.resetAt; if (!at) return;
  const L = ledger(), keep = L.filter(x => !(x.at < at));
  if (keep.length !== L.length) { LS.set(LEDGER, keep); for (const x of L) if (x.at < at) overlayDrop(x.id); for (const i of ["A", "B"]) settleOverlay(i); }
}

/** Race Configuration › Start a new race (added 22 Oct after the club test). Admin only, after the password is re-entered.
    level "keep": crews stay exactly as listed (bow, event, crew, club, division); everything else goes —
                  all times and statuses in A and B, review flags and Resolves, penalties, notes, handicap groups.
    level "all":  the crew list goes too - a completely empty system, ready for a fresh import.
    The tap log is never deleted (security rules); taps from before the reset are hidden from the history. */
export function resetSystem(level) {
  const now = serverNow();
  const keep = {};
  if (level === "keep") for (const e of Object.values(S.entries)) keep[String(e.bow)] = { bow: e.bow, event: e.event || "", crew: e.crew || "", club: e.club || "", division: e.division ?? null, status: "", notes: "", ...(e.boat ? { boat: e.boat } : {}) };
  const race = {}; for (const [k, v] of Object.entries(S.race || {})) if (k !== "combos") race[k] = v;
  Object.assign(race, { resetAt: now, resetBy: S.user ? S.user.email : "", resetLevel: level });
  const id = S.backend.newId();
  const tap = { ...baseTap("system-reset", "A", null, null), value: level, note: `${Object.keys(S.entries).length} crews before; ${level === "keep" ? "crew list kept" : "crew list wiped"}` };
  LS.set(LEDGER, []); for (const i of ["A", "B"]) overlay[i] = {};          // nothing from before the reset is sent from this phone either
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap },
    { path: "timings/A", replace: true, data: {} }, { path: "timings/B", replace: true, data: {} },
    { path: "config/entries", replace: true, data: keep }, { path: "config/race", replace: true, data: race }], tap);
}
export const reauth = pw => S.backend.reauth(pw);

/* Updates / issues tracker (23 Oct). Each new issue and each later change is a new record in the audit log
   (kind "issue"), so nothing is overwritten and every change keeps who and when. Officials only can read it.
   fields: { id: "7", cat: "Crew"|"System"|"Other", bow: 157|null, text, status: "Open"|"In progress"|"Resolved" } */
export const ISSUE_CATS = ["Crew", "System", "Other"], ISSUE_STATUSES = ["Open", "In progress", "Resolved"];
export function logIssue(fields, prevBow = null) {
  const id = S.backend.newId();
  const bow = fields.bow == null || fields.bow === "" ? null : Number(fields.bow);
  const tap = { ...baseTap("issue", "A", bow, null), value: String(fields.id), issue: { ...fields, bow }, at: Date.now() };
  /* public "Check" marker on the crew while the issue is open (23 Oct); cleared from the old bow if the issue moved */
  const mark = {};
  if (prevBow != null && Number(prevBow) !== bow) mark[String(prevBow)] = { issues: { [fields.key]: false } };
  if (bow != null) mark[String(bow)] = { issues: { [fields.key]: fields.status !== "Resolved" } };
  const ops = [{ path: "taps/" + id, create: true, data: tap }];
  if (Object.keys(mark).length) ops.push({ path: "timings/A", data: mark });
  writeOps(id, ops, tap);
  return { id, ...tap };                      // the record itself, so the page can show it straight away
}
/** Issue records from this phone that haven't reached the server yet (shown straight away) */
export function pendingIssueRecords() {
  return ledger().flatMap(x => x.ops.filter(o => o.create && o.data && o.data.kind === "issue").map(o => ({ id: o.path.slice(5), ...o.data, pending: true })));
}
export const watchIssueRecords = cb => S.backend.watchTapsOfKind(RP("taps"), "issue", cb);
export const tapsFor = (inst, bow) => S.backend.tapsFor(RP("taps"), inst, bow);

export function saveRace(patch) { writeOps("r" + rid(12), [{ path: "config/race", data: patch }], null); }
/** The race's own record (Race Setup, the Results Hidden / Public switch). Admin of this race only (rules). */
export function saveRaceDoc(patch) { writeOps("d" + rid(12), [{ path: "races/" + RACE_ID, data: { ...patch, updatedAt: Date.now(), updatedBy: S.authUser ? S.authUser.email : "" } }], null); }
export const getRaceRecord = p => S.backend.getOnce(RP(p));

/* Crew and finished counts kept on the race record for the Races page tiles (multi-race brief I2), so that page reads
   one document per race. Updated quietly by the race's admin pages; never on an Archived race. */
let countsTimer = null;
function keepCounts() {
  if (S.role !== "admin" || !S.raceDoc || isArchived() || S.fromCache) return;
  const crewCount = Object.keys(S.entries).length;
  const finishedCountA = Object.entries(S.timings.A || {}).filter(([b, t]) => S.entries[b] && t && t.finish != null && !OUT_ST.includes(statusOf("A", b))).length;
  if (S.raceDoc.crewCount === crewCount && S.raceDoc.finishedCountA === finishedCountA) return;
  clearTimeout(countsTimer);
  countsTimer = setTimeout(() => S.backend.commit([{ path: "races/" + RACE_ID, data: { crewCount, finishedCountA } }]).catch(e => console.warn("counts", e)), 3000);
}
/** The Race Timer's own menu (multi-race brief B4, V00.02): Community Support › Burway Rowing Club Race Timer, with Races
    (race admins) and Results. Shown on the pages above a race only; never on the main dewhurst.tech menu. */
export function mountMenu(host, here = "") {
  const paint = () => {
    const admin = S.user && ["admin", "raceadmin"].includes(S.realRole);
    host.innerHTML = `<nav class="rt-menu" aria-label="Race Timer">
      <span class="crumb">Community Support <span aria-hidden="true">›</span> <b>Burway Rowing Club Race Timer</b></span>
      <span class="sub">${admin ? `<a href="index.html"${here === "races" ? ' aria-current="page"' : ""}>Races</a>` : ""}
        <a href="results-list.html"${here === "results" ? ' aria-current="page"' : ""}>Results</a></span>
      <span class="who" id="who"></span></nav>`;
    paintWho();
  };
  paint(); onChange(() => { const want = String(!!(S.user && ["admin", "raceadmin"].includes(S.realRole))); if (host.dataset.adm !== want) { host.dataset.adm = want; paint(); } });
}

/* ---- 8. Entries helpers ------------------------------------------- */
export function entryList(div) {             // sorted by bow; div = 1|2|3|"all"
  return Object.values(S.entries)
    .filter(e => div === "all" || div == null || Number(e.division) === Number(div))
    .sort((a, b) => a.bow - b.bow);
}
export function timing(inst, bow) { return (S.timings[inst] || {})[String(bow)] || {}; }
export function statusOf(inst, bow) {        // instance status wins over entry status
  const t = timing(inst, bow); const e = S.entries[String(bow)] || {};
  return t.status || e.status || "";
}
export function isTimed(bow) {               // F-K5
  return ["A", "B"].some(i => { const t = timing(i, bow); return t.start != null || t.finish != null; });
}

const OUT_ST = ["DNS", "DNF", "DSQ", "Withdrawn"];
/** Compute results for one instance: race time, position in division, position in event. */
/* Event combinations and handicaps (Handicap Configuration page). Stored in config/race:
   combos: { id: { name, events: { "<event name>": handicapSeconds } } }. An event belongs to at most one combo. */
export function combos() {
  const out = [];
  for (const [id, c] of Object.entries(S.race.combos || {})) if (c && typeof c === "object") {
    const events = {}; for (const [ev, h] of Object.entries(c.events || {})) if (h != null) events[ev] = Number(h) || 0;
    out.push({ id, name: c.name || "", events, created: c.created || 0 });
  }
  return out.sort((x, y) => x.created - y.created || x.name.localeCompare(y.name));
}
export function comboOf(event) {
  for (const c of combos()) if (event in c.events) return { id: c.id, name: c.name, handicap: c.events[event] };
  return null;
}
export const penaltyOf = e => Number(e && e.penalty) || 0;

/* Boating times (23 Oct): a crew's own "boat" time (part of the crew list - SBH 2026's came from the Burway event page's
   race order and were written into each crew when the race was moved into the multi-race structure); a crew with no time
   of its own (TBC, or added later) uses its division's first boating time. A race with neither skips the boating labels. */
const DIV_FIRST_BOAT = {};                 // filled from the race record (Race Setup "first boating time"); SBH 2026: 09:33 / 11:06 / 13:09
function hm(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "")); return m ? +m[1] * 60 + +m[2] : null; }
export function boatingTime(e) { return [e.boat, DIV_FIRST_BOAT[e.division]].find(v => hm(v) != null) || null; }
/** What Results show for a crew that hasn't started yet (Steve, 23 Oct):
    more than 10 min before boating: "Div 2 starts at 11:30"; from 10 min before boating: "Proceed to boating area";
    from the boating time until the division start: "Boating now"; from the division start until the crew's start is logged: "Waiting to start". */
export function preStartNote(e, nowMin = ukMinutesNow()) {
  const div = Number(e.division), start = hm(DIV_STARTS[div]), boat = hm(boatingTime(e));
  if (start == null) return "";
  if (boat != null && nowMin < boat - 10) return `Div ${div} starts at ${DIV_STARTS[div]}`;
  if (boat == null && nowMin < start - 10) return `Div ${div} starts at ${DIV_STARTS[div]}`;
  if (boat != null && nowMin < boat) return "Proceed to boating area";
  if (nowMin < start) return boat != null ? "Boating now" : "Proceed to boating area";
  return "Waiting to start";
}

/* Results for one instance.
   rt  = race time (finish - start), tenths of a second. pt = race time + penalty. pos = place across the whole event (all divisions) on adjusted time.
   adj = adjusted time = race time + penalty - handicap (tenths). posEv = place on adjusted time
         among crews in the same event - or the same event combination - across all divisions. */
/** Should Results show "Check" against this crew? (Steve, 23 Oct) Only when something has been raised against it:
    an open "Flag for review" (A, or B via its marker), DNF / DSQ marked in A and not yet Resolved on Race Adjudication,
    or an open / in-progress issue on Updates / Issues. A-versus-B timing differences never show here. */
export function needsCheck(bow) {
  const a = timing("A", bow), st = statusOf("A", bow);
  if (Object.values(a.flags || {}).some(f => f && !f.done)) return true;
  if (Object.values(a.bflags || {}).some(Boolean)) return true;
  if (Object.values(a.issues || {}).some(Boolean)) return true;
  if ((st === "DNF" || st === "DSQ") && !(a.reviewed && String(a.reviewed.sig || "").includes(`${st} marked`))) return true;
  return false;
}
export function computeResults(inst) {
  const nowMin = ukMinutesNow();
  const rows = entryList("all").map(e => {
    const t = timing(inst, e.bow); const st = statusOf(inst, e.bow);
    let rt = OUT_ST.includes(st) ? null : raceTenths(t.start, t.finish);
    let note = st;
    if (rt != null && rt <= 0) { note = "Time pending"; rt = null; }   // finish before start: officials see it on Race Adjudication
    if (!note && rt == null) note = t.start != null ? (t.finish != null ? "" : "On water") : (t.finish != null ? "" : preStartNote(e, nowMin));
    const combo = comboOf(e.event); const hc = combo ? combo.handicap : 0; const pen = penaltyOf(e);
    const pt = rt == null ? null : rt + Math.round(pen * 10);            // time + penalty: used for overall Pos
    const adj = rt == null ? null : pt - Math.round(hc * 10);            // adjusted: penalty and handicap, used for Pos in event
    return { e, t, st, rt, pt, adj, hc, pen, combo, group: combo ? "combo:" + combo.id : "event:" + e.event, note, pos: null, posEv: null, check: needsCheck(e.bow) };
  });
  const rank = (group, key) => {
    const g = group.filter(r => r[key] != null).sort((a, b) => a[key] - b[key]);
    const out = new Map(); g.forEach((r, i) => out.set(r, i > 0 && g[i - 1][key] === r[key] ? out.get(g[i - 1]) : i + 1)); return out;
  };
  // Steve, 21 Oct: positions span the whole event - divisions are only start groups, and all times combine at the end of the day.
  rank(rows, "adj").forEach((p, r) => (r.pos = p));                    // overall: on adjusted time - penalties and handicaps (Steve, 22 Oct)
  for (const gk of new Set(rows.map(r => r.group))) rank(rows.filter(r => r.group === gk), "adj").forEach((p, r) => (r.posEv = p));
  return rows;
}

/* ---- 9. Tap writing: local ledger first, then server (T-T4) ------- */
const LEDGER = rkey("ledger"), LOG = rkey("log");           // per race (F-X5); each waiting item keeps its full races/<id>/... paths
export const ledger = () => LS.get(LEDGER, []);
function ledgerKeys() {                       // waiting items for every race on this phone
  const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^sbh\.[^.]+\.ledger$/.test(k)) out.push(k); } } catch (e) {}
  return out;
}
export const allPending = () => ledgerKeys().reduce((n, k) => n + LS.get(k, []).length, 0);
function removeFrom(k, id) { if (k === LEDGER) return ledgerRemove(id); LS.set(k, LS.get(k, []).filter(x => x.id !== id)); }
function ledgerRemove(id) {
  const left = ledger().filter(x => x.id !== id); LS.set(LEDGER, left); overlayDrop(id);
  if (!left.length && S.ledgerError && !/refused/.test(S.ledgerError)) S.ledgerError = null;   // review R11: "not yet saved" clears once everything has gone
  changed();
}

function writeOps(id, ops, tap) {
  ops = ops.map(o => ({ ...o, path: abs(o.path) }));         // this race's records only (F-X4)
  /* F-X3: an Archived race is read-only; outside Live only the race's admin can change times, statuses and flags.
     (The security rules refuse the same writes - this just says so instead of showing a red "refused" banner.) */
  if (isArchived()) { toast("This race is archived - read only"); return false; }
  if (tap && !isLive() && S.role !== "admin") { toast("Timing is closed for this race"); return false; }
  // 1) keep it on the phone, synchronously, before anything is sent
  const L = ledger(); L.push({ id, ops, at: Date.now() });
  const okLocal = LS.set(LEDGER, L);
  overlayAdd(id, ops);                        // on screen now (S-2)
  if (tap) { const log = LS.get(LOG, []); log.push({ id, ...tap }); if (log.length > 5000) log.splice(0, log.length - 5000); LS.set(LOG, log); }
  if (!okLocal) showBanner("This phone's storage is full - taps are not backed up locally. Keep the paper sheet going.", "amber");
  // 2) hand to the backend (it also queues offline)
  S.backend.commit(ops).then(() => ledgerRemove(id)).catch(err => {
    console.error("commit failed", err);
    const code = (err && err.code) || String(err);
    if (/permission/i.test(code)) { S.ledgerError = "Server refused a tap (" + code + "). Tell the race admin - don't sign out. Keep the paper sheet going."; LS.set(LEDGER, ledger().filter(x => x.id !== id)); overlayDrop(id); }
    else S.ledgerError = "Tap not yet saved: " + code;
    changed();
  });
  changed();
}

let replaying = false;
/* Re-send waiting taps. Every race's waiting taps on this phone are sent, each to the race it was made in
   (multi-race brief F-X5, T-SEP2), whichever race's page is open. */
async function replayLedger() {
  if (replaying || !S.authUser || !navigator.onLine) return; replaying = true;
  try {
    await S.backend.pendingDone();            // let the SDK flush its own queue first
    for (const k of ledgerKeys()) {
      const mine = k === LEDGER; let resetAt = mine ? (S.race.resetAt || null) : undefined;
      for (const item of LS.get(k, [])) {
        const tapOp = item.ops.find(o => /(^|\/)taps\/[^/]+$/.test(o.path));
        if (!tapOp) { removeFrom(k, item.id); continue; }   // crew-list/handicap edits (no tap record): the database sends those itself. Review R3: was "id starts with e or r", which also caught ~1 in 31 real taps
        if (resetAt === undefined) {          // another race: read its "last cleared" marker once
          try { resetAt = (await S.backend.getOnce(tapOp.path.replace(/\/taps\/[^/]+$/, "/config/race"))).resetAt || null; } catch (e) { resetAt = null; }
        }
        if (resetAt && item.at < resetAt) { removeFrom(k, item.id); continue; }   // from before a system reset: never send
        let there = false;
        try { there = await S.backend.exists(tapOp.path); } catch (e) { if (/permission/i.test((e && e.code) || "")) { removeFrom(k, item.id); continue; } break; }
        if (there) { removeFrom(k, item.id); continue; }
        try { await S.backend.commit(item.ops); removeFrom(k, item.id); }
        catch (e) { console.error("replay", e); if (/permission/i.test(e.code || "")) removeFrom(k, item.id); else break; }
      }
    }
  } finally { replaying = false; changed(); }
}

function baseTap(kind, inst, bow, tDevice) {
  const off = S.offset ? S.offset.ms : 0;
  return {
    raceId: RACE_ID,                          // F-X4: the rules check it matches the race in the path
    instance: inst, bow: bow == null ? null : Number(bow), kind, value: null, field: null,
    tDevice: tDevice == null ? null : tDevice, offset: off, offsetChecked: offsetValid(),
    tCorrected: tDevice == null ? null : tDevice + off,
    deviceId: S.deviceId, user: S.user ? S.user.email : null, page: S.page
  };
}
const myTaps = {};                            // `${inst}:${bow}:${field}` -> local time of my tap

/** Log a start or finish. Returns the corrected time. */
export function logTime(field, bow, tDevice, inst = S.instance) {
  if (!isLive()) { toast("Timing is closed for this race"); return null; }   // F-X3: START / FINISH only while the race is Live
  const id = S.backend.newId();
  const tap = baseTap(field, inst, bow, tDevice);
  const patch = { [String(bow)]: { [field]: tap.tCorrected, [field + "Tap"]: id } };
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/" + inst, data: patch }], tap);
  myTaps[`${inst}:${bow}:${field}`] = Date.now();
  setTimeout(changed, GUARD_MS + 100);                    // re-enable Undo once the guard has passed
  vibrate();
  return tap.tCorrected;
}
/** Undo = a "void" record; the original tap is never deleted (F-S5). */
export function voidField(field, bow, inst = S.instance) {
  const id = S.backend.newId(); const cur = timing(inst, bow);
  const tap = { ...baseTap("void", inst, bow, null), field, value: cur[field + "Tap"] || null };
  const patch = { [String(bow)]: { [field]: null, [field + "Tap"]: null } };
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/" + inst, data: patch }], tap);
  delete myTaps[`${inst}:${bow}:${field}`];
}
export function setStatus(bow, status, inst = S.instance) {
  if (!status) return voidField("status", bow, inst);
  const id = S.backend.newId();
  const tap = { ...baseTap("status", inst, bow, null), value: status };
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/" + inst, data: { [String(bow)]: { status, statusTap: id } } }], tap);
}
/** Double-tap guard: true for 2 s after this phone logged that start/finish (Undo sits where the button was). */
export const GUARD_MS = 2000;
export function justTapped(field, bow, inst = S.instance) {
  const t = myTaps[`${inst}:${bow}:${field}`];
  return !!(t && Date.now() - t < GUARD_MS);
}
export function undoNeedsConfirm(field, bow, inst = S.instance) {
  const t = myTaps[`${inst}:${bow}:${field}`];
  return !(t && Date.now() - t < UNDO_FREE_MS);
}

/** Swap one field (start or finish) between two crews in one instance - one atomic write, logged as a "swap" tap. */
export function swapField(field, bowA, bowB, inst = S.instance) {
  const a = timing(inst, bowA), b = timing(inst, bowB);
  const id = S.backend.newId();
  const tap = { ...baseTap("swap", inst, bowA, null), field, value: Number(bowB),
    note: `${field} ${bowA}: ${a[field] ?? "-"} <-> ${bowB}: ${b[field] ?? "-"}` };
  const patch = {
    [String(bowA)]: { [field]: b[field] ?? null, [field + "Tap"]: b[field + "Tap"] ?? null },
    [String(bowB)]: { [field]: a[field] ?? null, [field + "Tap"]: a[field + "Tap"] ?? null }
  };
  const id2 = S.backend.newId();                                         // a matching record for the other crew, so both histories show it
  const tap2 = { ...tap, bow: Number(bowB), value: Number(bowA) };
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap }, { path: "taps/" + id2, create: true, data: tap2 }, { path: "timings/" + inst, data: patch }], tap);
  myTaps[`${inst}:${bowA}:${field}`] = 0; myTaps[`${inst}:${bowB}:${field}`] = 0;
}

/** Flag a crew for review, with optional notes. Kept with the instance's timings (starters and finishers
    can write there; the entries table is admin-only) and shown in Notes on Race Configuration and on Race Adjudication. */
export function flagForReview(bow, text, inst = S.instance) {
  const id = S.backend.newId();
  const tap = { ...baseTap("flag", inst, bow, null), value: text || "" };
  const flag = { text: text || "", by: S.role || (S.user ? S.user.email : ""), at: Date.now(), page: S.page, done: false };
  const ops = [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/" + inst, data: { [String(bow)]: { flags: { [id]: flag } } } }];
  if (inst === "B") ops.push({ path: "timings/A", data: { [String(bow)]: { bflags: { [id]: true } } } });   // public "Check" marker (23 Oct)
  writeOps(id, ops, tap);
}
export function resolveFlag(bow, flagId, inst) {
  const id = S.backend.newId();
  const tap = { ...baseTap("flag-resolved", inst, bow, null), value: flagId };
  const ops = [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/" + inst, data: { [String(bow)]: { flags: { [flagId]: { done: true, doneBy: S.user ? S.user.email : "" } } } } }];
  if (inst === "B") ops.push({ path: "timings/A", data: { [String(bow)]: { bflags: { [flagId]: false } } } });
  writeOps(id, ops, tap);
}
/** Open review flags for a crew, across A and B: [{inst, id, text, by, at}] */
export function flagsOf(bow, onlyOpen = true) {
  const out = [];
  for (const inst of ["A", "B"]) for (const [id, f] of Object.entries(timing(inst, bow).flags || {}))
    if (f && (!onlyOpen || !f.done)) out.push({ inst, id, ...f });
  return out.sort((x, y) => x.at - y.at);
}

/* Shared crew-menu actions for Starter and Finisher (Steve, 22 Oct) */
export async function swapFlow(field, bow) {
  const label = field === "start" ? "start" : "finish";
  const other = await numberPrompt(`Swap ${label} time for ${bow}`, `Which crew's bow number should ${bow} swap its ${label} time with?`);
  if (other == null) return;
  if (other === Number(bow)) { toast("That's the same crew"); return; }
  if (!S.entries[String(other)]) { toast(`No bow ${other}`); return; }
  const a = timing(S.instance, bow)[field], b = timing(S.instance, other)[field];
  if (a == null && b == null) { toast(`Neither crew has a ${label} time`); return; }
  if (await confirmBox(`Swap ${bow} with ${other}?`, `${bow}: ${fmtClock(a) || "no time"}  ⇄  ${other}: ${fmtClock(b) || "no time"}. Each crew takes the other's ${label} time.`, "Confirm")) {
    swapField(field, bow, other); toast(`${label[0].toUpperCase() + label.slice(1)} times swapped: ${bow} ⇄ ${other}`);
  }
}
export async function flagFlow(bow) {
  const txt = await textPrompt(`Flag ${bow} for review`, "Optional: a few words on what happened. They go into the crew's notes for later review.", "Flag", "e.g. clashed blades at the bridge");
  if (txt == null) return;
  flagForReview(bow, txt); toast(`${bow} flagged for review`);
}
/* One-tap Flag on Starter / Finisher (Steve, 23 Oct): no note, no question - the timing team is mid-race; it is tidied up
   on Race Adjudication later. hasOpenFlag drives the button's "pressed" colour. */
export const hasOpenFlag = bow => flagsOf(bow).length > 0;
export function quickFlag(bow) {
  if (hasOpenFlag(bow)) { toast(`${bow} is already flagged - it's cleared on Race Adjudication`); return; }
  flagForReview(bow, "", S.instance); vibrate(); toast(`⚑ ${bow} flagged for review`);
}
/* "Add note" (replaces Flag for review in the ⋯ menu): a note from the timing team, shown with the crew's Notes on
   Race Configuration and in its Review window on Race Adjudication. Stored with the instance's times (timers can write
   there); it is not a flag and doesn't show "Check" on Results. */
export function addNote(bow, text, inst = S.instance) {
  const id = S.backend.newId();
  const tap = { ...baseTap("note", inst, bow, null), value: text };
  const note = { text, by: S.role || (S.user ? S.user.email : ""), at: Date.now(), page: S.page };
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/" + inst, data: { [String(bow)]: { tnotes: { [id]: note } } } }], tap);
}
export function notesOf(bow) {
  const out = [];
  for (const inst of ["A", "B"]) for (const [id, n] of Object.entries(timing(inst, bow).tnotes || {})) if (n && n.text) out.push({ inst, id, ...n });
  return out.sort((x, y) => x.at - y.at);
}
export async function noteFlow(bow) {
  const txt = await textPrompt(`Add a note for ${bow}`, "It goes with the crew's notes on Race Configuration and Race Adjudication.", "Add note", "e.g. clashed blades at the bridge");
  if (!txt) return;
  addNote(bow, txt); toast(`Note added for ${bow}`);
}
export const flagBadge = bow => flagsOf(bow).length ? `<div class="fl">⚑ Flagged for review</div>` : "";

/** Race Adjudication: mark a crew as checked ("Resolved"). Stored with instance A (the official record) together with
    a fingerprint of the differences seen at the time; if anything changes afterwards the crew is flagged again.
    Also resolves any open "Flag for review" notes on the crew. */
export function markReviewed(bow, sig, note) {
  const id = S.backend.newId();
  const tap = { ...baseTap("reviewed", "A", bow, null), value: note || "", note: sig };
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap },
    { path: "timings/A", data: { [String(bow)]: { reviewed: { sig, note: note || "", at: Date.now(), by: S.user ? S.user.email : "" } } } }], tap);
  for (const f of flagsOf(bow)) resolveFlag(bow, f.id, f.inst);
}
export function reopenReview(bow) {
  const id = S.backend.newId();
  const tap = { ...baseTap("review-reopened", "A", bow, null) };
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/A", data: { [String(bow)]: { reviewed: null } } }], tap);
}

/** Admin: clear every start (or finish) time in one instance. Logged as one "reset" tap; nothing is deleted from the log. */
export function resetField(field, inst) {
  const T = S.timings[inst] || {}; const patch = {}; let n = 0;
  for (const [bow, t] of Object.entries(T)) if (t && t[field] != null) { patch[bow] = { [field]: null, [field + "Tap"]: null }; n++; }
  if (!n) return 0;
  const id = S.backend.newId();
  const tap = { ...baseTap("reset", inst, null, null), field, value: n };
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/" + inst, data: patch }], tap);
  return n;
}

/** Admin (Race Adjudication, F-K7): set or clear one start/finish/status in one instance, with a reason.
    Logged as an "adjust" tap; earlier taps are untouched. value = corrected ms, a status string, or null. */
export function adjust(inst, bow, field, value, reason, source = null) {
  const id = S.backend.newId();
  const tap = { ...baseTap("adjust", inst, bow, null), field, value: value == null ? null : value, reason: reason || "", source };
  if (field !== "status") tap.tCorrected = value;
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/" + inst, data: { [String(bow)]: { [field]: value == null ? null : value, [field + "Tap"]: value == null ? null : id } } }], tap);
}

/** Admin: write a patch to the entries table (merge). null removes a bow. */
export function saveEntries(patch) {
  const id = "e" + rid(12);
  writeOps(id, [{ path: "config/entries", data: patch }], null);
}

/* ---- 10. Server clock offset (T-T2, T-T3) ------------------------- */
let measuring = false;
/** D8: a clock check only counts for a race if it was made with that race open, today (review R9: Thursday's offset reused on Saturday). */
const ukDay = ms => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
export const todayUK = () => ukDay(serverNow());
export function offsetValid() { return !!(S.offset && S.offset.race === RACE_ID && ukDay(S.offset.at) === ukDay(Date.now())); }
export async function measureOffset() {
  if (measuring || !S.user || !navigator.onLine) return; measuring = true;
  try {
    const id = (S.user.uid || "u") + "_" + S.deviceId; let best = null;
    for (let i = 0; i < 3; i++) {
      const p = await Promise.race([S.backend.clockProbe(id), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
      const rtt = p.t1 - p.t0; const ms = Math.round(p.server - (p.t0 + p.t1) / 2);
      if (rtt < 1000 && (!best || rtt < best.rtt)) best = { ms, rtt };     // review R8: a slow round trip can be 1-2 s lopsided; keep the last good offset instead
    }
    if (best) {
      S.offset = { ...best, at: Date.now(), race: RACE_ID }; LS.set("sbh.offset", S.offset);   // phone-level (D8): the error is in the phone's clock
      if (S.raceDoc && !isArchived())         // D8: each check is also recorded with the race, for the hub's Clock check panel
        S.backend.commit([{ path: RP("clocks/" + id), data: { deviceId: S.deviceId, user: S.user.email, role: S.realRole, page: S.page, instance: S.instance, offset: best.ms, rtt: best.rtt, at: Date.now() } }]).catch(e => console.warn("clock record", e));
    }
  } catch (e) { console.warn("offset", e); }
  finally { measuring = false; changed(); }
}

/* ---- 11. Common UI: top bar, sync light, sign-in, dialogs ---------- */
export function mountBar(host, { instance = true, division = true, allowAll = false, confirmSwitch = false, instanceHidden = false } = {}) {
  host.innerHTML = `
    <div class="sbh-race" aria-live="polite"></div>
    <div class="sbh-bar">
      ${instance ? `<div class="seg inst" role="group" aria-label="Instance"${instanceHidden ? " hidden" : ""}>
        <button type="button" data-i="A">A</button><button type="button" data-i="B">B</button></div>` : ""}
      ${division ? `<div class="seg div" role="group" aria-label="Division">
        ${DIVS.map(d => `<button type="button" data-d="${d}" aria-label="Division ${d}"><small>Div</small>${d}</button>`).join("")}
        ${allowAll ? `<button type="button" data-d="all">All</button>` : ""}</div>` : ""}
      <div class="clock" aria-live="off"><span class="clk">--:--:--.-</span><small class="clk-note"></small></div>
      <button type="button" class="sync" aria-label="Sync status and settings"><span class="dot"></span><span class="txt">…</span></button>
    </div>
    <div class="sbh-datewarn" hidden></div>
    <div class="sbh-banner" hidden></div>
    <div class="sbh-settings" hidden></div>`;
  $$(".inst button", host).forEach(b => b.addEventListener("click", async () => {
    const i = b.dataset.i; if (i === S.instance) return;
    if (confirmSwitch && !(await confirmBox(`Switch this phone to instance ${i}?`, `Taps from now on go to instance ${i}. Only do this if you were told to.`, `Switch to ${i}`))) return;
    S.instance = i; if (confirmSwitch) LS.set(rkey("instance"), i); changed();   // review R1: only Starter/Finisher remember A/B; other pages change it for this visit only
  }));
  host._allowAll = allowAll;
  $(".div", host)?.addEventListener("click", e => {          // one listener: the buttons are redrawn when the race's divisions arrive
    const b = e.target.closest("button[data-d]"); if (!b) return;
    const d = b.dataset.d === "all" ? "all" : Number(b.dataset.d);
    S.division = d; SS.set(rkey("div"), d); changed();
  });
  $(".sync", host).addEventListener("click", () => { if (S.user) toggleSettings(host); });   // details panel for signed-in officials only
  const clk = $(".clk", host);
  const tick = () => { clk.textContent = fmtClock(serverNow()); };
  tick(); setInterval(tick, 100);
  onChange(() => paintBar(host));
  paintBar(host);
}
function paintBar(host) {
  const seg = $(".div", host), want = DIVS.join(",") + (host._allowAll ? ",all" : "");
  if (seg && seg.dataset.has !== want) {
    seg.dataset.has = want;
    seg.innerHTML = DIVS.map(d => `<button type="button" data-d="${d}" aria-label="Division ${d}"><small>Div</small>${d}</button>`).join("") + (host._allowAll ? `<button type="button" data-d="all">All</button>` : "");
  }
  const rt = $(".sbh-race", host);
  if (rt) rt.textContent = S.raceDoc ? raceShort() + (isLive() ? "" : " · " + (RACE_STATUS_LABEL[raceStatus()] || raceStatus())) : "";
  const dw = $(".sbh-datewarn", host), rd = S.raceDoc && S.raceDoc.date;     // F-X8, Starter and Finisher only; never blocks a tap
  if (dw) {
    const show = ["start", "finish"].includes(S.page) && rd && rd !== todayUK();
    dw.hidden = !show;
    if (show) { const f = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
      dw.textContent = `This race is dated ${f(rd)} — today is ${f(todayUK())}. Check you have this week's link.`; }
  }
  document.body.classList.toggle("closed", !!S.raceDoc && !isLive() && ["start", "finish"].includes(S.page));   // F-X3
  $$(".inst button", host).forEach(b => b.classList.toggle("on", b.dataset.i === S.instance));
  host.querySelector(".sbh-bar")?.setAttribute("data-inst", S.instance);
  document.documentElement.dataset.inst = S.instance;
  const cd = String(currentDivision());
  $$(".div button", host).forEach(b => b.classList.toggle("on", b.dataset.d === cd));
  const note = $(".clk-note", host);
  if (note) note.textContent = S.user ? (offsetValid() ? "" : "clock not checked") : (S.offset ? "" : "phone time");
  // T-T3 clock warning
  const ban = $(".sbh-banner", host);
  if (S.offset && Math.abs(S.offset.ms) > OFFSET_WARN_MS) {
    showBanner(`This phone's clock is ${(Math.abs(S.offset.ms) / 1000).toFixed(1)} s ${S.offset.ms > 0 ? "slow" : "fast"} - check Settings › Date & time › Automatic. Times are being corrected.`, "amber", ban);
  } else if (S.ledgerError) {
    showBanner(S.ledgerError, "red", ban);
  } else if (ban && ban.dataset.auto) { ban.hidden = true; }
  if (ban && ban.dataset.conn && !S.fromCache) { ban.hidden = true; delete ban.dataset.conn; }   // connection came back
  if (!$(".sbh-settings", host).hidden) paintSettings(host);
}
export function showBanner(text, tone = "amber", el = $(".sbh-banner")) {
  if (!el) return; el.textContent = text; el.className = "sbh-banner " + tone; el.hidden = false; el.dataset.auto = "1";
}
export function updateLight() {
  const b = $(".sync"); if (!b) return;
  const pending = allPending();                // every race's waiting taps on this phone
  const connected = navigator.onLine && !S.fromCache;
  let tone = "green", txt = "All saved";
  if (!connected) { tone = "red"; txt = pending ? `Offline · ${pending} waiting` : "Offline"; }
  else if (pending) { tone = "amber"; txt = `Sending ${pending}…`; }
  if (!S.user && !pending) txt = connected ? "Live" : "Offline";
  b.dataset.tone = tone; $(".txt", b).textContent = txt;
}
function toggleSettings(host) { const p = $(".sbh-settings", host); p.hidden = !p.hidden; if (!p.hidden) paintSettings(host); }
function paintSettings(host) {
  const p = $(".sbh-settings", host);
  const o = S.offset;
  p.innerHTML = `
    <dl>
      <dt>Signed in</dt><dd>${S.user ? esc(S.user.email) + ` <button type="button" class="link so">Sign out</button>` : "No (read only)"}</dd>
      <dt>Instance</dt><dd>${S.instance}</dd>
      <dt>This phone</dt><dd>${esc(S.deviceId)}</dd>
      <dt>Clock offset</dt><dd>${o ? `${o.ms > 0 ? "+" : ""}${o.ms} ms (round trip ${o.rtt} ms, checked ${fmtClock(o.at).slice(0, 8)})` : "not checked yet"}
        ${S.user ? `<button type="button" class="link chk">Check now</button>` : ""}</dd>
      <dt>Waiting to send</dt><dd>${ledger().length}</dd>
      <dt>Backend</dt><dd>${S.mock ? "LOCAL TEST MODE" : "Firebase" + (S.backend && S.backend.safe ? " - SAFE MODE (no on-device cache)" : S.backend && S.backend.persistent === false ? " (no offline cache!)" : "")}
        ${S.backend && S.backend.safe ? `<button type="button" class="link nosafe">Leave safe mode</button>` : ""}</dd>
      <dt>Connected</dt><dd>${navigator.onLine ? (S.fromCache ? "No - waiting for the database" : "Yes") : "No - phone offline"}</dd>
      <dt>Last error</dt><dd>${S.lastError ? esc(fmtClock(S.lastError.at).slice(0, 8) + " " + S.lastError.msg) : "none"}</dd>
    </dl>
    ${S.user ? `<button type="button" class="btn small dl">Download this phone's tap log (CSV)</button>` : ""}
    <button type="button" class="btn small close">Close</button>`;
  p.querySelector(".so")?.addEventListener("click", async () => { if (await confirmBox("Sign out?", "You'll need the password to sign back in.", "Sign out")) S.backend.signOut(); });
  p.querySelector(".chk")?.addEventListener("click", () => measureOffset());
  p.querySelector(".nosafe")?.addEventListener("click", () => { LS.set("sbh.safeMode", 0); location.reload(); });
  p.querySelector(".dl")?.addEventListener("click", downloadLocalLog);
  p.querySelector(".close").addEventListener("click", () => (p.hidden = true));
}
function downloadLocalLog() {
  const rows = [["Tap id", "Instance", "Bow#", "Kind", "Value", "Field", "Phone time", "Offset ms", "Corrected time", "User", "Device"]];
  for (const t of LS.get(LOG, [])) rows.push([t.id, t.instance, t.bow, t.kind, t.value, t.field, fmtClock(t.tDevice), t.offset, fmtClock(t.tCorrected), t.user, t.deviceId]);
  downloadCSV(csvName(`taplog-${S.deviceId}`), rows);
}

/** Sign-in gate. Resolves once signed in with one of the allowed roles. */
export function requireRole(host, roles, defaultRole, opts = {}) {   // opts: { lead, wrong } - wording for the pages above a race
  return new Promise(resolve => {
    const draw = () => {
      if (S.user && roles.includes(S.role) && S.raceState === "ok") { host.hidden = true; host.innerHTML = ""; resolve(); return true; }
      host.hidden = false;
      if (S.user && roles.includes(S.role)) { host.innerHTML = `<p class="note">Opening the race…</p>`; return false; }
      const wrong = S.authUser && !roles.includes(S.role);
      const opts2 = [...new Set(roles.includes("admin") ? roles.flatMap(r => r === "admin" ? ["admin", "raceadmin"] : [r]) : roles)];
      host.innerHTML = `
        <form class="signin">
          <h2>Sign in</h2>
          ${opts.lead ? `<p>${esc(opts.lead)}</p>` : ""}
          ${wrong ? `<p class="warn">${opts.wrong ? esc(opts.wrong) : `Signed in as ${esc(S.authUser.email)}, which can't use this page${S.realRole === "raceadmin" ? " (this race belongs to another race admin)" : ""}. Sign in as ${opts2.map(r => ROLE_LABEL[r]).join(" or ")}.`}</p>` : ""}
          <label>Role
            <select name="role">${opts2.map(r => `<option value="${r}" ${r === defaultRole ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select>
          </label>
          <label>Password <input name="pw" type="password" autocomplete="current-password" required></label>
          <button class="btn big" type="submit">Sign in</button>
          <p class="err" hidden></p>
        </form>`;
      $("form", host).addEventListener("submit", async ev => {
        ev.preventDefault();
        const f = ev.target; const err = $(".err", host); err.hidden = true;
        f.querySelector("button").disabled = true;
        try { await S.backend.signIn(ROLE_EMAIL[f.role.value], f.pw.value); }
        catch (e) { err.textContent = /network/i.test(e.code || "") ? "No connection - you need signal to sign in the first time." : "Wrong password, or that account isn't set up."; err.hidden = false; f.querySelector("button").disabled = false; }
      });
      return false;
    };
    authReady.then(() => { if (!draw()) onChange(() => { if (!host.hidden && S.user && roles.includes(S.role)) draw(); else if (host.hidden && !(S.user && roles.includes(S.role))) location.reload(); }); });
  });
}

export function confirmBox(title, body = "", ok = "Yes", cancel = "Cancel") {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "sbh-modal";
    d.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ""}
      <div class="row"><button type="button" class="btn big no">${esc(cancel)}</button><button type="button" class="btn big yes">${esc(ok)}</button></div></div>`;
    const done = v => { d.remove(); res(v); };
    d.querySelector(".no").addEventListener("click", () => done(false));
    d.querySelector(".yes").addEventListener("click", () => done(true));
    document.body.appendChild(d); d.querySelector(".yes").focus();
  });
}
export function typedConfirm(title, body, word, ok = "Confirm") {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "sbh-modal";
    d.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(body)}</p>
      <p>Type <b>${esc(word)}</b> to confirm:</p><input class="typed" autocomplete="off" autocapitalize="characters" style="font:700 20px/1 var(--sans);padding:10px;width:100%;border:2px solid #0E1621;border-radius:10px;margin-bottom:12px">
      <div class="row"><button type="button" class="btn big no">Cancel</button><button type="button" class="btn big yes danger" disabled>${esc(ok)}</button></div></div>`;
    const inp = d.querySelector(".typed"), yes = d.querySelector(".yes");
    inp.addEventListener("input", () => (yes.disabled = inp.value.trim().toUpperCase() !== word.toUpperCase()));
    const done = v => { d.remove(); res(v); };
    d.querySelector(".no").addEventListener("click", () => done(false));
    yes.addEventListener("click", () => done(true));
    document.body.appendChild(d); inp.focus();
  });
}
/** Ask for a bow number with the phone's number pad. Resolves to a number, or null if cancelled. */
export function numberPrompt(title, body = "", ok = "Next") {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "sbh-modal";
    d.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ""}
      <input class="typed" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="done"
        style="font:800 30px/1 var(--sans);padding:12px;width:100%;border:2px solid #0E1621;border-radius:10px;margin-bottom:12px;text-align:center;letter-spacing:2px">
      <div class="row"><button type="button" class="btn big no">Cancel</button><button type="button" class="btn big yes" disabled>${esc(ok)}</button></div></div>`;
    const inp = d.querySelector(".typed"), yes = d.querySelector(".yes");
    inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, ""); yes.disabled = !inp.value; });
    const done = v => { d.remove(); res(v); };
    d.querySelector(".no").addEventListener("click", () => done(null));
    yes.addEventListener("click", () => done(Number(inp.value)));
    inp.addEventListener("keydown", e => { if (e.key === "Enter" && inp.value) done(Number(inp.value)); });
    document.body.appendChild(d); inp.focus();
  });
}
/** Ask for a short note. Resolves to the text ("" allowed), or null if cancelled. */
export function textPrompt(title, body = "", ok = "Save", placeholder = "") {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "sbh-modal";
    d.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ""}
      <textarea class="typed" rows="3" maxlength="300" placeholder="${esc(placeholder)}"
        style="font:500 17px/1.35 var(--sans);padding:10px;width:100%;border:2px solid #0E1621;border-radius:10px;margin-bottom:12px"></textarea>
      <div class="row"><button type="button" class="btn big no">Cancel</button><button type="button" class="btn big yes">${esc(ok)}</button></div></div>`;
    const inp = d.querySelector(".typed");
    const done = v => { d.remove(); res(v); };
    d.querySelector(".no").addEventListener("click", () => done(null));
    d.querySelector(".yes").addEventListener("click", () => done(inp.value.trim()));
    document.body.appendChild(d); inp.focus();
  });
}
export function menuBox(title, items) {       // items: [{label, value, danger}]
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "sbh-modal";
    d.innerHTML = `<div class="box"><h3>${esc(title)}</h3><div class="col">${items.map((it, i) => `<button type="button" class="btn big ${it.danger ? "danger" : ""}" data-i="${i}">${esc(it.label)}</button>`).join("")}
      <button type="button" class="btn big no">Cancel</button></div></div>`;
    d.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; d.remove(); res(b.classList.contains("no") ? null : items[+b.dataset.i].value); });
    document.body.appendChild(d);
  });
}
export function toast(text) {
  let t = $(".sbh-toast"); if (!t) { t = document.createElement("div"); t.className = "sbh-toast"; document.body.appendChild(t); }
  t.textContent = text; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2500);
}
function vibrate() { try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} }

/* ---- 12. CSV ------------------------------------------------------- */
export function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ""));
}
function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;      // stop Excel treating text as a formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function downloadCSV(name, rows) {
  const blob = new Blob(["﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
