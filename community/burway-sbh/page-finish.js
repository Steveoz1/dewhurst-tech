/* Finisher page (brief E4: F-F1 to F-F5) */
import { boot, mountBar, requireRole, onChange, changed, S, $, $$, esc, entryList, currentDivision, timing, statusOf,
         logTime, voidField, setStatus, justTapped, swapFlow, flagFlow, flagBadge, undoNeedsConfirm, bindTap, confirmBox, menuBox, toast, fmtClock, fmtRace, raceTenths, idleFor } from "./sbh.js?v=20261022i";

await boot({ watch: ["entries", "A", "B"] });
mountBar($("#bar"), { allowAll: true, confirmSwitch: true });
await requireRole($("#gate"), ["finisher", "admin"], "finisher");

const OUT = ["DNS", "DNF", "DSQ", "Withdrawn"];
const HOLD_MS = 4000;          // a finished row stays where it is until the screen has been still this long
const app = $("#app");
app.innerHTML = `
  <div class="strip"><span class="count" id="count"></span>
    <form class="jump" id="jump"><input inputmode="numeric" placeholder="Bow#" aria-label="Bring bow number to the top"><button class="btn small">Go</button></form></div>
  <div id="lists"></div>`;
const lists = $("#lists");
const held = new Map();        // bow -> time it was finished on this phone
const rearm = new Set();
let pinned = null, pinTimer = null;
let openNS = false, openOut = false;

function row(e, mode) {
  const t = timing(S.instance, e.bow); const st = statusOf(S.instance, e.bow);
  const rt = raceTenths(t.start, t.finish);
  const time = t.finish != null ? `<div class="tm">${fmtClock(t.finish)}${rt != null ? ` · ${fmtRace(rt)}` : ""}</div>`
             : `<div class="tm" style="color:#556;font-size:14px">${t.start != null ? "Started " + fmtClock(t.start) : ""}</div>`;
  const info = `<div class="bow">${e.bow}</div><div class="info"><div class="ev">${esc(e.event)}</div><div class="nm">${esc(e.crew)}</div><div class="cl">${esc(e.club)}</div>${time}${flagBadge(e.bow)}</div>`;
  const more = `<button class="mini more" type="button" aria-label="More">⋯</button>`;
  if (mode === "out") return `<li class="crew out" data-bow="${e.bow}">${info}<div class="acts"><span class="st">${st}</span>${more}</div></li>`;
  if (mode === "done") return `<li class="crew done" data-bow="${e.bow}">${info}<div class="acts"><button class="mini undo${justTapped("finish", e.bow) ? " locked" : ""}" type="button">Undo</button>${more}</div></li>`;
  return `<li class="crew${pinned === e.bow ? " pinned" : ""}" data-bow="${e.bow}">${info}<div class="acts"><button class="go" type="button">${rearm.has(e.bow) ? "RE-FINISH" : "FINISH"}</button>${more}</div></li>`;
}

function draw() {
  if (S.pointerDown) return;
  if (idleFor() >= HOLD_MS) held.clear();
  const crews = entryList(currentDivision());
  const water = [], notStarted = [], done = [], out = [];
  for (const e of crews) {
    const t = timing(S.instance, e.bow); const st = statusOf(S.instance, e.bow);
    if (held.has(e.bow) && t.finish != null) { water.push([e, "done"]); continue; }   // stays in place for now
    if (OUT.includes(st)) out.push(e);
    else if (t.finish != null && !rearm.has(e.bow)) done.push(e);
    else if (t.start != null || pinned === e.bow || rearm.has(e.bow)) water.push([e, "go"]);
    else notStarted.push(e);
  }
  if (pinned != null) { const i = water.findIndex(([e]) => e.bow === pinned); if (i > 0) water.unshift(water.splice(i, 1)[0]); }
  done.sort((a, b) => timing(S.instance, b.bow).finish - timing(S.instance, a.bow).finish);    // latest first
  const startedN = crews.filter(e => timing(S.instance, e.bow).start != null).length;
  $("#count").textContent = `Finished ${crews.filter(e => timing(S.instance, e.bow).finish != null).length} / ${startedN} started`;
  lists.innerHTML = `
    <h2 class="sec-h">On the water (${water.filter(x => x[1] === "go").length})</h2>
    <ul class="crews">${water.map(([e, m]) => row(e, m)).join("") || `<li class="empty">No crews on the water.</li>`}</ul>
    <details class="sec" id="ns" ${openNS ? "open" : ""}><summary>Not started yet (${notStarted.length})</summary>
      <ul class="crews">${notStarted.map(e => row(e, "go")).join("")}</ul></details>
    <h2 class="sec-h">Finished (${done.length})</h2>
    <ul class="crews">${done.map(e => row(e, "done")).join("") || `<li class="empty">None yet.</li>`}</ul>
    ${out.length ? `<details class="sec" id="oo" ${openOut ? "open" : ""}><summary>DNS / DNF / DSQ / Withdrawn (${out.length})</summary><ul class="crews">${out.map(e => row(e, "out")).join("")}</ul></details>` : ""}`;
  $("#ns").addEventListener("toggle", ev => (openNS = ev.target.open));
  $("#oo")?.addEventListener("toggle", ev => (openOut = ev.target.open));
  $$(".go", lists).forEach(b => bindTap(b, t => onFinish(Number(b.closest("li").dataset.bow), t)));
}
onChange(draw); draw();
setInterval(() => { if (held.size && idleFor() >= HOLD_MS && !S.pointerDown) changed(); }, 500);

async function onFinish(bow, t) {
  const cur = timing(S.instance, bow);
  if (cur.finish != null) {                          // F-F3 re-tap protection
    const ok = await confirmBox(`Replace finish for ${bow}?`, `It already has a finish at ${fmtClock(cur.finish)}. The new time will be ${fmtClock(t + (S.offset ? S.offset.ms : 0))}.`, "Replace");
    rearm.delete(bow); if (!ok) { changed(); return; }
  }
  rearm.delete(bow);
  const tc = logTime("finish", bow, t);
  held.set(bow, Date.now());
  if (pinned === bow) pinned = null;
  toast(`${bow} finished ${fmtClock(tc)}`);
}

lists.addEventListener("click", async e => {
  const li = e.target.closest("li[data-bow]"); if (!li) return; const bow = Number(li.dataset.bow);
  if (e.target.closest(".undo")) {
    if (justTapped("finish", bow)) { toast("Just logged - Undo is available in a moment"); return; }   // double-tap guard
    if (undoNeedsConfirm("finish", bow) && !(await confirmBox(`Clear finish for ${bow}?`, "The original tap stays in the log.", "Clear finish"))) return;
    held.delete(bow); voidField("finish", bow); toast(`Finish cleared for ${bow}`);
  } else if (e.target.closest(".more")) {
    const t = timing(S.instance, bow); const st = statusOf(S.instance, bow); const items = [];
    if (t.status) items.push({ label: `Clear ${t.status}`, value: "clear" });
    else if (st !== "Withdrawn") { items.push({ label: "Mark DNF (did not finish)", value: "DNF", danger: true }); items.push({ label: "Mark DSQ (disqualified)", value: "DSQ", danger: true }); }
    items.push({ label: "Swap finish time…", value: "swap" });
    items.push({ label: "Flag for review…", value: "flag" });
    const v = await menuBox(`Bow ${bow}`, items);
    if ((v === "DNF" || v === "DSQ") && await confirmBox(`Mark ${bow} as ${v}?`, "", `Mark ${v}`)) setStatus(bow, v);
    if (v === "clear" && await confirmBox(`Clear ${t.status} for ${bow}?`, "", "Clear")) setStatus(bow, "");
    if (v === "swap") await swapFlow("finish", bow);
    if (v === "flag") await flagFlow(bow);
    if (v === "rearm") { held.delete(bow); rearm.add(bow); changed(); toast(`Tap RE-FINISH when ${bow} crosses the line`); }
  }
});

$("#jump").addEventListener("submit", e => {          // F-F5
  e.preventDefault(); const inp = $("input", e.target); const bow = Number(inp.value.trim()); inp.value = ""; inp.blur();
  const ent = S.entries[String(bow)]; if (!ent) { toast(`No bow ${bow}`); return; }
  if (currentDivision() !== "all" && Number(ent.division) !== Number(currentDivision())) S.division = "all";
  pinned = bow; clearTimeout(pinTimer); pinTimer = setTimeout(() => { pinned = null; changed(); }, 60000);
  draw(); scrollTo({ top: lists.getBoundingClientRect().top + scrollY - $("#bar").offsetHeight - 50 });
});
