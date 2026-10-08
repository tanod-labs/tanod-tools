import { $, live, openTextFile, wireCopy, downloadButton, fmtInt, normalizeNewlines, tx, txn } from "./textcore.js?v=5";

const area = $("#text");
const out = $("#out");
const status = $("#status");
const joinerSel = $("#joiner");
const custom = $("#custom");

function joinLines(lines, o) {
  let res = null;
  for (let line of lines) {
    if (o.trim) line = line.trim();
    if (line.trim() === "") continue;
    if (res === null) { res = line; continue; }
    if (o.hyphen && /\p{L}-$/u.test(res) && /^\p{Ll}/u.test(line)) res = res.slice(0, -1) + line;
    else res += o.joiner + line;
  }
  return res === null ? "" : res;
}

/* o: {mode: "para" | "all", joiner, trim, collapse, hyphen} */
export function unwrap(raw, o) {
  const text = normalizeNewlines(raw);
  let result;
  if (o.mode === "para") {
    result = text.split(/\n[ \t]*\n(?:[ \t]*\n)*/).map((p) => joinLines(p.split("\n"), o)).filter((p) => p !== "").join("\n\n");
  } else {
    result = joinLines(text.split("\n"), o);
  }
  if (o.collapse) result = result.replace(/[ \t]{2,}/g, " ");
  const removed = (text.match(/\n/g) || []).length - (result.match(/\n/g) || []).length;
  return { text: result, removed: Math.max(0, removed) };
}

function joiner() {
  if (joinerSel.value === "none") return "";
  if (joinerSel.value === "custom") return custom.value;
  return " ";
}

function update() {
  $("#custom-field").hidden = joinerSel.value !== "custom";
  const r = unwrap(area.value, {
    mode: document.querySelector('input[name="mode"]:checked').value, joiner: joiner(),
    trim: $("#trim").checked, collapse: $("#collapse").checked, hyphen: $("#hyphen").checked,
  });
  out.value = r.text;
  const has = !!area.value;
  $("#report").textContent = has ? txn(r.removed, "{n} line break removed.", "{n} line breaks removed.") : tx("Paste text to begin.");
  $("#copy").disabled = $("#dl").disabled = !r.text;
  $("#clear").disabled = !has;
}

const controls = [area, joinerSel, custom, $("#trim"), $("#collapse"), $("#hyphen"), ...document.querySelectorAll('input[name="mode"]')];
live(() => area.value, controls, update);
wireCopy($("#copy"), () => out.value);
$("#dl").replaceWith(Object.assign(downloadButton(tx("Download .txt"), () => out.value, "text-without-line-breaks.txt"), { id: "dl" }));
$("#clear").addEventListener("click", () => { area.value = ""; update(); area.focus(); });
openTextFile($("#drop"), status, (text) => { area.value = text; update(); });
update();
