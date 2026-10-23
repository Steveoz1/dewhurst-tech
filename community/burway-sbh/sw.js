/* sw.js - keeps a copy of the SBH timing pages on the phone so they open with no signal.
   Scope: /community/burway-sbh/ only. Race data itself is handled by Firebase's own offline cache.
   Bump VERSION on every publish so phones pick up the new files. */
const VERSION = "sbh-20261022l";
const FB = "https://www.gstatic.com/firebasejs/12.19.0/";
const LOCAL = [
  "./", "index.html", "config.html", "start.html", "finish.html", "results.html", "adjudicate.html", "handicap.html", "burway-emblem.png",
  "sbh.js", "sbh.css", "page-config.js", "page-start.js", "page-finish.js", "page-results.js", "page-adjudicate.js", "page-handicap.js", "page-home.js",
  "../../assets/site.css", "../../assets/favicon-32.png", "../../brand-lockup-2.w338-h84-c0.jpg",
  "../../assets/fonts/inter-latin-400-normal.woff2", "../../assets/fonts/inter-latin-500-normal.woff2",
  "../../assets/fonts/inter-latin-600-normal.woff2", "../../assets/fonts/inter-latin-700-normal.woff2",
  "../../assets/fonts/source-serif-4-latin-600-normal.woff2", "../../assets/fonts/source-serif-4-latin-700-normal.woff2"
];
const REMOTE = [FB + "firebase-app.js", FB + "firebase-firestore.js", FB + "firebase-auth.js"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // one file failing must not stop the rest being kept
    await Promise.all([...LOCAL, ...REMOTE].map(u => c.add(new Request(u, { cache: "reload" })).catch(err => console.warn("sw: not cached", u, err))));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k.startsWith("sbh-")) await caches.delete(k);
    await self.clients.claim();
  })());
});

const ourOrigin = self.location.origin;
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.href.startsWith(FB)) { e.respondWith(cacheFirst(req)); return; }          // pinned version never changes
  if (url.origin !== ourOrigin) return;                                              // Firestore, sign-in, analytics: leave alone
  e.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const c = await caches.open(VERSION);
  const hit = await c.match(req); if (hit) return hit;
  const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
}
/* Fresh copy when the signal is decent; the kept copy after 3 s or when offline. */
async function networkFirst(req) {
  const c = await caches.open(VERSION);
  const net = fetch(req, { cache: "no-cache" }).then(res => { if (res.ok) c.put(req, res.clone()); return res; });
  net.catch(() => {});
  const timer = new Promise(r => setTimeout(r, 3000));
  try {
    const first = await Promise.race([net, timer]);
    if (first) return first;
  } catch (err) { /* offline - fall through */ }
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  return net;                                                                         // nothing kept: wait for the network
}
