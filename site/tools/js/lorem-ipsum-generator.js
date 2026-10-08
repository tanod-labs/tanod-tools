import { $, wireCopy, downloadButton, announce, tx } from "./textcore.js?v=5";

const WORDS = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum at vero eos accusamus iusto odio dignissimos ducimus blanditiis praesentium voluptatum deleniti atque corrupti quos dolores quas molestias excepturi occaecati cupiditate provident similique mollitia animi perspiciatis unde omnis iste natus error voluptatem accusantium doloremque laudantium totam rem aperiam eaque ipsa quae ab illo inventore veritatis quasi architecto beatae vitae dicta explicabo nemo ipsam quia voluptas aspernatur aut odit fugit consequuntur magni dolores eum ratione sequi nesciunt neque porro quisquam dolorem adipisci numquam eius modi tempora incidunt magnam quaerat").split(" ");
const OPENING = "Lorem ipsum dolor sit amet, consectetur adipiscing elit".split(" ");

function rnd(n) {
  const buf = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  do { crypto.getRandomValues(buf); } while (buf[0] >= lim);
  return buf[0] % n;
}
const between = (lo, hi) => lo + rnd(hi - lo + 1);
const cap = (w) => w[0].toUpperCase() + w.slice(1);

function sentence(first) {
  const n = between(8, 16);
  const w = [];
  if (first) w.push(...OPENING);
  let prev = "";
  while (w.length < n) {
    let x;
    do { x = WORDS[rnd(WORDS.length)]; } while (x === prev);
    w.push(x); prev = x;
  }
  // a comma or two in the middle of longer sentences
  const out = w.map((x, i) => (i > 3 && i < w.length - 3 && !x.endsWith(",") && rnd(7) === 0) ? x + "," : x);
  if (out[out.length - 1].endsWith(",")) out[out.length - 1] = out[out.length - 1].slice(0, -1);
  out[0] = cap(out[0]);
  return out.join(" ") + ".";
}

export function generate({ unit, count, start, wrap }) {
  if (unit === "words") {
    const w = [];
    if (start) w.push(...OPENING.slice(0, 5));
    while (w.length < count) w.push(WORDS[rnd(WORDS.length)]);
    return cap(w.slice(0, count).join(" ").replace(/,$/, "")) + ".";
  }
  if (unit === "sentences") {
    const s = [];
    for (let i = 0; i < count; i++) s.push(sentence(start && i === 0));
    return s.join(" ");
  }
  const paras = [];
  for (let p = 0; p < count; p++) {
    const n = between(4, 7), s = [];
    for (let i = 0; i < n; i++) s.push(sentence(start && p === 0 && i === 0));
    paras.push(s.join(" "));
  }
  return wrap ? paras.map((p) => `<p>${p}</p>`).join("\n\n") : paras.join("\n\n");
}

const out = $("#out");
const LIMITS = { paragraphs: 100, sentences: 500, words: 5000 };

function run() {
  const unit = document.querySelector('input[name="unit"]:checked').value;
  const num = $("#count");
  const max = LIMITS[unit];
  num.max = String(max);
  let n = Math.floor(Number(num.value));
  const bad = !Number.isFinite(n) || n < 1 || n > max;
  num.setAttribute("aria-invalid", bad ? "true" : "false");
  $("#count-help").textContent = bad ? tx("Enter a number from 1 to {max}.", { max }) : tx("Up to {max}.", { max });
  $("#wrap-row").hidden = unit !== "paragraphs";
  if (bad) { out.value = ""; $("#copy").disabled = $("#dl").disabled = true; return; }
  out.value = generate({ unit, count: n, start: $("#start").checked, wrap: $("#wrap").checked });
  $("#copy").disabled = $("#dl").disabled = false;
}

["#count", "#start", "#wrap"].forEach((s) => $(s).addEventListener("input", run));
document.querySelectorAll('input[name="unit"]').forEach((r) => r.addEventListener("change", run));
$("#again").addEventListener("click", () => { run(); announce(tx("Generated new text.")); });
wireCopy($("#copy"), () => out.value);
$("#dl").replaceWith(Object.assign(downloadButton(tx("Download .txt"), () => out.value, "lorem-ipsum.txt"), { id: "dl" }));
run();
