/* Handicap Configuration (admin): event combination groups, each event with a handicap in seconds.
   Adjusted time = race time - handicap + penalty. Crews in a combination are placed together for "Pos in event". */
import { boot, mountBar, requireRole, onChange, S, $, $$, esc, entryList, combos, saveRace, toast, confirmBox } from "./sbh.js";

await boot({ watch: ["entries"] });
mountBar($("#bar"), { instance: false, division: false });
await requireRole($("#gate"), ["admin"], "admin");

const app = $("#app");
app.innerHTML = `
  <div class="strip"><button type="button" class="btn small primary" id="add">Add event combination group</button>
    <a class="btn small" href="config.html">Back to Race Configuration</a></div>
  <div class="panel" id="addp" hidden>
    <h3>New event combination</h3>
    <div class="grid"><input id="nm" placeholder="Name, e.g. Open Masters C&D 2x" maxlength="80"></div>
    <button type="button" class="btn primary" id="create">Create group</button> <button type="button" class="btn" id="cancel">Cancel</button>
  </div>
  <p class="note">Time + penalty = race time + penalty (decides overall Pos). Adjusted time = time + penalty − handicap (decides Pos in event). Handicaps are seconds taken off; penalties (set per crew on Race Configuration) are seconds added. Crews whose events are in the same group are placed together in "Pos in event". Events not in any group have no handicap. Each event can be in one group only.</p>
  <div id="groups"></div>`;

const allEvents = () => [...new Set(entryList("all").map(e => e.event))].sort((a, b) => a.localeCompare(b));
const crewsIn = ev => entryList("all").filter(e => e.event === ev).length;

function draw() {
  const cs = combos(); const used = new Set(cs.flatMap(c => Object.keys(c.events)));
  const free = allEvents().filter(ev => !used.has(ev));
  $("#groups").innerHTML = cs.length ? cs.map(c => `
    <div class="panel" data-id="${esc(c.id)}">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <input class="gname" value="${esc(c.name)}" aria-label="Group name" style="flex:1 1 240px;font:800 18px/1.2 var(--sans);padding:8px;border:2px solid #b9c3cd;border-radius:8px">
        <button type="button" class="btn small danger del">Delete group</button></div>
      <div class="tblwrap"><table class="sbh-t"><thead><tr><th>Event</th><th class="n">Crews</th><th class="n">Handicap (s)</th><th></th></tr></thead><tbody>
        ${Object.keys(c.events).sort().map(ev => `<tr data-ev="${esc(ev)}"><td>${esc(ev)}</td><td class="n">${crewsIn(ev)}</td>
          <td class="n"><input class="hc" inputmode="decimal" value="${c.events[ev]}" style="width:90px;min-width:0;text-align:right"></td>
          <td><button type="button" class="btn small rm">Remove</button></td></tr>`).join("") || `<tr><td colspan="4" class="empty">No events yet - add one below.</td></tr>`}
      </tbody></table></div>
      <p style="margin:10px 0 0"><select class="addev" style="font:inherit;font-size:16px;padding:8px;border:2px solid #b9c3cd;border-radius:8px;max-width:100%">
        <option value="">Add an event to this group…</option>${free.map(ev => `<option>${esc(ev)}</option>`).join("")}</select></p>
    </div>`).join("") : `<p class="empty">No event combinations yet. Use "Add event combination group" to make one.</p>`;
}
onChange(() => { if (!$("#groups").contains(document.activeElement)) draw(); });
$("#groups").addEventListener("focusout", () => setTimeout(() => { if (!$("#groups").contains(document.activeElement)) draw(); }, 50));
draw();

$("#add").addEventListener("click", () => { $("#addp").hidden = false; $("#nm").focus(); });
$("#cancel").addEventListener("click", () => { $("#addp").hidden = true; $("#nm").value = ""; });
$("#create").addEventListener("click", () => {
  const name = $("#nm").value.trim(); if (!name) { toast("Give the group a name"); return; }
  if (combos().some(c => c.name.toLowerCase() === name.toLowerCase())) { toast("There's already a group with that name"); return; }
  const id = "c" + Date.now().toString(36);
  saveRace({ combos: { [id]: { name, events: {}, created: Date.now() } } });
  $("#nm").value = ""; $("#addp").hidden = true; toast(`Group "${name}" created - now add its events`);
});

$("#groups").addEventListener("change", e => {
  const card = e.target.closest("[data-id]"); if (!card) return; const id = card.dataset.id;
  if (e.target.classList.contains("gname")) {
    const name = e.target.value.trim(); if (!name) { toast("Name can't be blank"); draw(); return; }
    saveRace({ combos: { [id]: { name } } });
  } else if (e.target.classList.contains("hc")) {
    const ev = e.target.closest("tr").dataset.ev; const n = Number(e.target.value.trim().replace(",", "."));
    if (!isFinite(n) || n < 0 || n > 3600) { toast("Handicap is seconds, e.g. 12 or 7.5"); draw(); return; }
    saveRace({ combos: { [id]: { events: { [ev]: n } } } });
  } else if (e.target.classList.contains("addev") && e.target.value) {
    saveRace({ combos: { [id]: { events: { [e.target.value]: 0 } } } }); toast(`${e.target.value} added (handicap 0 s)`);
  }
});
$("#groups").addEventListener("click", async e => {
  const card = e.target.closest("[data-id]"); if (!card) return; const id = card.dataset.id;
  if (e.target.closest(".rm")) {
    const ev = e.target.closest("tr").dataset.ev;
    if (await confirmBox(`Remove ${ev} from this group?`, "Its crews go back to no handicap.", "Remove")) saveRace({ combos: { [id]: { events: { [ev]: null } } } });
  } else if (e.target.closest(".del")) {
    const c = combos().find(x => x.id === id);
    if (await confirmBox(`Delete the group "${c ? c.name : ""}"?`, "Its events go back to no handicap.", "Delete")) saveRace({ combos: { [id]: null } });
  }
});
