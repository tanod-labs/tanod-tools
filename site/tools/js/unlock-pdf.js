import { $, fmtBytes, dropzone, setStatus, showResults, clearNode, baseName, announce, UserError, tx } from "./core.js?v=5";
import { loadPdfLib } from "./pdfcore.js?v=5";
import { serverInit, runServerJob, serverJob, fileToBase64, blobFromBase64, checkSize, available } from "./servercore.js?v=5";

const drop = $("#drop"), work = $("#work"), status = $("#status"), result = $("#result"), go = $("#go");
const pw = $("#pw");
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
      if (!doc.isEncrypted) throw new UserError(tx("\"{name}\" has no password or restrictions, so there's nothing to remove.", { name: f.name }));
    } catch (e) { setStatus(status, "error", e.message); return; }
    file = f;
    $("#fname").textContent = f.name;
    $("#finfo").textContent = fmtBytes(f.size) + " · " + tx("protected");
    work.hidden = false;
    drop.classList.add("is-compact");
    $("[data-pick-label]", drop).textContent = tx("Choose another PDF");
    setStatus(status, "idle");
    update();
    pw.focus();
    announce(tx("{name} is protected. Enter its password.", { name: f.name }));
  },
});

function update() {
  const bad = new TextEncoder().encode(pw.value).length > 127;
  if (bad) pw.setAttribute("aria-invalid", "true"); else pw.removeAttribute("aria-invalid");
  go.disabled = !file || !available() || bad;
}
pw.addEventListener("input", update);
pw.addEventListener("keydown", (e) => { if (e.key === "Enter" && !go.disabled) { e.preventDefault(); go.click(); } });
$("#show").addEventListener("change", (e) => { pw.type = e.target.checked ? "text" : "password"; });

go.addEventListener("click", () => serverJob({
  status, button: go,
  done: (r) => r && r.msg,
  job: async (phase) => {
    if (!file) throw new UserError(tx("Choose a PDF first."));
    phase(tx("Reading the file…"));
    const b64 = await fileToBase64(file);
    const j = await runServerJob("/pdf/unlock", { pdf_base64: b64, password: pw.value }, { onPhase: phase });
    const blob = blobFromBase64(j.file.data_base64, "application/pdf");
    showResults(result, [{ blob, name: baseName(file.name) + "-unlocked.pdf" }], {
      note: tx("The copy opens without a password and has no printing or copying restrictions. Your original file is unchanged."),
    });
    return { msg: j.opened_with === "owner" || !pw.value ? tx("Done. Restrictions removed.") : tx("Done. Password removed.") };
  },
}));

$("#clear").addEventListener("click", () => {
  file = null;
  pw.value = "";
  work.hidden = true; clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a PDF");
  drop.querySelector("input").focus();
});

serverInit().then(update);
