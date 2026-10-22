/* Race Configuration page (brief E2: F-K1 to F-K6) */
import { boot, mountBar, requireRole, onChange, S, $, $$, esc, entryList, currentDivision, isTimed, comboOf, penaltyOf, flagsOf, fmtClock,
         saveEntries, parseCSV, downloadCSV, STATUSES, DIVS, toast, confirmBox, typedConfirm,
         resetField, officialInstance, saveRace } from "./sbh.js?v=20261022c";

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
  <p class="note">Edits save when you leave a box. Withdraw a crew with the Status column - crews are never deleted. A crew's Bow# is locked once it has a time in A or B.</p>
  <div class="tblwrap"><table class="sbh-t" id="tbl"></table></div>`;

/* ---------- table ---------- */
const tbl = $("#tbl");
function draw() {
  const div = currentDivision();
  const list = entryList(div);
  const all = Object.values(S.entries);
  $("#count").textContent = `${all.length} crews · ` + DIVS.map(d => `Div ${d}: ${all.filter(e => Number(e.division) === d).length}`).join(" · ");
  tbl.innerHTML = `<thead><tr><th>Bow#</th><th>Event</th><th>Crew name</th><th>Club</th><th>Division</th><th>Event combo</th><th class="n">Handicap (s)</th><th>Status</th><th class="n">Penalty (s)</th><th>Notes</th></tr></thead><tbody>${
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
        <td class="wr"><input data-f="notes" value="${esc(e.notes || "")}">${flagsOf(e.bow).map(f => `<span class="flagnote">⚑ ${esc(f.inst)} · ${esc(f.by)} ${esc(fmtClock(f.at).slice(0, 8))}: ${esc(f.text || "flagged for review")}</span>`).join("")}</td></tr>`;
    }).join("") || `<tr><td colspan="10" class="empty">No crews yet. Use Import CSV to load the Raceclocker upload file.</td></tr>`
  }</tbody>`;
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
