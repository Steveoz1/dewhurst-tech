/* Race Configuration page (brief E2: F-K1 to F-K6) */
import { boot, mountBar, requireRole, onChange, S, $, $$, esc, entryList, currentDivision, isTimed, comboOf, penaltyOf, flagsOf, fmtClock,
         saveEntries, parseCSV, downloadCSV, STATUSES, DIVS, toast, confirmBox, typedConfirm, resetSystem, reauth,
         resetField, officialInstance, saveRace, setStatus, statusOf, timing, flagFlow, menuBox, textPrompt, numberPrompt, logIssue,
         watchIssueRecords, pendingIssueRecords, ISSUE_CATS } from "./sbh.js?v=20261023s";

const app = $("#app");
await boot({ watch: ["entries", "A", "B"] });
mountBar($("#bar"), { allowAll: true });
await requireRole($("#gate"), ["admin"], "admin");

app.innerHTML = `
  <div class="strip">
    <label class="btn small primary" for="csvfile">Import CSV</label>
    <input id="csvfile" type="file" accept=".csv,text/csv" hidden>
    <button type="button" class="btn small" id="addbtn">Add a crew</button>
    <button type="button" class="btn small" id="expbtn">Export CSV</button>
    <a class="btn small" href="handicap.html">Handicap Configuration</a>
    <span class="count" id="count"></span>
  </div>
  <div id="imp"></div>
  <div class="panel" id="addp" hidden>
    <h3>Add a crew (late substitution)</h3>
    <div class="grid">
      <input id="a-bow" inputmode="numeric" placeholder="Bow#">
      <input id="a-event" placeholder="Event (e.g. Op 2x)">
      <input id="a-crew" placeholder="Crew name">
      <input id="a-club" placeholder="Club">
      <select id="a-div">${DIVS.map(d => `<option value="${d}">Division ${d}</option>`).join("")}</select>
    </div>
    <button type="button" class="btn primary" id="a-save">Add crew</button>
    <button type="button" class="btn" id="a-cancel">Cancel</button>
    <span id="a-msg" class="bad"></span>
  </div>
  <div class="panel" id="admin">
    <h3>Reset times</h3>
    <p>Clears times so crews show as not started / not finished. The taps stay in the audit log.</p>
    <p>Instance: <span class="seg light" id="rseg" role="group" aria-label="Instance to reset"><button type="button" data-i="A">A</button><button type="button" data-i="B">B</button></span></p>
    <button type="button" class="btn danger" id="rstart"></button>
    <button type="button" class="btn danger" id="rfinish"></button>
  </div>
  <div class="panel" id="newrace">
    <h3>Start a new race (clear the system)</h3>
    <p>For a clean slate before race day. Both need a typed confirmation and the admin password. Before you use either, make sure every timing phone shows <b>All saved</b>, then close the timing pages on them; reopen them afterwards.</p>
    <p><button type="button" class="btn danger" id="clr-keep">Clear everything except the crew list</button><br>
      <small>Keeps each crew's Bow#, Event, Crew name, Club and Division as listed below. Clears all start and finish times and statuses (DNS/DNF/DSQ/Withdrawn) in A and B, review flags and Resolves, penalties, notes, and handicap groups.</small></p>
    <p><button type="button" class="btn danger" id="clr-all">Wipe everything, crew list too</button><br>
      <small>As above, and the crew list is emptied too, ready for a fresh CSV import.</small></p>
    <p class="note" id="lastreset"></p>
  </div>
  <p class="note">Edits save when you leave a box. Withdraw a crew with the Status column - crews are never deleted. A crew's Bow# is locked once it has a time in A or B. To change a number, type a new unused one in Bow#, or use ⋯ › Swap bow number.</p>
  <div class="tblwrap"><table class="sbh-t" id="tbl"></table></div>`;

/* ---------- table ---------- */
const tbl = $("#tbl");
function draw() {
  const div = currentDivision();
  const list = entryList(div);
  const all = Object.values(S.entries);
  $("#count").textContent = `${all.length} crews · ` + DIVS.map(d => `Div ${d}: ${all.filter(e => Number(e.division) === d).length}`).join(" · ");
  tbl.innerHTML = `<thead><tr><th>Bow#</th><th>Event</th><th>Crew name</th><th>Club</th><th>Division</th><th>Event combo</th><th class="n">Handicap (s)</th><th>Status</th><th class="n">Penalty (s)</th><th>Notes</th><th></th></tr></thead><tbody>${
    list.map(e => {
      const locked = isTimed(e.bow);
      return `<tr data-bow="${e.bow}" class="${e.status === "Withdrawn" ? "withdrawn" : ""}">
        <td><input class="bowin ${locked ? "locked" : ""}" data-f="bow" inputmode="numeric" value="${e.bow}" ${locked ? `readonly title="Has a time in A or B - Bow# can't change"` : ""}></td>
        <td><input data-f="event" value="${esc(e.event)}"></td>
        <td class="wr"><input data-f="crew" value="${esc(e.crew)}"></td>
        <td class="wr"><input data-f="club" value="${esc(e.club)}"></td>
        <td><select data-f="division">${DIVS.map(d => `<option value="${d}" ${Number(e.division) === d ? "selected" : ""}>${d}</option>`).join("")}</select></td>
        <td class="wr">${(() => { const c = comboOf(e.event); return c ? esc(c.name) : "<small>-</small>"; })()}</td>
        <td class="n">${(() => { const c = comboOf(e.event); return c && c.handicap ? c.handicap : "0"; })()}</td>
        <td><select data-f="status">${STATUSES.map(s => `<option ${s === (e.status || "") ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        <td><input data-f="penalty" inputmode="decimal" value="${penaltyOf(e) || 0}" style="width:70px;min-width:0;text-align:right"></td>
        <td class="wr"><input data-f="notes" value="${esc(e.notes || "")}">${flagsOf(e.bow).map(f => `<span class="flagnote">⚑ ${esc(f.inst)} · ${esc(f.by)} ${esc(fmtClock(f.at).slice(0, 8))}: ${esc(f.text || "flagged for review")}</span>`).join("")}</td>
        <td><button type="button" class="mini more" aria-label="More for bow ${e.bow}">⋯</button></td></tr>`;
    }).join("") || `<tr><td colspan="11" class="empty">No crews yet. Use Import CSV to load the Raceclocker upload file.</td></tr>`
  }</tbody>`;
}
/* ⋯ menu per crew (Steve, 23 Oct): the same actions as Starter / Finisher (no swap of times), plus logging an
   issue and swapping bow numbers for crews that haven't started - so everything about a crew can be raised from here. */
let issueRecs = [];
watchIssueRecords(list => { issueRecs = list; });
const nextIssueId = () => String(Math.max(0, ...[...issueRecs, ...pendingIssueRecords()].map(r => parseInt(r.issue && r.issue.id, 10) || 0)) + 1);
const OUTS = ["DNS", "DNF", "DSQ"];
tbl.addEventListener("click", async ev => {
  const btn = ev.target.closest(".more"); if (!btn) return;
  const bow = Number(btn.closest("tr").dataset.bow), e = S.entries[String(bow)]; if (!e) return;
  const inst = S.instance, t = timing(inst, bow), items = [];
  if (t.status) items.push({ label: `Clear ${t.status} (instance ${inst})`, value: "clear" });
  for (const st of OUTS) if (t.status !== st) items.push({ label: `Mark ${st} (instance ${inst})`, value: st, danger: true });
  items.push({ label: "Flag for review…", value: "flag" });
  items.push({ label: "Log an issue on Updates / Issues…", value: "issue" });
  if (!isTimed(bow)) items.push({ label: "Swap bow number with another crew…", value: "swapbow" });
  const v = await menuBox(`Bow ${bow} · ${e.crew}`, items);
  if (OUTS.includes(v) && await confirmBox(`Mark ${bow} as ${v} in instance ${inst}?`, inst === "A" ? "A is what the public sees: Results will show " + v + " with Check until it is Resolved on Race Adjudication." : "", `Mark ${v}`)) { setStatus(bow, v, inst); toast(`${bow}: ${v} (${inst})`); }
  if (v === "clear" && await confirmBox(`Clear ${t.status} for ${bow} in instance ${inst}?`, "", "Clear")) { setStatus(bow, "", inst); toast(`${bow}: status cleared (${inst})`); }
  if (v === "flag") await flagFlow(bow);
  if (v === "issue") {
    const text = await textPrompt(`Log an issue for bow ${bow}`, `${e.crew}. It goes on Updates / Issues as a Crew issue, Open.`, "Log issue", "e.g. sub in bow seat");
    if (text) { const id = nextIssueId(); logIssue({ key: S.backend.newId(), id, cat: "Crew", bow, text, status: "Open" }); toast(`Issue #${id} logged for ${bow}`); }
  }
  if (v === "swapbow") await swapBowNumbers(bow);
});
async function swapBowNumbers(bow) {
  const other = await numberPrompt(`Swap bow number ${bow}`, "Which bow number should this crew swap with? Both crews must not have started yet.", "Next");
  if (other == null) return;
  const a = S.entries[String(bow)], b = S.entries[String(other)];
  if (!b || Number(other) === bow) { toast(b ? "That's the same crew." : `No crew has bow ${other}. To give this crew a new, unused number, type it in its Bow# box instead.`); return; }
  if (isTimed(bow) || isTimed(other)) { toast("One of these crews already has a time - bow numbers can only be swapped before either has started."); return; }
  if (!(await confirmBox(`Swap bow numbers ${bow} and ${other}?`, `${a.crew} becomes bow ${other}; ${b.crew} becomes bow ${bow}.`, "Swap"))) return;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const as = (src, nb) => Object.fromEntries([...keys].map(k => [k, k === "bow" ? Number(nb) : (src[k] ?? null)]));
  const stamp = { updatedAt: Date.now(), updatedBy: S.user.email };
  saveEntries({ [String(bow)]: { ...as(b, bow), ...stamp }, [String(other)]: { ...as(a, other), ...stamp } });
  toast(`Swapped: ${a.crew} is now ${other}, ${b.crew} is now ${bow}`);
}

let dirty = false;
onChange(() => { if (tbl.contains(document.activeElement)) dirty = true; else draw(); });
tbl.addEventListener("focusout", () => setTimeout(() => { if (dirty && !tbl.contains(document.activeElement)) { dirty = false; draw(); } }, 50));
draw();

tbl.addEventListener("change", e => {
  const el = e.target; const tr = el.closest("tr[data-bow]"); if (!tr) return;
  const bow = tr.dataset.bow; const f = el.dataset.f; const entry = S.entries[bow]; if (!entry) return;
  const stamp = { updatedAt: Date.now(), updatedBy: S.user.email };
  if (f === "bow") {
    const nb = parseInt(el.value.trim(), 10);
    if (isTimed(bow)) { toast(`Bow ${bow} already has a time - its number can't change.`); el.value = bow; return; }
    if (!Number.isInteger(nb) || nb < 1 || nb > 9999) { toast("Bow# must be a whole number."); el.value = bow; return; }
    if (String(nb) === bow) return;
    if (S.entries[String(nb)]) { toast(`Bow ${nb} is already used by ${S.entries[String(nb)].crew}.`); el.value = bow; return; }
    saveEntries({ [bow]: null, [String(nb)]: { ...entry, bow: nb, ...stamp } });
    toast(`Bow ${bow} renumbered to ${nb}`);
    return;
  }
  let v = el.value; if (typeof v === "string") v = v.trim();
  if (f === "division") v = Number(v);
  if (f === "penalty") { const n = Number(String(v).replace(",", ".")); if (!isFinite(n) || n < 0 || n > 3600) { toast("Penalty is seconds, e.g. 10 or 5.5"); el.value = penaltyOf(entry); return; } v = n; }
  if (f === "crew" && !v) { toast("Crew name can't be blank."); el.value = entry.crew; return; }
  saveEntries({ [bow]: { [f]: v, ...stamp } });
});

/* ---------- add a crew (F-K4) ---------- */
$("#addbtn").addEventListener("click", () => { $("#addp").hidden = false; $("#a-bow").focus(); });
$("#a-cancel").addEventListener("click", () => ($("#addp").hidden = true));
$("#a-save").addEventListener("click", () => {
  const msg = $("#a-msg"); msg.textContent = "";
  const bow = parseInt($("#a-bow").value.trim(), 10);
  const rec = { bow, event: $("#a-event").value.trim(), crew: $("#a-crew").value.trim(), club: $("#a-club").value.trim(), division: Number($("#a-div").value), status: "", notes: "" };
  if (!Number.isInteger(bow) || bow < 1) { msg.textContent = "Bow# must be a whole number."; return; }
  if (S.entries[String(bow)]) { msg.textContent = `Bow ${bow} already exists.`; return; }
  if (!rec.crew || !rec.event) { msg.textContent = "Event and crew name are needed."; return; }
  saveEntries({ [String(bow)]: { ...rec, updatedAt: Date.now(), updatedBy: S.user.email } });
  $$("#addp input").forEach(i => (i.value = "")); $("#addp").hidden = true; toast(`Bow ${bow} added`);
});

/* ---------- public instance + reset (F-K9, punch list 3 and 5) ---------- */
let rInst = S.instance;
function paintAdmin() {

$$("#rseg button").forEach(b => b.classList.toggle("on", b.dataset.i === rInst));
  const n = f => Object.values(S.timings[rInst] || {}).filter(t => t && t[f] != null).length;
  $("#rstart").textContent = `Reset all START times in ${rInst} (${n("start")})`;
  $("#rfinish").textContent = `Reset all FINISH times in ${rInst} (${n("finish")})`;
}
onChange(paintAdmin); paintAdmin();

/* ---------- Start a new race (22 Oct, after the club test) ---------- */
function passwordPrompt(title) {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "sbh-modal";
    d.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>Enter the admin password to confirm it's you.</p>
      <form><input type="password" autocomplete="current-password" class="typed" aria-label="Admin password"
        style="font:500 18px/1.3 var(--sans);padding:10px;width:100%;border:2px solid #0E1621;border-radius:10px;margin-bottom:12px">
      <div class="row"><button type="button" class="btn big no">Cancel</button><button class="btn big danger yes">Confirm</button></div></form></div>`;
    const done = v => { d.remove(); res(v); };
    d.querySelector(".no").addEventListener("click", () => done(null));
    d.querySelector("form").addEventListener("submit", e => { e.preventDefault(); done(d.querySelector("input").value); });
    document.body.appendChild(d); d.querySelector("input").focus();
  });
}
function systemCounts() {
  const timed = entryList("all").filter(e => isTimed(e.bow)).length;
  const pens = entryList("all").filter(e => penaltyOf(e)).length;
  const groups = Object.keys(S.race.combos || {}).length;
  return `${entryList("all").length} crews · ${timed} with times · ${pens} with penalties · ${groups} handicap group${groups === 1 ? "" : "s"}`;
}
for (const [id, level, phrase, title] of [["#clr-keep", "keep", "CLEAR RACE", "Clear everything except the crew list?"], ["#clr-all", "all", "WIPE ALL", "Wipe everything, crew list too?"]]) {
  $(id).addEventListener("click", async () => {
    const body = `Now: ${systemCounts()}. ` + (level === "keep"
      ? "Afterwards: the same crews (Bow#, Event, Crew, Club, Division) and nothing else - no times, statuses, flags, penalties, notes or handicap groups, in A or B."
      : "Afterwards: an empty system - no crews, times, penalties or handicap groups. You'll need to import the CSV again.")
      + " This can't be undone from the pages. The tap log stays on the server (hidden).";
    if (!(await typedConfirm(title, body, phrase, level === "keep" ? "Clear" : "Wipe"))) return;
    const pw = await passwordPrompt(title.replace("?", ""));
    if (pw == null) return;
    try { await reauth(pw); }
    catch (e) { toast(/wrong-password|invalid-credential|invalid-login/i.test(e.code || "") ? "Wrong password - nothing was cleared" : "Couldn't check the password (" + (e.code || e) + ") - nothing was cleared. Needs a connection."); return; }
    resetSystem(level);
    toast(level === "keep" ? "Cleared - crew list kept" : "Wiped - import the CSV to start again");
  });
}
function paintLastReset() {
  const r = S.race; $("#lastreset").textContent = r.resetAt ? `Last cleared ${new Date(r.resetAt).toLocaleString("en-GB")} by ${(r.resetBy || "").replace("@dewhurst.tech", "")} (${r.resetLevel === "keep" ? "crew list kept" : "everything wiped"}).` : "";
}
onChange(paintLastReset);

$$("#rseg button").forEach(b => b.addEventListener("click", () => { rInst = b.dataset.i; paintAdmin(); }));
for (const [id, field, label] of [["#rstart", "start", "START"], ["#rfinish", "finish", "FINISH"]]) {
  $(id).addEventListener("click", async () => {
    const n = Object.values(S.timings[rInst] || {}).filter(t => t && t[field] != null).length;
    if (!n) { toast(`No ${label.toLowerCase()} times in ${rInst} to reset`); return; }
    if (!(await typedConfirm(`Reset all ${n} ${label} times in instance ${rInst}?`, `Every crew in ${rInst} will show as not ${field === "start" ? "started" : "finished"}. This can't be undone from the pages.`, `RESET ${rInst}`, "Reset"))) return;
    toast(`${resetField(field, rInst)} ${label.toLowerCase()} times cleared in ${rInst}`);
  });
}

/* ---------- import (F-K2) ---------- */
$("#csvfile").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file) return;
  const rows = parseCSV(await file.text()); e.target.value = "";
  const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
  const col = n => head.indexOf(n);
  const need = { bow: col("bow#"), event: col("event"), crew: col("crew name"), club: col("club"), division: col("division") };
  const imp = $("#imp");
  if (Object.values(need).some(i => i < 0)) {
    imp.innerHTML = `<div class="panel"><h3 class="bad">That file doesn't have the expected columns</h3><p>Expected: Bow#, Event, Crew Name, Club, Division. Found: ${esc(head.join(", "))}</p></div>`; return;
  }
  const rowsOK = [], bad = [], seen = new Set();
  rows.forEach((r, i) => {
    const g = k => (r[need[k]] || "").trim();                 // trim every field
    const bow = parseInt(g("bow"), 10); const dm = g("division").match(/[1-3]/);
    const rec = { bow, event: g("event"), crew: g("crew"), club: g("club"), division: dm ? Number(dm[0]) : null, status: "", notes: "" };
    const line = `Line ${i + 2}`;
    if (!Number.isInteger(bow) || String(bow) !== g("bow")) bad.push(`${line}: Bow# "${g("bow")}" is not a whole number`);
    else if (seen.has(bow)) bad.push(`${line}: Bow ${bow} appears twice in the file - second one rejected`);
    else if (!rec.division) bad.push(`${line}: Bow ${bow} has no valid division ("${g("division")}")`);
    else if (!rec.crew) bad.push(`${line}: Bow ${bow} has no crew name`);
    else { seen.add(bow); rowsOK.push(rec); }
  });
  const existing = Object.keys(S.entries).length;
  const timed = Object.values(S.entries).filter(e => isTimed(e.bow)).length;
  let mode = existing ? "append" : "replace";
  const drawImp = () => {
    const good = mode === "append" ? rowsOK.filter(r => !S.entries[String(r.bow)]) : rowsOK;
    const skipped = mode === "append" ? rowsOK.length - good.length : 0;
    const removed = mode === "replace" ? Object.keys(S.entries).filter(k => !seen.has(Number(k))).length : 0;
    const blocked = mode === "replace" && timed > 0;
    const byDiv = DIVS.map(d => `Div ${d}: ${good.filter(r => r.division === d).length}`).join(" · ");
    imp.innerHTML = `<div class="panel"><h3>Import ${esc(file.name)}</h3>
      ${existing ? `<p>The table already has ${existing} crews. <span class="seg light" id="modeseg" role="group" aria-label="Import mode">
        <button type="button" data-m="append" class="${mode === "append" ? "on" : ""}">Add to the list</button><button type="button" data-m="replace" class="${mode === "replace" ? "on" : ""}">Replace the whole list</button></span></p>
        <p class="note" style="margin:0 0 8px">${mode === "append" ? "New bow numbers are added. Bows already in the table are left as they are." : "The table becomes exactly this file. Crews not in the file are removed; crews in it are overwritten."}</p>` : ""}
      <p><b>${good.length} crews to ${mode === "append" ? "add" : "load"}</b> - ${byDiv}${skipped ? ` · ${skipped} already in the table (skipped)` : ""}${removed ? ` · <span class="bad">${removed} removed</span>` : ""}${bad.length ? ` · <span class="bad">${bad.length} rejected</span>` : ""}</p>
      ${bad.length ? `<ul>${bad.map(b => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      ${blocked ? `<p class="bad">${timed} crews have start or finish times. Reset the times (above) before replacing the list.</p>` : ""}
      <button type="button" class="btn primary" id="doimp" ${good.length && !blocked ? "" : "disabled"}>${mode === "append" ? "Add" : "Load"} ${good.length} crews</button>
      <button type="button" class="btn" id="noimp">Cancel</button></div>`;
    $$("#modeseg button").forEach(b => b.addEventListener("click", () => { mode = b.dataset.m; drawImp(); }));
    $("#noimp").addEventListener("click", () => (imp.innerHTML = ""));
    $("#doimp").addEventListener("click", async () => {
      const stamp = { updatedAt: Date.now(), updatedBy: S.user.email };
      const patch = {};
      if (mode === "replace" && existing) {
        if (!(await typedConfirm(`Replace the whole list with ${good.length} crews?`, `${removed} crews not in the file will be removed from the table.`, "REPLACE", "Replace"))) return;
        for (const k of Object.keys(S.entries)) if (!seen.has(Number(k))) patch[k] = null;
      } else if (!(await confirmBox(`${mode === "append" ? "Add" : "Load"} ${good.length} crews?`, byDiv, mode === "append" ? "Add" : "Load"))) return;
      for (const r of good) patch[String(r.bow)] = { ...r, ...stamp };
      saveEntries(patch); imp.innerHTML = ""; toast(`${good.length} crews ${mode === "append" ? "added" : "loaded"}`);
    });
  };
  drawImp();
});

/* ---------- export (F-K6) ---------- */
$("#expbtn").addEventListener("click", () => {
  const rows = [["Bow#", "Event", "Crew Name", "Club", "Division", "Event combo", "Handicap (s)", "Status", "Penalty (s)", "Notes"]];
  for (const e of entryList("all")) { const c = comboOf(e.event); rows.push([e.bow, e.event, e.crew, e.club, "Division " + e.division, c ? c.name : "", c ? c.handicap : 0, e.status || "", penaltyOf(e), [e.notes || "", ...flagsOf(e.bow).map(f => `FLAG ${f.inst} ${f.by} ${fmtClock(f.at).slice(0, 8)}: ${f.text || "flagged for review"}`)].filter(Boolean).join(" | ")]); }
  downloadCSV("SBH2026-configuration.csv", rows);
});
