import { $, fmtBytes, tx, txn } from "./core.js?v=5";
import { batchTool, decode, newCanvas, ctx2d, release, encodeCanvas, outName, LABEL, dims } from "./imgcore.js?v=5";

const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const qInput = $("#quality"), qOut = $("#quality-out"), bg = $("#bg");
const bgField = $("#bg-field"), qField = $("#q-field");
let tool;

function sync() {
  const t = radio("to");
  bgField.hidden = t !== "jpeg";
  qField.hidden = t === "png";
  if (tool) tool.render();
}
qInput.addEventListener("input", () => { qOut.textContent = qInput.value; });
document.querySelectorAll('input[name="to"]').forEach((r) => r.addEventListener("change", sync));

tool = batchTool({
  drop: $("#drop"), list: $("#files"), optsBox: $("#opts"), goRow: $("#go-row"), go: $("#go"),
  summary: $("#summary"), status: $("#status"), result: $("#result"), clear: $("#clear"),
  verb: tx("Converting"), zipName: "converted-images.zip",
  pickFirst: $("#drop [data-pick-label]").textContent, // variant pages name their source format ("Choose PNG files")
  meta: (it) => `${fmtBytes(it.file.size)} · ${it.info.width ? dims(it.info.width, it.info.height) + " · " : ""}${LABEL[it.info.type]}`,
  summaryText: (items) => txn(items.length, "{n} image to {format}", "{n} images to {format}", { format: LABEL[radio("to")] }),
  async process(item) {
    const to = radio("to");
    const bmp = await decode(item.file);
    const canvas = newCanvas(bmp.width, bmp.height);
    ctx2d(canvas).drawImage(bmp, 0, 0);
    bmp.close();
    try {
      const blob = await encodeCanvas(canvas, to, Number(qInput.value) / 100, bg.value);
      const same = item.info.type === to;
      return {
        blob, name: outName(item.file.name, same ? "-converted" : "", to),
        note: `${LABEL[item.info.type]} → ${LABEL[to]} · ${fmtBytes(item.file.size)} → ${fmtBytes(blob.size)}`,
      };
    } finally {
      release(canvas);
    }
  },
  doneText: (outputs) => txn(outputs.length, "Converted {n} image to {format}.", "Converted {n} images to {format}.", { format: LABEL[radio("to")] }),
});
sync();
