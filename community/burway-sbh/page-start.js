/* Starter page (brief E3: F-S1 to F-S8, plus F-S9 jump box which shares the Finisher's code) */
import { boot, mountBar, requireRole, onChange, changed, S, $, $$, esc, entryList, currentDivision, timing, statusOf,
         logTime, voidField, setStatus, swapFlow, flagFlow, flagBadge, undoNeedsConfirm, bindTap, confirmBox, menuBox, toast, fmtClock, idleFor } from "./sbh.js?v=20261022g";

await boot({ watch: ["entries", "A", "B"] });
mountBar($("#bar"), { allowAll: true, confirmSwitch: true });
await requireRole($("#gate"), ["starter", "admin"], "starter");

const OUT = ["DNS", "DNF", "DSQ", "Withdrawn"];
const app = $("#app");
app.innerHTML = `
  <div class="strip"><span class="count" id="count"></span>
    <form class="jump" id="jump"><input inputmode="numeric" placeholder="Bow#" aria-label="Jump to bow number"><button class="btn small">Go</button></form></div>
  <ul class="crews" id="list"></ul>`;
const list = $("#list");
const rearm = new Set();       // bows where "replace start" was chosen
let pinned = null, pinTimer = null, nextBow = null, wantScroll = false;

function rowHTML(e, isNext) {
  const t = timing(S.instance, e.bow); const st = statusOf(S.instance, e.bow);
  const info = `<div class="bow">${e.bow}</div><div class="info"><div class="ev">${esc(e.event)}</div><div class="nm">${esc(e.crew)}</div><div class="cl">${esc(e.club)}</div>
    <div class="tm">${t.start != null ? fmtClock(t.start) : ""}</div>${flagBadge(e.bow)}</div>`;
  if (OUT.includes(st)) return `<li class="crew out" data-bow="${e.bow}">${info}<div class="acts"><span class="st">${st}</span><button class="mini more" type="button" aria-label="More">⋯</button></div></li>`;
  if (t.start != null && !rearm.has(e.bow))
    return `<li class="crew done" data-bow="${e.bow}">${info}<div class="acts"><button class="mini undo" type="button">Undo</button><button class="mini more" type="button" aria-label="More">⋯</button></div></li>`;
  return `<li class="crew${isNext ? " next" : ""}${pinned === e.bow ? " pinned" : ""}" data-bow="${e.bow}">${info}<div class="acts"><button class="go" type="button">${rearm.has(e.bow) ? "RE-START" : "START"}</button><button class="mini more" type="button" aria-label="More">⋯</button></div></li>`;
}

function draw() {
  if (S.pointerDown) return;                        // never redraw under a finger
  const div = currentDivision();
  const crews = entryList(div);
  const live = crews.filter(e => !["Withdrawn"].includes(statusOf(S.instance, e.bow)));
  const started = live.filter(e => timing(S.instance, e.bow).start != null).length;
  $("#count").textContent = `Started ${started} / ${live.length}`;
  const nx = crews.find(e => timing(S.instance, e.bow).start == null && !OUT.includes(statusOf(S.instance, e.bow)));
  nextBow = nx ? nx.bow : null;
  list.innerHTML = crews.length ? crews.map(e => rowHTML(e, e.bow === nextBow)).join("") : `<li class="empty">No crews in this division yet.</li>`;
  $$(".go", list).forEach(b => bindTap(b, t => onStart(Number(b.closest("li").dataset.bow), t)));
}
onChange(draw); draw();

async function onStart(bow, t) {
  const cur = timing(S.instance, bow);
  if (cur.start != null) {                           // F-S6 re-tap protection
    const ok = await confirmBox(`Replace start for ${bow}?`, `It already has a start at ${fmtClock(cur.start)}. The new time will be ${fmtClock(t + (S.offset ? S.offset.ms : 0))}.`, "Replace");
    rearm.delete(bow); if (!ok) { changed(); return; }
  }
  rearm.delete(bow);
  const tc = logTime("start", bow, t);
  toast(`${bow} started ${fmtClock(tc)}`);
  wantScroll = true; scrollSoon();
}

/* F-S4: keep the next crew near the top - but only once the starter's thumb is off the screen */
function scrollSoon() {
  if (!wantScroll) return;
  if (idleFor() < 1200 || S.pointerDown) { setTimeout(scrollSoon, 300); return; }
  wantScroll = false;
  const li = nextBow != null && list.querySelector(`li[data-bow="${nextBow}"]`);
  if (li) { const top = li.getBoundingClientRect().top + scrollY - ($("#bar").offsetHeight + 8); scrollTo({ top, behavior: "smooth" }); }
}

list.addEventListener("click", async e => {
  const li = e.target.closest("li[data-bow]"); if (!li) return; const bow = Number(li.dataset.bow);
  if (e.target.closest(".undo")) {                   // F-S5
    if (undoNeedsConfirm("start", bow) && !(await confirmBox(`Clear start for ${bow}?`, "The original tap stays in the log.", "Clear start"))) return;
    voidField("start", bow); toast(`Start cleared for ${bow}`);
  } else if (e.target.closest(".more")) {
    const t = timing(S.instance, bow); const st = statusOf(S.instance, bow); const items = [];
    if (t.status) items.push({ label: `Clear ${t.status}`, value: "clear" });
    else if (st !== "Withdrawn") items.push({ label: "Mark DNS (did not start)", value: "DNS", danger: true });
    items.push({ label: "Swap start time…", value: "swap" });
    items.push({ label: "Flag for review…", value: "flag" });
    const v = await menuBox(`Bow ${bow}`, items);
    if (v === "DNS" && await confirmBox(`Mark ${bow} as DNS?`, "", "Mark DNS")) setStatus(bow, "DNS");
    if (v === "clear" && await confirmBox(`Clear ${t.status} for ${bow}?`, "", "Clear")) setStatus(bow, "");
    if (v === "swap") await swapFlow("start", bow);
    if (v === "flag") await flagFlow(bow);
    if (v === "rearm") { rearm.add(bow); changed(); toast(`Tap RE-START when ${bow} crosses the line`); }
  }
});

$("#jump").addEventListener("submit", e => {          // F-S9
  e.preventDefault(); const inp = $("input", e.target); const bow = Number(inp.value.trim()); inp.value = ""; inp.blur();
  const ent = S.entries[String(bow)]; if (!ent) { toast(`No bow ${bow}`); return; }
  if (currentDivision() !== "all" && Number(ent.division) !== Number(currentDivision())) { S.division = "all"; }
  pinned = bow; clearTimeout(pinTimer); pinTimer = setTimeout(() => { pinned = null; changed(); }, 8000);
  draw();
  const li = list.querySelector(`li[data-bow="${bow}"]`);
  if (li) { const top = li.getBoundingClientRect().top + scrollY - ($("#bar").offsetHeight + 8); scrollTo({ top }); }
});
