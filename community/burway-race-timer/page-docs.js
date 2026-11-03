/* App Documentation (multi-race brief F-H7): signed-in officials only; sections by login; Firebase section Admin only.
   Opened from a race's menu (?race=) the tick boxes are kept per race on this phone; from elsewhere, in one general set. */
import { boot, bootRaceless, requireRole, onChange, S, $, $$, LS, rkey, RACE_ID } from "./sbh.js?v=20261101b";
if (RACE_ID) await boot({ watch: [] }); else await bootRaceless();
if (!RACE_ID) { const a = $(".sbh-tools .admin"); a.textContent = "Races"; a.setAttribute("href", "index.html"); }
await requireRole($("#gate"), RACE_ID ? ["admin", "starter", "finisher"] : ["admin", "raceadmin", "starter", "finisher"], "starter", { lead: "Race Timer — race officials only." });
const KEY = RACE_ID ? rkey("docs") : "brt.docs.general";
const ticks = LS.get(KEY, {});
function draw() {
  const role = S.realRole || "";
  $$("[data-for]").forEach(el => (el.hidden = !el.dataset.for.split(" ").includes(role)));
  $("#docs").hidden = false;
}
$$('input[type=checkbox][data-k]').forEach(b => { b.checked = !!ticks[b.dataset.k]; b.addEventListener("change", () => { ticks[b.dataset.k] = b.checked; LS.set(KEY, ticks); }); });
onChange(draw); draw();
