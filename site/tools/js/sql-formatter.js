import { loadScript } from "./vendorload.js?v=5";
import { initFormatter, FmtError, loadFailed, $, $$ } from "./fmtcore.js?v=5";
import { prefs, tx } from "./core.js?v=5";

const SRC = "/tools/vendor/sql-formatter/sql-formatter.min.js";
let lib = null;
const ready = () => (lib ? Promise.resolve(lib) : loadScript(SRC, "sqlFormatter").then((l) => { lib = l; return l; }, loadFailed));

const SAMPLE = `select u.id, u.email::text as email, count(o.id) filter (where o.status = 'paid') as paid_orders
from users u left join orders o on o.user_id = u.id
where u.created_at > $1 and u.country = any($2) group by u.id, u.email having count(o.id) > 0 order by paid_orders desc limit 20;
update users set last_seen = now() where id = $3;`;

const dialect = $("#o-dialect");
const saved = prefs.get("sql:dialect", "sql");
if ([...dialect.options].some((o) => o.value === saved)) dialect.value = saved;

/* The library throws long parser dumps ("Instead, I was expecting..."): keep the first line and position. */
function friendly(err, lang) {
  const msg = String(err && err.message || err);
  const pos = /at line (\d+) column (\d+)/.exec(msg);
  const line = pos ? Number(pos[1]) : null, col = pos ? Number(pos[2]) : null;
  let why;
  if (/«EOF»/.test(msg)) why = tx("the statement ends too early. A bracket is probably not closed, or a clause is unfinished.");
  else {
    const tok = /Unexpected "([\s\S]*?)" at line/.exec(msg);
    if (tok) {
      const t = tok[1].length > 24 ? tok[1].slice(0, 24) + "…" : tok[1];
      why = lang === "sql" ? tx("unexpected \"{token}\". Check for an unclosed quote or bracket, or pick your database from the Dialect list.", { token: t })
        : tx("unexpected \"{token}\". Check for an unclosed quote or bracket.", { token: t });
    } else why = msg.split("\n")[0].replace(/^Parse error:?\s*/, "").replace(/ at line \d+ column \d+\.?$/, "") + ".";
  }
  return new FmtError(why, { line, col });
}

initFormatter({
  label: "SQL",
  ready,
  loaded: () => !!lib,
  triggers: $$("#o-dialect, #o-case, input[name='indent']"),
  sample: SAMPLE,
  filename: "formatted.sql",
  mime: "application/sql",
  done: tx("Formatted."),
  format(text) {
    const lang = dialect.value;
    const ind = $("input[name='indent']:checked").value;
    prefs.set("sql:dialect", lang);
    try {
      const out = lib.format(text, {
        language: lang,
        keywordCase: $("#o-case").value,
        tabWidth: ind === "tab" ? 4 : Number(ind),
        useTabs: ind === "tab",
        linesBetweenQueries: 1,
      });
      return { out };
    } catch (err) {
      throw friendly(err, lang);
    }
  },
});
