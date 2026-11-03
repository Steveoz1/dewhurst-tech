/* Race Setup (multi-race brief Part D). ?new=1 = a new, empty race (saved when "Create race" is pressed);
   ?race=<id> = that race, every field saved as it's changed. Admin, or the RaceAdmin who owns the race (Part O). */
import { boot, bootRaceless, mountBar, requireRole, onChange, S, $, $$, esc, toast, confirmBox, RACE_ID, ROLE_EMAIL, raceStatus, isArchived, saveRaceDoc } from "./sbh.js?v=20261101b";
import { STATUS_NAME, isSuper, blankRace, suggestId, idProblem, createRace, liveBlockers, RACEADMINS } from "./races.js?v=20261101b";

const NEW = new URLSearchParams(location.search).get("new") === "1";
if (NEW) await bootRaceless(); else await boot({ watch: ["entries"] });
mountBar($("#bar"), { instance: false, division: false });
await requireRole($("#gate"), NEW ? ["admin", "raceadmin"] : ["admin"], "admin", NEW ? {} : { wrong: "Race Setup is for the race admin only." });
if (NEW) { const a = $(".sbh-tools .admin"); a.textContent = "All races"; a.setAttribute("href", "index.html"); $(".sbh-tools .pt").textContent = "New race"; }
else { const t = $(".sbh-tools"); t.insertAdjacentHTML("afterbegin", `<a class="admin" href="index.html">All races</a>`); }

const app = $("#app");
let rec = NEW ? blankRace("", isSuper() ? ROLE_EMAIL.admin : S.authUser.email.toLowerCase()) : null, idTouched = false;
const cur = () => NEW ? rec : (S.raceDoc || {});
const save = patch => { if (NEW) Object.assign(rec, patch); else saveRaceDoc(patch); };
const crewCount = () => NEW ? 0 : Object.keys(S.entries).length;
const RO = () => !NEW && isArchived();

function field(name, label, opts = {}) {
  const v = cur()[name] ?? "";
  if (opts.area) return `<label class="sf">${label}<textarea data-k="${name}" rows="3" ${RO() ? "disabled" : ""}>${esc(v)}</textarea>${opts.hint ? `<small>${opts.hint}</small>` : ""}</label>`;
  return `<label class="sf">${label}<input data-k="${name}" type="${opts.type || "text"}" value="${esc(v)}" ${opts.max ? `maxlength="${opts.max}"` : ""} ${opts.num ? 'inputmode="numeric"' : ""} ${RO() ? "disabled" : ""}>${opts.hint ? `<small>${opts.hint}</small>` : ""}</label>`;
}
function draw() {
  if (app.contains(document.activeElement) && document.activeElement.matches("input,textarea,select")) return;   // never redraw under a typing finger
  const r = cur(); const st = NEW ? "draft" : raceStatus();
  const divs = Array.isArray(r.divisions) && r.divisions.length ? r.divisions : [{ n: 1, name: "Division 1", start: "", firstBoating: "" }];
  app.innerHTML = `
  <h1>${NEW ? "New race" : esc(r.title || "Race Setup")}</h1>
  ${RO() ? `<p class="bad">This race is archived — read only. Unarchive it on the Races page to change it.</p>` : ""}
  <div class="panel"><h3>Race details</h3>
    ${field("title", "Title (required)")}
    ${field("shortName", "Short name — for the top bar, up to 24 characters", { max: 24, hint: "Leave blank to use the title." })}
    <div class="sf2">${field("date", "Race date (required)", { type: "date" })}${field("firstStart", "First start time", { type: "time" })}</div>
    ${field("location", "Location")}
    ${field("course", "Course", { hint: "e.g. Upstream, approx. 3,000 m" })}
    ${field("club", "Organising club")}
    ${field("officialsNotes", "Notes for officials", { area: true, hint: "Shown on the race menu to signed-in officials." })}
    ${field("bowGuide", "Bow-number guide", { hint: "Optional reminder, e.g. Div 1: 151–192. Nothing is enforced from it." })}
  </div>
  <div class="panel"><h3>Race ID</h3>
    ${NEW ? `<label class="sf">Race ID<input id="rid" value="${esc(rec.raceId)}" autocomplete="off" autocapitalize="off"><small>Goes in every link for this race. Lower-case letters, numbers and hyphens. <b>Can't be changed after the race is created.</b></small></label><p class="bad" id="riderr" hidden></p>`
      : `<p><code>${esc(RACE_ID)}</code> <small class="note">(fixed)</small></p>`}
    ${isSuper() ? `<label class="sf">Owner<select id="owner" ${RO() ? "disabled" : ""}>${[ROLE_EMAIL.admin, ...RACEADMINS].map(e => `<option value="${e}" ${e === (r.owner || ROLE_EMAIL.admin) ? "selected" : ""}>${e === ROLE_EMAIL.admin ? "Admin" : "RaceAdmin (" + e.replace("@dewhurst.tech", "") + ")"}</option>`).join("")}</select></label>` : ""}
  </div>
  <div class="panel"><h3>Divisions</h3>
    <label class="sf">Number of divisions <select id="ndiv" ${RO() ? "disabled" : ""}>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<option ${n === divs.length ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <table class="sbh-t divt wrapt"><thead><tr><th>#</th><th>Name</th><th>Start time</th><th>First boating time <small>(optional)</small></th></tr></thead><tbody>
    ${divs.map((d, i) => `<tr data-i="${i}"><td>${d.n}</td><td><input data-d="name" value="${esc(d.name || "")}" ${RO() ? "disabled" : ""}></td><td><input data-d="start" type="time" value="${esc(d.start || "")}" ${RO() ? "disabled" : ""}></td><td><input data-d="firstBoating" type="time" value="${esc(d.firstBoating || "")}" ${RO() ? "disabled" : ""}></td></tr>`).join("")}
    </tbody></table>
    <p class="note">Crews with a boating time of their own use it; others use their division's first boating time. With neither, Results go straight from "Div n starts at…" to "Waiting to start".</p>
  </div>
  <div class="panel"><h3>Results</h3>
    ${field("resultsNote", "Note at the top of Results")}
    ${field("riverMinutes", "Expected time on the water, minutes (for the TV river)", { type: "number", num: true })}
    <p>Results are <b>${r.resultsPublic ? "Public" : "Hidden"}</b>. ${NEW ? "A new race starts Hidden." : `<button type="button" class="btn small" id="pub" ${RO() ? "disabled" : ""}>Make ${r.resultsPublic ? "Hidden" : "Public"}…</button>`}</p>
  </div>
  ${NEW ? `<p><button type="button" class="btn primary big" id="create">Create race</button></p>` : `
  <div class="panel"><h3>Race status</h3>
    <p>Now: <span class="chip ${st}">${STATUS_NAME[st]}</span></p>
    <p class="note"><b>Draft</b> — being set up; timing closed. <b>Live</b> — timing open. <b>Finished</b> — timing closed; adjudication, handicaps and the results switch still work. <b>Archived</b> — read-only (from the Races page).</p>
    ${RO() ? "" : `<p>${["draft", "live", "finished"].filter(s => s !== st).map(s => `<button type="button" class="btn ${s === "live" ? "primary" : ""}" data-st="${s}">Set ${STATUS_NAME[s]}</button>`).join(" ")}</p>`}
    <p class="bad" id="sterr" hidden></p>
  </div>
  <p><a class="btn primary big" href="home.html">Open the race menu</a></p>`}`;
  wire();
}
function wire() {
  $$("[data-k]", app).forEach(el => el.addEventListener("change", () => {
    let v = el.value; if (el.dataset.k === "riverMinutes") v = Math.max(1, Math.min(120, parseInt(v, 10) || 13));
    if (el.dataset.k === "title" || el.dataset.k === "shortName") v = v.trim();
    save({ [el.dataset.k]: v });
    if (NEW && (el.dataset.k === "title" || el.dataset.k === "date") && !idTouched) { rec.raceId = suggestId(rec.date, rec.title); const i = $("#rid"); if (i) i.value = rec.raceId; }
    if (!NEW) toast("Saved");
  }));
  $("#rid")?.addEventListener("input", e => { idTouched = true; rec.raceId = e.target.value.trim().toLowerCase(); });
  $("#owner")?.addEventListener("change", e => { save({ owner: e.target.value }); if (!NEW) toast("Owner changed"); });
  const divsNow = () => { const r = cur(); return (Array.isArray(r.divisions) && r.divisions.length ? r.divisions : [{ n: 1, name: "Division 1", start: "", firstBoating: "" }]).map(d => ({ ...d })); };
  $("#ndiv")?.addEventListener("change", async e => {
    const n = Number(e.target.value); let d = divsNow();
    if (n < d.length && !NEW && Object.values(S.entries).some(x => Number(x.division) > n)) { toast(`Some crews are in division ${n + 1} or higher - move them first`); draw(); return; }
    while (d.length < n) d.push({ n: d.length + 1, name: `Division ${d.length + 1}`, start: "", firstBoating: "" });
    d = d.slice(0, n); save({ divisions: d }); draw();
  });
  $$(".divt input", app).forEach(el => el.addEventListener("change", () => {
    const d = divsNow(); const i = Number(el.closest("tr").dataset.i); d[i][el.dataset.d] = el.value.trim(); save({ divisions: d }); if (!NEW) toast("Saved");
  }));
  $("#pub")?.addEventListener("click", async () => {
    const want = !cur().resultsPublic;
    if (await confirmBox(want ? "Make the results public?" : "Hide the results?", want ? "Anyone with the Results link will see the times." : "The public Results page will show \"Results will be published here on race day\".", want ? "Make public" : "Hide")) save({ resultsPublic: want });
  });
  $$("[data-st]", app).forEach(b => b.addEventListener("click", async () => {
    const s = b.dataset.st, err = $("#sterr"); err.hidden = true;
    if (s === "live") { const miss = liveBlockers(cur(), crewCount()); if (miss.length) { err.textContent = "Can't set Live yet - it needs " + miss.join(", ") + "."; err.hidden = false; return; } }
    const words = { live: "Timing opens: Starter and Finisher can record times.", finished: "Timing closes. Adjudication, handicaps, penalties and the results switch still work.", draft: "Timing closes. Use this while setting the race up." };
    if (await confirmBox(`Set this race ${STATUS_NAME[s]}?`, words[s], `Set ${STATUS_NAME[s]}`)) { save({ status: s }); toast(`Race is now ${STATUS_NAME[s]}`); }
  }));
  $("#create")?.addEventListener("click", async () => {
    const e = $("#riderr"); e.hidden = true;
    rec.raceId = ($("#rid").value || "").trim().toLowerCase();
    if (!rec.title) { e.textContent = "Give the race a title."; e.hidden = false; return; }
    if (!rec.date) { e.textContent = "Give the race a date."; e.hidden = false; return; }
    const p = await idProblem(rec.raceId); if (p) { e.textContent = p; e.hidden = false; return; }
    try { await createRace(rec); toast("Race created (Draft)"); location.href = "setup.html?race=" + encodeURIComponent(rec.raceId); }
    catch (x) { e.textContent = "Couldn't create it: " + (x.code || x.message || x); e.hidden = false; }
  });
}
document.addEventListener("focusout", () => setTimeout(() => { if (!app.contains(document.activeElement)) draw(); }, 50));
if (!NEW) onChange(draw);
draw();
