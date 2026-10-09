// HTML entity encoder and decoder. Encoding and number decoding are in entitycore.js; names beyond its table are looked up
// with the browser's own HTML parser (a detached textarea: nothing is rendered, no script can run).
import { $, tx, txn, setStatus, copyText, announce, fmtNum } from "./core.js?v=11";
import { encode, decode } from "./entitycore.js?v=11";

const input = $("#he-in"), out = $("#he-out");
const mode = () => document.querySelector('input[name="he-mode"]:checked').value;
const probe = document.createElement("textarea");
const cache = new Map();

/* the browser decodes "&name;" to a character, or leaves it alone when the name is unknown */
function lookup(name) {
  if (cache.has(name)) return cache.get(name);
  probe.innerHTML = "&" + name + ";";
  const v = probe.value;
  const r = v === "&" + name + ";" ? null : v;
  cache.set(name, r);
  return r;
}

function update() {
  const m = mode();
  $("#he-opts").hidden = m !== "encode";
  const text = input.value;
  setStatus($("#status"), "idle");
  let msg = tx("Paste text to begin.");
  if (m === "encode") {
    const style = $("#he-style").value;
    const all = $("#he-all").checked;
    $("#he-style").disabled = all;
    out.value = encode(text, { mode: style, hex: $("#he-hex").checked, all });
    if (text) msg = tx("{chars} encoded into {len}.", { chars: txn(Array.from(text).length, "{n} character", "{n} characters"), len: txn(Array.from(out.value).length, "{n} character", "{n} characters") });
  } else {
    const r = decode(text, lookup);
    out.value = r.text;
    if (text) {
      msg = r.count ? txn(r.count, "{n} entity decoded.", "{n} entities decoded.") : tx("No entities found to decode.");
      if (r.unknown.length) msg += " " + tx("Not recognised and left as they are: {list}", { list: r.unknown.slice(0, 5).join(" ") });
    }
  }
  $("#he-report").textContent = msg;
  const has = !!text;
  $("#he-copy").disabled = $("#he-use").disabled = $("#he-clear").disabled = !has;
}

for (const sel of ["#he-in", "#he-style", "#he-hex", "#he-all"]) {
  $(sel).addEventListener("input", update);
  $(sel).addEventListener("change", update);
}
for (const r of document.querySelectorAll('input[name="he-mode"]')) r.addEventListener("change", update);
$("#he-copy").addEventListener("click", () => copyText(out.value, $("#he-copy")));
$("#he-use").addEventListener("click", () => { input.value = out.value; update(); announce(tx("Result moved into the input.")); });
$("#he-clear").addEventListener("click", () => { input.value = ""; update(); input.focus(); });
update();
