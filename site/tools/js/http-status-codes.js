import { $, $$, el, debounce, tx, EN, fmtNum } from "./core.js?v=11";
import { CODES } from "./httpdata.js?v=11";

const list = $("#h-list"), q = $("#h-q"), count = $("#h-count"), none = $("#h-none");

const CLASS_NAME = { 1: tx("Informational"), 2: tx("Success"), 3: tx("Redirection"), 4: tx("Client error"), 5: tx("Server error") };
const items = CODES.map(([code, phrase, meaning, seen, client, owner, rfc, kw, flag]) => {
  const unofficial = !!flag && flag[0] === "u";
  const reserved = flag === "r";
  const cls = String(code)[0];
  const group = unofficial ? "u" : cls;
  const source = unofficial ? flag.slice(2) : "";
  const blob = [code, phrase, `${cls}xx`, CLASS_NAME[cls], meaning, seen, client, owner, rfc, kw || "", unofficial ? "unofficial " + source + (EN ? "" : " " + tx("Unofficial, {source}", { source })) : "", reserved ? "reserved unused" + (EN ? "" : " " + tx("Reserved, not for use")) : ""].join(" ").toLowerCase();
  const node = el("details", { id: String(code), class: "hs" + (unofficial ? " hs--un" : "") + (reserved ? " hs--res" : ""), "data-group": group },
    el("summary", {},
      el("span", { class: "hs-code" }, String(code)),
      el("span", { class: "hs-main" },
        el("span", { class: "hs-name" }, phrase,
          unofficial ? el("span", { class: "hs-tag" }, tx("Unofficial, {source}", { source })) : null,
          reserved ? el("span", { class: "hs-tag" }, tx("Reserved, not for use")) : null),
        el("span", { class: "hs-mean" }, meaning))),
    el("dl", { class: "hs-body" },
      el("div", {}, el("dt", {}, tx("When you see it")), el("dd", {}, seen)),
      el("div", {}, el("dt", {}, tx("As a client")), el("dd", {}, client)),
      el("div", {}, el("dt", {}, tx("As a server owner")), el("dd", {}, owner)),
      el("div", {}, el("dt", {}, unofficial ? tx("Source") : tx("Defined in")), el("dd", {}, rfc, " ", el("a", { class: "hs-link", href: `#${code}`, "aria-label": tx("Link to {code}", { code }) }, "#" + code)))));
  return { code, group, blob, node };
});
list.append(...items.map((i) => i.node));

const groups = ["all", "1", "2", "3", "4", "5", "u"];
const n = (g) => items.filter((i) => g === "all" || i.group === g).length;
for (const g of groups) {
  const label = g === "all" ? tx("All") : g === "u" ? tx("Unofficial") : `${g}xx`;
  $(`#h-g-${g}`).nextSibling.textContent = `${label} (${EN ? n(g) : fmtNum(n(g))})`;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function matches(item, tokens) {
  return tokens.every((t) => {
    if (/^\d{1,3}$/.test(t)) return String(item.code).startsWith(t);
    return new RegExp("(^|[^a-z0-9])" + esc(t)).test(item.blob);
  });
}

function apply() {
  const g = $('input[name="h-group"]:checked').value;
  const tokens = q.value.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const i of items) {
    const ok = (g === "all" || i.group === g) && matches(i, tokens);
    i.node.hidden = !ok;
    if (ok) shown++;
  }
  count.textContent = tx("Showing {shown} of {total} status codes.", { shown: EN ? shown : fmtNum(shown), total: EN ? items.length : fmtNum(items.length) });
  none.hidden = shown !== 0;
  if (shown === 0) none.textContent = g === "all"
    ? tx("No status code matches \"{q}\". Try a number such as 404, or a word such as redirect, timeout or cache.", { q: q.value.trim() })
    : tx("No status code matches \"{q}\" in this group. Try a number such as 404, or a word such as redirect, timeout or cache.", { q: q.value.trim() });
}

function target() {
  for (const i of items) i.node.classList.remove("is-target");
  const id = decodeURIComponent(location.hash.slice(1));
  const item = items.find((i) => String(i.code) === id);
  if (!item) return;
  if (item.node.hidden) { q.value = ""; $("#h-g-all").checked = true; apply(); }
  item.node.open = true;
  item.node.classList.add("is-target");
  item.node.scrollIntoView({ block: "start", behavior: "auto" });
}

q.addEventListener("input", debounce(apply, 80));
for (const r of $$('input[name="h-group"]')) r.addEventListener("change", apply);
window.addEventListener("hashchange", target);
apply();
target();
