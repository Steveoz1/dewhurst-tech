/* Results page (brief E5: F-R1 to F-R7). Open to anyone; read only. */
import { boot, mountBar, onChange, S, officialInstance, computeResults as compute, $, $$, esc, entryList, currentDivision, timing, statusOf, watchTimings,
         raceTenths, fmtRace, fmtClock, downloadCSV, DIVS, LS, combos, saveRace, confirmBox, serverNow } from "./sbh.js?v=20261023r";

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
const CYCLE_MS = 10000, RIVER_MS = 13 * 60000;        // TV mode: page change interval; time for a crew to cross the river picture
let cycle = /[?&]cycle=1\b/.test(location.search) || LS.get("sbh.cycle", false) === true, page = 0, pages = [[]], cycTimer = null;
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
  <div class="pubbar" id="pubbar" hidden>
    <span class="seg light pubseg" role="group" aria-label="Who can see these results"><button type="button" data-p="hidden">Hidden</button><button type="button" data-p="public">Public</button></span>
    <span class="pubnote" id="pubnote"></span>
  </div>
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
  <div class="cycbar"><span class="cyclbl">Cycle through pages?</span>
    <span class="seg light cycseg" role="group" aria-label="Cycle through pages"><button type="button" data-c="off">Off</button><button type="button" data-c="on">On</button></span>
    <small class="note">Pages change every 10 seconds. For the TV in the clubhouse.</small> <b class="cycpage" id="cycpage"></b></div>
  <div class="rframe" id="rframe">
    <aside class="rf-side rf-left" id="rf-left" hidden><h4>Yet to start</h4><div class="bows" id="notstarted"></div></aside>
    <div class="rf-main" id="rfmain">
      <span class="rf-pg" id="rfpg"></span>
      <div class="tblwrap"><table class="sbh-t" id="tbl"></table></div>
      <div class="rcards" id="cards" hidden></div>
    </div>
    <aside class="rf-side rf-right" id="rf-right" hidden><h4>Finished</h4><div class="bows" id="finished"></div></aside>
    <div class="river" id="river" hidden aria-label="Crews on the water">
      <span class="flag fstart" title="Start"><svg viewBox="0 0 24 32" aria-hidden="true"><rect x="2" y="2" width="2.5" height="28" fill="#333"/><path d="M4.5 3h16l-4 5 4 5h-16z" fill="#1d8a47"/></svg><small>Start</small></span>
      <div class="water" id="water"></div>
      <span class="flag ffinish" title="Finish"><svg viewBox="0 0 24 32" aria-hidden="true"><rect x="2" y="2" width="2.5" height="28" fill="#333"/><g transform="translate(4.5 3)"><rect width="16" height="10" fill="#fff" stroke="#111" stroke-width=".6"/><path d="M0 0h4v2.5H0zM8 0h4v2.5H8zM4 2.5h4V5H4zM12 2.5h4V5h-4zM0 5h4v2.5H0zM8 5h4v2.5H8zM4 7.5h4V10H4zM12 7.5h4V10h-4z" fill="#111"/></g></svg><small>Finish</small></span>
    </div>
  </div>`;
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
/* Pre-start notes in the Adjudication page's flag colours (Steve, 23 Oct): "Proceed to boating area" yellow, "Boating now" red */
const NOTE_FLAG = { "Proceed to boating area": "amber", "Boating now": "red" };
const timeOr = (v, r) => v != null ? fmtRace(v) : NOTE_FLAG[r.note] ? `<span class="flag ${NOTE_FLAG[r.note]} rnote">${esc(r.note)}</span>` : esc(r.note);

/* Results hidden / public (23 Oct): until the admin makes them public, the public sees an empty table - so test
   times are never shown. Signed-in officials (admin, starter, finisher) always see results; only the admin can switch. Stored in config/race.resultsPublic (admin-only write);
   no setting yet counts as hidden. Note: this hides the times on the page; it does not lock the data itself. */
const isAdmin = () => !!S.user && S.role === "admin";
const isPublic = () => S.race.resultsPublic === true;
$$(".pubseg button").forEach(b => b.addEventListener("click", async () => {
  const want = b.dataset.p === "public"; if (want === isPublic()) return;
  const ok = await confirmBox(want ? "Make results public?" : "Hide results from the public?",
    want ? "Everyone who opens Results will see the times straight away." : "The public will see an empty table until results are made public again. Signed-in officials still see them.",
    want ? "Make public" : "Hide");
  if (ok) saveRace({ resultsPublic: want });
}));
function paintPub() {
  $("#pubbar").hidden = !isAdmin();
  $$(".pubseg button").forEach(b => b.classList.toggle("on", (b.dataset.p === "public") === isPublic()));
  $("#pubnote").innerHTML = isPublic() ? "Results: <b>public</b> - everyone can see these times." : "Results: <b>hidden</b> - only signed-in officials can see these times.";
  $("#pubbar").classList.toggle("is-hidden", !isPublic());
}

function draw() { drawList(); if (cycle) paginate(); }
function drawList() {
  fillOptions(); paintPub();
  $$("button", vseg).forEach(b => b.classList.toggle("on", b.dataset.v === view));
  const t = q.value.trim().toLowerCase();
  const shut = !isPublic() && !S.user;               // not public yet, and not a signed-in official: an empty table
  const all = shut ? [] : compute(S.instance);
  let rows = all.filter(r => (!t || String(r.e.crew).toLowerCase().includes(t))
    && (!fc.value || r.e.club === fc.value)
    && (!fe.value || (fe.value.startsWith("combo:") ? r.combo && r.combo.id === fe.value.slice(6) : r.e.event === fe.value.slice(6))));
  if (shut) $("#rstatus").textContent = "";
  else $("#rstatus").textContent = (t || fc.value || fe.value) ? `Showing ${rows.length} of ${all.length} crews` : `${all.length} crews`;
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
        `<div class="rc${r.rt == null ? " out" : ""}${r.check ? " chk" : ""}">
          <div class="p">${r.pos ?? ""}</div>
          <div class="m"><div class="nm">${hl(r.e.crew, t)}</div><div class="ev">${esc(r.e.event)}</div><div class="cl">${esc(r.e.club)}</div>
            <div class="sm"><span class="bw"><i>Bow </i>${r.e.bow}</span><span class="dv"><i>Division </i>${r.e.division}</span></div></div>
          <div class="tm">${timeOr(r.adj, r)}${r.check ? `<small class="chk-l">Check</small>` : ""}</div></div>`;
    }).join("");
    $("#cards").innerHTML = `<div class="rh"><div class="p">Pos</div><div class="bw">Bow#</div><div class="ev">Event</div><div class="nm">Crew name</div><div class="cl">Club</div><div class="dv">Div</div><div class="tm">Adjusted time</div></div>` +
      (html || `<div class="empty">${shut ? "Results will be published here on race day." : all.length ? "No crews match these filters." : "No crews loaded yet."}</div>`);
    return;
  }
  const body = rows.map(r => {
    const g = groupHead(r);
    return (g ? `<tr class="grp"><td colspan="12">${esc(g.name)}${g.sub ? ` <small>(${esc(g.sub)})</small>` : ""}</td></tr>` : "") + `<tr class="${r.rt == null ? "out" : ""}${r.check ? " chk" : ""}">
      <td class="n"><b>${r.pos ?? ""}</b></td><td class="n">${r.e.bow}</td><td>${esc(r.e.event)}</td><td class="wr">${hl(r.e.crew, t)}</td><td class="wr">${esc(r.e.club)}</td>
      <td class="n">${r.e.division}</td><td class="t">${fmtClock(r.t.start)}</td><td class="t">${fmtClock(r.t.finish)}</td>
      <td class="t"><b>${timeOr(r.rt, r)}</b></td>
      <td class="t">${r.pt != null ? `<b>${fmtRace(r.pt)}</b>${r.pen ? `<br><small>penalty +${r.pen} s</small>` : ""}` : ""}</td>
      <td class="t">${r.adj != null ? `<b>${fmtRace(r.adj)}</b>${r.hc ? `<br><small>handicap -${r.hc} s</small>` : ""}` : ""}${r.check ? `<br><small class="chk-l">Check</small>` : ""}</td><td class="n">${r.posEv ?? ""}</td></tr>`;
  }).join("");
  $("#tbl").innerHTML = `<thead><tr><th class="n" title="Overall, all divisions, on Adjusted time">Pos</th><th class="n">Bow#</th><th>Event</th><th>Crew name</th><th>Club</th><th class="n">Div</th><th>Start</th><th>Finish</th><th>Race time</th><th title="Race time plus any penalty">Time + penalty</th><th title="Time + penalty, minus any handicap - decides Pos and Pos in event">Adjusted time</th><th class="n" title="On adjusted time, within the event or its event combination">Pos in event</th></tr></thead><tbody>${body || `<tr><td colspan="12" class="empty">${shut ? "Results will be published here on race day." : all.length ? "No crews match these filters." : "No crews loaded yet."}</td></tr>`}</tbody>`;
}
onChange(draw); draw();
setInterval(() => { if (!document.hidden) draw(); }, 30000);   // the "Proceed to boating area" / "Waiting to start" notes follow the clock

/* ---- TV mode: "Cycle through pages" (Steve, 23 Oct, for the TV by the clubhouse bar) -----------------------
   On: the results show one screenful at a time, changing every 10 s and looping; the page is framed by the crews
   yet to start (left), the crews finished (right) and a river along the bottom on which each started crew drifts
   from the start flag to the finish flag over 13 minutes, staying at the finish end until its finish is recorded.
   Off: Results look exactly as before. The choice is kept on that screen (and ?cycle=1 in the address turns it on). */
$$(".cycseg button").forEach(b => b.addEventListener("click", () => { setCycle(b.dataset.c === "on"); }));
function setCycle(on) {
  cycle = on; LS.set("sbh.cycle", on); page = 0;
  document.body.classList.toggle("tv", on);
  $$(".cycseg button").forEach(b => b.classList.toggle("on", (b.dataset.c === "on") === on));
  ["#rf-left", "#rf-right", "#river"].forEach(id => ($(id).hidden = !on));
  clearInterval(cycTimer); cycTimer = on ? setInterval(() => { page = (page + 1) % Math.max(1, pages.length); showPage(); }, CYCLE_MS) : null;
  sizeFrame(); draw(); paintFrame();
  if (on) setTimeout(() => scrollTo({ top: $("#rframe").getBoundingClientRect().top + scrollY - ($("#bar").offsetHeight || 0) - 8 }), 50);
}
function sizeFrame() {
  const f = $("#rframe");
  const barH = $("#bar").offsetHeight || 0;            // the sticky clock bar sits over the top of the page
  f.style.height = cycle ? Math.max(420, innerHeight - barH - 16) + "px" : "";
}
addEventListener("resize", () => { if (cycle) { sizeFrame(); paginate(); } });

/* Split the visible list into screenfuls that fit the middle of the frame */
function items() {
  const basic = !$("#cards").hidden;
  return basic ? [...$("#cards").children].filter(x => !x.classList.contains("rh")) : [...$$("#tbl tbody tr")];
}
function paginate() {
  const list = items();
  list.forEach(x => (x.style.display = ""));
  if (!cycle) { $("#cycpage").textContent = ""; return; }
  const main = $("#rfmain"), head = $("#cards").hidden ? ($("#tbl thead")?.offsetHeight || 0) : ($("#cards .rh")?.offsetHeight || 0);
  const avail = Math.max(120, main.clientHeight - head - 8);
  pages = [[]]; let used = 0;
  list.forEach((x, i) => {
    const h = x.offsetHeight || 40;
    const isHead = x.classList.contains("rg") || x.classList.contains("grp");
    const needed = isHead ? h + (list[i + 1]?.offsetHeight || 0) : h;     // never leave an event heading at the bottom of a page
    if (used + needed > avail && pages[pages.length - 1].length) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(x); used += h;
  });
  if (page >= pages.length) page = 0;
  showPage();
}
function showPage() {
  if (!cycle) return;
  pages.forEach((pg, i) => pg.forEach(x => (x.style.display = i === page ? "" : "none")));
  $("#rfmain").scrollTop = 0;
  $("#cycpage").textContent = pages.length > 1 ? `Page ${page + 1} of ${pages.length}` : "";
  $("#rfpg").textContent = $("#cycpage").textContent;
}

/* The frame: yet to start (left), on the water (river), finished (right) */
const sq = bow => `<span class="bowsq" data-b="${bow}">${bow}</span>`;
let lastFrameKey = "";
function paintFrame() {
  if (!cycle) return;
  const shut = !isPublic() && !S.user;
  const crews = shut ? [] : entryList("all");
  const notStarted = [], onWater = [], finished = [];
  for (const e of crews) {
    const t = timing(S.instance, e.bow), st = statusOf(S.instance, e.bow);
    if (t.finish != null) finished.push([e.bow, t.finish]);
    else if (["DNS", "DNF", "DSQ", "Withdrawn"].includes(st)) continue;
    else if (t.start != null) onWater.push([e.bow, t.start]);
    else notStarted.push(e.bow);
  }
  finished.sort((a, b) => b[1] - a[1]);                // latest finisher first
  const key = JSON.stringify([notStarted, finished.map(f => f[0])]);
  if (key !== lastFrameKey) {
    lastFrameKey = key;
    $("#notstarted").innerHTML = notStarted.map(sq).join("") || `<small class="note">${shut ? "" : "All crews have started."}</small>`;
    $("#finished").innerHTML = finished.map(f => sq(f[0])).join("") || `<small class="note">${shut ? "" : "None yet."}</small>`;
  }
  /* the river: reuse each crew's square so it glides rather than jumps */
  const water = $("#water"), W = water.clientWidth, H = water.clientHeight, size = 30, gap = 4;
  const lanes = Math.max(1, Math.floor((H - gap) / (size + gap)));
  const laneEnd = new Array(lanes).fill(1e9), now = serverNow(), live = new Set();
  onWater.sort((a, b) => a[1] - b[1]);                  // earliest starter (furthest along) first
  const placed = onWater.map(([bow, start]) => [bow, Math.min(1, Math.max(0, (now - start) / RIVER_MS))]).sort((a, b) => b[1] - a[1]);
  for (const [bow, frac] of placed) {
    const x = Math.round(frac * Math.max(0, W - size));
    let lane = laneEnd.findIndex(end => end - x >= size + gap);   // a lane where the crew ahead is clear of this one
    if (lane < 0) lane = laneEnd.indexOf(Math.max(...laneEnd)) ; // all lanes busy here: share the lane with the most room
    laneEnd[lane] = x;
    let el = water.querySelector(`.bowsq[data-b="${bow}"]`);
    if (!el) { el = document.createElement("span"); el.className = "bowsq"; el.dataset.b = bow; el.textContent = bow; el.style.transform = `translate(0px, ${gap + lane * (size + gap)}px)`; water.appendChild(el); }
    el.style.transform = `translate(${x}px, ${gap + lane * (size + gap)}px)`;
    live.add(String(bow));
  }
  [...water.querySelectorAll(".bowsq")].forEach(el => { if (!live.has(el.dataset.b)) el.remove(); });
}
setInterval(paintFrame, 1000);
onChange(() => { if (cycle) paintFrame(); });
setCycle(cycle);

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
