import { $, $$, el, copyText, announce, tx, txn } from "./core.js?v=11";

const preview = $("#g-preview"), outEl = $("#g-out"), msg = $("#g-msg");
const stopsEl = $("#g-stops"), copyBtn = $("#g-copy");
const angleN = $("#g-angle"), angleR = $("#g-angle-r");

const MAX_STOPS = 10;
const state = {
  type: "linear", angle: 90, shape: "circle", x: 50, y: 50, repeat: false, fallback: false,
  stops: [{ color: "#1636a3", pos: 0 }, { color: "#6dd5ed", pos: 100 }],
};

const PRESETS = [
  { name: tx("Ocean"), type: "linear", angle: 135, stops: [["#2193b0", 0], ["#6dd5ed", 100]] },
  { name: tx("Sunset"), type: "linear", angle: 180, stops: [["#1b1464", 0], ["#c0392b", 55], ["#f7b733", 100]] },
  { name: tx("Midnight"), type: "linear", angle: 160, stops: [["#0f2027", 0], ["#203a43", 50], ["#2c5364", 100]] },
  { name: tx("Hard stripes"), type: "linear", angle: 90, stops: [["#1636a3", 0], ["#1636a3", 50], ["#f3c11a", 50], ["#f3c11a", 100]] },
  { name: tx("Candy stripes"), type: "linear", angle: 45, repeat: true, stops: [["#f3c11a", 0], ["#f3c11a", 10], ["#16140f", 10], ["#16140f", 20]] },
  { name: tx("Radial glow"), type: "radial", shape: "circle", x: 50, y: 50, stops: [["#fff3b0", 0], ["#f3c11a", 40], ["#16140f", 100]] },
  { name: tx("Colour wheel"), type: "conic", angle: 0, x: 50, y: 50, stops: [["#ff0000", 0], ["#ffff00", 17], ["#00ff00", 33], ["#00ffff", 50], ["#0000ff", 67], ["#ff00ff", 83], ["#ff0000", 100]] },
];

/* ------------------------------------------------------------------ colour checking */

let ctx;
/* A colour the browser accepts for the CSS color property. */
function validColour(v) {
  if (!v) return false;
  if (/var\(|inherit|initial|unset|revert/i.test(v)) return false;
  return CSS.supports("color", v);
}
/* "#rrggbb" for the picker, or null when the colour has alpha or cannot be flattened. */
function toHex(v) {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  for (const sentinel of ["#010203", "#030201"]) {
    ctx.fillStyle = sentinel;
    ctx.fillStyle = v;
    const s = String(ctx.fillStyle);
    if (s === sentinel) continue;
    return /^#[0-9a-f]{6}$/i.test(s) ? s : null;
  }
  return null;
}

/* ------------------------------------------------------------------ CSS text */

const num = (v) => (String(v).trim() === "" ? NaN : Number(v));

/* Returns {css} or {error, field}. */
export function buildCss(s) {
  const stops = [];
  for (let i = 0; i < s.stops.length; i++) {
    const st = s.stops[i];
    const c = String(st.color).trim();
    if (!validColour(c)) return { error: tx("Stop {n}: \"{c}\" is not a colour CSS understands. Use a HEX value such as #1636a3, or a name such as tomato.", { n: i + 1, c }), field: `colour-${i}` };
    const p = num(st.pos);
    if (!Number.isFinite(p) || p < 0 || p > 100) return { error: tx("Stop {n}: the position must be a number from 0 to 100.", { n: i + 1 }), field: `pos-${i}` };
    stops.push(`${c} ${p}%`);
  }
  const rep = s.repeat ? "repeating-" : "";
  const x = num(s.x), y = num(s.y), a = num(s.angle);
  let head;
  if (s.type === "linear" || s.type === "conic") {
    if (!Number.isFinite(a) || a < 0 || a > 360) return { error: tx("The angle must be a number from 0 to 360."), field: "angle" };
  }
  if (s.type !== "linear" && (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100)) {
    return { error: tx("The centre position must be two numbers from 0 to 100."), field: "pos" };
  }
  if (s.type === "linear") head = `${a}deg`;
  else if (s.type === "radial") head = `${s.shape} at ${x}% ${y}%`;
  else head = `from ${a}deg at ${x}% ${y}%`;
  const g = `${rep}${s.type}-gradient(${head}, ${stops.join(", ")})`;
  const first = String(s.stops[0].color).trim();
  const css = (s.fallback ? `background: ${first};\n` : "") + `background: ${g};`;
  return { css, gradient: g };
}

/* ------------------------------------------------------------------ rendering */

function clearInvalid() { $$("[aria-invalid]", $(".gen-grad")).forEach((n) => n.removeAttribute("aria-invalid")); }

function summary() {
  const n = state.stops.length;
  if (state.repeat) {
    if (state.type === "linear") return txn(n, "Repeating linear gradient with {n} stop.", "Repeating linear gradient with {n} stops.");
    if (state.type === "radial") return txn(n, "Repeating radial gradient with {n} stop.", "Repeating radial gradient with {n} stops.");
    return txn(n, "Repeating conic gradient with {n} stop.", "Repeating conic gradient with {n} stops.");
  }
  if (state.type === "linear") return txn(n, "linear gradient with {n} stop.", "linear gradient with {n} stops.");
  if (state.type === "radial") return txn(n, "radial gradient with {n} stop.", "radial gradient with {n} stops.");
  return txn(n, "conic gradient with {n} stop.", "conic gradient with {n} stops.");
}

function update() {
  clearInvalid();
  const r = buildCss(state);
  if (r.error) {
    outEl.value = "";
    copyBtn.disabled = true;
    msg.textContent = r.error;
    msg.dataset.state = "error";
    const f = r.field;
    let node = null;
    if (f === "angle") node = angleN;
    else if (f === "pos") node = $("#g-x");
    else if (f.startsWith("colour-")) node = $(`#g-stops li:nth-child(${+f.slice(7) + 1}) .gen-stop__c`);
    else if (f.startsWith("pos-")) node = $(`#g-stops li:nth-child(${+f.slice(4) + 1}) .gen-stop__p`);
    if (node) node.setAttribute("aria-invalid", "true");
    return;
  }
  outEl.value = r.css;
  copyBtn.disabled = false;
  preview.style.background = r.gradient;
  msg.dataset.state = "ok";
  msg.textContent = summary() +
    (state.repeat && Math.max(...state.stops.map((s) => Number(s.pos))) >= 100 ? " " + tx("The last stop is at 100%, so the repeat is not visible; end it earlier.") : "");
}

function syncType() {
  const t = state.type;
  $("#g-angle-box").hidden = t === "radial";
  $("#g-angle-l").textContent = t === "conic" ? tx("Start angle (degrees)") : tx("Angle (degrees)");
  $("#g-shape-box").hidden = t !== "radial";
  $("#g-x-box").hidden = $("#g-y-box").hidden = t === "linear";
}

function renderStops(focus) {
  stopsEl.textContent = "";
  const n = state.stops.length;
  state.stops.forEach((st, i) => {
    const hex = toHex(st.color) || "#000000";
    const pick = el("input", { type: "color", value: hex, "aria-label": tx("Stop {n} colour picker", { n: i + 1 }), class: "gen-stop__pick" });
    const txt = el("input", { type: "text", class: "mono gen-stop__c", value: st.color, autocomplete: "off", spellcheck: "false", autocapitalize: "off", id: `g-c-${i}` });
    const pos = el("input", { type: "number", class: "gen-stop__p", min: 0, max: 100, step: 1, value: st.pos, id: `g-p-${i}` });
    const up = el("button", { type: "button", class: "btn btn--sm", "aria-label": tx("Move stop {n} up", { n: i + 1 }), "data-act": "up" }, tx("Up"));
    const down = el("button", { type: "button", class: "btn btn--sm", "aria-label": tx("Move stop {n} down", { n: i + 1 }), "data-act": "down" }, tx("Down"));
    const rm = el("button", { type: "button", class: "btn btn--sm", "aria-label": tx("Remove stop {n}", { n: i + 1 }), "data-act": "rm" }, tx("Remove"));
    up.disabled = i === 0; down.disabled = i === n - 1; rm.disabled = n <= 2;
    pick.addEventListener("input", () => { st.color = pick.value; txt.value = pick.value; update(); });
    txt.addEventListener("input", () => {
      st.color = txt.value;
      const h = toHex(txt.value.trim());
      if (h) pick.value = h;
      update();
    });
    pos.addEventListener("input", () => { st.pos = pos.value; update(); });
    up.addEventListener("click", () => move(i, -1, "up"));
    down.addEventListener("click", () => move(i, 1, "down"));
    rm.addEventListener("click", () => {
      state.stops.splice(i, 1);
      renderStops({ i: Math.min(i, state.stops.length - 1), act: "rm" });
      update();
      announce(tx("Stop {n} removed.", { n: i + 1 }));
    });
    stopsEl.append(el("li", { class: "gen-stop" },
      el("span", { class: "gen-stop__n" }, tx("Stop {n}", { n: i + 1 })),
      pick,
      el("div", { class: "field" }, el("label", { for: `g-c-${i}` }, tx("Colour")), txt),
      el("div", { class: "field" }, el("label", { for: `g-p-${i}` }, tx("Position %")), pos),
      el("div", { class: "gen-stop__btns" }, up, down, rm)));
  });
  $("#g-add").disabled = n >= MAX_STOPS;
  if (focus) {
    const li = stopsEl.children[focus.i];
    const b = li && li.querySelector(`[data-act="${focus.act}"]`);
    const target = b && !b.disabled ? b : li && li.querySelector("[data-act]:not(:disabled)");
    if (target) target.focus();
  }
}

function move(i, d, act) {
  const j = i + d;
  if (j < 0 || j >= state.stops.length) return;
  [state.stops[i], state.stops[j]] = [state.stops[j], state.stops[i]];
  renderStops({ i: j, act });
  update();
  announce(tx("Stop moved to position {i} of {n}.", { i: j + 1, n: state.stops.length }));
}

function syncControls() {
  $(`input[name="g-type"][value="${state.type}"]`).checked = true;
  angleN.value = angleR.value = state.angle;
  $("#g-shape").value = state.shape;
  $("#g-x").value = state.x; $("#g-y").value = state.y;
  $("#g-repeat").checked = state.repeat;
  $("#g-fallback").checked = state.fallback;
  syncType();
}

/* ------------------------------------------------------------------ events */

$$('input[name="g-type"]').forEach((r) => r.addEventListener("change", () => { state.type = r.value; syncType(); update(); }));
angleN.addEventListener("input", () => { state.angle = angleN.value; if (angleN.value !== "") angleR.value = angleN.value; update(); });
angleR.addEventListener("input", () => { state.angle = angleR.value; angleN.value = angleR.value; update(); });
$("#g-shape").addEventListener("change", () => { state.shape = $("#g-shape").value; update(); });
$("#g-x").addEventListener("input", () => { state.x = $("#g-x").value; update(); });
$("#g-y").addEventListener("input", () => { state.y = $("#g-y").value; update(); });
$("#g-repeat").addEventListener("change", () => { state.repeat = $("#g-repeat").checked; update(); });
$("#g-fallback").addEventListener("change", () => { state.fallback = $("#g-fallback").checked; update(); });
copyBtn.addEventListener("click", () => copyText(outEl.value, copyBtn));

$("#g-add").addEventListener("click", () => {
  const s = state.stops;
  if (s.length >= MAX_STOPS) return;
  const a = Number(s[s.length - 2].pos), b = Number(s[s.length - 1].pos);
  const mid = Number.isFinite(a + b) ? Math.round((a + b) / 2) : 50;
  s.splice(s.length - 1, 0, { color: "#ffffff", pos: mid });
  renderStops({ i: s.length - 2, act: "up" });
  update();
  announce(txn(s.length, "Stop added. There is now {n} stop.", "Stop added. There are now {n} stops."));
});
$("#g-sort").addEventListener("click", () => {
  state.stops.sort((p, q) => Number(p.pos) - Number(q.pos));
  renderStops(); update(); announce(tx("Stops sorted by position."));
});
$("#g-rev").addEventListener("click", () => {
  state.stops.reverse().forEach((s) => { const p = Number(s.pos); if (Number.isFinite(p)) s.pos = 100 - p; });
  renderStops(); update(); announce(tx("Stops reversed."));
});

const presetBox = $("#g-presets");
for (const p of PRESETS) {
  const b = el("button", { type: "button", class: "btn btn--sm" }, p.name);
  b.addEventListener("click", () => {
    Object.assign(state, { type: p.type, angle: p.angle ?? 90, shape: p.shape || "circle", x: p.x ?? 50, y: p.y ?? 50, repeat: !!p.repeat });
    state.stops = p.stops.map(([color, pos]) => ({ color, pos }));
    syncControls(); renderStops(); update();
    announce(tx("{name} preset applied.", { name: p.name }));
  });
  presetBox.append(b);
}

syncControls();
renderStops();
update();
