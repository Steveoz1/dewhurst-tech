/* Updates / Issues tracker (added 23 Oct). For the admin and the timing team: crew changes, system issues, anything else.
   Shared between phones; every new issue and every change is kept in the audit log (nothing is overwritten). */
import { boot, mountBar, requireRole, onChange, changed, S, $, $$, esc, fmtClock, toast, confirmBox, downloadCSV,
         ISSUE_CATS, ISSUE_STATUSES, logIssue, pendingIssueRecords, watchIssueRecords } from "./sbh.js?v=20261023t";

await boot({ watch: ["entries"] });
mountBar($("#bar"), { instance: false, division: false });
await requireRole($("#gate"), ["admin", "starter", "finisher"], "admin");

let records = [];                                      // every issue record from the server
const mine = [];                                       // records made on this phone, shown at once until the server list includes them
watchIssueRecords(list => { records = list; changed(); });

const when = r => r.createdAt?.toMillis ? r.createdAt.toMillis() : (r.createdAt || r.at || r.tDevice || 0);
const who = r => (r.user || "").replace(/^sbh-/, "").replace("@dewhurst.tech", "");
const opt = (list, cur) => list.map(v => `<option${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("");

/* Rebuild the current state of each issue from its records: the newest record wins, the first gives "logged". */
function issues() {
  const have = new Set(records.map(r => r.id));
  const local = [...pendingIssueRecords(), ...mine].filter(p => !have.has(p.id) && (have.add(p.id), true));
  const all = [...records, ...local]
    .filter(r => r.issue && r.issue.key).sort((a, b) => when(a) - when(b));
  const map = new Map();
  for (const r of all) {
    const k = r.issue.key, cur = map.get(k);
    if (!cur) map.set(k, { ...r.issue, first: r, last: r, n: 1, pending: !!r.pending });
    else { Object.assign(cur, r.issue); cur.last = r; cur.n++; cur.pending = cur.pending || !!r.pending; }
  }
  const list = [...map.values()];
  const seen = {};                                     // two phones picking the same number at once: show 7 and 7b
  for (const i of list.sort((a, b) => when(a.first) - when(b.first))) { seen[i.id] = (seen[i.id] || 0) + 1; i.label = i.id + (seen[i.id] > 1 ? String.fromCharCode(96 + seen[i.id]) : ""); }
  return list;
}
function remember(rec) { mine.push(rec); changed(); }
const nextId = () => String(Math.max(0, ...issues().map(i => parseInt(i.id, 10) || 0)) + 1);

const app = $("#app");
app.innerHTML = `
  <form class="panel iss-add" id="add" autocomplete="off">
    <h3>Log an update or issue</h3>
    <div class="iss-grid">
      <label>Category<select name="cat">${opt(ISSUE_CATS, "Crew")}</select></label>
      <label>Bow number <small>(if any)</small><input name="bow" inputmode="numeric" pattern="[0-9]*" placeholder="e.g. 157"></label>
      <label class="wide">Issue<textarea name="text" rows="2" maxlength="500" placeholder="What happened or what changed"></textarea></label>
      <label>Status<select name="status">${opt(ISSUE_STATUSES, "Open")}</select></label>
    </div>
    <button class="btn primary" type="submit">Add</button> <span class="bad" id="addmsg"></span>
  </form>
  <div class="strip">
    <div class="seg light" id="fseg" role="group" aria-label="Show"><button type="button" data-f="open" class="on">Open</button><button type="button" data-f="all">All</button></div>
    <select id="fcat" aria-label="Category"><option value="">All categories</option>${opt(ISSUE_CATS, "")}</select>
    <span class="note" id="count"></span>
    <button type="button" class="btn small" id="exp">Export CSV</button>
  </div>
  <div class="tblwrap"><table class="sbh-t iss" id="tbl"></table></div>
  <p class="note">Every new issue and every change is kept with who made it and when; nothing is overwritten. A crew's issues also show in its history on Race Adjudication.</p>`;

let filter = "open", editing = null;
$$("#fseg button").forEach(b => b.addEventListener("click", () => { filter = b.dataset.f; $$("#fseg button").forEach(x => x.classList.toggle("on", x === b)); draw(); }));
$("#fcat").addEventListener("change", draw);

function bowCheck(v) {
  v = String(v || "").trim(); if (!v) return { ok: true, bow: null };
  if (!/^\d{1,4}$/.test(v)) return { ok: false, msg: "Bow number is digits only, or leave it blank." };
  const e = S.entries[v]; return { ok: true, bow: Number(v), crew: e ? e.crew : null };
}

$("#add").addEventListener("submit", e => {
  e.preventDefault(); const f = e.target;
  const text = f.text.value.trim(), b = bowCheck(f.bow.value);
  if (!text) { $("#addmsg").textContent = "Type the issue first."; f.text.focus(); return; }
  if (!b.ok) { $("#addmsg").textContent = b.msg; f.bow.focus(); return; }
  const id = nextId(), key = S.backend.newId();
  remember(logIssue({ key, id, cat: f.cat.value, bow: b.bow, text, status: f.status.value }));
  $("#addmsg").textContent = ""; f.text.value = ""; f.bow.value = ""; f.status.value = "Open";
  toast(`Issue #${id} logged`);
});

function draw() {
  const a = document.activeElement;                   // don't redraw under someone typing in an edit box
  if (a && a.closest && a.closest("#tbl") && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
  const all = issues().sort((a, b) => when(b.first) - when(a.first));      // newest first
  const rows = all.filter(i => (filter === "all" || i.status !== "Resolved") && (!$("#fcat").value || i.cat === $("#fcat").value));
  const open = all.filter(i => i.status !== "Resolved").length;
  $("#count").textContent = `${open} open · ${all.length} in total`;
  $("#tbl").innerHTML = `<thead><tr><th>ID</th><th>Category</th><th>Bow#</th><th>Issue</th><th>Status</th><th>Logged</th><th></th></tr></thead><tbody>${
    rows.map(i => editing === i.key ? editRow(i) : `<tr data-k="${esc(i.key)}" class="st-${i.status === "Resolved" ? "done" : i.status === "In progress" ? "prog" : "open"}">
      <td data-label="ID"><b>#${esc(i.label)}</b>${i.pending ? ` <small class="bad">not yet saved</small>` : ""}</td>
      <td data-label="Category">${esc(i.cat)}</td>
      <td data-label="Bow#">${i.bow ?? "–"}${i.bow != null && S.entries[String(i.bow)] ? `<br><small>${esc(S.entries[String(i.bow)].crew)}</small>` : ""}</td>
      <td data-label="Issue" class="wr">${esc(i.text)}</td>
      <td data-label="Status"><select class="st" aria-label="Status of issue ${esc(i.label)}">${opt(ISSUE_STATUSES, i.status)}</select></td>
      <td data-label="Logged"><small>${esc(fmtClock(when(i.first)).slice(0, 5))} ${esc(who(i.first))}${i.n > 1 ? `<br>updated ${esc(fmtClock(when(i.last)).slice(0, 5))} ${esc(who(i.last))}` : ""}</small></td>
      <td><button type="button" class="btn small edit">Edit</button></td></tr>`).join("")
    || `<tr><td colspan="7" class="empty">${all.length ? "No open issues." : "Nothing logged yet."}</td></tr>`}</tbody>`;
}
function editRow(i) {
  return `<tr data-k="${esc(i.key)}" class="editing"><td data-label="ID"><b>#${esc(i.label)}</b></td>
    <td data-label="Category"><select class="e-cat">${opt(ISSUE_CATS, i.cat)}</select></td>
    <td data-label="Bow#"><input class="e-bow" inputmode="numeric" value="${i.bow ?? ""}" style="width:80px"></td>
    <td data-label="Issue"><textarea class="e-text" rows="3" maxlength="500">${esc(i.text)}</textarea></td>
    <td data-label="Status"><select class="e-st">${opt(ISSUE_STATUSES, i.status)}</select></td>
    <td></td><td><button type="button" class="btn small primary save">Save</button> <button type="button" class="btn small cancel">Cancel</button></td></tr>`;
}
onChange(draw); draw();

$("#tbl").addEventListener("change", e => {
  const sel = e.target.closest("select.st"); if (!sel) return;
  const i = issues().find(x => x.key === sel.closest("tr").dataset.k); if (!i) return;
  remember(logIssue({ key: i.key, id: i.id, cat: i.cat, bow: i.bow, text: i.text, status: sel.value }));
  sel.blur(); toast(`#${i.label}: ${sel.value}`);
});
$("#tbl").addEventListener("click", async e => {
  const tr = e.target.closest("tr[data-k]"); if (!tr) return;
  const i = issues().find(x => x.key === tr.dataset.k); if (!i) return;
  if (e.target.closest(".edit")) { editing = i.key; document.activeElement?.blur(); draw(); document.querySelector("#tbl .e-text")?.focus(); }
  else if (e.target.closest(".cancel")) { editing = null; document.activeElement?.blur(); draw(); }
  else if (e.target.closest(".save")) {
    const text = $(".e-text", tr).value.trim(), b = bowCheck($(".e-bow", tr).value);
    if (!text) { toast("The issue can't be blank"); return; }
    if (!b.ok) { toast(b.msg); return; }
    remember(logIssue({ key: i.key, id: i.id, cat: $(".e-cat", tr).value, bow: b.bow, text, status: $(".e-st", tr).value }, i.bow));
    editing = null; document.activeElement?.blur(); draw(); toast(`#${i.label} updated`);
  }
});

$("#exp").addEventListener("click", () => {
  const rows = [["ID", "Category", "Bow#", "Crew", "Issue", "Status", "Logged", "Logged by", "Last updated", "Updated by", "Changes"]];
  for (const i of issues().sort((a, b) => when(a.first) - when(b.first)))
    rows.push([i.label, i.cat, i.bow ?? "", i.bow != null && S.entries[String(i.bow)] ? S.entries[String(i.bow)].crew : "", i.text, i.status,
      fmtClock(when(i.first)), who(i.first), fmtClock(when(i.last)), who(i.last), i.n - 1]);
  downloadCSV("SBH2026-issues.csv", rows);
});
