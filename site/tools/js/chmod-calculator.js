import { $, $$, copyText, tx, EN, listText } from "./core.js?v=5";
import { parseOctal, parseSymbolic, toOctal, toSymbolic, chmodCommands, ModeError } from "./dev3core.js?v=5";

const octalIn = $("#m-octal"), symIn = $("#m-sym"), fileIn = $("#m-file"), info = $("#m-info"), warn = $("#m-warn");
const boxes = {};
for (const [who, shift] of [["u", 6], ["g", 3], ["o", 0]]) {
  for (const [what, bit] of [["r", 4], ["w", 2], ["x", 1]]) boxes[`${who}${what}`] = { el: $(`#m-${who}-${what}`), bit: bit << shift };
}
boxes.suid = { el: $("#m-suid"), bit: 0o4000 };
boxes.sgid = { el: $("#m-sgid"), bit: 0o2000 };
boxes.sticky = { el: $("#m-sticky"), bit: 0o1000 };

let mode = 0o755;

const FILE = { r: tx("read it"), w: tx("change it"), x: tx("run it as a program") };
const DIR = { r: tx("list the names in it"), w: tx("add, rename and delete entries (needs execute too)"), x: tx("enter it and reach entries by name") };
const join = (arr) => (arr.length < 2 ? arr[0] || "" : arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1]);

function describeWho(shift, map) {
  const b = (mode >> shift) & 7;
  const got = [];
  if (b & 4) got.push(map.r);
  if (b & 2) got.push(map.w);
  if (b & 1) got.push(map.x);
  return got.length ? tx("Can {list}.", { list: EN ? join(got) : listText(got) }) : tx("No access.");
}

function warnings() {
  const w = [];
  const worldWrite = mode & 0o002;
  if (worldWrite && (mode & 0o1000)) w.push(tx("Others can write, but the sticky bit limits deleting and renaming to each file's owner. This is how shared directories such as /tmp are set up (1777). On a plain file, the sticky bit does nothing."));
  else if (worldWrite) w.push(tx("World-writable: every user on the system, and any program running as one, can change this. Use 775 or 755 and fix ownership instead unless you are certain it is needed."));
  if (mode & 0o4000) w.push(tx("Setuid: the program runs with its owner's rights. Linux ignores the bit on shell scripts, and a writable setuid file is a privilege-escalation risk."));
  if (mode & 0o2000) w.push(tx("Setgid: a program runs with its group's rights, and on a directory new files inherit the directory's group."));
  const sym = toSymbolic(mode);
  if (/[ST]/.test(sym)) w.push(tx("An upper-case S or T means the special bit is set but execute is off. That is rarely intended; add execute or remove the special bit."));
  return w;
}

function commands() {
  const c = chmodCommands(mode, fileIn.value.trim() || "file");
  $("#m-cmd-num").textContent = c.numeric;
  $("#m-cmd-sym").textContent = c.symbolic;
}

function render(except) {
  for (const k in boxes) boxes[k].el.checked = (mode & boxes[k].bit) !== 0;
  if (except !== "octal") octalIn.value = toOctal(mode);
  if (except !== "sym") symIn.value = toSymbolic(mode);
  commands();
  const rows = [[tx("Owner"), 6], [tx("Group"), 3], [tx("Others"), 0]].map(([n, s]) => {
    const tr = document.createElement("tr");
    for (const t of [n, describeWho(s, FILE), describeWho(s, DIR)]) { const td = document.createElement(t === n ? "th" : "td"); if (t === n) td.scope = "row"; td.textContent = t; tr.append(td); }
    return tr;
  });
  $("#m-means tbody").replaceChildren(...rows);
  const w = warnings();
  warn.textContent = w.join(" ");
  warn.hidden = !w.length;
  for (const i of [octalIn, symIn]) i.setAttribute("aria-invalid", "false");
  info.classList.remove("tt__err");
  info.textContent = tx("Mode {octal} is {symbolic}.", { octal: toOctal(mode), symbolic: toSymbolic(mode) });
}

function fromText(parse, input, name) {
  try {
    mode = parse(input.value);
    render(name);
  } catch (e) {
    if (!(e instanceof ModeError)) throw e;
    input.setAttribute("aria-invalid", "true");
    info.classList.add("tt__err");
    info.textContent = e.message;
  }
}

for (const k in boxes) boxes[k].el.addEventListener("change", () => { mode = (mode & ~boxes[k].bit) | (boxes[k].el.checked ? boxes[k].bit : 0); render(); });
octalIn.addEventListener("input", () => fromText(parseOctal, octalIn, "octal"));
symIn.addEventListener("input", () => fromText(parseSymbolic, symIn, "sym"));
fileIn.addEventListener("input", commands);
for (const b of $$("[data-mode]")) b.addEventListener("click", () => { mode = parseInt(b.dataset.mode, 8); render(); });
$("#m-copy-num").addEventListener("click", (e) => copyText($("#m-cmd-num").textContent, e.currentTarget));
$("#m-copy-sym").addEventListener("click", (e) => copyText($("#m-cmd-sym").textContent, e.currentTarget));
render();
