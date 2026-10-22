/* =====================================================================
   sbh.js - Burway Small Boats Head 2026 - fallback timing system
   Shared core: connection, sign-in, clock, data helpers (brief T-B2).
   Spec of record: "SBH 2026 Timing System - Design Brief (V00.01).md"
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
  admin:    "sbh-admin@dewhurst.tech",
  starter:  "sbh-starter@dewhurst.tech",
  finisher: "sbh-finisher@dewhurst.tech"
};
export const DIVS = [1, 2, 3];
export const DIV_STARTS = { 1: "10:00", 2: "12:00", 3: "14:00" };   // F-K8 defaults
export const STATUSES = ["", "DNS", "DNF", "DSQ", "Withdrawn"];
const UNDO_FREE_MS   = 30000;               // F-S5
const OFFSET_WARN_MS = 2000;                // T-T3
const OFFSET_EVERY   = 5 * 60 * 1000;       // T-T2
const TZ = "Europe/London";                 // T-T5

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
  instance: LS.get("sbh.instance", "A") === "B" ? "B" : "A",
  division: SS.get("sbh.div", null),          // null = automatic (F-C3)
  fromCache: true,
  page: document.body ? (document.body.dataset.page || "") : "",
  ledgerError: null,
  pointerDown: false
};
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
  const now = ukMinutesNow(); let d = 1;
  for (const k of DIVS) { const [h, m] = DIV_STARTS[k].split(":").map(Number); if (now >= h * 60 + m) d = k; }
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
  return local && (q.has("mock") || /^PASTE/.test(FIREBASE_CONFIG.apiKey));     // test mode only ever on a local machine
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
    signOut: () => au.signOut(auth),
    watchDoc(path, cb, onErr) {
      return fs.onSnapshot(ref(path), { includeMetadataChanges: true },
        snap => cb(snap.exists() ? snap.data() : {}, { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache }),
        err => { console.error(path, err); noteError(err); onErr && onErr(err); });
    },
    async getOnce(path) { const s = await fs.getDoc(ref(path)); return s.exists() ? s.data() : {}; },
    commit(ops) {
      const b = fs.writeBatch(db);
      for (const op of ops) {
        if (op.create) b.set(ref(op.path), { ...op.data, createdAt: fs.serverTimestamp() });
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
    async tapsFor(instance, bow) {
      const q = fs.query(fs.collection(db, "taps"), fs.where("instance", "==", instance), fs.where("bow", "==", Number(bow)));
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

export async function boot({ watch = ["entries", "A", "B"] } = {}) {
  document.documentElement.style.scrollBehavior = "auto";     // site.css sets smooth; rows must not drift under a finger
  S.mock = wantMock();
  if (S.mock) {
    const m = await import("./sbh-mock.js");
    S.backend = await m.mockBackend();
    devSkew = LS.get("sbhmock.skew", 0);
    document.documentElement.classList.add("sbh-mock");
  } else {
    S.backend = await firebaseBackend(FIREBASE_CONFIG);
  }
  S.backend.onAuth(u => {
    S.user = u;
    S.role = u ? (Object.keys(ROLE_EMAIL).find(r => ROLE_EMAIL[r] === (u.email || "").toLowerCase()) || null) : null;
    authReadyResolve();
    if (u) { measureOffset(); replayLedger(); }
    changed();
  });
  if (watch.includes("entries")) watchEntries();
  S.backend.watchDoc("config/race", (data, meta) => { S.race = data || {}; changed(); });
  onChange(paintWho);
  for (const i of ["A", "B"]) if (watch.includes(i)) watchTimings(i);
  addEventListener("online", () => { replayLedger(); changed(); });
  addEventListener("offline", changed);
  setInterval(() => { if (S.user) measureOffset(); }, OFFSET_EVERY);
  setInterval(updateLight, 2000);
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
  S.backend.watchDoc("config/entries", (data, meta) => {
    const out = {};
    for (const [k, v] of Object.entries(data || {})) if (v && typeof v === "object" && v.bow != null) out[k] = v;
    S.entries = out; noteMeta(meta); changed();
  }, () => showBanner("Can't read the entries table. Check the connection.", "red"));
}
export function watchTimings(inst) {
  if (watching[inst]) return; watching[inst] = true;
  S.backend.watchDoc("timings/" + inst, (data, meta) => {
    S.timings[inst] = data || {}; noteMeta(meta); changed();
  });
}

function paintWho() {
  const w = document.getElementById("who"); if (!w) return;
  if (!S.user) { w.innerHTML = "Not signed in"; return; }
  const r = S.role ? S.role[0].toUpperCase() + S.role.slice(1) : S.user.email;
  w.innerHTML = `Signed in: <b>${esc(r)}</b> <button type="button" class="link">Sign out</button>`;
  w.querySelector("button").onclick = async () => { if (await confirmBox("Sign out?", "You'll need the password to sign back in.", "Sign out")) S.backend.signOut(); };
}
export const officialInstance = () => "A";      // Steve, 21 Oct: the public sees instance A only
export function saveRace(patch) { writeOps("r" + rid(12), [{ path: "config/race", data: patch }], null); }

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

/* Results for one instance.
   rt  = race time (finish - start), tenths of a second. pt = race time + penalty. pos = place across the whole event (all divisions) on adjusted time.
   adj = adjusted time = race time + penalty - handicap (tenths). posEv = place on adjusted time
         among crews in the same event - or the same event combination - across all divisions. */
export function computeResults(inst) {
  const rows = entryList("all").map(e => {
    const t = timing(inst, e.bow); const st = statusOf(inst, e.bow);
    let rt = OUT_ST.includes(st) ? null : raceTenths(t.start, t.finish);
    let note = st;
    if (rt != null && rt <= 0) { note = "Check"; rt = null; }
    if (!note && rt == null) note = t.start != null ? (t.finish != null ? "" : "On water") : "";
    const combo = comboOf(e.event); const hc = combo ? combo.handicap : 0; const pen = penaltyOf(e);
    const pt = rt == null ? null : rt + Math.round(pen * 10);            // time + penalty: used for overall Pos
    const adj = rt == null ? null : pt - Math.round(hc * 10);            // adjusted: penalty and handicap, used for Pos in event
    return { e, t, st, rt, pt, adj, hc, pen, combo, group: combo ? "combo:" + combo.id : "event:" + e.event, note, pos: null, posEv: null };
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
const LEDGER = "sbh.ledger", LOG = "sbh.log";
export const ledger = () => LS.get(LEDGER, []);
function ledgerRemove(id) { LS.set(LEDGER, ledger().filter(x => x.id !== id)); changed(); }

function writeOps(id, ops, tap) {
  // 1) keep it on the phone, synchronously, before anything is sent
  const L = ledger(); L.push({ id, ops, at: Date.now() });
  const okLocal = LS.set(LEDGER, L);
  if (tap) { const log = LS.get(LOG, []); log.push({ id, ...tap }); if (log.length > 5000) log.splice(0, log.length - 5000); LS.set(LOG, log); }
  if (!okLocal) showBanner("This phone's storage is full - taps are not backed up locally. Keep the paper sheet going.", "amber");
  // 2) hand to the backend (it also queues offline)
  S.backend.commit(ops).then(() => ledgerRemove(id)).catch(err => {
    console.error("commit failed", err);
    const code = (err && err.code) || String(err);
    if (/permission/i.test(code)) { S.ledgerError = "Server refused a tap (" + code + "). Sign out and back in."; LS.set(LEDGER, ledger().filter(x => x.id !== id)); }
    else S.ledgerError = "Tap not yet saved: " + code;
    changed();
  });
  changed();
}

let replaying = false;
async function replayLedger() {
  if (replaying || !S.user || !navigator.onLine) return; replaying = true;
  try {
    await S.backend.pendingDone();            // let the SDK flush its own queue first
    for (const item of ledger()) {
      if (item.id[0] === "e" || item.id[0] === "r") { ledgerRemove(item.id); continue; }   // entries edits: SDK has flushed them
      let there = false;
      try { there = await S.backend.exists("taps/" + item.id); } catch (e) { break; }
      if (there) { ledgerRemove(item.id); continue; }
      try { await S.backend.commit(item.ops); ledgerRemove(item.id); }
      catch (e) { console.error("replay", e); if (/permission/i.test(e.code || "")) ledgerRemove(item.id); else break; }
    }
  } finally { replaying = false; changed(); }
}

function baseTap(kind, inst, bow, tDevice) {
  const off = S.offset ? S.offset.ms : 0;
  return {
    instance: inst, bow: bow == null ? null : Number(bow), kind, value: null, field: null,
    tDevice: tDevice == null ? null : tDevice, offset: off, offsetChecked: !!S.offset,
    tCorrected: tDevice == null ? null : tDevice + off,
    deviceId: S.deviceId, user: S.user ? S.user.email : null, page: S.page
  };
}
const myTaps = {};                            // `${inst}:${bow}:${field}` -> local time of my tap

/** Log a start or finish. Returns the corrected time. */
export function logTime(field, bow, tDevice, inst = S.instance) {
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
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/" + inst, data: { [String(bow)]: { flags: { [id]: flag } } } }], tap);
}
export function resolveFlag(bow, flagId, inst) {
  const id = S.backend.newId();
  const tap = { ...baseTap("flag-resolved", inst, bow, null), value: flagId };
  writeOps(id, [{ path: "taps/" + id, create: true, data: tap }, { path: "timings/" + inst, data: { [String(bow)]: { flags: { [flagId]: { done: true, doneBy: S.user ? S.user.email : "" } } } } }], tap);
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
export async function measureOffset() {
  if (measuring || !S.user || !navigator.onLine) return; measuring = true;
  try {
    const id = (S.user.uid || "u") + "_" + S.deviceId; let best = null;
    for (let i = 0; i < 3; i++) {
      const p = await Promise.race([S.backend.clockProbe(id), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
      const rtt = p.t1 - p.t0; const ms = Math.round(p.server - (p.t0 + p.t1) / 2);
      if (rtt < 5000 && (!best || rtt < best.rtt)) best = { ms, rtt };
    }
    if (best) { S.offset = { ...best, at: Date.now() }; LS.set("sbh.offset", S.offset); }
  } catch (e) { console.warn("offset", e); }
  finally { measuring = false; changed(); }
}

/* ---- 11. Common UI: top bar, sync light, sign-in, dialogs ---------- */
export function mountBar(host, { instance = true, division = true, allowAll = false, confirmSwitch = false, instanceHidden = false } = {}) {
  host.innerHTML = `
    <div class="sbh-bar">
      ${instance ? `<div class="seg inst" role="group" aria-label="Instance"${instanceHidden ? " hidden" : ""}>
        <button type="button" data-i="A">A</button><button type="button" data-i="B">B</button></div>` : ""}
      ${division ? `<div class="seg div" role="group" aria-label="Division">
        ${DIVS.map(d => `<button type="button" data-d="${d}" aria-label="Division ${d}"><small>Div</small>${d}</button>`).join("")}
        ${allowAll ? `<button type="button" data-d="all">All</button>` : ""}</div>` : ""}
      <div class="clock" aria-live="off"><span class="clk">--:--:--.-</span><small class="clk-note"></small></div>
      <button type="button" class="sync" aria-label="Sync status and settings"><span class="dot"></span><span class="txt">…</span></button>
    </div>
    <div class="sbh-banner" hidden></div>
    <div class="sbh-settings" hidden></div>`;
  $$(".inst button", host).forEach(b => b.addEventListener("click", async () => {
    const i = b.dataset.i; if (i === S.instance) return;
    if (confirmSwitch && !(await confirmBox(`Switch this phone to instance ${i}?`, `Taps from now on go to instance ${i}. Only do this if you were told to.`, `Switch to ${i}`))) return;
    S.instance = i; LS.set("sbh.instance", i); changed();
  }));
  $$(".div button", host).forEach(b => b.addEventListener("click", () => {
    const d = b.dataset.d === "all" ? "all" : Number(b.dataset.d);
    S.division = d; SS.set("sbh.div", d); changed();
  }));
  $(".sync", host).addEventListener("click", () => { if (S.user) toggleSettings(host); });   // details panel for signed-in officials only
  const clk = $(".clk", host);
  const tick = () => { clk.textContent = fmtClock(serverNow()); };
  tick(); setInterval(tick, 100);
  onChange(() => paintBar(host));
  paintBar(host);
}
function paintBar(host) {
  $$(".inst button", host).forEach(b => b.classList.toggle("on", b.dataset.i === S.instance));
  host.querySelector(".sbh-bar")?.setAttribute("data-inst", S.instance);
  document.documentElement.dataset.inst = S.instance;
  const cd = String(currentDivision());
  $$(".div button", host).forEach(b => b.classList.toggle("on", b.dataset.d === cd));
  const note = $(".clk-note", host);
  if (note) note.textContent = S.offset ? "" : (S.user ? "clock not checked" : "phone time");
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
  const pending = ledger().length;
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
  downloadCSV(`sbh-taplog-${S.deviceId}.csv`, rows);
}

/** Sign-in gate. Resolves once signed in with one of the allowed roles. */
export function requireRole(host, roles, defaultRole) {
  return new Promise(resolve => {
    const draw = () => {
      if (S.user && roles.includes(S.role)) { host.hidden = true; host.innerHTML = ""; resolve(); return true; }
      host.hidden = false;
      const wrong = S.user && !roles.includes(S.role);
      host.innerHTML = `
        <form class="signin">
          <h2>Sign in</h2>
          ${wrong ? `<p class="warn">Signed in as ${esc(S.user.email)}, which can't use this page. Sign in as ${roles.join(" or ")}.</p>` : ""}
          <label>Role
            <select name="role">${roles.map(r => `<option value="${r}" ${r === defaultRole ? "selected" : ""}>${r[0].toUpperCase() + r.slice(1)}</option>`).join("")}</select>
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
