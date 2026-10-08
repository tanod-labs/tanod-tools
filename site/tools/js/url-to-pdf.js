import { $, setStatus, showResults, clearNode, announce, UserError, prefs, tx, txn } from "./core.js?v=5";
import { serverInit, runServerJob, serverJob, blobFromBase64, available } from "./servercore.js?v=5";

const url = $("#url"), go = $("#go"), status = $("#status"), result = $("#result"), help = $("#url-help");
const HELP = help.textContent;
const radio = (n) => document.querySelector(`input[name="${n}"]:checked`).value;

for (const n of ["paper", "orient"]) {
  const saved = prefs.get("url-to-pdf:" + n, null);
  const input = saved && document.querySelector(`input[name="${n}"][value="${saved}"]`);
  if (input) input.checked = true;
  document.querySelectorAll(`input[name="${n}"]`).forEach((i) => i.addEventListener("change", () => prefs.set("url-to-pdf:" + n, radio(n))));
}

/* The address as typed, made absolute: "example.com/page" becomes "https://example.com/page". */
function target() {
  let v = url.value.trim();
  if (!v) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = "https://" + v;
  let u;
  try { u = new URL(v); } catch (_) { throw new UserError(tx("That doesn't look like a web address, for example https://example.com/page.")); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UserError(tx("Only http:// and https:// addresses work."));
  if (u.username || u.password) throw new UserError(tx("Addresses with a user name or password in them aren't allowed."));
  if (!u.hostname.includes(".")) throw new UserError(tx("Use a public web address, for example https://example.com/page."));
  if (u.href.length > 2048) throw new UserError(tx("That address is too long (2,048 characters at most)."));
  return u;
}

function update() {
  let ok = available();
  url.removeAttribute("aria-invalid");
  help.textContent = HELP;
  try {
    if (!target()) ok = false;
  } catch (e) {
    ok = false;
    url.setAttribute("aria-invalid", "true");
    help.textContent = e.message;
  }
  go.disabled = !ok;
}
url.addEventListener("input", update);
url.addEventListener("keydown", (e) => { if (e.key === "Enter" && !go.disabled) { e.preventDefault(); go.click(); } });

function fileName(u) {
  const host = u.hostname.replace(/^www\./, "");
  const last = u.pathname.split("/").filter(Boolean).pop() || "";
  const base = (host + (last ? "-" + last.replace(/\.[a-z0-9]+$/i, "") : "")).replace(/[^a-z0-9.-]+/gi, "-").slice(0, 80);
  return base + ".pdf";
}

go.addEventListener("click", () => serverJob({
  status, button: go,
  done: (r) => r && r.msg,
  job: async (phase) => {
    const u = target();
    if (!u) throw new UserError(tx("Enter a web address first."));
    clearNode(result); result.hidden = true;
    const j = await runServerJob("/pdf/html-to-pdf", {
      url: u.href, paper: radio("paper"), landscape: radio("orient") === "landscape", print_background: $("#bg").checked,
    }, { onPhase: phase });
    const blob = blobFromBase64(j.file.data_base64, "application/pdf");
    const pages = j.pages || j.file.pages;
    showResults(result, [{ blob, name: fileName(u), note: pages ? txn(pages, "{n} page", "{n} pages") : "" }], {
      note: tx("Printed by a browser on our server, as a visitor with no login would see the page. Pages behind a login, a cookie banner or a paywall print as that visitor sees them."),
    });
    announce(tx("Your PDF is ready."));
    return { msg: tx("Done. Your PDF is ready.") };
  },
}));

serverInit().then(update);
