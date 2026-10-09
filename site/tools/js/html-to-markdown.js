import { $, live, wireCopy, setStatus, announce, fmtInt, tx, txn } from "./textcore.js?v=11";
import { dropzone, fmtBytes, baseName } from "./core.js?v=11";
import { saveText } from "./csvcore.js?v=11";

const MAX_BYTES = 5 * 1024 * 1024;
const area = $("#html");
const out = $("#out");
const status = $("#status");
const report = $("#report");
const controls = ["#heading", "#bullet", "#code", "#em", "#tables"].map((s) => $(s));
let fileBase = "document";

/* Turndown loads the first time there is something to convert. It parses the HTML with the browser's
   DOMParser, which builds an inert document: scripts don't run and images aren't fetched. */
let lib = null;
function loadLib() {
  if (!lib) {
    lib = import("/tools/vendor/turndown/turndown.browser.es.js").then((m) => m.default);
    lib.catch(() => { lib = null; });
  }
  return lib;
}

const cellMd = (s) => s.replace(/\n+/g, " ").replace(/\|/g, "\\|").trim();

export function makeService(TurndownService, o) {
  const svc = new TurndownService({
    headingStyle: o.heading, bulletListMarker: o.bullet, codeBlockStyle: o.code,
    emDelimiter: o.em, strongDelimiter: "**", fence: "```", hr: "---",
  });
  svc.remove(["script", "style", "noscript", "template", "title", "meta", "link", "head", "iframe", "object", "embed", "button", "select", "textarea"]);
  svc.addRule("strike", {
    filter: ["del", "s", "strike"],
    replacement: (content) => (content.trim() ? "~~" + content + "~~" : content),
  });
  svc.addRule("taskItem", {
    filter: (node) => node.nodeName === "INPUT" && node.type === "checkbox" && node.parentNode && node.parentNode.nodeName === "LI",
    replacement(content, node) {
      const next = node.nextSibling;
      const gap = next && next.nodeType === 3 && /^\s/.test(next.nodeValue) ? "" : " ";
      return (node.checked ? "[x]" : "[ ]") + gap;
    },
  });
  const stats = { tables: 0, keptTables: 0 };
  if (o.tables) {
    svc.addRule("table", {
      filter: "table",
      replacement(content, node) {
        const rows = Array.from(node.rows);
        const spans = rows.some((r) => Array.from(r.cells).some((c) => c.rowSpan > 1 || c.colSpan > 1));
        const nested = node.querySelector("table");
        if (!rows.length || spans || nested) {
          stats.keptTables++;
          return "\n\n" + node.outerHTML + "\n\n";
        }
        stats.tables++;
        const width = Math.max(...rows.map((r) => r.cells.length));
        const cells = rows.map((r) => {
          const line = Array.from(r.cells, (c) => cellMd(svc.turndown(c)) || " ");
          while (line.length < width) line.push(" ");
          return line;
        });
        const aligns = Array.from(rows[0].cells, (c) => (c.getAttribute("align") || c.style.textAlign || "").toLowerCase());
        const rule = Array.from({ length: width }, (_, i) => {
          const a = aligns[i];
          return a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---";
        });
        const line = (r) => "| " + r.join(" | ") + " |";
        return "\n\n" + [line(cells[0]), line(rule), ...cells.slice(1).map(line)].join("\n") + "\n\n";
      },
    });
  } else {
    svc.keep(["table"]);
  }
  return { svc, stats };
}

export function htmlToMarkdown(TurndownService, html, o) {
  const { svc, stats } = makeService(TurndownService, o);
  const md = svc.turndown(html);
  return { md, ...stats };
}

const opts = () => ({
  heading: $("#heading").value, bullet: $("#bullet").value, code: $("#code").value, em: $("#em").value, tables: $("#tables").checked,
});

let run = 0;
async function update() {
  const html = area.value;
  const mine = ++run;
  if (!html.trim()) {
    out.value = "";
    report.textContent = tx("Paste HTML to begin.");
    $("#copy").disabled = $("#dl").disabled = true;
    setStatus(status, "idle");
    return;
  }
  let TurndownService;
  try { TurndownService = await loadLib(); } catch (err) {
    console.warn(err);
    setStatus(status, "error", tx("The converter couldn't be loaded. Check your connection and reload the page."));
    return;
  }
  if (mine !== run) return;
  try {
    const r = htmlToMarkdown(TurndownService, html, opts());
    out.value = r.md;
    const parts = [tx("{n} characters of Markdown", { n: fmtInt([...r.md].length) })];
    if (r.tables) parts.push(txn(r.tables, "{n} table converted", "{n} tables converted"));
    if (r.keptTables) parts.push(txn(r.keptTables, "{n} table with merged cells kept as HTML", "{n} tables with merged cells kept as HTML"));
    report.textContent = parts.join(", ") + ".";
    $("#copy").disabled = $("#dl").disabled = false;
    setStatus(status, "idle");
  } catch (err) {
    console.warn(err);
    out.value = "";
    report.textContent = "";
    $("#copy").disabled = $("#dl").disabled = true;
    setStatus(status, "error", tx("This HTML couldn't be converted. It may be nested too deeply."));
  }
}

live(() => area.value, [area, ...controls], update);
wireCopy($("#copy"), () => out.value);
$("#dl").addEventListener("click", () => saveText(out.value, fileBase + ".md", "text/markdown"));
$("#clear").addEventListener("click", () => { area.value = ""; fileBase = "document"; update(); area.focus(); });

dropzone($("#drop"), {
  accept: ["text/html", ".html", ".htm", "text/plain", ".txt"],
  typeLabel: "HTML", maxFileBytes: MAX_BYTES,
  onError: (m) => setStatus(status, "error", m + " " + tx("HTML files up to 5 MB can be opened.")),
  onFiles: async ([file]) => {
    try {
      area.value = await file.text();
      fileBase = baseName(file.name);
      update();
      announce(tx("Opened {name}, {size}.", { name: file.name, size: fmtBytes(file.size) }));
    } catch (_) { setStatus(status, "error", tx("That file couldn't be read as text.")); }
  },
});
update();
