import { $, $$, debounce, setStatus, copyText } from "./core.js?v=11";

/* x402 listing lint. Pure rules in lint(); everything runs in the page and nothing is sent anywhere. */

const MAX_DESC = 500;
const MAX_BYTES = 1024 * 1024;
const WHEN = /\b(use (this |it |the endpoint |the tool )?(when|if|to|for|before|after)|when to use|call (this |it )?(when|if|before|after|to)|best (used )?(for|when)|ideal for|useful (when|for|if)|should (use|call)|reach for)\b/i;
const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : "");
const filled = (v) => (isObj(v) ? Object.keys(v).length > 0 : typeof v === "string" ? v.trim() !== "" : v != null && v !== false);

/* Accepts a PaymentRequired object (v1 or v2), a bare accepts[] entry, or the base64 PAYMENT-REQUIRED header value. */
export function parseInput(text) {
  let t = text.trim();
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  if (/^payment-required:\s*/i.test(t)) t = t.replace(/^payment-required:\s*/i, "").trim();
  if (t && t[0] !== "{" && t[0] !== "[" && /^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) {
    try {
      const b = atob(t.replace(/-/g, "+").replace(/_/g, "/"));
      t = new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
    } catch (_) { /* fall through to JSON error */ }
  }
  return JSON.parse(t);
}

function R(level, name, msg, fix) { return { level, name, msg, fix: level === "pass" ? "" : fix }; }

export function lint(pr) {
  const rows = [];
  if (!isObj(pr)) throw new Error("Expected a JSON object.");
  const accepts = Array.isArray(pr.accepts) ? pr.accepts.filter(isObj) : (pr.payTo || pr.network ? [pr] : []);
  const res = isObj(pr.resource) ? pr.resource : {};
  const first = accepts[0] || {};
  const bz = isObj(pr.extensions) && isObj(pr.extensions.bazaar) ? pr.extensions.bazaar : {};

  /* description: v2 puts it on resource, v1 on each accepts entry */
  const desc = str(res.description) || str(pr.description) || str(first.description);
  if (!desc.trim()) rows.push(R("fail", "Description", "No description found.", "Add a description of what the endpoint does and returns (resource.description in v2, accepts[].description in v1)."));
  else rows.push(R("pass", "Description", "Present."));

  if (desc.trim()) {
    const n = [...desc].length;
    if (n > MAX_DESC) rows.push(R("fail", "Description length", `${n} characters; the limit is ${MAX_DESC}.`, `Cut ${n - MAX_DESC} character${n - MAX_DESC === 1 ? "" : "s"}. CDP rejects descriptions over ${MAX_DESC} at settle time.`));
    else if (n > MAX_DESC - 50) rows.push(R("warn", "Description length", `${n} of ${MAX_DESC} characters.`, "Close to the limit; trim a little so edits do not push it over."));
    else rows.push(R("pass", "Description length", `${n} of ${MAX_DESC} characters.`));

    if (WHEN.test(desc)) rows.push(R("pass", "When-to-use sentence", "Found."));
    else rows.push(R("warn", "When-to-use sentence", "No \"use when\" sentence found.", "Add one, for example: \"Use when an agent needs X before doing Y.\" Curators look for it; 94% of Bazaar listings lack it."));
  }

  const url = str(res.url) || str(pr.resource) || str(first.resource);
  if (!url) rows.push(R("fail", "Resource URL", "No resource URL found.", "Set resource.url (v2) or accepts[].resource (v1) to the full endpoint URL."));
  else {
    let u = null;
    try { u = new URL(url); } catch (_) { /* invalid */ }
    if (!u) rows.push(R("fail", "Resource URL", "Not a valid absolute URL.", "Use a full URL such as https://api.example.com/v1/thing."));
    else if (u.protocol !== "https:") rows.push(R("fail", "Resource URL", `Uses ${u.protocol.replace(":", "")}, not https.`, "Serve the endpoint over https; the Bazaar only lists https resources."));
    else rows.push(R("pass", "Resource URL", "https."));
  }

  const mime = str(res.mimeType) || str(first.mimeType) || str(pr.mimeType);
  if (!mime.trim()) rows.push(R("fail", "mimeType", "Missing.", "Set mimeType to the response type, usually \"application/json\"."));
  else if (!/^[\w.+-]+\/[\w.+-]+(\s*;.*)?$/.test(mime.trim())) rows.push(R("warn", "mimeType", `"${mime}" does not look like a MIME type.`, "Use type/subtype, for example application/json."));
  else rows.push(R("pass", "mimeType", mime));

  const schema = first.outputSchema ?? pr.outputSchema ?? bz.schema ?? (isObj(bz.info) ? bz.info.output : undefined);
  if (!filled(schema)) rows.push(R("fail", "outputSchema", "Missing or empty.", "Describe the response (and input) shape in outputSchema, or extensions.bazaar in v2, so agents can call it without guessing."));
  else rows.push(R("pass", "outputSchema", "Present."));

  if (!accepts.length) {
    rows.push(R("fail", "accepts", "No payment options found.", "Add at least one entry to accepts[] with scheme, network, asset, amount and payTo."));
  }
  accepts.forEach((a, i) => {
    const tag = accepts.length > 1 ? ` (accepts[${i}])` : "";
    const amt = a.maxAmountRequired ?? a.amount;
    const amtName = "Amount" + tag;
    if (amt === undefined || amt === "") rows.push(R("fail", amtName, "No maxAmountRequired or amount.", "Set maxAmountRequired (v1) or amount (v2) as a string of base units, e.g. \"10000\" for 0.01 USDC."));
    else if (!/^\d+$/.test(String(amt)) || BigInt(String(amt)) === 0n) rows.push(R("fail", amtName, `"${amt}" is not a positive integer string.`, "Use whole base units as a digit string (USDC has 6 decimals), not a decimal like \"0.01\"."));
    else rows.push(R("pass", amtName, String(amt) + " base units."));

    rows.push(str(a.network).trim()
      ? R("pass", "Network" + tag, a.network)
      : R("fail", "Network" + tag, "Missing.", "Set network, e.g. \"base\" (v1) or \"eip155:8453\" (v2)."));
    rows.push(str(a.asset).trim()
      ? R("pass", "Asset" + tag, a.asset)
      : R("fail", "Asset" + tag, "Missing.", "Set asset to the token contract address (USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)."));

    const pay = str(a.payTo).trim();
    if (!pay) rows.push(R("fail", "payTo" + tag, "Missing.", "Set payTo to the wallet address that receives payment."));
    else if (!(EVM.test(pay) || SOL.test(pay))) rows.push(R("fail", "payTo" + tag, `"${pay}" is not an address.`, "Use a 0x address with 40 hex characters (EVM) or a base58 Solana address."));
    else rows.push(R("pass", "payTo" + tag, pay));
  });
  return rows;
}

const SAMPLE = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: "https://api.example.com/v1/weather", description: "Weather forecast for a city.", mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "10000", payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C", maxTimeoutSeconds: 60 }],
  extensions: { bazaar: { info: { output: { type: "json", example: { tempC: 21 } } } } },
};

function render(rows) {
  const list = $("#l-list");
  list.textContent = "";
  for (const r of rows) {
    const li = document.createElement("li");
    li.className = "ll-r ll-r--" + r.level;
    li.dataset.level = r.level;
    const tag = Object.assign(document.createElement("span"), { className: "ll-r__tag", textContent: r.level });
    const name = Object.assign(document.createElement("span"), { className: "ll-r__name", textContent: r.name });
    const msg = Object.assign(document.createElement("span"), { className: "ll-r__msg", textContent: r.msg });
    li.append(tag, name, msg);
    if (r.fix) li.append(Object.assign(document.createElement("p"), { className: "ll-r__fix", textContent: "Fix: " + r.fix }));
    list.append(li);
  }
  const c = (l) => rows.filter((r) => r.level === l).length;
  $("#l-sum").textContent = `${c("fail")} fail, ${c("warn")} warn, ${c("pass")} pass`;
  $("#l-sum").dataset.fail = String(c("fail"));
  $("#l-sum").dataset.warn = String(c("warn"));
  $("#l-sum").dataset.pass = String(c("pass"));
  $("#l-result").hidden = false;
}

const input = $("#l-in");
const status = $("#status");

function run() {
  const text = input.value;
  if (!text.trim()) { setStatus(status, "idle"); $("#l-result").hidden = true; return; }
  if (new Blob([text]).size > MAX_BYTES) { $("#l-result").hidden = true; setStatus(status, "error", "That is over 1 MB; paste just the PaymentRequired body."); return; }
  let pr;
  try { pr = parseInput(text); } catch (err) {
    $("#l-result").hidden = true;
    setStatus(status, "error", "Not valid JSON: " + String(err.message).slice(0, 200) + ". Paste the 402 response body or the PAYMENT-REQUIRED header value.");
    return;
  }
  try {
    const rows = lint(pr);
    render(rows);
    const f = rows.filter((r) => r.level === "fail").length;
    setStatus(status, "done", f ? `${f} rule${f === 1 ? "" : "s"} failed.` : "No failing rules.");
  } catch (err) {
    $("#l-result").hidden = true;
    setStatus(status, "error", err.message);
  }
}

input.addEventListener("input", debounce(run, 200));
$("#l-sample").addEventListener("click", () => { input.value = JSON.stringify(SAMPLE, null, 2); run(); });
$("#l-clear").addEventListener("click", () => { input.value = ""; run(); input.focus(); });

/* The page cannot call other sites (its policy allows only this origin, and most APIs send no CORS headers),
   so a URL becomes a command to run yourself. */
const url = $("#l-url");
function curl() {
  const v = url.value.trim();
  const out = $("#l-curl");
  if (!/^https?:\/\/\S+$/i.test(v)) { out.hidden = true; $("#l-curl-copy").hidden = true; return; }
  out.textContent = `curl -s -i '${v.replace(/'/g, "%27")}'`;
  out.hidden = false;
  $("#l-curl-copy").hidden = false;
}
url.addEventListener("input", curl);
$("#l-curl-copy").addEventListener("click", (e) => copyText($("#l-curl").textContent, e.currentTarget));
