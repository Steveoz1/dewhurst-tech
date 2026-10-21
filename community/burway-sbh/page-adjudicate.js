/* Race Adjudication page (admin only): compare A with B, flag differences, correct a time with a reason.
   Brief F-R8 (A/B check) + F-K7 (timing correction panel). Public results always show A. */
import { boot, mountBar, requireRole, onChange, S, $, $$, esc, entryList, currentDivision, timing, statusOf,
         computeResults, fmtClock, fmtRace, adjust, toast, confirmBox, STATUSES, DIVS } from "./sbh.js?v=20261021i";

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
  <p class="note">A is the official record shown to the public. Flags: a start or finish more than 1.0 s apart, a time in one instance only, or statuses that disagree. Tap <b>Review</b> to correct A (or B) - every change needs a reason and the original taps stay in the log.</p>
  <div class="tblwrap"><table class="sbh-t" id="tbl"></table></div>`;
$$("#fseg button").forEach(b => b.addEventListener("click", () => { onlyFlagged = b.dataset.f === "1"; draw(); }));

function flagsFor(bow) {
  const a = timing("A", bow), b = timing("B", bow), f = [];
  for (const [k, w] of [["start", "start"], ["finish", "finish"]]) {
    if (a[k] != null && b[k] == null) f.push({ t: `B ${w} missing`, lvl: "amber" });
    else if (a[k] == null && b[k] != null) f.push({ t: `A ${w} missing`, lvl: "red" });
    else if (a[k] != null && b[k] != null && Math.abs(a[k] - b[k]) > TOL_MS) f.push({ t: `${w[0].toUpperCase() + w.slice(1)} differs ${(Math.abs(a[k] - b[k]) / 1000).toFixed(1)} s`, lvl: "red" });
  }
  const sa = statusOf("A", bow), sb = statusOf("B", bow);
  if (sa !== sb) f.push({ t: `Status A: ${sa || "-"} / B: ${sb || "-"}`, lvl: "red" });
  return f;
}

function draw() {
  $$("#fseg button").forEach(b => b.classList.toggle("on", (b.dataset.f === "1") === onlyFlagged));
  const div = currentDivision();
  const A = new Map(computeResults("A").map(r => [r.e.bow, r])), B = new Map(computeResults("B").map(r => [r.e.bow, r]));
  const crews = entryList(div);
  const rows = crews.map(e => ({ e, a: A.get(e.bow), b: B.get(e.bow), flags: flagsFor(e.bow) }));
  const flagged = rows.filter(r => r.flags.length);
  $("#count").textContent = `${flagged.length} to look at · ${crews.length} crews`;
  const show = onlyFlagged ? flagged : rows;
  const diff = r => r.a.rt != null && r.b.rt != null ? (r.a.rt - r.b.rt) / 10 : null;
  $("#tbl").innerHTML = `<thead><tr><th class="n">Bow#</th><th>Crew</th>
      <th>A start</th><th>A finish</th><th>A time</th><th class="n">A pos</th>
      <th>B start</th><th>B finish</th><th>B time</th><th class="n">B pos</th>
      <th class="n">A-B</th><th>Flags</th><th></th></tr></thead><tbody>${
    show.map(r => {
      const d = diff(r);
      return `<tr data-bow="${r.e.bow}">
        <td class="n"><b>${r.e.bow}</b></td><td class="wr">${esc(r.e.crew)}<br><small>${esc(r.e.event)} · Div ${r.e.division}</small></td>
        <td class="t">${fmtClock(r.a.t.start)}</td><td class="t">${fmtClock(r.a.t.finish)}</td><td class="t"><b>${r.a.rt != null ? fmtRace(r.a.rt) : esc(r.a.note)}</b></td><td class="n">${r.a.pos ?? ""}</td>
        <td class="t">${fmtClock(r.b.t.start)}</td><td class="t">${fmtClock(r.b.t.finish)}</td><td class="t"><b>${r.b.rt != null ? fmtRace(r.b.rt) : esc(r.b.note)}</b></td><td class="n">${r.b.pos ?? ""}</td>
        <td class="n ${d != null && Math.abs(d) > 1 ? "bad" : ""}">${d != null ? (d > 0 ? "+" : "") + d.toFixed(1) : ""}</td>
        <td class="wr">${r.flags.map(f => `<span class="flag ${f.lvl}">${esc(f.t)}</span>`).join(" ") || `<span class="ok">OK</span>`}</td>
        <td><button type="button" class="btn small rev">Review</button></td></tr>`;
    }).join("") || `<tr><td colspan="13" class="empty">${onlyFlagged ? "Nothing to look at - A and B agree for every crew in this view." : "No crews in this division."}</td></tr>`
  }</tbody>`;
}
let reviewing = false;
onChange(() => { if (!reviewing) draw(); });
draw();

/* ---------- Review one crew ---------- */
$("#tbl").addEventListener("click", e => { const b = e.target.closest(".rev"); if (b) review(Number(b.closest("tr").dataset.bow)); });

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
    <div id="rv"></div>
    <label style="display:grid;gap:4px;margin:10px 0;font-weight:700">Reason (needed for any change)
      <input id="reason" placeholder="e.g. A finisher missed the crew - taken from B" style="font:500 16px/1.2 var(--sans);padding:10px;border:2px solid #b9c3cd;border-radius:8px"></label>
    <h3 style="font-size:16px;margin-top:14px">Every tap for bow ${bow}</h3><div id="hist" class="note">Loading…</div>
    <div class="row" style="margin-top:12px"><button type="button" class="btn big no">Close</button><span></span></div></div>`;
  document.body.appendChild(d);
  let tgt = "A";
  const close = () => { d.remove(); reviewing = false; draw(); };
  d.querySelector(".no").addEventListener("click", close);
  $$("#tseg button", d).forEach(b => b.addEventListener("click", () => { tgt = b.dataset.i; $$("#tseg button", d).forEach(x => x.classList.toggle("on", x === b)); paint(); }));
  const reason = () => { const r = $("#reason", d).value.trim(); if (!r) { toast("Add a reason first"); $("#reason", d).focus(); } return r; };

  function paint() {
    const src = tgt === "A" ? "B" : "A"; const t = timing(tgt, bow), s = timing(src, bow);
    const row = (f, label) => `<tr><th>${label}</th><td class="t">${fmtClock(t[f]) || "-"}</td><td class="t">${fmtClock(s[f]) || "-"}</td>
      <td>${s[f] != null ? `<button type="button" class="btn small use" data-f="${f}">Use ${src}'s ${label.toLowerCase()}</button> ` : ""}
        <input class="typed" data-f="${f}" placeholder="HH:MM:SS.s" style="width:120px;font:600 15px/1 ui-monospace,monospace;padding:8px;border:2px solid #b9c3cd;border-radius:8px">
        <button type="button" class="btn small set" data-f="${f}">Set</button>
        ${t[f] != null ? `<button type="button" class="btn small danger clr" data-f="${f}">Clear</button>` : ""}</td></tr>`;
    $("#rv", d).innerHTML = `<div class="tblwrap"><table class="sbh-t"><thead><tr><th></th><th>${tgt} (changing)</th><th>${src}</th><th>Change ${tgt}</th></tr></thead><tbody>
      ${row("start", "Start")}${row("finish", "Finish")}
      <tr><th>Status</th><td>${esc(statusOf(tgt, bow) || "-")}</td><td>${esc(statusOf(src, bow) || "-")}</td>
        <td><select id="st" style="font:inherit;padding:8px">${STATUSES.filter(x => x !== "Withdrawn").map(x => `<option value="${x}" ${x === (t.status || "") ? "selected" : ""}>${x || "(none)"}</option>`).join("")}</select>
        <button type="button" class="btn small" id="setst">Set status</button></td></tr></tbody></table></div>`;
    $$(".use", d).forEach(b => b.addEventListener("click", async () => {
      const f = b.dataset.f, r = reason(); if (!r) return; const v = timing(src, bow)[f];
      if (await confirmBox(`Set ${tgt} ${f} for ${bow} to ${fmtClock(v)}?`, `Copied from ${src}. Reason: ${r}`, "Set")) { adjust(tgt, bow, f, v, r, src + ":" + (timing(src, bow)[f + "Tap"] || "")); toast("Saved"); setTimeout(loadHist, 1500); }
    }));
    $$(".set", d).forEach(b => b.addEventListener("click", async () => {
      const f = b.dataset.f, inp = d.querySelector(`.typed[data-f="${f}"]`);
      const ref = timing(tgt, bow)[f] ?? timing(src, bow)[f] ?? timing(tgt, bow).start ?? Date.now();
      const v = parseUK(inp.value, ref); if (v == null) { toast("Type the time as HH:MM:SS.s, e.g. 10:14:07.3"); inp.focus(); return; }
      const r = reason(); if (!r) return;
      if (await confirmBox(`Set ${tgt} ${f} for ${bow} to ${fmtClock(v)}?`, `Reason: ${r}`, "Set")) { adjust(tgt, bow, f, v, r, "typed"); inp.value = ""; toast("Saved"); setTimeout(loadHist, 1500); }
    }));
    $$(".clr", d).forEach(b => b.addEventListener("click", async () => {
      const f = b.dataset.f, r = reason(); if (!r) return;
      if (await confirmBox(`Clear ${tgt} ${f} for ${bow}?`, `Reason: ${r}`, "Clear")) { adjust(tgt, bow, f, null, r); toast("Cleared"); setTimeout(loadHist, 1500); }
    }));
    $("#setst", d).addEventListener("click", async () => {
      const v = $("#st", d).value || null, r = reason(); if (!r) return;
      if (await confirmBox(`Set ${tgt} status for ${bow} to ${v || "(none)"}?`, `Reason: ${r}`, "Set")) { adjust(tgt, bow, "status", v, r); toast("Saved"); setTimeout(loadHist, 1500); }
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
      all.sort((x, y) => when(x) - when(y));
      const what = t => t.kind === "start" || t.kind === "finish" ? `${t.kind} ${fmtClock(t.tCorrected)}`
        : t.kind === "void" ? `undo ${t.field}` : t.kind === "status" ? `status ${t.value}`
        : t.kind === "adjust" ? `ADJUDICATION ${t.field} → ${t.field === "status" ? (t.value || "none") : (fmtClock(t.value) || "cleared")} · "${esc(t.reason)}"` : t.kind;
      $("#hist", d).innerHTML = all.length ? `<table class="sbh-t"><thead><tr><th>Logged</th><th>Inst</th><th>What</th><th>Who</th><th>Phone</th></tr></thead><tbody>${
        all.map(t => `<tr><td class="t">${fmtClock(when(t))}</td><td>${t.instance}</td><td class="wr">${what(t)}</td><td>${esc((t.user || "").replace("@dewhurst.tech", ""))}</td><td>${esc(t.deviceId || "")}</td></tr>`).join("")}</tbody></table>`
        : "No taps logged for this crew.";
    } catch (err) { $("#hist", d).textContent = "Couldn't load the tap log: " + (err.code || err.message || err); }
    finally { histBusy = false; }
  }
  loadHist();
}
