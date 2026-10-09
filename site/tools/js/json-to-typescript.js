import { $, debounce, copyText, textBlob, tx, txn } from "./core.js?v=11";
import { jsonToTs } from "./dev3core.js?v=11";

const input = $("#t-in"), out = $("#t-out"), info = $("#t-info"), root = $("#t-root");
const radios = document.querySelectorAll('input[name="t-style"]');
let current = "";

function update() {
  const opts = {
    rootName: root.value.trim(),
    style: document.querySelector('input[name="t-style"]:checked').value,
    exportKw: $("#t-export").checked,
    readonly: $("#t-readonly").checked,
    optional: $("#t-optional").checked,
  };
  root.setAttribute("aria-invalid", "false");
  input.setAttribute("aria-invalid", "false");
  if (!input.value.trim()) {
    current = ""; out.textContent = ""; info.classList.remove("tt__err");
    info.textContent = tx("Paste some JSON above to see TypeScript.");
    return;
  }
  try {
    current = jsonToTs(input.value, opts);
    out.textContent = current;
    info.classList.remove("tt__err");
    const n = (current.match(/^(?:export )?(?:interface|type) /gm) || []).length;
    info.textContent = txn(n, "{n} declaration generated.", "{n} declarations generated.");
  } catch (e) {
    current = "";
    out.textContent = "";
    info.classList.add("tt__err");
    info.textContent = e.message;
    (/type name/.test(e.message) ? root : input).setAttribute("aria-invalid", "true");
  }
}

const slow = debounce(update, 120);
input.addEventListener("input", slow);
root.addEventListener("input", slow);
for (const c of [...radios, $("#t-export"), $("#t-readonly"), $("#t-optional")]) c.addEventListener("change", update);
$("#t-copy").addEventListener("click", (e) => { if (current) copyText(current, e.currentTarget); });
$("#t-dl").addEventListener("click", () => {
  if (!current) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(textBlob(current, "text/plain"));
  a.download = `${root.value.trim() || "types"}.ts`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
update();
