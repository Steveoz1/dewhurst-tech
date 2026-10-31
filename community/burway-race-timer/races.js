/* races.js - race-level actions for the Burway Race Timer (multi-race brief Parts C, D, E, I4, O).
   Used by the Races page, Race Setup and the race hub. Admin / RaceAdmin only; every action is also
   checked by the Firestore rules. These write straight to the server (no offline queue): they are
   desk jobs done with signal, and each one reports success or failure on the page. */
import { S, ROLE_EMAIL } from "./sbh.js?v=20261031a";

export const STATUS = ["draft", "live", "finished", "archived"];
export const STATUS_NAME = { draft: "Draft", live: "Live", finished: "Finished", archived: "Archived" };
export const RACEADMINS = [ROLE_EMAIL.raceadmin];          // D10: one shared RaceAdmin login for now
const me = () => (S.authUser ? S.authUser.email.toLowerCase() : "");
export const isSuper = () => S.realRole === "admin";
export const canRun = r => !!r && (isSuper() || (S.realRole === "raceadmin" && String(r.owner || "").toLowerCase() === me()));

/* ---- race IDs (F-SU2, D2) ---- */
export const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export function slug(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, ""); }
export function suggestId(date, title) { return [date || "", slug(title)].filter(Boolean).join("-").slice(0, 60).replace(/-+$/, ""); }
/** "" if the ID can be used; otherwise the reason it can't. */
export async function idProblem(id) {
  if (!ID_RE.test(id)) return "Lower-case letters, numbers and hyphens only (e.g. 2026-11-07-training).";
  if (await S.backend.exists("races/" + id)) return "A race with this ID already exists.";
  try { if (await S.backend.exists("deletedRaces/" + id)) return "This ID belonged to a deleted race - pick another (old links must never point at a new race)."; } catch (e) {}
  return "";
}

/* ---- the race record ---- */
export function blankRace(id, owner) {
  return { raceId: id, title: "", shortName: "", date: "", firstStart: "", location: "", course: "", club: "Burway Rowing Club", officialsNotes: "",
    divisions: [{ n: 1, name: "Division 1", start: "", firstBoating: "" }],      // D4: one division for a new race
    resultsNote: "Provisional - subject to penalties and handicaps.", riverMinutes: 13, bowGuide: "",
    status: "draft", resultsPublic: false, deleteRequested: false, owner: owner || me(), duplicatedFrom: null, crewCount: 0, finishedCountA: 0 };
}
const stamp = () => ({ updatedAt: Date.now(), updatedBy: me() });
export async function createRace(rec) {
  const p = await idProblem(rec.raceId); if (p) throw new Error(p);
  await S.backend.commit([{ path: "races/" + rec.raceId, create: true, data: { ...rec, createdBy: me(), ...stamp() } }]);
}
export const updateRace = (id, patch) => S.backend.commit([{ path: "races/" + id, data: { ...patch, ...stamp() } }]);

/** F-SU9: what's missing before a race can go Live ([] = nothing). */
export function liveBlockers(r, crewCount) {
  const out = [];
  if (!String(r.title || "").trim()) out.push("a title");
  if (!r.date) out.push("a race date");
  if (!(r.divisions || []).some(d => /^\d{1,2}:\d{2}$/.test(d.start || ""))) out.push("at least one division with a start time");
  if (!(crewCount > 0)) out.push("at least one crew");
  return out;
}

/* ---- Duplicate (E1): reads the source, writes only the new race ---- */
export async function duplicateRace(srcId, { raceId, title, date, owner }) {
  const p = await idProblem(raceId); if (p) throw new Error(p);
  const src = await S.backend.getOnce("races/" + srcId);
  if (!src || !src.raceId) throw new Error("Couldn't read the race to copy.");
  const keep = ["shortName", "firstStart", "location", "course", "club", "officialsNotes", "divisions", "resultsNote", "riverMinutes", "bowGuide"];
  const rec = { ...blankRace(raceId, owner || me()), ...Object.fromEntries(keep.filter(k => k in src).map(k => [k, src[k]])),
    title, shortName: title.length <= 24 ? title : (src.shortName && src.shortName !== src.title ? src.shortName : title.slice(0, 24)),
    date, duplicatedFrom: srcId, dupIncomplete: true };
  await S.backend.commit([{ path: "races/" + raceId, create: true, data: { ...rec, createdBy: me(), ...stamp() } }]);
  const cfg = await S.backend.getOnce(`races/${srcId}/config/race`);
  const ents = await S.backend.getOnce(`races/${srcId}/config/entries`);
  const crews = {};
  for (const [k, e] of Object.entries(ents || {})) if (e && typeof e === "object" && e.bow != null)
    crews[k] = { bow: e.bow, event: e.event || "", crew: e.crew || "", club: e.club || "", division: e.division ?? null, status: "", notes: "", ...(e.boat ? { boat: e.boat } : {}) };
  await S.backend.commit([
    { path: `races/${raceId}/config/race`, replace: true, data: { combos: (cfg && cfg.combos) || {} } },
    { path: `races/${raceId}/config/entries`, replace: true, data: crews }]);
  await S.backend.commit([{ path: "races/" + raceId, data: { dupIncomplete: false, crewCount: Object.keys(crews).length, ...stamp() } }]);
  return Object.keys(crews).length;
}

/* ---- Archive (F-RL5) ---- */
export const archiveRace = (id, r) => updateRace(id, { status: "archived", statusBeforeArchive: r.status === "archived" ? "finished" : (r.status || "finished") });
export const unarchiveRace = (id, r) => updateRace(id, { status: r.statusBeforeArchive && r.statusBeforeArchive !== "live" ? r.statusBeforeArchive : "finished", deleteRequested: false });

/* ---- Everything in one race, for Export and Delete ---- */
const SINGLES = ["config/race", "config/entries", "timings/A", "timings/B"], COLLS = ["taps", "clocks"];
export async function collectRace(id) {
  const out = { ["races/" + id]: await S.backend.getOnce("races/" + id) };
  for (const s of SINGLES) out[`races/${id}/${s}`] = await S.backend.getOnce(`races/${id}/${s}`);
  for (const c of COLLS) for (const d of await S.backend.query(`races/${id}/${c}`)) { const { id: did, ...rest } = d; out[`races/${id}/${c}/${did}`] = rest; }
  return out;
}
/** F-H5: one JSON file with the whole race. */
export async function exportRace(id) {
  const all = await collectRace(id);
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), exportedBy: me(), raceId: id, documents: all }, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${id}_everything_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return Object.keys(all).length;
}

/* ---- Delete (E3, I4): archived races only, Admin only; resumable ---- */
export async function deleteRace(id, progress = () => {}) {
  const r = await S.backend.getOnce("races/" + id);
  if (!r || r.status !== "archived") throw new Error("Only an archived race can be deleted.");
  if (!r.deleteRequested) await updateRace(id, { deleteRequested: true });
  const paths = [];
  for (const s of SINGLES) paths.push(`races/${id}/${s}`);
  for (const c of COLLS) for (const d of await S.backend.query(`races/${id}/${c}`)) paths.push(`races/${id}/${c}/${d.id}`);
  let done = 0; progress(done, paths.length + 1);
  for (let i = 0; i < paths.length; i += 400) {
    const chunk = paths.slice(i, i + 400);
    await S.backend.commit(chunk.map(p => ({ path: p, del: true })));
    done += chunk.length; progress(done, paths.length + 1);
  }
  await S.backend.commit([{ path: "races/" + id, del: true }]);
  await S.backend.commit([{ path: "deletedRaces/" + id, data: { deletedAt: Date.now(), deletedBy: me() } }]);
  progress(paths.length + 1, paths.length + 1);
}

export const changeOwner = (id, owner) => updateRace(id, { owner });
