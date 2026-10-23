/* Home page: show only the pages the signed-in role can use. */
import { boot, onChange, S, $, $$ } from "./sbh.js?v=20261022l";
await boot({ watch: [] });
function draw() {
  const role = S.user ? S.role : null;
  $$("#tiles .tile").forEach(t => { const r = t.dataset.r.split(" "); t.hidden = !(r.includes("all") || (role && r.includes(role))); });
  $("#officials").hidden = !!S.user;
}
onChange(draw); draw();
