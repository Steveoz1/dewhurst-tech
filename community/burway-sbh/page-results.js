/* Results page (brief E5: F-R1 to F-R7). Open to anyone; read only. */
import { boot, mountBar, onChange, S, officialInstance, computeResults as compute, $, $$, esc, entryList, currentDivision, timing, statusOf, watchTimings,
         raceTenths, fmtRace, fmtClock, downloadCSV, DIVS, LS, combos } from "./sbh.js?v=20261022f";

S.instance = "A";                                    // the public only ever sees A; officials can switch once signed in
await boot({ watch: ["entries"] });
watchTimings("A");
mountBar($("#bar"), { division: false, instanceHidden: true });         // no division filter: one table for the whole event
/* Public viewers see the official instance only; signed-in officials can switch A/B. */
onChange(() => {
  if (!S.user) S.instance = officialInstance();
  document.querySelector(".sbh-bar")?.classList.toggle("public", !S.user);
  const inst = document.querySelector(".sbh-bar .inst");      // A/B switch only for signed-in officials
  if (inst) inst.hidden = !S.user;
  const exp = document.getElementById("exp"); if (exp) exp.hidden = !S.user;    // CSV export (A and B) for officials only
  const panel = document.querySelector(".sbh-settings"); if (panel && !S.user) panel.hidden = true;
  /* Public visitors get no way off Results: no Home button, no sign-in note, banner not a link (Steve, 22 Oct) */
  const admin = document.querySelector(".sbh-tools .admin"), who = document.getElementById("who"), ban = document.querySelector(".bbanner a");
  if (admin) admin.hidden = !S.user;
  if (who) who.hidden = !S.user;
  if (ban) { if (S.user) ban.setAttribute("href", "./"); else ban.removeAttribute("href"); }
  watchTimings(S.instance);                           // listen to B only if someone needs it
});

const OUT = ["DNS", "DNF", "DSQ", "Withdrawn"];
let sort = "pos";
const isPhone = () => matchMedia("(max-width: 759px)").matches;
let view = isPhone() ? "basic" : (LS.get("sbh.resultsView", "basic") === "details" ? "details" : "basic");   // phones always open on Basic

/* Basic / Details toggle, in front of the A/B toggle in the top bar */
const vseg = document.createElement("div");
vseg.className = "seg view"; vseg.setAttribute("role", "group"); vseg.setAttribute("aria-label", "View");
vseg.innerHTML = `<button type="button" data-v="basic">Basic</button><button type="button" data-v="details">Details</button>`;
$(".sbh-bar").prepend(vseg);
$$("button", vseg).forEach(b => b.addEventListener("click", () => { view = b.dataset.v; LS.set("sbh.resultsView", view); draw(); }));

const app = $("#app");
app.innerHTML = `
  <p class="prov">Provisional - subject to penalties and handicaps.</p>
  <div class="rfilters">
    <input class="q" type="search" placeholder="Search crew name, e.g. smi" aria-label="Search crew name" autocomplete="off">
    <select class="fc" aria-label="Filter by club"><option value="">All clubs</option></select>
    <select class="fe" aria-label="Filter by event"><option value="">All events</option></select>
    <button class="clear link" type="button">Clear</button>
  </div>
  <div class="strip">
    <div class="seg light sortseg" role="group" aria-label="Sort">
      <button type="button" data-s="pos" class="on">By position</button><button type="button" data-s="bow">By Bow#</button><button type="button" data-s="event">By event</button></div>
    <button type="button" class="btn small" id="exp" hidden>Export CSV</button>
    <span class="note rstatus" id="rstatus" aria-live="polite"></span>
  </div>
  <div class="tblwrap"><table class="sbh-t" id="tbl"></table></div>
  <div class="rcards" id="cards" hidden></div>`;
$$(".sortseg button").forEach(b => b.addEventListener("click", () => { sort = b.dataset.s; $$(".sortseg button").forEach(x => x.classList.toggle("on", x === b)); draw(); }));
const q = $(".rfilters .q"), fc = $(".rfilters .fc"), fe = $(".rfilters .fe");
q.addEventListener("input", draw); fc.addEventListener("change", draw); fe.addEventListener("change", draw);
$(".rfilters .clear").addEventListener("click", () => { q.value = ""; fc.value = ""; fe.value = ""; draw(); });

/* Fill the drop-downs from the live data, keeping the current choice */
let optKey = "";
function fillOptions() {
  const ents = entryList("all");
  const clubs = [...new Set(ents.map(e => e.club))].sort((a, b) => a.localeCompare(b));
  const events = [...new Set(ents.map(e => e.event))].sort((a, b) => a.localeCompare(b));
  const cs = combos().filter(c => Object.keys(c.events).length);
  const key = JSON.stringify([clubs, events, cs.map(c => [c.id, c.name])]);
  if (key === optKey) return; optKey = key;
  const keepC = fc.value, keepE = fe.value;
  fc.innerHTML = `<option value="">All clubs</option>` + clubs.map(c => `<option>${esc(c)}</option>`).join("");
  fe.innerHTML = `<option value="">All events</option>` +
    (cs.length ? `<optgroup label="Event combinations">${cs.map(c => `<option value="combo:${esc(c.id)}">${esc(c.name)}</option>`).join("")}</optgroup>` : "") +
    `<optgroup label="Events">${events.map(e => `<option value="event:${esc(e)}">${esc(e)}</option>`).join("")}</optgroup>`;
  fc.value = clubs.includes(keepC) ? keepC : ""; fe.value = [...fe.options].some(o => o.value === keepE) ? keepE : "";
}

const gname = r => r.combo ? r.combo.name : r.e.event;
const byPos = (a, b) => (a.pos == null) - (b.pos == null) || (a.pos || 0) - (b.pos || 0) || a.e.bow - b.e.bow;
function hl(s, t) {                                  // highlight the search text, like the Burway event page
  s = String(s == null ? "" : s); const i = t ? s.toLowerCase().indexOf(t) : -1;
  return i < 0 ? esc(s) : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + t.length)) + "</mark>" + esc(s.slice(i + t.length));
}
const timeOr = (v, r) => v != null ? fmtRace(v) : esc(r.note);

function draw() {
  fillOptions();
  $$("button", vseg).forEach(b => b.classList.toggle("on", b.dataset.v === view));
  const t = q.value.trim().toLowerCase();
  const all = compute(S.instance);
  let rows = all.filter(r => (!t || String(r.e.crew).toLowerCase().includes(t))
    && (!fc.value || r.e.club === fc.value)
    && (!fe.value || (fe.value.startsWith("combo:") ? r.combo && r.combo.id === fe.value.slice(6) : r.e.event === fe.value.slice(6))));
  $("#rstatus").textContent = (t || fc.value || fe.value) ? `Showing ${rows.length} of ${all.length} crews` : `${all.length} crews`;
  if (sort === "bow") rows.sort((a, b) => a.e.bow - b.e.bow);
  else if (sort === "event") rows.sort((a, b) => gname(a).localeCompare(gname(b)) || (a.posEv == null) - (b.posEv == null) || (a.posEv || 0) - (b.posEv || 0) || a.e.bow - b.e.bow);
  else rows.sort(byPos);
  const basic = view === "basic";
  $("#tbl").hidden = basic; $("#cards").hidden = !basic;
  let lastEv = null;
  const groupHead = r => {
    if (sort !== "event" || gname(r) === lastEv) return "";
    lastEv = gname(r);
    const evs = r.combo ? Object.keys(((S.race.combos || {})[r.combo.id] || {}).events || {}) : [];
    return { name: gname(r), sub: evs.length ? evs.join(", ") : "" };
  };
  if (basic) {
    /* Basic: one card per crew - the Burway event-page layout. Same markup on every screen; CSS lines it up as columns on a computer. */
    const html = rows.map(r => {
      const g = groupHead(r);
      return (g ? `<div class="rg">${esc(g.name)}${g.sub ? ` <small>${esc(g.sub)}</small>` : ""}</div>` : "") +
        `<div class="rc${r.rt == null ? " out" : ""}">
          <div class="p">${r.pos ?? ""}</div>
          <div class="m"><div class="nm">${hl(r.e.crew, t)}</div><div class="ev">${esc(r.e.event)}</div><div class="cl">${esc(r.e.club)}</div>
            <div class="sm"><span class="bw"><i>Bow </i>${r.e.bow}</span><span class="dv"><i>Division </i>${r.e.division}</span></div></div>
          <div class="tm">${timeOr(r.adj, r)}</div></div>`;
    }).join("");
    $("#cards").innerHTML = `<div class="rh"><div class="p">Pos</div><div class="bw">Bow#</div><div class="ev">Event</div><div class="nm">Crew name</div><div class="cl">Club</div><div class="dv">Div</div><div class="tm">Adjusted time</div></div>` +
      (html || `<div class="empty">${all.length ? "No crews match these filters." : "No crews loaded yet."}</div>`);
    return;
  }
  const body = rows.map(r => {
    const g = groupHead(r);
    return (g ? `<tr class="grp"><td colspan="12">${esc(g.name)}${g.sub ? ` <small>(${esc(g.sub)})</small>` : ""}</td></tr>` : "") + `<tr class="${r.rt == null ? "out" : ""}">
      <td class="n"><b>${r.pos ?? ""}</b></td><td class="n">${r.e.bow}</td><td>${esc(r.e.event)}</td><td class="wr">${hl(r.e.crew, t)}</td><td class="wr">${esc(r.e.club)}</td>
      <td class="n">${r.e.division}</td><td class="t">${fmtClock(r.t.start)}</td><td class="t">${fmtClock(r.t.finish)}</td>
      <td class="t"><b>${timeOr(r.rt, r)}</b></td>
      <td class="t">${r.pt != null ? `<b>${fmtRace(r.pt)}</b>${r.pen ? `<br><small>penalty +${r.pen} s</small>` : ""}` : ""}</td>
      <td class="t">${r.adj != null ? `<b>${fmtRace(r.adj)}</b>${r.hc ? `<br><small>handicap -${r.hc} s</small>` : ""}` : ""}</td><td class="n">${r.posEv ?? ""}</td></tr>`;
  }).join("");
  $("#tbl").innerHTML = `<thead><tr><th class="n" title="Overall, all divisions, on Adjusted time">Pos</th><th class="n">Bow#</th><th>Event</th><th>Crew name</th><th>Club</th><th class="n">Div</th><th>Start</th><th>Finish</th><th>Race time</th><th title="Race time plus any penalty">Time + penalty</th><th title="Time + penalty, minus any handicap - decides Pos and Pos in event">Adjusted time</th><th class="n" title="On adjusted time, within the event or its event combination">Pos in event</th></tr></thead><tbody>${body || `<tr><td colspan="12" class="empty">${all.length ? "No crews match these filters." : "No crews loaded yet."}</td></tr>`}</tbody>`;
}
onChange(draw); draw();

/* F-R7: all divisions, both instances side by side */
$("#exp").addEventListener("click", async () => {
  const other = S.instance === "A" ? "B" : "A";
  watchTimings(other);
  if (!Object.keys(S.timings[other] || {}).length) S.timings[other] = await S.backend.getOnce("timings/" + other);
  const A = new Map(compute("A").map(r => [r.e.bow, r])), B = new Map(compute("B").map(r => [r.e.bow, r]));
  const P = S.instance === "A" ? A : B;
  const rows = [["Bow#", "Event", "Crew Name", "Club", "Division", "Status", "A Start", "A Finish", "A Time", "B Start", "B Finish", "B Time", "Event combo", "Handicap (s)", "Penalty (s)", "A Time + penalty", "A Adjusted", "B Time + penalty", "B Adjusted", `Position (${S.instance})`, `Position in event (${S.instance})`]];
  for (const e of entryList("all").sort((a, b) => (P.get(a.bow).pos ?? 9999) - (P.get(b.bow).pos ?? 9999) || a.bow - b.bow)) {
    const a = A.get(e.bow), b = B.get(e.bow), p = P.get(e.bow);
    const status = [a.st && `A:${a.st}`, b.st && b.st !== a.st && `B:${b.st}`].filter(Boolean).join(" ") || (e.status || "");
    rows.push([e.bow, e.event, e.crew, e.club, "Division " + e.division, a.st === b.st ? (a.st || "") : status,
      fmtClock(a.t.start), fmtClock(a.t.finish), a.rt != null ? fmtRace(a.rt) : "",
      fmtClock(b.t.start), fmtClock(b.t.finish), b.rt != null ? fmtRace(b.rt) : "",
      p.combo ? p.combo.name : "", p.hc || 0, p.pen || 0, a.pt != null ? fmtRace(a.pt) : "", a.adj != null ? fmtRace(a.adj) : "", b.pt != null ? fmtRace(b.pt) : "", b.adj != null ? fmtRace(b.adj) : "",
      p.pos ?? "", p.posEv ?? ""]);
  }
  downloadCSV("SBH2026-results.csv", rows);
});
