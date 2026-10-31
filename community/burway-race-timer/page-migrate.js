/* One-off: move SBH 2026 from the original single-race layout into race "sbh-2026" (multi-race brief E2).
   Step 1 Export (M-2) -> Step 2 Copy, only when Steve says go (M-3) -> Step 3 Check (M-4) on ?race=sbh-2026&check=1.
   Admin only. The original data is never changed or deleted here (M-5, M-6). */
import { boot, bootRaceless, mountBar, requireRole, S, $, esc, toast, typedConfirm, computeResults, fmtRace, statusOf, entryList, ROLE_EMAIL } from "./sbh.js?v=20261031a";
import { EXPECTED, BOATING } from "./sbh2026-reference.js?v=20261031a";

const ID = "sbh-2026";
const CHECK = new URLSearchParams(location.search).get("check") === "1";
if (CHECK) await boot(); else await bootRaceless();
mountBar($("#bar"), { instance: false, division: false });
await requireRole($("#gate"), ["admin"], "admin", { wrong: "Admin only." });
if (S.realRole !== "admin") { $("#app").innerHTML = `<p class="bad">Admin only.</p>`; await new Promise(() => {}); }
const app = $("#app");
const ONE = ["config/race", "config/entries", "timings/A", "timings/B"];

/* stable text of a value, Firestore Timestamps as milliseconds - for exact comparison */
const norm = v => v && typeof v.toMillis === "function" ? v.toMillis() : (v && typeof v === "object" && "seconds" in v && "nanoseconds" in v && Object.keys(v).length === 2) ? v.seconds * 1000 + Math.floor(v.nanoseconds / 1e6) : v;
const stable = v => { v = norm(v); return Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}" : JSON.stringify(v ?? null); };

async function readOld() {
  const o = {}; for (const p of ONE) o[p] = await S.backend.getOnce(p);
  o.taps = await S.backend.query("taps");
  return o;
}
const counts = o => ({ crews: Object.keys(o["config/entries"]).length, "timings A": Object.keys(o["timings/A"]).length, "timings B": Object.keys(o["timings/B"]).length, taps: o.taps.length,
  "handicap groups": Object.keys((o["config/race"] || {}).combos || {}).length });
const table = c => `<table class="sbh-t"><tbody>${Object.entries(c).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;

if (!CHECK) {
  const old = await readOld(); const c = counts(old);
  const exported = JSON.parse(localStorage.getItem("brt.mig.exported") || "null");
  const there = await S.backend.exists("races/" + ID);
  app.innerHTML = `<h1>Move SBH 2026 into the race structure</h1>
  <div class="panel"><h3>What's there now (the original single-race data)</h3>${table(c)}</div>
  <div class="panel"><h3>Step 1 — Export (the rollback copy)</h3>
    <p>Downloads every original record as one JSON file. Save it, with the Results CSV, in <code>Rowing\\Burway Race Timer\\Migration\\sbh-2026\\</code>.</p>
    <p><button type="button" class="btn primary" id="exp">Download the export</button> ${exported ? `<small class="note">Last downloaded ${new Date(exported.at).toLocaleString("en-GB")}</small>` : ""}</p>
    <p class="note">Also download the Results CSV (both instances): open the <a href="../burway-sbh/results.html">original Results page</a>, signed in, and press <b>Export CSV</b>.</p></div>
  <div class="panel"><h3>Step 2 — Copy into race <code>${ID}</code></h3>
    ${there ? `<p>Race <code>${ID}</code> already exists. ${(await S.backend.getOnce("races/" + ID)).migrating ? "<b class='bad'>The copy didn't finish.</b> Delete the partial race in the Firebase console, then copy again." : "Copy done."}</p>
      <p><a class="btn" href="migrate.html?race=${ID}&check=1">Step 3 — Check it</a></p>`
    : `<p>Copies every record into <code>races/${ID}/…</code> exactly as it is (same IDs, values and server times), adds each crew's boating time, and sets the race to <b>Finished</b> with results <b>Public</b>. The original stays where it is.</p>
      <p><button type="button" class="btn danger" id="copy" ${exported ? "" : "disabled"}>Copy SBH 2026…</button> ${exported ? "" : `<small class="note">Export first.</small>`}</p>`}
    <p id="prog"></p></div>`;
  $("#exp").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), counts: c, documents: { ...Object.fromEntries(ONE.map(p => [p, old[p]])), ...Object.fromEntries(old.taps.map(t => { const { id, ...r } = t; return ["taps/" + id, r]; })) } }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `sbh-2026_original-export_${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove();
    localStorage.setItem("brt.mig.exported", JSON.stringify({ at: Date.now(), counts: c })); toast("Export downloaded"); setTimeout(() => location.reload(), 1200);
  });
  $("#copy")?.addEventListener("click", async () => {
    if (!(await typedConfirm("Copy SBH 2026 now?", `Copies ${c.crews} crews, both sets of times and ${c.taps} tap-log records into race ${ID}. The original isn't changed.`, "COPY SBH 2026", "Copy"))) return;
    const prog = $("#prog"); const say = s => (prog.textContent = s);
    try {
      const cfg = { ...old["config/race"] }; const pub = cfg.resultsPublic === true; delete cfg.resultsPublic;
      const ents = {}; for (const [k, e] of Object.entries(old["config/entries"])) ents[k] = BOATING[k] && !e.boat ? { ...e, boat: BOATING[k] } : e;
      const finished = Object.entries(old["timings/A"]).filter(([b, t]) => ents[b] && t && t.finish != null && !["DNS", "DNF", "DSQ", "Withdrawn"].includes(t.status || ents[b].status || "")).length;
      say("Creating the race…");
      await S.backend.commit([{ path: "races/" + ID, create: true, data: { raceId: ID, title: "Burway Small Boats Head 2026", shortName: "SBH 2026", date: "2026-10-24", firstStart: "10:00",
        location: "Burway Rowing Club", course: "Upstream, approx. 3,000 m", club: "Burway Rowing Club", officialsNotes: "",
        divisions: [{ n: 1, name: "Division 1", start: "10:00", firstBoating: "09:33" }, { n: 2, name: "Division 2", start: "11:30", firstBoating: "11:06" }, { n: 3, name: "Division 3", start: "13:30", firstBoating: "13:09" }],
        resultsNote: "Provisional - subject to penalties and handicaps.", riverMinutes: 13, bowGuide: "Div 1: 151–192 · Div 2: 251–274 · Div 3: 371–392",
        status: "finished", resultsPublic: pub, deleteRequested: false, owner: ROLE_EMAIL.admin, duplicatedFrom: null, migrating: true,
        crewCount: Object.keys(ents).length, finishedCountA: finished, createdBy: S.authUser.email, updatedAt: Date.now(), updatedBy: S.authUser.email } }]);
      say("Copying the crew list, handicaps and times…");
      await S.backend.commit([{ path: `races/${ID}/config/race`, replace: true, data: cfg }, { path: `races/${ID}/config/entries`, replace: true, data: ents },
        { path: `races/${ID}/timings/A`, replace: true, data: old["timings/A"] }, { path: `races/${ID}/timings/B`, replace: true, data: old["timings/B"] }]);
      for (let i = 0; i < old.taps.length; i += 400) {
        say(`Copying the tap log… ${Math.min(i + 400, old.taps.length)} of ${old.taps.length}`);
        await S.backend.commit(old.taps.slice(i, i + 400).map(t => { const { id, ...r } = t; return { path: `races/${ID}/taps/${id}`, replace: true, data: r }; }));
      }
      await S.backend.commit([{ path: "races/" + ID, data: { migrating: false, migratedAt: Date.now() } }]);
      say("Copied. Now check it."); location.href = `migrate.html?race=${ID}&check=1`;
    } catch (e) { say("Stopped: " + (e.code || e.message || e) + ". Nothing in the original was changed."); }
  });
} else {
  /* Step 3 - Check (M-4): counts, every A/B time and status, every record, and Results against the published file */
  const old = await readOld();
  const rows = []; const add = (what, ok, detail = "") => rows.push({ what, ok, detail });
  const cn = {}; for (const p of ONE) cn[p] = await S.backend.getOnce(`races/${ID}/${p}`);
  cn.taps = await S.backend.query(`races/${ID}/taps`);
  const co = counts(old), cnew = counts(cn);
  for (const k of Object.keys(co)) add(`Count — ${k}`, co[k] === cnew[k], `${co[k]} original, ${cnew[k]} in ${ID}`);
  let bad = [];
  for (const inst of ["A", "B"]) for (const b of new Set([...Object.keys(old["timings/" + inst]), ...Object.keys(cn["timings/" + inst])]))
    for (const f of ["start", "finish", "status"]) if ((old["timings/" + inst][b] || {})[f] != (cn["timings/" + inst][b] || {})[f]) bad.push(`${inst} ${b} ${f}`);
  add("Every A and B start, finish and status identical", !bad.length, bad.slice(0, 8).join(", "));
  add("Timings records identical (flags, notes, Resolves, issues)", stable(old["timings/A"]) === stable(cn["timings/A"]) && stable(old["timings/B"]) === stable(cn["timings/B"]));
  const cfgOld = { ...old["config/race"] }; delete cfgOld.resultsPublic;
  add("Handicaps, event combinations and reset marker identical", stable(cfgOld) === stable(cn["config/race"]));
  bad = [];
  for (const [k, e] of Object.entries(old["config/entries"])) { const n = { ...(cn["config/entries"][k] || {}) }; const boat = n.boat; if (BOATING[k] && !e.boat) { if (boat !== BOATING[k]) bad.push(k + " boat"); delete n.boat; } if (stable(e) !== stable(n)) bad.push(k); }
  add("Crew list identical (plus each crew's boating time)", !bad.length && Object.keys(cn["config/entries"]).length === Object.keys(old["config/entries"]).length, bad.slice(0, 8).join(", "));
  const byId = Object.fromEntries(cn.taps.map(t => [t.id, t])); bad = old.taps.filter(t => !byId[t.id] || stable(t) !== stable(byId[t.id])).map(t => t.id);
  add("Every tap-log record identical (IDs, values, server times)", !bad.length, bad.length ? bad.length + " differ, e.g. " + bad.slice(0, 3).join(", ") : "");
  // Results against Burway SBH 2026 Results.html
  const res = computeResults("A"); const byBow = Object.fromEntries(res.map(r => [String(r.e.bow), r]));
  const withTimes = res.filter(r => r.rt != null).length, wd = res.filter(r => r.st === "Withdrawn").length, dnf = res.filter(r => r.st === "DNF").length;
  add("Results: 68 crews with times, 89 entries, 20 Withdrawn, 1 DNF", withTimes === 68 && res.length === 89 && wd === 20 && dnf === 1, `${withTimes} with times, ${res.length} entries, ${wd} Withdrawn, ${dnf} DNF`);
  bad = [];
  for (const [bow, pos, pie, rt, st] of EXPECTED) { const r = byBow[String(bow)]; if (!r) { bad.push(bow + " missing"); continue; }
    if ((r.pos ?? null) !== (pos ?? null) || (r.posEv ?? null) !== (pie ?? null) || (rt ? fmtRace(r.rt) : "") !== rt || (st || "") !== (OUTS(r.st))) bad.push(`${bow}: ${r.pos}/${r.posEv}/${fmtRace(r.rt)}/${r.st}`); }
  add("Results: every position, race time and position-in-event as published", !bad.length, bad.slice(0, 6).join("; "));
  const allOk = rows.every(r => r.ok);
  app.innerHTML = `<h1>Check the move of SBH 2026</h1>
    <table class="sbh-t"><tbody>${rows.map(r => `<tr><td>${r.ok ? "✅" : "❌"}</td><th>${esc(r.what)}</th><td>${esc(r.detail)}</td></tr>`).join("")}</tbody></table>
    ${allOk ? `<p><b>Everything matches.</b> Next: open <a href="results.html?race=${ID}">${ID} Results</a> signed out and compare it with the published page (T-REG1), then paste the second rules box (old data read-only).</p>
      <p><button type="button" class="btn primary" id="ok">Record the check as passed</button></p>`
      : `<p class="bad"><b>Stop.</b> Something differs - the move isn't finished. Nothing in the original was changed. Send this page to the builder.</p>`}`;
  $("#ok")?.addEventListener("click", async () => { await S.backend.commit([{ path: "races/" + ID, data: { migrationCheckedAt: Date.now(), migrationCheckedBy: S.authUser.email } }]); toast("Recorded"); });
}
function OUTS(st) { return ["Withdrawn", "DNF", "DNS", "DSQ"].includes(st) ? st : ""; }
