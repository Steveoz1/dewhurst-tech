/* Public results list (multi-race brief F-P1, D3): races whose results are Public. Nothing else on the page. */
import { bootRaceless, mountMenu, S, $, esc } from "./sbh.js?v=20261031a";
await bootRaceless();
mountMenu($("#menu"), "results");
const app = $("#app");
app.innerHTML = `<h1>Results</h1><div id="rlist"><p class="note">Loading…</p></div>`;
const fmt = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
async function load() {
  let list = [];
  try { list = await S.backend.query("races", { resultsPublic: true }); }
  catch (e) { $("#rlist").innerHTML = `<p class="note">Couldn't load the list. Check the signal and try again.</p>`; return; }
  list.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  $("#rlist").innerHTML = list.length ? `<ul class="rlist">${list.map(r => `<li><a href="results.html?race=${encodeURIComponent(r.id)}"><b>${esc(r.title || r.id)}</b><span>${esc([fmt(r.date), r.location].filter(Boolean).join(" · "))}</span></a></li>`).join("")}</ul>`
    : `<p class="note">No results have been published yet.</p>`;
}
load();
