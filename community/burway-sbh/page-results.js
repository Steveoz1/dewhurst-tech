/* Results page (brief E5: F-R1 to F-R7). Open to anyone; read only. */
import { boot, mountBar, onChange, S, officialInstance, computeResults as compute, $, $$, esc, entryList, currentDivision, timing, statusOf, watchTimings,
         raceTenths, fmtRace, fmtClock, downloadCSV, DIVS } from "./sbh.js";

await boot({ watch: ["entries"] });
watchTimings(S.instance);
mountBar($("#bar"), { allowAll: true });
/* Public viewers see the official instance only; signed-in officials can switch A/B. */
onChange(() => {
  if (!S.user) S.instance = officialInstance();
  document.querySelector(".sbh-bar")?.classList.toggle("public", !S.user);
  watchTimings(S.instance);                           // listen to B only if someone needs it
});

const OUT = ["DNS", "DNF", "DSQ", "Withdrawn"];
let sort = "pos";
const app = $("#app");
app.innerHTML = `
  <p class="prov">Provisional - subject to penalties and handicaps.</p>
  <div class="strip">
    <div class="seg light sortseg" role="group" aria-label="Sort">
      <button type="button" data-s="pos" class="on">By position</button><button type="button" data-s="bow">By Bow#</button><button type="button" data-s="event">By event</button></div>
    <button type="button" class="btn small" id="exp">Export CSV</button>
    <span class="note" id="inst"></span>
  </div>
  <div class="tblwrap"><table class="sbh-t" id="tbl"></table></div>`;
$$(".sortseg button").forEach(b => b.addEventListener("click", () => { sort = b.dataset.s; $$(".sortseg button").forEach(x => x.classList.toggle("on", x === b)); draw(); }));

const gname = r => r.combo ? r.combo.name : r.e.event;
const adjNote = r => [r.hc ? `handicap -${r.hc} s` : "", r.pen ? `penalty +${r.pen} s` : ""].filter(Boolean).join(", ");
const byPos = (a, b) => (a.pos == null) - (b.pos == null) || (a.pos || 0) - (b.pos || 0) || a.e.bow - b.e.bow;

function draw() {
  const div = currentDivision();
  $("#inst").textContent = S.user ? `Showing instance ${S.instance} times · the public always sees A` : "";
  let rows = compute(S.instance).filter(r => div === "all" || Number(r.e.division) === Number(div));
  if (sort === "bow") rows.sort((a, b) => a.e.bow - b.e.bow);
  else if (sort === "event") rows.sort((a, b) => Number(a.e.division) - Number(b.e.division) || gname(a).localeCompare(gname(b)) || (a.posEv == null) - (b.posEv == null) || (a.posEv || 0) - (b.posEv || 0) || a.e.bow - b.e.bow);
  else rows.sort((a, b) => Number(a.e.division) - Number(b.e.division) || byPos(a, b));
  let lastDiv = null, lastEv = null;
  const body = rows.map(r => {
    let h = "";
    if (div === "all" && sort !== "bow" && r.e.division !== lastDiv) { h += `<tr class="divh"><td colspan="11">Division ${r.e.division}</td></tr>`; lastDiv = r.e.division; lastEv = null; }
    if (sort === "event" && gname(r) !== lastEv) { h += `<tr class="divh"><td colspan="11" style="background:#eef2f6;color:#0E1621">${esc(gname(r))}${r.combo ? ` <small>(event combination: ${esc(Object.keys(r.combo ? (S.race.combos[r.combo.id] || {}).events || {} : {}).join(", "))})</small>` : ""}</td></tr>`; lastEv = gname(r); }
    return h + `<tr class="${r.rt == null ? "out" : ""}">
      <td class="n"><b>${r.pos ?? ""}</b></td><td class="n">${r.e.bow}</td><td>${esc(r.e.event)}</td><td class="wrap">${esc(r.e.crew)}</td><td class="wrap">${esc(r.e.club)}</td>
      <td class="n">${r.e.division}</td><td class="t">${fmtClock(r.t.start)}</td><td class="t">${fmtClock(r.t.finish)}</td>
      <td class="t"><b>${r.rt != null ? fmtRace(r.rt) : esc(r.note)}</b></td>
      <td class="t">${r.adj != null ? `<b>${fmtRace(r.adj)}</b>${adjNote(r) ? `<br><small>${esc(adjNote(r))}</small>` : ""}` : ""}</td><td class="n">${r.posEv ?? ""}</td></tr>`;
  }).join("");
  $("#tbl").innerHTML = `<thead><tr><th class="n">Pos</th><th class="n">Bow#</th><th>Event</th><th>Crew name</th><th>Club</th><th class="n">Div</th><th>Start</th><th>Finish</th><th>Race time</th><th>Adjusted time</th><th class="n" title="On adjusted time, within the event or its event combination">Pos in event</th></tr></thead><tbody>${body || `<tr><td colspan="11" class="empty">No crews loaded yet.</td></tr>`}</tbody>`;
}
onChange(draw); draw();

/* F-R7: all divisions, both instances side by side */
$("#exp").addEventListener("click", async () => {
  const other = S.instance === "A" ? "B" : "A";
  watchTimings(other);
  if (!Object.keys(S.timings[other] || {}).length) S.timings[other] = await S.backend.getOnce("timings/" + other);
  const A = new Map(compute("A").map(r => [r.e.bow, r])), B = new Map(compute("B").map(r => [r.e.bow, r]));
  const P = S.instance === "A" ? A : B;
  const rows = [["Bow#", "Event", "Crew Name", "Club", "Division", "Status", "A Start", "A Finish", "A Time", "B Start", "B Finish", "B Time", "Event combo", "Handicap (s)", "Penalty (s)", "A Adjusted", "B Adjusted", `Position (${S.instance})`, `Position in event (${S.instance})`]];
  for (const e of entryList("all").sort((a, b) => a.division - b.division || a.bow - b.bow)) {
    const a = A.get(e.bow), b = B.get(e.bow), p = P.get(e.bow);
    const status = [a.st && `A:${a.st}`, b.st && b.st !== a.st && `B:${b.st}`].filter(Boolean).join(" ") || (e.status || "");
    rows.push([e.bow, e.event, e.crew, e.club, "Division " + e.division, a.st === b.st ? (a.st || "") : status,
      fmtClock(a.t.start), fmtClock(a.t.finish), a.rt != null ? fmtRace(a.rt) : "",
      fmtClock(b.t.start), fmtClock(b.t.finish), b.rt != null ? fmtRace(b.rt) : "",
      p.combo ? p.combo.name : "", p.hc || 0, p.pen || 0, a.adj != null ? fmtRace(a.adj) : "", b.adj != null ? fmtRace(b.adj) : "",
      p.pos ?? "", p.posEv ?? ""]);
  }
  downloadCSV("SBH2026-results.csv", rows);
});
