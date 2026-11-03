/* Race hub (today's home page, for one race - multi-race brief Part G): show only the pages the signed-in role can use,
   plus, for this race's admin, Race Setup, All races, Share links (F-H3), the Clock check panel (D8) and Export (F-H5). */
import { boot, onChange, S, $, $$, esc, toast, DIVS, DIV_STARTS, raceTitle, RACE_ID, ROLE_LABEL } from "./sbh.js?v=20261101b";
import { exportRace } from "./races.js?v=20261101b";
await boot({ watch: [] });
const longDate = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
const base = location.origin + location.pathname.replace(/[^/]*$/, "");
const id = encodeURIComponent(RACE_ID);
const LINKS = [["Starter A", "starter-a", `start.html?race=${id}&i=A`], ["Starter B", "starter-b", `start.html?race=${id}&i=B`],
  ["Finisher A", "finisher-a", `finish.html?race=${id}&i=A`], ["Finisher B", "finisher-b", `finish.html?race=${id}&i=B`],
  ["Results (public)", "results", `results.html?race=${id}`], ["Race menu (this page)", "", `home.html?race=${id}`]];
let clocks = [], hubKey = "";
function draw() {
  const role = S.user ? S.role : null, admin = role === "admin";
  $$("#tiles .tile").forEach(t => { const r = t.dataset.r.split(" "); t.hidden = !(r.includes("all") || (role && r.includes(role))); });
  $("#officials").hidden = !!S.user;
  const r = S.raceDoc || {};                                  // header: title, date, location, course, divisions (F-H1, F2)
  $("#rtitle").textContent = raceTitle() || "Burway Race Timer";
  const divs = DIVS.filter(d => DIV_STARTS[d]).map((d, i) => (i ? `Division ${d} ` : `Division ${d} starts `) + DIV_STARTS[d]);
  $("#lede").textContent = [longDate(r.date), r.location, r.course, divs.length ? divs.join(", ") : ""].filter(Boolean).join(" · ") + (divs.length ? "." : "");
  const key = JSON.stringify([role, r.officialsNotes, r.bowGuide, clocks]);
  if (key === hubKey) return; hubKey = key;
  const x = $("#hubx");
  x.innerHTML = (role && (r.officialsNotes || r.bowGuide) ? `<div class="panel"><h3>Notes for officials</h3>${r.officialsNotes ? `<p style="white-space:pre-line">${esc(r.officialsNotes)}</p>` : ""}${r.bowGuide ? `<p class="note">Bow numbers: ${esc(r.bowGuide)}</p>` : ""}</div>` : "")
    + (admin ? `<div class="hubbtns"><a class="btn" href="setup.html?race=${id}">Race Setup</a> <a class="btn" href="index.html">All races</a> <button type="button" class="btn" id="exp">Export everything</button></div>
      <div class="panel"><h3>Clock check</h3>${clockTable()}</div>
      <div class="panel"><h3>Share links</h3><p class="note">Send each official only their own link. The short link is easier to type; the long one always works and is the one to bookmark.</p>
      <div class="links">${LINKS.map(([lab, s, long]) => { const short = base + "r/" + id + (s ? "/" + s : ""); return `<div class="lk"><b>${lab}</b>
        <div class="lkrow"><code>${esc(short)}</code><button type="button" class="btn small cp" data-v="${esc(short)}">Copy</button></div>
        <div class="lkrow long"><code>${esc(base + long)}</code><button type="button" class="link cp" data-v="${esc(base + long)}">Copy</button></div></div>`; }).join("")}</div></div>` : "");
  $$(".cp", x).forEach(b => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(b.dataset.v); toast("Link copied"); } catch (e) { prompt("Copy this link:", b.dataset.v); } }));
  $("#exp", x)?.addEventListener("click", async () => { try { const n = await exportRace(RACE_ID); toast(`Exported ${n} records`); } catch (e) { toast("Export didn't work: " + (e.code || e.message)); } });
}
function clockTable() {
  if (!clocks.length) return `<p class="note">No timing phone has checked its clock for this race yet. Each phone checks when Starter or Finisher is opened.</p>`;
  const now = Date.now(), fresh = c => now - c.at < 15 * 60000 && c.rtt < 1000;
  const rows = clocks.slice().sort((a, b) => b.at - a.at);
  const timers = rows.filter(c => ["start", "finish"].includes(c.page) && fresh(c));
  const worst = timers.length ? Math.max(...timers.map(c => c.rtt)) / 1000 : null;
  return `<div class="tblwrap"><table class="sbh-t"><thead><tr><th>Phone</th><th>Login</th><th>Page</th><th>A/B</th><th>Phone clock</th><th>Accuracy</th><th>Checked</th><th></th></tr></thead><tbody>
    ${rows.map(c => `<tr><td>${esc(c.deviceId)}</td><td>${esc(ROLE_LABEL[c.role] || c.role || "")}</td><td>${c.page === "start" ? "Starter" : c.page === "finish" ? "Finisher" : esc(c.page || "")}</td><td>${esc(c.instance || "")}</td>
      <td>${(c.offset > 0 ? "+" : "") + (c.offset / 1000).toFixed(2)} s</td><td>±${(c.rtt / 2000).toFixed(2)} s</td><td>${new Date(c.at).toLocaleTimeString("en-GB")}</td>
      <td>${fresh(c) ? `<span class="chip live">OK</span>` : `<span class="chip draft">Check again</span>`}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">Every phone's times are corrected to the race database's clock, so phones agree with each other once checked. ${worst != null ? `Timing phones checked in the last 15 minutes agree to within about <b>${worst.toFixed(2)} s</b> at worst.` : "No Starter or Finisher phone has checked in the last 15 minutes — open the page on each, with signal."}</p>`;
}
async function loadClocks() {
  if (S.role !== "admin") return;
  try { clocks = await S.backend.query(`races/${RACE_ID}/clocks`); } catch (e) { clocks = []; }
  draw();
}
onChange(draw); draw();
onChange(() => { if (S.role === "admin" && !loadClocks.started) { loadClocks.started = true; loadClocks(); setInterval(loadClocks, 20000); } });
