/* Finisher page (brief E4: F-F1 to F-F5) */
import { boot, mountBar, requireRole, onChange, changed, S, $, $$, esc, entryList, currentDivision, timing, statusOf,
         logTime, voidField, setStatus, justTapped, swapFlow, flagFlow, flagBadge, undoNeedsConfirm, bindTap, confirmBox, menuBox, toast, fmtClock, fmtRace, raceTenths } from "./sbh.js?v=20261023q";

await boot({ watch: ["entries", "A", "B"] });
mountBar($("#bar"), { allowAll: true, confirmSwitch: true });
await requireRole($("#gate"), ["finisher", "admin"], "finisher");

const OUT = ["DNS", "DNF", "DSQ", "Withdrawn"];
/* Club test 22 Oct, snags S-1, S-3, S-4: one list in bow order that never reorders or scrolls by itself, and every
   crew has a FINISH button from the beginning of the race (the start may still be on its way from the start phone). */
const app = $("#app");
app.innerHTML = `
  <div class="strip"><span class="count" id="count"></span>
    <form class="jump" id="jump"><input inputmode="numeric" placeholder="Bow#" aria-label="Go to bow number"><button class="btn small">Go</button></form></div>
  <ul class="crews fin" id="list"></ul>`;
const list = $("#list");
const rearm = new Set();
let pinned = null, pinTimer = null;

function rowHTML(e) {
  const t = timing(S.instance, e.bow); const st = statusOf(S.instance, e.bow);
  const rt = raceTenths(t.start, t.finish);
  const time = t.finish != null ? `<div class="tm">${fmtClock(t.finish)}${rt != null ? ` · ${fmtRace(rt)}` : ""}</div>`
             : `<div class="tm" style="color:#556">${t.start != null ? "Started " + fmtClock(t.start) : "No start yet"}</div>`;
  const info = `<div class="bow">${e.bow}</div><div class="info"><div class="ev">${esc(e.event)}</div><div class="nm">${esc(e.crew)}</div><div class="cl">${esc(e.club)}</div>${time}${flagBadge(e.bow)}</div>`;
  const more = `<button class="mini more" type="button" aria-label="More">⋯</button>`;
  if (OUT.includes(st)) return `<li class="crew out" data-bow="${e.bow}">${info}<div class="acts"><span class="st">${st}</span>${more}</div></li>`;
  if (t.finish != null && !rearm.has(e.bow))
    return `<li class="crew done" data-bow="${e.bow}">${info}<div class="acts"><button class="mini undo${justTapped("finish", e.bow) ? " locked" : ""}" type="button">Undo</button>${more}</div></li>`;
  return `<li class="crew${pinned === e.bow ? " pinned" : ""}" data-bow="${e.bow}">${info}<div class="acts"><button class="go" type="button">${rearm.has(e.bow) ? "RE-FINISH" : "FINISH"}</button>${more}</div></li>`;
}

function draw() {
  if (S.pointerDown) return;                         // never redraw under a finger
  const crews = entryList(currentDivision());
  const startedN = crews.filter(e => timing(S.instance, e.bow).start != null).length;
  $("#count").textContent = `Finished ${crews.filter(e => timing(S.instance, e.bow).finish != null).length} / ${startedN} started`;
  list.innerHTML = crews.length ? crews.map(rowHTML).join("") : `<li class="empty">No crews in this division yet.</li>`;
  $$(".go", list).forEach(b => bindTap(b, t => onFinish(Number(b.closest("li").dataset.bow), t)));
}
onChange(draw); draw();

async function onFinish(bow, t) {
  const cur = timing(S.instance, bow);
  if (cur.finish != null) {                          // F-F3 re-tap protection
    const ok = await confirmBox(`Replace finish for ${bow}?`, `It already has a finish at ${fmtClock(cur.finish)}. The new time will be ${fmtClock(t + (S.offset ? S.offset.ms : 0))}.`, "Replace");
    rearm.delete(bow); if (!ok) { changed(); return; }
  }
  rearm.delete(bow);
  const tc = logTime("finish", bow, t);
  if (pinned === bow) pinned = null;
  toast(`${bow} finished ${fmtClock(tc)}`);
}

list.addEventListener("click", async e => {
  const li = e.target.closest("li[data-bow]"); if (!li) return; const bow = Number(li.dataset.bow);
  if (e.target.closest(".undo")) {
    if (justTapped("finish", bow)) { toast("Just logged - Undo is available in a moment"); return; }   // double-tap guard
    if (undoNeedsConfirm("finish", bow) && !(await confirmBox(`Clear finish for ${bow}?`, "The original tap stays in the log.", "Clear finish"))) return;
    voidField("finish", bow); toast(`Finish cleared for ${bow}`);
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
    if (v === "rearm") { rearm.add(bow); changed(); toast(`Tap RE-FINISH when ${bow} crosses the line`); }
  }
});

$("#jump").addEventListener("submit", e => {          // F-F5: scroll to the row you asked for (rows never move by themselves)
  e.preventDefault(); const inp = $("input", e.target); const bow = Number(inp.value.trim()); inp.value = ""; inp.blur();
  const ent = S.entries[String(bow)]; if (!ent) { toast(`No bow ${bow}`); return; }
  if (currentDivision() !== "all" && Number(ent.division) !== Number(currentDivision())) S.division = "all";
  pinned = bow; clearTimeout(pinTimer); pinTimer = setTimeout(() => { pinned = null; changed(); }, 8000);
  draw();
  const li = list.querySelector(`li[data-bow="${bow}"]`);
  if (li) { const top = li.getBoundingClientRect().top + scrollY - ($("#bar").offsetHeight + 8); scrollTo({ top }); }
});
