// Extract emails, URLs, domains, IPs, phone-like numbers and hashtags. The matching is in extractcore.js (no DOM).
import { $, el, tx, txn, setStatus, copyText, fmtNum, announce, textBlob } from "./core.js?v=11";
import { KINDS, extractAll, listCsv } from "./extractcore.js?v=11";

const input = $("#ex-in"), lists = $("#ex-lists");
const TITLE = {
  emails: tx("Email addresses"), urls: tx("Web addresses (URLs)"), domains: tx("Domains"),
  ips: tx("IPv4 addresses"), phones: tx("Phone-like numbers"), hashtags: tx("Hashtags"),
};
const BOM = String.fromCharCode(0xfeff);

function save(text, name, type) {
  const url = URL.createObjectURL(textBlob(text, type));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* one card per kind, created once and refilled */
const cards = {};
for (const kind of KINDS) {
  const area = el("textarea", { id: "ex-out-" + kind, readonly: true, spellcheck: "false", wrap: "off", "aria-labelledby": "ex-h-" + kind });
  const h = el("h3", { id: "ex-h-" + kind });
  const copy = el("button", { type: "button", class: "btn btn--sm btn--primary" }, tx("Copy"));
  const txt = el("button", { type: "button", class: "btn btn--sm" }, tx("Download .txt"));
  const csv = el("button", { type: "button", class: "btn btn--sm" }, tx("Download .csv"));
  copy.addEventListener("click", () => copyText(area.value, copy));
  txt.addEventListener("click", () => save(area.value + "\n", kind + ".txt", "text/plain"));
  csv.addEventListener("click", () => save(BOM + listCsv(cards[kind].rows), kind + ".csv", "text/csv"));
  lists.append(el("section", { class: "ex-card" }, h, area, el("div", { class: "actions" }, copy, txt, csv)));
  cards[kind] = { area, h, copy, txt, csv, rows: [] };
}

function render() {
  const text = input.value;
  $("#ex-clear").disabled = !text;
  setStatus($("#status"), "idle");
  const unique = $("#ex-unique").checked;
  const res = extractAll(text, { unique, sort: $("#ex-sort").value });
  let totalFound = 0;
  for (const kind of KINDS) {
    const { rows, found } = res[kind];
    const c = cards[kind];
    c.rows = rows;
    totalFound += found;
    c.area.value = rows.map((r) => r.value).join("\n");
    c.h.textContent = unique && found !== rows.length
      ? tx("{title} ({n} different, {found} found)", { title: TITLE[kind], n: fmtNum(rows.length), found: fmtNum(found) })
      : tx("{title} ({n})", { title: TITLE[kind], n: fmtNum(rows.length) });
    for (const b of [c.copy, c.txt, c.csv]) b.disabled = !rows.length;
  }
  $("#ex-report").textContent = !text ? tx("Paste text to begin.")
    : totalFound ? txn(totalFound, "{n} item found.", "{n} items found.") : tx("Nothing found in this text.");
}

for (const id of ["#ex-in", "#ex-sort", "#ex-unique"]) { $(id).addEventListener("input", render); $(id).addEventListener("change", render); }
$("#ex-clear").addEventListener("click", () => { input.value = ""; render(); input.focus(); });
$("#ex-example").addEventListener("click", () => {
  input.value = "Contact: sales@example.com, Support <support@example.com> or alice@mail.example.org.\n"
    + "Docs at https://docs.example.com/start?ref=home and www.example.net/blog, also see (https://example.com/a_(b)).\n"
    + "Server 192.168.1.10 and 10.0.0.1. Call +1 (555) 123-4567 or 020 7946 0958.\n"
    + "Follow #launch and #Launch for news. Write to sales@example.com again.";
  render();
  announce(tx("Example loaded."));
});
render();
