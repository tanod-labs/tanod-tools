// SSD health check: paste smartctl or nvme-cli output, get the wear numbers and a plain verdict. Runs in the page; nothing is uploaded.
import { $, el, icon, debounce, setStatus } from "./core.js?v=14";
import { parseSmart, assess, SAMPLES } from "./ssdcore.js?v=14";

const status = $("#status");
const inEl = $("#ssd-in"), tbwEl = $("#ssd-tbw"), out = $("#ssd-out"), verdict = $("#ssd-verdict");
const fmt = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));


function render() {
  const raw = inEl.value;
  if (!raw.trim()) { out.hidden = true; inEl.setAttribute("aria-invalid", "false"); setStatus(status, "idle"); return; }
  let info;
  try { info = parseSmart(raw); } catch (err) {
    out.hidden = true;
    inEl.setAttribute("aria-invalid", "true");
    setStatus(status, "error", err.message);
    return;
  }
  inEl.setAttribute("aria-invalid", "false");
  setStatus(status, "idle");
  const tbw = Number(String(tbwEl.value).replace(",", "."));
  const rated = Number.isFinite(tbw) && tbw > 0 ? tbw : 0;
  const a = assess(info, rated);

  const healthy = a.level === "ok" && info.percentUsed != null;
  verdict.dataset.ok = healthy ? "yes" : a.level === "bad" ? "no" : "none";
  verdict.replaceChildren(icon(healthy ? "i-check" : a.level === "bad" ? "i-alert" : "i-clock"), a.headline);

  $("#ssd-pu").textContent = info.percentUsed === null || info.percentUsed === undefined ? "-" : fmt(info.percentUsed) + "%";
  $("#ssd-tb").textContent = info.tbWritten === null ? "-" : fmt(info.tbWritten, info.tbWritten < 10 ? 2 : 1) + " TB";
  $("#ssd-share").textContent = a.share === null ? (rated ? "-" : "add rated TBW") : fmt(a.share, 1) + "%";
  $("#ssd-gap").textContent = a.gap === null ? "-" : (a.gap > 0 ? "+" : "") + fmt(a.gap, 1) + " pts";
  $("#ssd-spare").textContent = info.spare === null || info.spare === undefined ? "-" : fmt(info.spare) + "% (threshold " + fmt(info.spareThreshold) + "%)";
  $("#ssd-media").textContent = fmt(info.mediaErrors ?? info.uncorrectable);
  $("#ssd-unsafe").textContent = fmt(info.unsafeShutdowns);
  $("#ssd-poh").textContent = fmt(info.powerOnHours);
  $("#ssd-cw").textContent = info.criticalWarning === null || info.criticalWarning === undefined ? "-" : "0x" + info.criticalWarning.toString(16).padStart(2, "0");
  $("#ssd-src").textContent = (info.model ? info.model + " · " : "") + "read as " + info.source;

  $("#ssd-reasons").replaceChildren(...a.reasons.map((r) =>
    el("li", { class: "ssd-r ssd-r--" + r.level }, el("strong", {}, r.level === "bad" ? "Problem: " : r.level === "caution" ? "Watch: " : "OK: "), r.text)));
  $("#ssd-notes").replaceChildren(...a.notes.map((n) => el("li", {}, n)));
  $("#ssd-notes-box").hidden = !a.notes.length;
  out.hidden = false;
}

const renderSoon = debounce(render, 120);
inEl.addEventListener("input", renderSoon);
tbwEl.addEventListener("input", renderSoon);
$("#ssd-clear").addEventListener("click", () => { inEl.value = ""; tbwEl.value = ""; render(); inEl.focus(); });

let next = 0;
$("#ssd-sample").addEventListener("click", () => {
  const s = SAMPLES[next % SAMPLES.length];
  next += 1;
  inEl.value = s.text;
  tbwEl.value = s.ratedTbw ? String(s.ratedTbw) : "";
  $("#ssd-sample-name").textContent = "Sample " + (((next - 1) % SAMPLES.length) + 1) + " of " + SAMPLES.length + ": " + s.label + ". Made-up numbers, not a real drive.";
  render();
  inEl.focus();
});

render();
