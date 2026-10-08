import { $, el, copyText, prefs, setStatus, announce, tx, EN, fmtNum } from "./core.js?v=5";

const SETS = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  digit: "0123456789",
  sym: "!@#$%^&*()-_=+[]{};:,.?/~",
};
const LOOK = new Set("Il1O0o");

$("#pw-symlist").textContent = SETS.sym;

/* Unbiased integer in [0, n) by rejection sampling over 32-bit values. */
function randInt(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(4294967296 / n) * n;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

function activeSets() {
  const noLook = $("#pw-nolook").checked;
  const out = [];
  for (const key of Object.keys(SETS)) {
    if (!$("#pw-" + (key === "digit" ? "digit" : key)).checked) continue;
    const chars = [...SETS[key]].filter((c) => !(noLook && LOOK.has(c))).join("");
    if (chars) out.push(chars);
  }
  return out;
}

export function makePassword(length, sets, requireEach) {
  const pool = sets.join("");
  const check = requireEach && length >= sets.length;
  for (;;) {
    let pw = "";
    for (let i = 0; i < length; i++) pw += pool[randInt(pool.length)];
    if (!check || sets.every((s) => [...s].some((c) => pw.includes(c)))) return pw;
  }
}

function clampNum(input, lo, hi, def) {
  let v = Math.round(Number(input.value));
  if (!Number.isFinite(v)) v = def;
  return Math.max(lo, Math.min(hi, v));
}

const list = $("#pw-list");
let passwords = [];

function label(bits) {
  return bits < 40 ? tx("Weak") : bits < 60 ? tx("Fair") : bits < 80 ? tx("Good") : bits < 100 ? tx("Strong") : tx("Very strong");
}

function generate() {
  const length = clampNum($("#pw-lennum"), 4, 128, 20);
  const count = clampNum($("#pw-count"), 1, 50, 1);
  const sets = activeSets();
  list.replaceChildren();
  passwords = [];
  if (!sets.length) {
    $("#pw-bits").textContent = "0"; $("#pw-label").textContent = "-"; $("#pw-pool").textContent = "0";
    setStatus($("#status"), "error", tx("Choose at least one kind of character."));
    $("#pw-copyall").disabled = true;
    return;
  }
  setStatus($("#status"), "idle");
  $("#pw-copyall").disabled = false;
  const poolSize = sets.join("").length;
  const bits = length * Math.log2(poolSize);
  for (let i = 0; i < count; i++) {
    const pw = makePassword(length, sets, $("#pw-each").checked);
    passwords.push(pw);
    const copy = el("button", { type: "button", class: "btn btn--sm", "aria-label": tx("Copy password {n}", { n: fmtNum(i + 1) }) }, tx("Copy"));
    copy.addEventListener("click", () => copyText(pw, copy));
    list.append(el("li", {}, el("code", { class: "util-pw", "data-pw": "" }, pw), copy));
  }
  $("#pw-bits").replaceChildren((EN ? bits.toFixed(0) : fmtNum(bits, { maximumFractionDigits: 0 })) + " ", el("small", {}, tx("bits")));
  $("#pw-label").textContent = label(bits);
  $("#pw-pool").textContent = EN ? String(poolSize) : fmtNum(poolSize);
  if ($("#pw-each").checked && length < sets.length) setStatus($("#status"), "error", tx("Length is shorter than the {n} chosen sets, so not every set can appear.", { n: fmtNum(sets.length) }));
}

function savePrefs() {
  prefs.set("pw-opts", {
    len: clampNum($("#pw-lennum"), 4, 128, 20), count: clampNum($("#pw-count"), 1, 50, 1),
    upper: $("#pw-upper").checked, lower: $("#pw-lower").checked, digit: $("#pw-digit").checked,
    sym: $("#pw-sym").checked, nolook: $("#pw-nolook").checked, each: $("#pw-each").checked,
  });
}

const saved = prefs.get("pw-opts", null);
if (saved && typeof saved === "object") {
  if (Number.isFinite(saved.len)) { $("#pw-len").value = $("#pw-lennum").value = Math.max(4, Math.min(128, saved.len)); }
  if (Number.isFinite(saved.count)) $("#pw-count").value = Math.max(1, Math.min(50, saved.count));
  for (const k of ["upper", "lower", "digit", "sym", "nolook", "each"]) if (typeof saved[k] === "boolean") $("#pw-" + k).checked = saved[k];
}

$("#pw-len").addEventListener("input", () => { $("#pw-lennum").value = $("#pw-len").value; generate(); savePrefs(); });
$("#pw-lennum").addEventListener("input", () => {
  const v = Math.round(Number($("#pw-lennum").value));
  if (Number.isFinite(v) && v >= 4 && v <= 128) { $("#pw-len").value = v; generate(); savePrefs(); }
});
$("#pw-lennum").addEventListener("change", () => { $("#pw-lennum").value = $("#pw-len").value = clampNum($("#pw-lennum"), 4, 128, 20); generate(); savePrefs(); });
$("#pw-count").addEventListener("change", () => { $("#pw-count").value = clampNum($("#pw-count"), 1, 50, 1); generate(); savePrefs(); });
for (const k of ["upper", "lower", "digit", "sym", "nolook", "each"]) $("#pw-" + k).addEventListener("change", () => { generate(); savePrefs(); });
$("#pw-gen").addEventListener("click", () => { generate(); announce(tx("New passwords generated.")); });
$("#pw-copyall").addEventListener("click", (e) => copyText(passwords.join("\n"), e.currentTarget));
generate();
