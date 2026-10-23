/* Race Adjudication page (admin only): compare A with B, flag differences, correct a time with a reason.
   Brief F-R8 (A/B check) + F-K7 (timing correction panel). Public results always show A. */
import { boot, mountBar, requireRole, onChange, S, $, $$, esc, entryList, currentDivision, timing, statusOf,
         computeResults, fmtClock, fmtRace, adjust, toast, confirmBox, STATUSES, DIVS, flagsOf, resolveFlag, notesOf, markReviewed, reopenReview, textPrompt } from "./sbh.js?v=20261023t";

await boot({ watch: ["entries", "A", "B"] });
mountBar($("#bar"), { instance: false, allowAll: true });
await requireRole($("#gate"), ["admin"], "admin");

const TOL_MS = 1000;                                   // F-R8: flag differences over 1.0 s
let onlyFlagged = true;
const app = $("#app");
app.innerHTML = `
  <div class="strip">
    <span class="seg light" id="fseg" role="group" aria-label="Show"><button type="button" data-f="1">Needs a look</button><button type="button" data-f="0">All crews</button></span>
    <span class="count" id="count"></span>
  </div>
  <p class="note">A is the official record shown to the public. Tap <b>Review</b> to correct A (or B) - every change needs a reason and the original taps stay in the log. Tap <b>Resolve</b> once a crew has been checked and A is right.</p>
  <details class="rules"><summary>When does a crew "need a look"? (the rules)</summary>
    <table class="sbh-t"><thead><tr><th>#</th><th>A crew is flagged when…</th><th>Shown as</th><th>Colour</th></tr></thead><tbody>
      <tr><td>1</td><td class="wr">A and B both have a <b>start</b>, more than <b>1.0 s</b> apart</td><td>"Start differs" (exact gap on hover)</td><td><span class="flag red">Red</span></td></tr>
      <tr><td>2</td><td class="wr">A and B both have a <b>finish</b>, more than <b>1.0 s</b> apart</td><td>"Finish differs" (exact gap on hover)</td><td><span class="flag red">Red</span></td></tr>
      <tr><td>3</td><td class="wr"><b>B has a start or finish that A doesn't</b> (A is what the public sees)</td><td>"A start / finish missing"</td><td><span class="flag red">Red</span></td></tr>
      <tr><td>4</td><td class="wr"><b>A has a start or finish that B doesn't</b></td><td>"B start / finish missing"</td><td><span class="flag amber">Amber</span></td></tr>
      <tr><td>5</td><td class="wr">The <b>statuses differ</b> between A and B (DNS / DNF / DSQ in one but not the other)</td><td>"Status A: DNF / B: –"</td><td><span class="flag red">Red</span></td></tr>
      <tr><td>6</td><td class="wr">A starter or finisher used <b>Flag for review</b> on the crew (A or B), not yet resolved</td><td>"⚑ Flagged for review"</td><td><span class="flag red">Red</span></td></tr>
      <tr><td>7</td><td class="wr">A has the crew as <b>DNF or DSQ</b> - confirm it, then Resolve</td><td>"DNF marked"</td><td><span class="flag red">Red</span></td></tr>
      <tr><td>8</td><td class="wr">An issue on <b>Updates / Issues</b> for this bow is still Open or In progress - close it there</td><td>"Open issue (1) on Updates / Issues"</td><td><span class="flag red">Red</span></td></tr>
      <tr><td>9</td><td class="wr">A <b>finish is earlier than its start</b> in A or B (wrong crew or wrong day)</td><td>"A finish before start"</td><td><span class="flag red">Red</span></td></tr>
    </tbody></table>
    <p class="note">Starts and finishes are compared separately; the A−B column (race-time difference) is information only. Withdrawn applies to both A and B, so it never shows as a difference. A flag clears when its cause is fixed. <b>Resolve</b> marks a crew as checked: it leaves "Needs a look" and any review notes are closed — but if its times or statuses change afterwards, it comes back. Public Results show <b>Check</b> (red box) only for rules 6, 7 and 8 - A-versus-B timing differences are never shown to the public. Source: design brief F-R12 and F-R16.</p>
  </details>
  <div class="tblwrap"><table class="sbh-t" id="tbl"></table></div>`;
$$("#fseg button").forEach(b => b.addEventListener("click", () => { onlyFlagged = b.dataset.f === "1"; draw(); }));

function flagsFor(bow) {
  const a = timing("A", bow), b = timing("B", bow), f = [];
  for (const [k, w] of [["start", "start"], ["finish", "finish"]]) {
    if (a[k] != null && b[k] == null) f.push({ t: `B ${w} missing`, lvl: "amber" });
    else if (a[k] == null && b[k] != null) f.push({ t: `A ${w} missing`, lvl: "red" });
    else if (a[k] != null && b[k] != null && Math.abs(a[k] - b[k]) > TOL_MS) {
      const exact = `${w[0].toUpperCase() + w.slice(1)} differs ${(Math.abs(a[k] - b[k]) / 1000).toFixed(1)} s`;
      f.push({ t: `${w[0].toUpperCase() + w.slice(1)} differs`, sig: exact, title: exact, lvl: "red" });   // short label (Steve, 23 Oct); exact gap on hover and in the Resolve fingerprint
    }
  }
  for (const [inst, t] of [["A", a], ["B", b]])                       // a finish recorded before its own start
    if (t.start != null && t.finish != null && t.finish <= t.start) f.push({ t: `${inst} finish before start`, lvl: "red" });
  const sa = statusOf("A", bow), sb = statusOf("B", bow);
  if (sa !== sb) f.push({ t: `Status A: ${sa || "-"} / B: ${sb || "-"}`, lvl: "red" });
  if (sa === "DNF" || sa === "DSQ") f.push({ t: `${sa} marked`, lvl: "red" });                 // shown as "Check" on Results until Resolved
  const iss = Object.values(a.issues || {}).filter(Boolean).length;                           // open on Updates / Issues - closed there, not here
  if (iss) f.push({ t: `Open issue${iss > 1 ? "s" : ""} (${iss}) on Updates / Issues`, lvl: "red", issue: true });
  const fl = flagsOf(bow); if (fl.length) f.push({ t: `⚑ Flagged for review${fl.length > 1 ? ` (${fl.length})` : ""}`, lvl: "red", review: true });
  return f;
}
/* Fingerprint of the differences (not the review notes) - a Resolve only holds while this stays the same */
const sigOf = flags => flags.filter(f => !f.review && !f.issue).map(f => f.sig || f.t).join(" | ");
function resolvedState(bow, flags) {
  const rv = timing("A", bow).reviewed;
  if (!rv) return null;
  const ok = rv.sig === sigOf(flags) && !flags.some(f => f.review || f.issue);
  return { ...rv, ok };
}

function draw() {
  $$("#fseg button").forEach(b => b.classList.toggle("on", (b.dataset.f === "1") === onlyFlagged));
  const div = currentDivision();
  const A = new Map(computeResults("A").map(r => [r.e.bow, r])), B = new Map(computeResults("B").map(r => [r.e.bow, r]));
  const crews = entryList(div);
  const rows = crews.map(e => { const flags = flagsFor(e.bow); return { e, a: A.get(e.bow), b: B.get(e.bow), flags, rs: resolvedState(e.bow, flags) }; });
  const flagged = rows.filter(r => r.flags.length && !(r.rs && r.rs.ok));
  $("#count").textContent = `${flagged.length} to look at · ${crews.length} crews`;
  const show = onlyFlagged ? flagged : rows;
  const diff = r => r.a.rt != null && r.b.rt != null ? (r.a.rt - r.b.rt) / 10 : null;
  $("#tbl").innerHTML = `<thead><tr><th class="n">Bow#</th><th>Crew</th>
      <th>A start</th><th>A finish</th><th>A time</th><th class="n">A pos</th>
      <th>B start</th><th>B finish</th><th>B time</th><th class="n">B pos</th>
      <th class="n" title="A race time minus B race time, in seconds">A−B time</th><th>Flags</th><th></th></tr></thead><tbody>${
    show.map(r => {
      const d = diff(r);
      return `<tr data-bow="${r.e.bow}">
        <td class="n"><b>${r.e.bow}</b></td><td class="wr">${esc(r.e.crew)}<br><small>${esc(r.e.event)} · Div ${r.e.division}</small></td>
        <td class="t">${fmtClock(r.a.t.start)}</td><td class="t">${fmtClock(r.a.t.finish)}</td><td class="t"><b>${r.a.rt != null ? fmtRace(r.a.rt) : esc(r.a.note)}</b></td><td class="n">${r.a.pos ?? ""}</td>
        <td class="t">${fmtClock(r.b.t.start)}</td><td class="t">${fmtClock(r.b.t.finish)}</td><td class="t"><b>${r.b.rt != null ? fmtRace(r.b.rt) : esc(r.b.note)}</b></td><td class="n">${r.b.pos ?? ""}</td>
        <td class="n ${d != null && Math.abs(d) > 1 ? "bad" : ""}">${d != null ? (d > 0 ? "+" : "") + d.toFixed(1) : ""}</td>
        <td class="wr">${r.rs && r.rs.ok
            ? `<span class="flag ok">✓ Resolved</span> <small>${esc((r.rs.by || "").replace("@dewhurst.tech", ""))} ${esc(fmtClock(r.rs.at).slice(0, 5))}${r.rs.note ? " · " + esc(r.rs.note) : ""}</small>`
            : (r.flags.map(f => `<span class="flag ${f.lvl}"${f.title ? ` title="${esc(f.title)}"` : ""}>${esc(f.t)}</span>`).join(" ") || `<span class="ok">OK</span>`) + (r.rs && !r.rs.ok && r.flags.length ? ` <small class="bad">changed since resolved</small>` : "")}</td>
        <td style="white-space:nowrap"><button type="button" class="btn small rev">Review</button>${r.flags.length && !(r.rs && r.rs.ok) ? ` <button type="button" class="btn small primary res">Resolve</button>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="13" class="empty">${onlyFlagged ? "Nothing to look at - A and B agree for every crew in this view." : "No crews in this division."}</td></tr>`
  }</tbody>`;
}
let reviewing = false;
onChange(() => { if (!reviewing) draw(); });
draw();

/* ---------- Review one crew ---------- */
$("#tbl").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-bow]"); if (!tr) return; const bow = Number(tr.dataset.bow);
  if (e.target.closest(".rev")) review(bow);
  else if (e.target.closest(".res")) resolveCrew(bow);
});
async function resolveCrew(bow) {
  const flags = flagsFor(bow), e = S.entries[String(bow)] || {};
  const list = flags.map(f => f.t).join("; ");
  const note = await textPrompt(`Resolve ${bow} · ${e.crew || ""}?`, `Confirms this crew has been checked and instance A has the correct times. Flags now: ${list}. Optional note:`, "Resolve", "e.g. A finish correct - B finisher late");
  if (note == null) return false;
  markReviewed(bow, sigOf(flags), note); toast(`${bow} resolved`); return true;
}

/* Turn a typed UK time (HH:MM:SS or HH:MM:SS.s) into ms on the same day as `ref`. */
function parseUK(text, ref) {
  const m = String(text).trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d))?$/); if (!m) return null;
  const want = (+m[1]) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + (m[4] ? +m[4] * 100 : 0);
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(ref)).split(":").map(Number);
  const have = p[0] * 3600000 + p[1] * 60000 + p[2] * 1000 + (ref % 1000);
  return ref + (want - have);
}

async function review(bow) {
  reviewing = true;
  const e = S.entries[String(bow)];
  const d = document.createElement("div"); d.className = "sbh-modal";
  d.innerHTML = `<div class="box wide" role="dialog" aria-modal="true">
    <h3>Bow ${bow} · ${esc(e.crew)}</h3><p>${esc(e.event)} · ${esc(e.club)} · Division ${e.division}</p>
    <p>Correct instance: <span class="seg light" id="tseg"><button type="button" data-i="A" class="on">A</button><button type="button" data-i="B">B</button></span></p>
    <p id="nowflags" class="note" style="margin:6px 0"></p>
    <div id="rv"></div>
    <p id="rvmsg" class="rvmsg" aria-live="polite"></p>
    <label style="display:grid;gap:4px;margin:10px 0;font-weight:700">Reason (needed for any change)
      <input id="reason" placeholder="e.g. A finisher missed the crew - taken from B" style="font:500 16px/1.2 var(--sans);padding:10px;border:2px solid #b9c3cd;border-radius:8px"></label>
    <div id="flagbox"></div>
    <div id="resbox" style="margin-top:12px"></div>
    <h3 style="font-size:16px;margin-top:14px">Every tap for bow ${bow}</h3><div id="hist" class="note">Loading…</div>
    <div class="row" style="margin-top:12px"><button type="button" class="btn big no">Close</button><span></span></div></div>`;
  document.body.appendChild(d);
  let tgt = "A";
  const close = () => { d.remove(); reviewing = false; draw(); };
  d.querySelector(".no").addEventListener("click", close);
  $$("#tseg button", d).forEach(b => b.addEventListener("click", () => { tgt = b.dataset.i; $$("#tseg button", d).forEach(x => x.classList.toggle("on", x === b)); paint(); }));
  /* Feedback shown inside this window (pop-up notes sit behind it) - Steve, 22 Oct: "no indication it was acknowledged" */
  let lastChanged = null;                              // highlight the cell just changed, for a few seconds
  const say = (html, ok = true) => { const m = $("#rvmsg", d); m.className = "rvmsg " + (ok ? "good" : "badmsg"); m.innerHTML = html; m.scrollIntoView({ block: "nearest" }); };
  const reason = () => {
    const el = $("#reason", d), r = el.value.trim();
    el.classList.toggle("need", !r);
    if (!r) { say("Nothing changed - type a <b>Reason</b> first (it is kept with the change).", false); el.focus(); }
    return r;
  };
  const done = (what, f) => {
    say(`✓ Saved: ${what}.<br>${tgt === "A" ? "Public Results use A, so they now show this." : "B is the check copy - public Results (A) are not affected."} The change and your reason are in the tap list below.`);
    $("#reason", d).classList.remove("need");
    lastChanged = { f, tgt, until: Date.now() + 8000 }; paint();
    setTimeout(loadHist, 1500);
  };

  function paintFlags() {
    const fl = flagsOf(bow);
    $("#flagbox", d).innerHTML = fl.length ? `<h3 style="font-size:16px;margin-top:14px">Flagged for review</h3>` + fl.map(f =>
      `<p class="flagnote" style="max-width:none">⚑ ${esc(f.inst)} · ${esc(f.by)} · ${esc(fmtClock(f.at).slice(0, 8))}: ${esc(f.text || "(no notes)")}
       <button type="button" class="btn small resolve" data-inst="${f.inst}" data-id="${esc(f.id)}">Mark resolved</button></p>`).join("") : "";
    const nts = notesOf(bow);
    if (nts.length) $("#flagbox", d).insertAdjacentHTML("beforeend", `<h3 style="font-size:16px;margin-top:14px">Notes from the timing team</h3>` + nts.map(n =>
      `<p class="flagnote" style="max-width:none">✎ ${esc(n.inst)} · ${esc(n.by)} · ${esc(fmtClock(n.at).slice(0, 8))}: ${esc(n.text)}</p>`).join(""));
    $$(".resolve", d).forEach(b => b.addEventListener("click", async () => {
      if (await confirmBox("Mark this flag as resolved?", "It stays in the tap log.", "Resolved")) { resolveFlag(bow, b.dataset.id, b.dataset.inst); say("✓ That review note is marked resolved."); }
    }));
  }
  function paintRes() {
    const flags = flagsFor(bow), rs = resolvedState(bow, flags);
    $("#resbox", d).innerHTML = rs && rs.ok
      ? `<p class="ok">✓ Resolved by ${esc((rs.by || "").replace("@dewhurst.tech", ""))} at ${esc(fmtClock(rs.at).slice(0, 8))}${rs.note ? ` - "${esc(rs.note)}"` : ""} <button type="button" class="btn small reopen">Reopen</button></p>`
      : flags.length ? `<button type="button" class="btn primary resolve-crew">Resolve - checked, A is correct</button>` : `<p class="ok">No flags on this crew.</p>`;
    $(".resolve-crew", d)?.addEventListener("click", async () => { if (await resolveCrew(bow)) say(`✓ Bow ${bow} resolved - it leaves Needs a look.`); });
    $(".reopen", d)?.addEventListener("click", async () => { if (await confirmBox(`Reopen ${bow}?`, "It goes back into Needs a look if it still has flags.", "Reopen")) { reopenReview(bow); say("✓ Reopened - back in Needs a look if it still has differences."); } });
  }
  function paint() {
    paintFlags(); paintRes();
    const nf = flagsFor(bow);
    $("#nowflags", d).innerHTML = "<b>Differences now:</b> " + (nf.length ? nf.map(f => `<span class="flag ${f.lvl}">${esc(f.t)}</span>`).join(" ") : `<span class="ok">none - A and B agree</span>`);
    const src = tgt === "A" ? "B" : "A"; const t = timing(tgt, bow), s = timing(src, bow);
    const row = (f, label) => `<tr><th>${label}</th><td class="t" data-cell="${f}">${fmtClock(t[f]) || "-"}</td><td class="t">${fmtClock(s[f]) || "-"}</td>
      <td>${s[f] != null ? `<button type="button" class="btn small use" data-f="${f}">Use ${src}'s ${label.toLowerCase()}</button> ` : ""}
        <input class="typed" data-f="${f}" placeholder="HH:MM:SS.s" style="width:120px;font:600 15px/1 ui-monospace,monospace;padding:8px;border:2px solid #b9c3cd;border-radius:8px">
        <button type="button" class="btn small set" data-f="${f}">Set</button>
        ${t[f] != null ? `<button type="button" class="btn small danger clr" data-f="${f}">Clear</button>` : ""}</td></tr>`;
    $("#rv", d).innerHTML = `<div class="tblwrap"><table class="sbh-t"><thead><tr><th></th><th>${tgt} (changing)</th><th>${src}</th><th>Change ${tgt}</th></tr></thead><tbody>
      ${row("start", "Start")}${row("finish", "Finish")}
      <tr><th>Status</th><td data-cell="status">${esc(statusOf(tgt, bow) || "-")}</td><td>${esc(statusOf(src, bow) || "-")}</td>
        <td><select id="st" style="font:inherit;padding:8px">${STATUSES.filter(x => x !== "Withdrawn").map(x => `<option value="${x}" ${x === (t.status || "") ? "selected" : ""}>${x || "(none)"}</option>`).join("")}</select>
        <button type="button" class="btn small" id="setst">Set status</button></td></tr></tbody></table></div>`;
    if (lastChanged && lastChanged.tgt === tgt && Date.now() < lastChanged.until) d.querySelector(`td[data-cell="${lastChanged.f}"]`)?.classList.add("changed");
    $$(".use", d).forEach(b => b.addEventListener("click", async () => {
      const f = b.dataset.f, r = reason(); if (!r) return; const v = timing(src, bow)[f];
      if (await confirmBox(`Set ${tgt} ${f} for ${bow} to ${fmtClock(v)}?`, `Copied from ${src}. Reason: ${r}`, "Set")) { adjust(tgt, bow, f, v, r, src + ":" + (timing(src, bow)[f + "Tap"] || "")); done(`${tgt} ${f} for ${bow} is now ${fmtClock(v)} (copied from ${src})`, f); }
    }));
    $$(".set", d).forEach(b => b.addEventListener("click", async () => {
      const f = b.dataset.f, inp = d.querySelector(`.typed[data-f="${f}"]`);
      const ref = timing(tgt, bow)[f] ?? timing(src, bow)[f] ?? timing(tgt, bow).start ?? Date.now();
      const v = parseUK(inp.value, ref); if (v == null) { toast("Type the time as HH:MM:SS.s, e.g. 10:14:07.3"); inp.focus(); return; }
      const r = reason(); if (!r) return;
      if (await confirmBox(`Set ${tgt} ${f} for ${bow} to ${fmtClock(v)}?`, `Reason: ${r}`, "Set")) { adjust(tgt, bow, f, v, r, "typed"); done(`${tgt} ${f} for ${bow} is now ${fmtClock(v)} (typed)`, f); }
    }));
    $$(".clr", d).forEach(b => b.addEventListener("click", async () => {
      const f = b.dataset.f, r = reason(); if (!r) return;
      if (await confirmBox(`Clear ${tgt} ${f} for ${bow}?`, `Reason: ${r}`, "Clear")) { adjust(tgt, bow, f, null, r); done(`${tgt} ${f} for ${bow} cleared`, f); }
    }));
    $("#setst", d).addEventListener("click", async () => {
      const v = $("#st", d).value || null, r = reason(); if (!r) return;
      if (await confirmBox(`Set ${tgt} status for ${bow} to ${v || "(none)"}?`, `Reason: ${r}`, "Set")) { adjust(tgt, bow, "status", v, r); done(`${tgt} status for ${bow} is now ${v || "(none)"}`, "status"); }
    });
  }
  paint();
  const repaint = () => { if (document.body.contains(d)) paint(); };
  onChange(repaint);

  let histBusy = false;
  async function loadHist() {
    if (histBusy) return; histBusy = true;
    try {
      const all = [...await S.backend.tapsFor("A", bow), ...await S.backend.tapsFor("B", bow)];
      const when = t => t.createdAt?.toMillis ? t.createdAt.toMillis() : (t.createdAt || t.tDevice || 0);
      const before = S.race.resetAt ? all.filter(t => when(t) < S.race.resetAt).length : 0;
      if (before) all.splice(0, all.length, ...all.filter(t => when(t) >= S.race.resetAt));   // taps from before the last "Start a new race" stay on the server, hidden here
      all.sort((x, y) => when(x) - when(y));
      const what = t => t.kind === "start" || t.kind === "finish" ? `${t.kind} ${fmtClock(t.tCorrected)}`
        : t.kind === "void" ? `undo ${t.field}` : t.kind === "status" ? `status ${t.value}`
        : t.kind === "swap" ? `SWAP ${t.field} with ${t.value}` : t.kind === "flag" ? `FLAGGED for review${t.value ? `: "${esc(t.value)}"` : ""}` : t.kind === "flag-resolved" ? "flag resolved" : t.kind === "note" ? `NOTE: "${esc(t.value || "")}"` : t.kind === "issue" ? `ISSUE #${esc(t.issue ? t.issue.id : t.value)} (${esc(t.issue ? t.issue.status : "")}): ${esc(t.issue ? t.issue.text : "")}` : t.kind === "reviewed" ? `RESOLVED${t.value ? `: "${esc(t.value)}"` : ""}` : t.kind === "review-reopened" ? "review reopened" : t.kind === "adjust" ? `ADJUDICATION ${t.field} → ${t.field === "status" ? (t.value || "none") : (fmtClock(t.value) || "cleared")} · "${esc(t.reason)}"` : t.kind;
      $("#hist", d).innerHTML = all.length ? `<table class="sbh-t"><thead><tr><th>Logged</th><th>Inst</th><th>What</th><th>Who</th><th>Phone</th></tr></thead><tbody>${
        all.map(t => `<tr><td class="t">${fmtClock(when(t))}</td><td>${t.instance}</td><td class="wr">${what(t)}</td><td>${esc((t.user || "").replace("@dewhurst.tech", ""))}</td><td>${esc(t.deviceId || "")}</td></tr>`).join("")}</tbody></table>`
        : "No taps logged for this crew.";
    } catch (err) { $("#hist", d).textContent = "Couldn't load the tap log: " + (err.code || err.message || err); }
    finally { histBusy = false; }
  }
  loadHist();
}
