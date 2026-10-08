import { $, fmtBytes, dropzone, setStatus, showResults, clearNode, baseName, announce, UserError, tx } from "./core.js?v=5";
import { loadPdfLib } from "./pdfcore.js?v=5";
import { serverInit, runServerJob, serverJob, fileToBase64, blobFromBase64, checkSize, available } from "./servercore.js?v=5";

const drop = $("#drop"), work = $("#work"), status = $("#status"), result = $("#result"), go = $("#go");
const pw = $("#pw"), pw2 = $("#pw2"), help = $("#pw-help");
const HELP = help.textContent;
let file = null;

dropzone(drop, {
  accept: ["application/pdf", ".pdf"], typeLabel: "PDF",
  onError: (m) => setStatus(status, "error", m),
  onFiles: async ([f]) => {
    clearNode(result); result.hidden = true;
    try {
      checkSize(f);
      const { PDFDocument } = await loadPdfLib();
      let doc;
      try { doc = await PDFDocument.load(new Uint8Array(await f.arrayBuffer()), { ignoreEncryption: true, updateMetadata: false }); } catch (_) {
        throw new UserError(tx("\"{name}\" couldn't be read as a PDF. It may be damaged or not a PDF.", { name: f.name }));
      }
      if (doc.isEncrypted) throw new UserError(tx("\"{name}\" already has a password or restrictions. To change them, remove them first with Unlock PDF.", { name: f.name }));
    } catch (e) { setStatus(status, "error", e.message); return; }
    file = f;
    $("#fname").textContent = f.name;
    $("#finfo").textContent = fmtBytes(f.size);
    work.hidden = false;
    drop.classList.add("is-compact");
    $("[data-pick-label]", drop).textContent = tx("Choose another PDF");
    setStatus(status, "idle");
    update();
    pw.focus();
    announce(tx("{name} ready. Choose a password.", { name: f.name }));
  },
});

function problem() {
  const a = pw.value, b = pw2.value;
  if (!a) return "";
  if (new TextEncoder().encode(a).length > 127) return tx("That password is too long (127 bytes at most).");
  if ([...a].some((ch) => ch < " " || ch === "\u007f")) return tx("The password can't contain control characters.");
  if (b && a !== b) return tx("The two passwords don't match.");
  return "";
}

function update() {
  const p = problem();
  help.textContent = p || HELP;
  if (p && pw2.value) pw2.setAttribute("aria-invalid", "true"); else pw2.removeAttribute("aria-invalid");
  go.disabled = !file || !available() || !pw.value || pw.value !== pw2.value || !!p;
}
for (const e of [pw, pw2]) e.addEventListener("input", update);
$("#show").addEventListener("change", (e) => { for (const i of [pw, pw2]) i.type = e.target.checked ? "text" : "password"; });

go.addEventListener("click", () => serverJob({
  status, button: go,
  done: (r) => r && r.msg,
  job: async (phase) => {
    if (!file) throw new UserError(tx("Choose a PDF first."));
    if (problem() || pw.value !== pw2.value) throw new UserError(problem() || tx("The two passwords don't match."));
    phase(tx("Reading the file…"));
    const b64 = await fileToBase64(file);
    const j = await runServerJob("/pdf/protect", {
      pdf_base64: b64, password: pw.value, allow_print: $("#allow-print").checked, allow_copy: $("#allow-copy").checked,
    }, { onPhase: phase });
    const blob = blobFromBase64(j.file.data_base64, "application/pdf");
    showResults(result, [{ blob, name: baseName(file.name) + "-protected.pdf", note: "AES-256" }], {
      note: tx("Keep the password somewhere safe: without it the PDF can't be opened, and we can't recover it. We never kept a copy of the file or the password."),
    });
    return { msg: tx("Done. Your PDF now needs the password to open.") };
  },
}));

$("#clear").addEventListener("click", () => {
  file = null;
  pw.value = pw2.value = "";
  work.hidden = true; clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a PDF");
  drop.querySelector("input").focus();
});

serverInit().then(update);
