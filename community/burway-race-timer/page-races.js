/* Races page (multi-race brief Part C). Admin sees every race; RaceAdmin sees the races it owns (Part O).
   Starter, Finisher and the public see a sign-in box only (F-RL1). */
import { bootRaceless, mountBar, mountMenu, requireRole, onChange, S, $, $$, esc, toast, confirmBox, typedConfirm, menuBox, reauth, ROLE_EMAIL, LS } from "./sbh.js?v=20261031a";
import { STATUS_NAME, isSuper, canRun, suggestId, idProblem, duplicateRace, archiveRace, unarchiveRace, deleteRace, exportRace, changeOwner, RACEADMINS } from "./races.js?v=20261031a";

await bootRaceless();
mountMenu($("#menu"), "races");
mountBar($("#bar"), { instance: false, division: false });
await requireRole($("#gate"), ["admin", "raceadmin"], "admin", { lead: "Race Timer — race officials only.", wrong: "Your race links come from the race admin." });

const app = $("#app");
let races = [], view = LS.get("brt.racesView", "current"), q = "";
app.innerHTML = `
  <div class="rl-head">
    <h1>Races</h1>
    <div class="rl-tools">
      <input type="search" class="q" placeholder="Search title or location" aria-label="Search races" autocomplete="off">
      <span class="seg light" id="vseg" role="group" aria-label="Show"><button type="button" data-v="current">Current</button><button type="button" data-v="archived">Archived</button><button type="button" data-v="all">All</button></span>
    </div>
  </div>
  <div id="migrate"></div>
  <div class="rtiles" id="tiles"></div>
  <p class="note" id="rlnote"></p>`;
$(".q", app).addEventListener("input", e => { q = e.target.value.trim().toLowerCase(); draw(); });
$$("#vseg button").forEach(b => b.addEventListener("click", () => { view = b.dataset.v; LS.set("brt.racesView", view); draw(); }));

async function load() {
  try {
    races = isSuper() ? await S.backend.query("races") : await S.backend.query("races", { owner: S.authUser.email.toLowerCase() });
    $("#rlnote").textContent = "";
  } catch (e) { $("#rlnote").textContent = "Couldn't load the races (" + (e.code || e.message || e) + "). Check the signal."; }
  draw();
}
const fmtDate = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "No date";
function tile(r) {
  const st = r.status || "draft";
  const warn = r.dupIncomplete ? `<p class="bad">Duplicate incomplete — delete and try again</p>` : r.deleteRequested && st === "archived" ? `<p class="bad">Delete incomplete — retry</p>` : "";
  return `<div class="rtile st-${st}" data-id="${esc(r.id)}">
    <a class="rmain" href="setup.html?race=${encodeURIComponent(r.id)}">
      <span class="chip ${st}">${STATUS_NAME[st] || st}</span>
      <b class="rt">${esc(r.title || "(untitled)")}</b>
      <span class="rd">${fmtDate(r.date)}${r.firstStart ? " · first start " + esc(r.firstStart) : ""}</span>
      <span class="rloc">${esc(r.location || "")}</span>
      <span class="rnums">${r.crewCount ?? 0} crews · ${r.finishedCountA ?? 0} finished · results ${r.resultsPublic ? "Public" : "Hidden"}</span>
      ${isSuper() && r.owner && r.owner !== ROLE_EMAIL.admin ? `<span class="rown">Owner: ${esc(r.owner.replace("@dewhurst.tech", ""))}</span>` : ""}
      ${warn}</a>
    <button type="button" class="more" aria-label="More actions for ${esc(r.title || r.id)}">⋯</button></div>`;
}
function draw() {
  $$("#vseg button").forEach(b => b.classList.toggle("on", b.dataset.v === view));
  const list = races.filter(r => view === "all" || (view === "archived" ? r.status === "archived" : r.status !== "archived"))
    .filter(r => !q || `${r.title || ""} ${r.location || ""}`.toLowerCase().includes(q))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.title || "").localeCompare(String(b.title || "")));
  $("#tiles").innerHTML = (view !== "archived" ? `<a class="rtile new" href="setup.html?new=1"><b>+ New race</b><span>Start from an empty race.</span></a>` : "") + list.map(tile).join("")
    + (!list.length && view === "archived" ? `<p class="note">No archived races.</p>` : "");
}
$("#tiles").addEventListener("click", async e => {
  const b = e.target.closest(".more"); if (!b) return;
  const id = b.closest(".rtile").dataset.id; const r = races.find(x => x.id === id); if (!r) return;
  const items = [];
  if (canRun(r)) items.push({ label: "Duplicate…", value: "dup" });
  if (r.status === "archived") items.push({ label: "Unarchive", value: "unarch" }); else items.push({ label: "Archive…", value: "arch" });
  items.push({ label: "Export everything (JSON)", value: "export" });
  if (isSuper()) items.push({ label: "Change owner…", value: "owner" });
  if (isSuper() && r.status === "archived") items.push({ label: "Delete…", value: "del", danger: true });
  const v = await menuBox(r.title || id, items);
  try {
    if (v === "dup") await dupFlow(r);
    if (v === "arch" && await confirmBox(`Archive "${r.title}"?`, "It becomes read-only for everyone and leaves the main list. Its results link keeps working if its results are Public.", "Archive")) { await archiveRace(id, r); toast("Archived"); }
    if (v === "unarch") { await unarchiveRace(id, r); toast("Unarchived - status " + (r.statusBeforeArchive && r.statusBeforeArchive !== "live" ? r.statusBeforeArchive : "finished")); }
    if (v === "export") { const n = await exportRace(id); toast(`Exported ${n} records`); }
    if (v === "owner") await ownerFlow(r);
    if (v === "del") await deleteFlow(r);
  } catch (err) { toast("Didn't work: " + (err.code || err.message || err)); }
  load();
});

/* ---- Duplicate (F-RL4) ---- */
function formBox(title, fields, ok) {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "sbh-modal";
    d.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><form class="fbox">
      ${fields.map(f => `<label>${esc(f.label)}${f.type === "select"
        ? `<select name="${f.name}">${f.options.map(o => `<option value="${esc(o.v)}" ${o.v === f.value ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select>`
        : `<input name="${f.name}" type="${f.type || "text"}" value="${esc(f.value || "")}" ${f.req ? "required" : ""} autocomplete="off">`}
        ${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</label>`).join("")}
      <p class="err bad" hidden></p>
      <div class="row"><button type="button" class="btn big no">Cancel</button><button class="btn big yes">${esc(ok)}</button></div></form></div>`;
    const form = d.querySelector("form");
    const done = v => { d.remove(); res(v); };
    d.querySelector(".no").addEventListener("click", () => done(null));
    form.addEventListener("submit", async ev => {
      ev.preventDefault(); const v = Object.fromEntries(new FormData(form).entries());
      const err = fields.find(f => f.check) ? await fields.find(f => f.check).check(v) : "";
      if (err) { const p = d.querySelector(".err"); p.textContent = err; p.hidden = false; return; }
      done(v);
    });
    if (fields.some(f => f.wire)) fields.filter(f => f.wire).forEach(f => f.wire(form));
    document.body.appendChild(d); d.querySelector("input,select").focus();
  });
}
const ownerField = value => ({ name: "owner", label: "Owner", type: "select", value, options: [{ v: ROLE_EMAIL.admin, t: "Admin" }, ...RACEADMINS.map(e => ({ v: e, t: "RaceAdmin (" + e.replace("@dewhurst.tech", "") + ")" }))] });
async function dupFlow(r) {
  const today = new Date().toISOString().slice(0, 10);
  const fields = [
    { name: "title", label: "New title", value: "Copy of " + (r.title || r.id), req: true },
    { name: "date", label: "New race date", type: "date", value: today, req: true },
    { name: "raceId", label: "New race ID", value: suggestId(today, "Copy of " + (r.title || r.id)), req: true, hint: "Goes in every link for this race. Lower-case letters, numbers and hyphens. Can't be changed later.",
      check: v => idProblem(v.raceId.trim()),
      wire: form => { let touched = false; form.raceId.addEventListener("input", () => (touched = true));
        const upd = () => { if (!touched) form.raceId.value = suggestId(form.date.value, form.title.value); }; form.title.addEventListener("input", upd); form.date.addEventListener("input", upd); } }];
  if (isSuper()) fields.push(ownerField(ROLE_EMAIL.admin));
  const v = await formBox(`Duplicate "${r.title || r.id}"`, fields, "Duplicate");
  if (!v) return;
  toast("Copying…");
  const n = await duplicateRace(r.id, { raceId: v.raceId.trim(), title: v.title.trim(), date: v.date, owner: isSuper() ? v.owner : S.authUser.email.toLowerCase() });
  toast(`Copied ${n} crews - set it up, then set it Live`);
  location.href = "setup.html?race=" + encodeURIComponent(v.raceId.trim());
}
async function ownerFlow(r) {
  const v = await formBox(`Owner of "${r.title || r.id}"`, [ownerField(r.owner || ROLE_EMAIL.admin)], "Save");
  if (v && v.owner !== r.owner) { await changeOwner(r.id, v.owner); toast("Owner changed"); }
}
/* ---- Delete (F-RL6, I4) ---- */
async function deleteFlow(r) {
  const first = await menuBox(`Delete "${r.title || r.id}"?`, [{ label: "Export everything first", value: "exp" }, { label: "Delete without exporting", value: "go", danger: true }]);
  if (!first) return;
  if (first === "exp") { await exportRace(r.id); if (!(await confirmBox("Export saved?", "Check the file downloaded before going on.", "Go on to delete"))) return; }
  if (!(await typedConfirm("Delete this race for good?", `Deletes ${r.title || r.id}, its crews, times, tap log, issues and results. It can't be undone. Its links stop working, and its race ID can't be used again for 30 days.`, `DELETE ${r.id}`, "Delete"))) return;
  const pw = await (async () => new Promise(res => {
    const d = document.createElement("div"); d.className = "sbh-modal";
    d.innerHTML = `<div class="box"><h3>Admin password</h3><form><input type="password" class="typed" autocomplete="current-password" style="font:500 18px/1.3 var(--sans);padding:10px;width:100%;border:2px solid #0E1621;border-radius:10px;margin-bottom:12px">
      <div class="row"><button type="button" class="btn big no">Cancel</button><button class="btn big danger yes">Delete</button></div></form></div>`;
    d.querySelector(".no").onclick = () => { d.remove(); res(null); };
    d.querySelector("form").onsubmit = e => { e.preventDefault(); const v = d.querySelector("input").value; d.remove(); res(v); };
    document.body.appendChild(d); d.querySelector("input").focus();
  }))();
  if (pw == null) return;
  try { await reauth(pw); } catch (e) { toast("Wrong password - nothing was deleted"); return; }
  const bar = document.createElement("div"); bar.className = "sbh-modal";
  bar.innerHTML = `<div class="box"><h3>Deleting ${esc(r.id)}</h3><progress max="1" value="0" style="width:100%"></progress><p class="pr">Starting…</p></div>`;
  document.body.appendChild(bar);
  try { await deleteRace(r.id, (n, of) => { bar.querySelector("progress").max = of; bar.querySelector("progress").value = n; bar.querySelector(".pr").textContent = `Deleting ${n.toLocaleString("en-GB")} of ${of.toLocaleString("en-GB")}…`; }); toast("Deleted"); }
  finally { bar.remove(); }
}

/* ---- Moving SBH 2026 in (E2), shown to Admin while the old single-race data exists ---- */
async function migratePanel() {
  if (!isSuper()) return;
  let old = {}; try { old = await S.backend.getOnce("config/entries"); } catch (e) { return; }
  if (!old || !Object.keys(old).length) return;
  const done = races.find(r => r.id === "sbh-2026");
  $("#migrate").innerHTML = `<div class="panel"><h3>SBH 2026 — the original single-race data</h3>
    <p>${done ? (done.migrating ? `The move into race <b>sbh-2026</b> was started but not finished.` : `Moved into race <b>sbh-2026</b>. The original copy is kept, read-only, until Steve says delete (D5).`)
      : `The 24 Oct race is still in the original single-race layout. Move it into the race structure as <b>sbh-2026</b>: export first, then copy, then check.`}</p>
    <a class="btn" href="migrate.html">${done && !done.migrating ? "Open the move / check page" : "Move SBH 2026…"}</a></div>`;
}
onChange(() => {});
await load(); migratePanel();
setInterval(load, 30000);
