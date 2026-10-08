// Runs a user-supplied regular expression off the main thread so a runaway pattern can be terminated.
// Message in:  { id, text, pattern, flags, replacement, replace }
// Message out: { id, count, output? } or { id, error }
// List mode (Regex tester): { id, mode: "list", text, pattern, flags, replacement?, max }
//   -> { id, count, matches: [{ index, end, text, groups: [{ n, name?, value?, index? }] }], capped, output? }
//   Without the g flag only the first match is reported, the same as RegExp.prototype.exec.
self.onmessage = (e) => {
  const { id, text, pattern, flags, replacement, replace, mode } = e.data;
  try {
    if (mode === "list") { self.postMessage(listMatches(e.data)); return; }
    const re = new RegExp(pattern, flags);
    let count = 0;
    const g = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
    let m;
    while ((m = g.exec(text)) !== null) {
      count++;
      if (m[0] === "") g.lastIndex++;
    }
    const msg = { id, count };
    if (replace) msg.output = text.replace(re.global ? re : new RegExp(pattern, flags + "g"), replacement);
    self.postMessage(msg);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};

function describeMatch(m, names) {
  const groups = [];
  if (names.length && names.length !== m.length) names = [];
  for (let n = 1; n < m.length; n++) {
    const gi = m.indices ? m.indices[n] : null;
    groups.push({ n, name: names[n], value: m[n], index: gi ? gi[0] : undefined });
  }
  return { index: m.index, end: m.index + m[0].length, text: m[0], groups };
}

/* Group names by number, read from the pattern source (outside character classes and escapes). */
function groupNames(pattern) {
  const names = [];
  let n = 0, inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") { i++; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c !== "(") continue;
    if (pattern[i + 1] !== "?") { names[++n] = undefined; continue; }
    const named = /^\?<([^>=!]+)>/.exec(pattern.slice(i + 1));
    if (named) names[++n] = named[1];
  }
  return names;
}

function listMatches({ id, text, pattern, flags, replacement, max = 1000 }) {
  const useD = !flags.includes("d") && supportsD();
  const re = new RegExp(pattern, useD ? flags + "d" : flags);
  const names = groupNames(pattern);
  const matches = [];
  let count = 0;
  if (!re.global) {
    const m = re.exec(text);
    if (m) { count = 1; matches.push(describeMatch(m, names)); }
  } else {
    const unicode = re.unicode || re.unicodeSets;
    let m;
    while ((m = re.exec(text)) !== null) {
      count++;
      if (matches.length < max) matches.push(describeMatch(m, names));
      if (m[0] === "") {
        const cp = unicode ? text.codePointAt(re.lastIndex) : 0;
        re.lastIndex += cp > 0xffff ? 2 : 1;
      }
    }
  }
  const out = { id, count, matches, capped: count > matches.length };
  if (typeof replacement === "string") out.output = text.replace(new RegExp(pattern, flags), replacement);
  return out;
}

let dOk;
function supportsD() {
  if (dOk === undefined) { try { new RegExp("", "d"); dOk = true; } catch (_) { dOk = false; } }
  return dOk;
}
