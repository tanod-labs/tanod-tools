import { $, fmtBytes, dropzone, setStatus, showResults, clearNode, baseName, announce, UserError, tx } from "./core.js?v=5";
import { serverInit, runServerJob, serverJob, fileToBase64, blobFromBase64, checkSize, available } from "./servercore.js?v=5";

const drop = $("#drop"), work = $("#work"), status = $("#status"), result = $("#result"), go = $("#go");
let file = null;

dropzone(drop, {
  accept: ["application/pdf", ".pdf"], typeLabel: "PDF",
  onError: (m) => setStatus(status, "error", m),
  onFiles: ([f]) => {
    clearNode(result); result.hidden = true;
    try { checkSize(f); } catch (e) { setStatus(status, "error", e.message); return; }
    file = f;
    $("#fname").textContent = f.name;
    $("#finfo").textContent = fmtBytes(f.size);
    work.hidden = false;
    drop.classList.add("is-compact");
    $("[data-pick-label]", drop).textContent = tx("Choose another PDF");
    setStatus(status, "idle");
    update();
    announce(tx("{name} ready to compress.", { name: f.name }));
  },
});

const level = () => document.querySelector('input[name="level"]:checked').value;
function update() { go.disabled = !file || !available(); }

go.addEventListener("click", () => serverJob({
  status, button: go,
  done: (r) => r && r.msg,
  job: async (phase) => {
    if (!file) throw new UserError(tx("Choose a PDF first."));
    phase(tx("Reading the file…"));
    const b64 = await fileToBase64(file);
    const j = await runServerJob("/pdf/compress", { pdf_base64: b64, level: level() }, { onPhase: phase });
    const before = file.size;
    if (j.unchanged || !j.file) {
      clearNode(result); result.hidden = true;
      return { msg: tx("This PDF is already compact: we couldn't make it smaller at this level, so there's nothing to download. Try Strong, or keep your original.") };
    }
    const blob = blobFromBase64(j.file.data_base64, "application/pdf");
    const saved = Math.max(0, Math.round((1 - blob.size / before) * 1000) / 10);
    showResults(result, [{ blob, name: baseName(file.name) + "-compressed.pdf", note: tx("was {size}", { size: fmtBytes(before) }) }], {
      title: tx("{saved}% smaller: {before} → {after}", { saved, before: fmtBytes(before), after: fmtBytes(blob.size) }),
      note: tx("Compressed on our server, then deleted there. Check the result before you delete your original."),
    });
    return { msg: tx("Done. Saved {size} ({saved}%).", { size: fmtBytes(before - blob.size), saved }) };
  },
}));

$("#clear").addEventListener("click", () => {
  file = null;
  work.hidden = true; clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a PDF");
  drop.querySelector("input").focus();
});

serverInit().then(update);
