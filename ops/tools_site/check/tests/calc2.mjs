// Calculators, batch 2: scientific, fraction, Roman numerals, BMI, date calculator, time zone converter.
// Expected values are literals or plain Date.UTC / BigInt arithmetic written here, never the page's own code.
import { readFileSync } from "node:fs";

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const get = (t, sel) => t.page.eval(`${q(sel)}.textContent.trim()`);
const getV = (t, sel) => t.page.eval(`${q(sel)}.value`);
const attr = (t, sel, a) => t.page.eval(`${q(sel)}.getAttribute(${JSON.stringify(a)})`);
const hidden = (t, sel) => t.page.eval(`${q(sel)}.hidden`);
const BAR = "\u0305";
const bar = (s) => Array.from(s, (c) => c + BAR).join("");

const DAY = 86400000;
const utc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const todayIn = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/* ------------------------------------------------------------ scientific helpers */
async function calc(t, expr) {
  await t.page.setValue("#sc-expr", expr);
  await t.page.click('[data-act="eval"]');
  const errHidden = await hidden(t, "#sc-error");
  return { result: await get(t, "#sc-result"), error: errHidden ? null : await get(t, "#sc-error") };
}
const setAngle = (t, v) => t.page.click(`input[name="sc-angle"][value="${v}"]`);

/* ------------------------------------------------------------ fraction helpers */
async function frac(t, a, op, b) {
  await t.page.setValue("#fc-a", a);
  await t.page.click(`input[name="fc-op"][value="${JSON.stringify(op).slice(1, -1)}"]`);
  await t.page.setValue("#fc-b", b);
  return {
    simple: await get(t, "#fc-simple"), mixed: await get(t, "#fc-mixed"), dec: await get(t, "#fc-dec"),
    steps: await get(t, "#fc-steps"), shown: !(await hidden(t, "#fc-res")), err: await get(t, "#status"),
  };
}
const gcd = (a, b) => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a; };

/* ------------------------------------------------------------ roman helpers */
async function setExt(t, on) {
  if ((await t.page.eval(`${q("#rn-ext")}.checked`)) !== on) await t.page.click("#rn-ext");
}
async function rn(t, n) {
  await t.page.setValue("#rn-num", String(n));
  return { rom: await getV(t, "#rn-rom"), msg: await get(t, "#rn-msg") };
}
async function fromRoman(t, s) {
  await t.page.setValue("#rn-rom", s);
  return { num: await getV(t, "#rn-num"), msg: await get(t, "#rn-msg"), bad: await attr(t, "#rn-rom", "aria-invalid") };
}

/* ------------------------------------------------------------ bmi helpers */
async function bmi(t, w, cm) {
  await t.page.click('input[name="bm-units"][value="metric"]');
  await t.page.setValue("#bm-w", String(w));
  await t.page.setValue("#bm-cm", String(cm));
  return { val: await get(t, "#bm-val"), cat: await get(t, "#bm-cat"), shown: !(await hidden(t, "#bm-res")), msg: await get(t, "#bm-msg") };
}

/* ------------------------------------------------------------ date calc helpers */
async function dcalc(t, start, { op = "add", y = "", m = "", w = "", d = "" } = {}) {
  await t.page.click('input[name="dc-kind"][value="cal"]');
  await t.page.click(`input[name="dc-op"][value="${op}"]`);
  await t.page.setValue("#dc-start", start);
  for (const [id, v] of [["y", y], ["m", m], ["w", w], ["d", d]]) await t.page.setValue(`#dc-${id}`, String(v));
  return dres(t);
}
async function dbiz(t, start, n, op = "add") {
  await t.page.click('input[name="dc-kind"][value="biz"]');
  await t.page.click(`input[name="dc-op"][value="${op}"]`);
  await t.page.setValue("#dc-start", start);
  await t.page.setValue("#dc-b", String(n));
  return dres(t);
}
async function dres(t) {
  const st = await t.status();
  if (await hidden(t, "#dc-res")) return { error: st.text };
  return { iso: await get(t, "#dc-iso"), wd: await get(t, "#dc-wd"), week: await get(t, "#dc-week"), doy: await get(t, "#dc-doy"), note: await get(t, "#dc-note"), main: await get(t, "#dc-main"), span: await get(t, "#dc-span") };
}

/* ------------------------------------------------------------ tz helpers */
async function tzSetup(t, tz = "America/New_York") {
  await t.page.timezone(tz);
  await t.go();
  await t.page.eval(`localStorage.removeItem("tt:tz.zones"); localStorage.removeItem("tt:tz.fmt"); true`);
  await t.go();
}
async function tzSet(t, date, time, from) {
  await t.page.setValue("#tzc-date", date);
  await t.page.setValue("#tzc-time", time);
  await t.page.setValue("#tzc-from", from);
  if ((await getV(t, "#tzc-from")) !== from) throw new Error("zone not offered by this browser: " + from);
}
const row = (zone, part) => `li[data-zone="${zone}"] .tzc__${part}`;
async function tzAdd(t, zone) {
  await t.page.setValue("#tzc-add", zone);
  if ((await getV(t, "#tzc-add")) !== zone) throw new Error("zone not offered by this browser: " + zone);
  await t.page.click("#tzc-addbtn");
}

export default [
  /* ============================================================ scientific calculator */
  {
    page: "scientific-calculator",
    name: "precedence and edge table (degrees)",
    async run(t) {
      const ok = [
        ["2+3*4", "14"], ["(2+3)*4", "20"], ["2^3^2", "512"], ["-2^2", "-4"], ["(-2)^2", "4"], ["2^-1", "0.5"],
        ["6/2(1+2)", "9"], ["6/(2(1+2))", "1"], ["2π", "6.28318530718"], ["2pi", "6.28318530718"], ["π", "3.14159265359"],
        ["5!", "120"], ["0!", "1"], ["170!", "7.25741561531e306"], ["-5!", "-120"], ["50%", "0.5"], ["200*10%", "20"], ["200+10%", "200.1"],
        ["sin(30)", "0.5"], ["cos(90)", "0"], ["tan(45)", "1"], ["cos(60)", "0.5"], ["sin(180)", "0"], ["asin(1)", "90"], ["acos(0.5)", "60"], ["atan(1)", "45"],
        ["0.1+0.2", "0.3"], ["0.1+0.2-0.3", "0"], ["1/3", "0.333333333333"], ["(1+2)(3+4)", "21"], ["2(3+4)", "14"], ["2sin(30)", "1"],
        ["1e-3", "0.001"], ["2.5e3", "2500"], [".5+.5", "1"], ["2−1", "1"], ["8÷2×3", "12"], ["8/2*3", "12"], ["--3", "3"], ["2--3", "5"], ["2^0.5", "1.41421356237"],
        ["sqrt(16)", "4"], ["√(16)", "4"], ["cbrt(-27)", "-3"], ["abs(-4.5)", "4.5"], ["floor(-1.5)", "-2"], ["ceil(1.2)", "2"], ["round(2.5)", "3"], ["round(-2.5)", "-3"],
        ["ln(e)", "1"], ["log(1000)", "3"], ["log2(8)", "3"], ["exp(0)", "1"], ["e^2", "7.38905609893"], ["1e20*5", "5e20"], ["1e-9/3", "3.33333333333e-10"],
        ["10^15", "1e15"], ["10^14", "100000000000000"], ["1e308*1", "1e308"],
      ];
      // Ans before any answer exists is an error (checked first, before the table sets one)
      const none = await calc(t, "Ans");
      t.assert(none.error && none.error.includes("no previous answer"), "Ans before any answer: " + JSON.stringify(none));
      for (const [expr, want] of ok) {
        const r = await calc(t, expr);
        t.eq([expr, r.error, r.result], [expr, null, want], "value of " + expr);
      }
      const bad = [
        ["1/0", "Division by zero"], ["0/0", "0 ÷ 0"], ["sqrt(-4)", "negative number"], ["171!", "170"], ["3.5!", "whole numbers"], ["(-1)!", "whole numbers"],
        ["1e308*10", "too large"], ["2^2000", "too large"], ["2++", "ends too soon"], ["*3", "can't go here"], [")(", "Unexpected"], ["()", "Empty brackets"],
        ["tan(90)", "undefined"], ["ln(0)", "greater than 0"], ["log(-5)", "greater than 0"], ["asin(2)", "−1 to 1"], ["acos(-1.5)", "−1 to 1"],
        ["foo", "isn't a function"], ["2 3", "Two numbers"], ["1,000", "Commas"], ["sin 30", "brackets"], ["2$3", "isn't something"], ["(-8)^(1/3)", "fractional power"],
      ];

      for (const [expr, frag] of bad) {
        const r = await calc(t, expr);
        t.assert(r.error && r.error.includes(frag), `${expr}: expected an error containing "${frag}", got ${JSON.stringify(r)}`);
        t.assert(!/Infinity|NaN/.test(r.error + r.result), `${expr}: no Infinity or NaN shown`);
        t.eq(await attr(t, "#sc-expr", "aria-invalid"), "true", "aria-invalid on " + expr);
      }
      // the source never evaluates text
      const src = readFileSync(new URL("../../../../site/tools/js/exprcore.js", import.meta.url), "utf8") + readFileSync(new URL("../../../../site/tools/js/scientific-calculator.js", import.meta.url), "utf8");
      t.assert(!/\beval\s*\(|new\s+Function|Function\s*\(|setTimeout\(\s*["'`]/.test(src), "no eval, Function or string timers");
    },
  },
  {
    page: "scientific-calculator",
    name: "radians, auto-closed brackets, Ans, history",
    async run(t) {
      await setAngle(t, "rad");
      for (const [expr, want] of [["sin(pi/2)", "1"], ["sin(pi)", "0"], ["cos(pi)", "-1"], ["cos(pi/2)", "0"], ["tan(pi/4)", "1"], ["sin(30)", "-0.988031624093"], ["atan(1)", "0.785398163397"], ["asin(1)", "1.57079632679"]]) {
        const r = await calc(t, expr);
        t.eq([expr, r.error, r.result], [expr, null, want], "radians " + expr);
      }
      const r = await calc(t, "tan(pi/2)");
      t.assert(r.error && r.error.includes("undefined"), "tan(pi/2) is undefined in radians: " + JSON.stringify(r));
      await setAngle(t, "deg");
      t.eq((await calc(t, "sin(30)")).result, "0.5", "back to degrees");

      const c = await calc(t, "(2+3");
      t.eq(c.result, "5", "auto-closed");
      t.eq(await hidden(t, "#sc-note"), false, "note shown");
      t.assert((await get(t, "#sc-note")).includes("Added 1 closing bracket"), "note text");
      t.eq(await getV(t, "#sc-expr"), "(2+3)", "input shows the closed expression");
      t.eq((await calc(t, "2(3+(4*5")).result, "46", "two brackets closed");
      t.assert((await get(t, "#sc-note")).includes("Added 2 closing brackets"), "plural note");
      t.eq((await calc(t, "sin(30")).result, "0.5", "function call closed");

      // Ans chaining and the continue-from-Ans rule
      await calc(t, "2+3");
      t.eq((await calc(t, "Ans*4")).result, "20", "Ans*4");
      t.eq((await calc(t, "Ans+Ans")).result, "40", "Ans+Ans");
      // history: newest first, click reuses
      const n = await t.page.eval(`document.querySelectorAll("#sc-hist li").length`);
      t.assert(n >= 5, "history grows: " + n);
      t.eq(await hidden(t, "#sc-hist-empty"), true, "empty hint hidden");
      t.eq(await get(t, "#sc-hist li:first-child .sc__hexpr"), "Ans+Ans", "newest first");
      t.eq(await get(t, "#sc-hist li:first-child .sc__hres"), "= 40", "result in history");
      await t.page.click("#sc-hist li:nth-child(2) button");
      t.eq(await getV(t, "#sc-expr"), "Ans*4", "click reuses the expression");
      await t.page.click("#sc-hist-clear");
      t.eq(await t.page.eval(`document.querySelectorAll("#sc-hist li").length`), 0, "history cleared");
    },
  },
  {
    page: "scientific-calculator",
    name: "keyboard typing, Enter, =, Escape, Ans continuation, keypad",
    async run(t) {
      await t.page.eval(`localStorage.removeItem("tt:sc.angle"); true`);
      await t.go();
      await t.page.type("#sc-expr", "12+30");
      t.eq(await get(t, "#sc-preview"), "= 42", "live preview");
      await t.page.press("Enter");
      t.eq(await get(t, "#sc-result"), "42", "Enter evaluates");
      // operator after a result continues from Ans
      await t.page.type("#sc-expr", "*2", { replace: false });
      t.eq(await getV(t, "#sc-expr"), "Ans*2", "operator after a result starts from Ans");
      await t.page.press("Enter");
      t.eq(await get(t, "#sc-result"), "84", "Ans continuation");
      // a digit after a result starts afresh
      await t.page.type("#sc-expr", "7", { replace: false });
      t.eq(await getV(t, "#sc-expr"), "7", "digit begins a new expression");
      // typing = evaluates
      await t.page.type("#sc-expr", "*6=", { replace: false });
      t.eq(await get(t, "#sc-result"), "42", "typing = evaluates 7*6");
      t.eq(await get(t, "#sc-echo"), "7*6 =", "echo line");
      // Escape clears
      await t.page.press("Escape");
      t.eq([await getV(t, "#sc-expr"), await get(t, "#sc-result")], ["", "0"], "Escape clears");
      // Backspace
      await t.page.type("#sc-expr", "123");
      await t.page.press("Backspace");
      const afterKey = await getV(t, "#sc-expr");
      if (afterKey === "123") await t.page.click('[data-act="back"]'); // raw CDP key events do not edit text; the keypad key does
      t.eq(await getV(t, "#sc-expr"), "12", "backspace removes one character");
      await t.page.click('[data-act="clear"]');
      // keypad: 7 × 6 =
      for (const k of ["7", "×", "6"]) await t.page.click(`.sc__pad [data-ins="${k}"]`);
      t.eq(await getV(t, "#sc-expr"), "7*6", "keypad inserts");
      await t.page.click('[data-act="eval"]');
      t.eq(await get(t, "#sc-result"), "42", "keypad =");
      // function keys insert name and bracket; backspace removes the whole name
      await t.page.click('[data-act="clear"]');
      await t.page.click('[data-ins="sin("]');
      t.eq(await getV(t, "#sc-expr"), "sin(", "function key");
      await t.page.click('[data-act="back"]');
      t.eq(await getV(t, "#sc-expr"), "", "backspace removes sin( whole");
      await t.page.click('[data-ins="sqrt("]');
      t.eq(await attr(t, '[data-ins="sqrt("]', "aria-label"), "square root", "accessible name for the root key");
      for (const k of ["1", "6", ")"]) await t.page.click(`[data-ins="${k}"]`);
      await t.page.click('[data-act="eval"]');
      t.eq(await get(t, "#sc-result"), "4", "√16");
      // every key has an accessible name
      const unnamed = await t.page.eval(`Array.from(document.querySelectorAll(".sc__k")).filter(b => !(b.getAttribute("aria-label") || b.textContent.trim())).length`);
      t.eq(unnamed, 0, "all keys named");
      // angle choice is remembered
      await setAngle(t, "rad");
      await t.go();
      t.eq(await t.page.eval(`${q('input[name="sc-angle"]:checked')}.value`), "rad", "angle unit remembered");
      await setAngle(t, "deg");
      await t.page.type("#sc-expr", "2(3+4)^2/7");
      await t.page.press("Enter");
      t.eq(await get(t, "#sc-result"), "14", "2(3+4)^2/7");
      await t.page.type("#sc-expr", "sin(30)+cos(60)", { replace: true });
      await t.page.press("Enter");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },

  /* ============================================================ fraction calculator */
  {
    page: "fraction-calculator",
    name: "exact arithmetic, steps, mixed numbers, repeating decimals",
    async run(t) {
      let r = await frac(t, "1/2", "+", "1/3");
      t.eq([r.simple, r.mixed, r.dec], ["5/6", "–", "0.8(3)"], "1/2 + 1/3");
      t.assert(r.steps.includes("Least common denominator of 2 and 3: 6"), "LCD step: " + r.steps);
      t.assert(r.steps.includes("3/6") && r.steps.includes("2/6"), "converted fractions");
      r = await frac(t, "3/4", "-", "5/6");
      t.eq([r.simple, r.dec], ["-1/12", "-0.08(3)"], "3/4 - 5/6");
      r = await frac(t, "2 1/2", "*", "1 1/3");
      t.eq([r.simple, r.mixed, r.dec], ["10/3", "3 1/3", "3.(3)"], "2 1/2 x 1 1/3");
      t.assert(r.steps.includes("improper fraction is 5/2"), "mixed number step");
      r = await frac(t, "1/2", "/", "1/4");
      t.eq(r.simple, "2", "1/2 / 1/4");
      t.assert(r.steps.includes("reciprocal, 4/1") && r.steps.includes("Cross-multiply"), "division steps: " + r.steps);
      r = await frac(t, "1/2", "/", "0");
      t.eq(r.shown, false, "no result when dividing by zero");
      t.assert(/dividing by 0/i.test(r.err), "division by zero message: " + r.err);
      t.eq(await attr(t, "#fc-b", "aria-invalid"), "true", "second field flagged");
      r = await frac(t, "1/2", "/", "0/5");
      t.eq(r.shown, false, "dividing by 0/5 is also division by zero");
      r = await frac(t, "0", "/", "3/4");
      t.eq(r.simple, "0", "0 divided by something");
      r = await frac(t, "3/0", "+", "1/2");
      t.eq(r.shown, false, "zero denominator");
      t.assert(r.err.includes("denominator can't be 0"), "zero denominator message: " + r.err);
      t.eq(await attr(t, "#fc-a", "aria-invalid"), "true", "first field flagged");
      r = await frac(t, "abc", "+", "1/2");
      t.assert(r.err.includes("isn't a number or fraction"), "malformed: " + r.err);
      r = await frac(t, "", "+", "1/2");
      t.eq([r.shown, r.err], [false, ""], "empty input is quiet");
      // negatives
      r = await frac(t, "-1 1/2", "+", "0");
      t.eq([r.simple, r.mixed, r.dec], ["-3/2", "-1 1/2", "-1.5"], "-1 1/2 means minus (1 + 1/2)");
      r = await frac(t, "-1/2", "*", "-1/2");
      t.eq(r.simple, "1/4", "negative times negative");
      r = await frac(t, "1/-2", "+", "0");
      t.eq(r.simple, "-1/2", "sign in the denominator moves to the numerator");
      r = await frac(t, "−1/3", "-", "−1/3");
      t.eq(r.simple, "0", "unicode minus, x - x = 0");
      r = await frac(t, "1/2", "-", "-1/2");
      t.eq(r.simple, "1", "minus a negative");
      // decimals are exact
      r = await frac(t, "0.1", "+", "0.2");
      t.eq(r.simple, "3/10", "0.1 + 0.2 is exactly 3/10");
      r = await frac(t, "0.(3)", "+", "0.(6)");
      t.eq(r.simple, "1", "0.(3) + 0.(6) = 1");
      r = await frac(t, "1.2e-3", "*", "1");
      t.eq([r.simple, r.dec], ["3/2500", "0.0012"], "exponent decimal");
      // huge values stay exact
      const n = 123456789012345678901n * 3n + 2n, d = 6n, g = gcd(n, d);
      r = await frac(t, "123456789012345678901/2", "+", "1/3");
      t.eq(r.simple, `${n / g}/${d / g}`, "huge sum exact");
      t.eq(r.simple, "370370367037037036705/6", "literal check of the same value");
      r = await frac(t, "99999999999999999999/100000000000000000000", "*", "100000000000000000000/99999999999999999999");
      t.eq(r.simple, "1", "huge reciprocal product");
      await frac(t, "2 1/2", "*", "1 1/3");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "fraction-calculator",
    name: "simplify and convert mode",
    async run(t) {
      await t.page.click('input[name="fc-mode"][value="conv"]');
      t.eq([await hidden(t, "#fc-calc"), await hidden(t, "#fc-conv")], [true, false], "mode switches the form");
      const conv = async (s) => {
        await t.page.setValue("#fc-c", s);
        return { simple: await get(t, "#fc-simple"), mixed: await get(t, "#fc-mixed"), dec: await get(t, "#fc-dec"), steps: await get(t, "#fc-steps"), err: await get(t, "#status") };
      };
      let r = await conv("0.75");
      t.eq([r.simple, r.dec], ["3/4", "0.75"], "0.75");
      t.assert(r.steps.includes("75/100") && r.steps.includes("divide both by 25"), "decimal steps: " + r.steps);
      r = await conv("6/8");
      t.eq(r.simple, "3/4", "6/8");
      t.assert(r.steps.includes("greatest common divisor of 6 and 8 is 2"), "gcd step: " + r.steps);
      r = await conv("3/4");
      t.assert(r.steps.includes("already in lowest terms"), "already simple");
      r = await conv("1/7");
      t.eq(r.dec, "0.(142857)", "1/7 repeats");
      t.assert((await get(t, "#fc-dec-note")).includes("6 digits long"), "block length note");
      r = await conv("22/7");
      t.eq([r.simple, r.mixed, r.dec], ["22/7", "3 1/7", "3.(142857)"], "22/7");
      r = await conv("1/6");
      t.eq(r.dec, "0.1(6)", "1/6 has a non-repeating digit first");
      r = await conv("0.(142857)");
      t.eq(r.simple, "1/7", "repeating decimal back to a fraction");
      r = await conv("0.1(6)");
      t.eq(r.simple, "1/6", "0.1(6) = 1/6");
      r = await conv("-0.125");
      t.eq([r.simple, r.dec], ["-1/8", "-0.125"], "negative decimal");
      r = await conv("1 1/2");
      t.eq([r.simple, r.mixed], ["3/2", "1 1/2"], "mixed number");
      r = await conv("12");
      t.eq([r.simple, r.mixed, r.dec], ["12", "–", "12"], "integer");
      r = await conv("1/0");
      t.assert(r.err.includes("denominator can't be 0"), "zero denominator in convert mode");
      r = await conv("1/9973");
      t.assert(r.dec.startsWith("0.0001002707309736") && r.dec.endsWith("…") && r.dec.length > 300, "long period is cut off and marked: " + r.dec.slice(0, 40));
      t.assert((await get(t, "#fc-dec-note")).includes("longer than 300"), "cut-off explained");
      await conv("22/7");
    },
  },

  /* ============================================================ Roman numerals */
  {
    page: "roman-numeral-converter",
    name: "number to Roman, both ways, every value 1-3999",
    async run(t) {
      await setExt(t, false);
      for (const [n, want] of [[3999, "MMMCMXCIX"], [1994, "MCMXCIV"], [2026, "MMXXVI"], [4, "IV"], [9, "IX"], [40, "XL"], [1, "I"], [14, "XIV"], [444, "CDXLIV"], [1666, "MDCLXVI"], [3888, "MMMDCCCLXXXVIII"]]) {
        const r = await rn(t, n);
        t.eq(r.rom, want, "roman of " + n);
        t.eq(await attr(t, "#rn-num", "aria-invalid"), "false", "valid number");
      }
      // every value, independent place-value algorithm, round trip through the parser
      const bad = await t.page.eval(`(async () => {
        const m = await import("/tools/js/roman-numeral-converter.js");
        const ones = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"], tens = ["", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC"], hund = ["", "C", "CC", "CCC", "CD", "D", "DC", "DCC", "DCCC", "CM"], th = ["", "M", "MM", "MMM"];
        const bad = [];
        for (let n = 1; n <= 3999; n++) {
          const want = th[Math.floor(n / 1000)] + hund[Math.floor(n / 100) % 10] + tens[Math.floor(n / 10) % 10] + ones[n % 10];
          const got = m.toRoman(n).text;
          const back = m.parseRoman(got).value;
          if (got !== want || back !== n) bad.push([n, got, want, back]);
        }
        return bad.slice(0, 5);
      })()`);
      t.eq(bad, [], "all 3999 values convert and parse back");
      // invalid numbers
      let r = await rn(t, 0);
      t.assert(r.msg.includes("no Roman numeral for 0") && r.msg.includes("nulla"), "zero explained: " + r.msg);
      t.eq(await attr(t, "#rn-num", "aria-invalid"), "true", "zero flagged");
      t.eq(await hidden(t, "#rn-res"), true, "no result for zero");
      r = await rn(t, "-5");
      t.assert(r.msg.includes("negative"), "negative rejected: " + r.msg);
      r = await rn(t, "3.5");
      t.assert(r.msg.includes("decimals"), "decimal rejected: " + r.msg);
      r = await rn(t, "12abc");
      t.assert(r.msg.includes("digits only"), "junk rejected: " + r.msg);
      r = await rn(t, "4000");
      t.eq(r.rom, "", "4000 not written without the extended range");
      t.assert(r.msg.includes("stop at 3999") && r.msg.includes("extended range"), "4000 explained: " + r.msg);
      // breakdown
      await rn(t, 1994);
      t.eq(await t.page.eval(`Array.from(document.querySelectorAll("#rn-parts .rn__sym")).map(e => e.textContent)`), ["M", "CM", "XC", "IV"], "parts");
      t.eq(await get(t, "#rn-sum"), "M + CM + XC + IV = 1000 + 900 + 90 + 4 = 1994", "breakdown sentence");
      t.eq(await get(t, "#rn-main"), "MCMXCIV = 1,994", "headline");
      await t.page.click('#rn-years button[data-n="2024"]');
      t.eq(await getV(t, "#rn-rom"), "MMXXIV", "year button");
    },
  },
  {
    page: "roman-numeral-converter",
    name: "Roman to number: lowercase, strict validation with reasons",
    async run(t) {
      await setExt(t, false);
      let r = await fromRoman(t, "mmxxvi");
      t.eq([r.num, r.bad], ["2026", "false"], "lowercase accepted");
      t.eq(await getV(t, "#rn-rom"), "MMXXVI", "normalised to capitals on change");
      r = await fromRoman(t, " m c m x c i v ");
      t.eq(r.num, "1994", "spaces ignored");
      for (const [s, n] of [["XLII", "42"], ["CDXLIV", "444"], ["MMMCMXCIX", "3999"], ["IX", "9"], ["I", "1"]]) t.eq((await fromRoman(t, s)).num, n, "valid " + s);
      const cases = [
        ["IIII", /more than three times/, /IV/],
        ["VV", /never repeated/, /\bX\b/],
        ["IC", /I can only be placed before V or X/, /XCIX/],
        ["XM", /X can only be placed before L or C/, /CMXC/],
        ["MCMC", /breaks the standard pattern/, /2000/],
        ["VX", /V is never placed before a larger symbol/, /./],
        ["IIX", /subtracted symbol appears once/, /VIII/],
        ["MMMM", /M can't appear more than three times/, /overline/],
        ["ABC", /"A", "B" are not Roman numeral letters/, /./],
        ["IXI", /breaks the standard pattern/, /./],
        ["LL", /never repeated/, /./],
        ["DM", /D is never placed/, /./],
      ];
      for (const [s, why, extra] of cases) {
        r = await fromRoman(t, s);
        t.eq([s, r.bad, r.num], [s, "true", ""], "rejected " + s);
        t.assert(why.test(r.msg), `${s}: reason "${r.msg}" should match ${why}`);
        t.assert(extra.test(r.msg), `${s}: hint "${r.msg}" should match ${extra}`);
        t.eq(await hidden(t, "#rn-res"), true, "no result for " + s);
      }
      r = await fromRoman(t, "12");
      t.assert(r.msg.includes("contains digits"), "digits in the Roman box: " + r.msg);
      r = await fromRoman(t, "");
      t.eq([r.num, r.msg, r.bad], ["", "", "false"], "empty is quiet");
      await fromRoman(t, "mcmxciv");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "roman-numeral-converter",
    name: "extended range with overline (vinculum)",
    async run(t) {
      await setExt(t, true);
      await t.go();
      t.eq(await t.page.eval(`${q("#rn-ext")}.checked`), true, "extended range remembered");
      let r = await rn(t, 4000);
      t.eq(r.rom, "I" + BAR + "V" + BAR, "4000 = IV with an overline");
      t.assert(r.msg.includes("later convention"), "convention note");
      t.eq((await rn(t, 5000)).rom, "V" + BAR, "5000");
      t.eq((await rn(t, 1000000)).rom, "M" + BAR, "1,000,000");
      t.eq((await rn(t, 4001)).rom, bar("IV") + "I", "4001");
      t.eq((await rn(t, 3999999)).rom, bar("MMMCMXCIX") + "CMXCIX", "3,999,999");
      t.eq((await rn(t, 123456)).rom, bar("CXXIII") + "CDLVI", "123,456");
      r = await rn(t, 4000000);
      t.assert(r.msg.includes("3,999,999"), "upper bound: " + r.msg);
      // parse: overline marks and the [bracket] shorthand
      t.eq((await fromRoman(t, "I" + BAR + "V" + BAR)).num, "4000", "overlined input");
      t.eq((await fromRoman(t, "[IV]")).num, "4000", "bracket shorthand");
      t.eq((await fromRoman(t, "[mmmcmxcix]cmxcix")).num, "3999999", "bracket, lowercase, rest");
      t.eq((await fromRoman(t, bar("CXXIII") + "CDLVI")).num, "123456", "overlined with rest");
      t.eq(await get(t, "#rn-sum"), `${bar("CXXIII")} + CD + L + V + I = 123000 + 400 + 50 + 5 + 1 = 123456`, "breakdown with overlined group");
      let b = await fromRoman(t, "[III]");
      t.assert(b.bad === "true" && b.msg.includes("starts at 4000"), "overline below 4000: " + b.msg);
      b = await fromRoman(t, "[IV]M");
      t.assert(b.bad === "true" && b.msg.includes("M is not used"), "M after an overline: " + b.msg);
      b = await fromRoman(t, "[IIII]");
      t.assert(b.bad === "true" && b.msg.startsWith("Inside the overline"), "invalid inside the overline: " + b.msg);
      await setExt(t, false);
      t.eq((await rn(t, 4000)).rom, "", "off again");
      await setExt(t, false);
    },
  },

  /* ============================================================ BMI */
  {
    page: "bmi-calculator",
    name: "metric and imperial results, categories on the rounded value, boundaries",
    async run(t) {
      await t.page.eval(`localStorage.removeItem("tt:bm.units"); true`);
      await t.go();
      t.eq(await get(t, "#bm-msg"), "Enter your weight and height.", "empty prompt");
      t.eq(await hidden(t, "#bm-res"), true, "no result yet");
      let r = await bmi(t, 70, 175);
      t.eq([r.val, r.cat], ["22.9", "Healthy weight"], "70 kg 175 cm");
      t.eq(await get(t, "#bm-range"), "56.7 to 76.2 kg", "healthy range at 175 cm (18.5 and 24.9 times 3.0625)");
      t.eq(await get(t, "#bm-hused"), "175 cm (5 ft 8.9 in)", "height used");
      t.eq(await attr(t, 'tr[data-cat="ok"]', "class"), "is-src", "row marked");
      t.assert((await get(t, 'tr[data-cat="ok"] td:last-child')).includes("you are here"), "text marker, not colour only");
      t.eq(await get(t, 'tr[data-cat="under"] td:last-child'), "", "other rows unmarked");
      const left = parseFloat(await t.page.eval(`${q("#bm-marker")}.style.left`));
      t.assert(Math.abs(left - ((22.9 - 15) / 25) * 100) < 0.01, "marker position " + left);
      // boundaries at 170 cm: height squared is 2.89
      const edge = [
        [53.3, "18.4", "Underweight"], [53.4, "18.5", "Healthy weight"], [53.465, "18.5", "Healthy weight"], [53.5, "18.5", "Healthy weight"],
        [72.1, "24.9", "Healthy weight"], [72.2, "25.0", "Overweight"], [72.25, "25.0", "Overweight"], [72.3, "25.0", "Overweight"],
        [86.5, "29.9", "Overweight"], [86.6, "30.0", "Obesity, class I"], [86.7, "30.0", "Obesity, class I"],
        [101.1, "35.0", "Obesity, class II"], [101.15, "35.0", "Obesity, class II"], [100.9, "34.9", "Obesity, class I"],
        [115.6, "40.0", "Obesity, class III"], [115.4, "39.9", "Obesity, class II"],
      ];
      for (const [kg, val, cat] of edge) {
        r = await bmi(t, kg, 170);
        t.eq([kg, r.val, r.cat], [kg, val, cat], `170 cm, ${kg} kg`);
      }
      // imperial: 5 ft 9 in, 160 lb
      await t.page.click('input[name="bm-units"][value="imperial"]');
      t.eq(await hidden(t, "#bm-h-imp"), false, "imperial height fields shown");
      t.eq(await hidden(t, "#bm-h-metric"), true, "metric height hidden");
      await t.page.setValue("#bm-w", "160");
      await t.page.setValue("#bm-ft", "5");
      await t.page.setValue("#bm-in", "9");
      t.eq([await get(t, "#bm-val"), await get(t, "#bm-cat")], ["23.6", "Healthy weight"], "5 ft 9 in, 160 lb");
      t.assert((await get(t, "#bm-range")).endsWith("lb"), "range in pounds");
      // feet only, inches empty
      await t.page.setValue("#bm-in", "");
      await t.page.setValue("#bm-ft", "6");
      await t.page.setValue("#bm-w", "200");
      t.eq(await get(t, "#bm-val"), "27.1", "6 ft, 200 lb: 90.718 kg / 3.3445 m2");
      t.eq(await get(t, "#bm-cat"), "Overweight", "overweight");
      await t.page.click('input[name="bm-units"][value="metric"]');
    },
  },
  {
    page: "bmi-calculator",
    name: "unit toggle converts the typed values; bad and absurd input",
    async run(t) {
      await t.page.eval(`localStorage.removeItem("tt:bm.units"); true`);
      await t.go();
      await bmi(t, 70, 175);
      await t.page.click('input[name="bm-units"][value="imperial"]');
      t.eq(await getV(t, "#bm-w"), "154.3", "70 kg in pounds");
      t.eq([await getV(t, "#bm-ft"), await getV(t, "#bm-in")], ["5", "8.9"], "175 cm in feet and inches");
      t.eq(await get(t, "#bm-val"), "22.9", "same BMI after converting");
      t.eq(await get(t, "#bm-w-l"), "Weight (lb)", "label changes");
      await t.page.click('input[name="bm-units"][value="metric"]');
      t.eq([await getV(t, "#bm-w"), await getV(t, "#bm-cm")], ["70", "175"], "and back");
      // remembered
      await t.page.click('input[name="bm-units"][value="imperial"]');
      await t.go();
      t.eq(await t.page.eval(`${q('input[name="bm-units"]:checked')}.value`), "imperial", "unit remembered");
      await t.page.click('input[name="bm-units"][value="metric"]');
      // absurd and invalid input
      let r = await bmi(t, 70, 20);
      t.eq(r.shown, false, "20 cm gives no result");
      t.assert(r.msg.includes("between 50 and 272 cm"), "height message: " + r.msg);
      t.eq(await attr(t, "#bm-cm", "aria-invalid"), "true", "height flagged");
      r = await bmi(t, 70, 300);
      t.assert(r.msg.includes("between 50 and 272 cm"), "too tall");
      r = await bmi(t, 1000, 175);
      t.assert(r.msg.includes("between 5 and 700 kg") && (await attr(t, "#bm-w", "aria-invalid")) === "true", "weight message: " + r.msg);
      r = await bmi(t, 2, 175);
      t.assert(r.msg.includes("between 5 and 700 kg"), "too light");
      r = await bmi(t, 0, 175);
      t.assert(r.msg.includes("more than zero"), "zero weight: " + r.msg);
      r = await bmi(t, -70, 175);
      t.assert(r.msg.includes("more than zero"), "negative weight: " + r.msg);
      r = await bmi(t, "abc", 175);
      t.assert(r.msg.includes("must be a number"), "text weight: " + r.msg);
      await t.page.setValue("#bm-w", "");
      r = { shown: !(await hidden(t, "#bm-res")), msg: await get(t, "#bm-msg") };
      t.eq([r.shown, r.msg], [false, "Enter your weight and height."], "empty weight is a prompt, not an error");
      await t.page.click('input[name="bm-units"][value="imperial"]');
      await t.page.setValue("#bm-w", "150");
      await t.page.setValue("#bm-ft", "5");
      await t.page.setValue("#bm-in", "12");
      t.assert((await get(t, "#bm-msg")).includes("0 to 11.9"), "inches over 11.9: " + (await get(t, "#bm-msg")));
      await t.page.setValue("#bm-ft", "1.5");
      await t.page.setValue("#bm-in", "3");
      t.assert((await get(t, "#bm-msg")).includes("whole number"), "fractional feet");
      await t.page.setValue("#bm-ft", "0");
      await t.page.setValue("#bm-in", "10");
      t.assert((await get(t, "#bm-msg")).includes("between about 1 ft 8 in and 8 ft 11 in"), "tiny imperial height");
      t.assert((await t.page.eval(`document.body.textContent`)).includes("18 and over"), "adult-only note present");
      await t.page.click('input[name="bm-units"][value="metric"]');
      await bmi(t, 70, 175);
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },

  /* ============================================================ date calculator */
  {
    page: "date-calculator",
    name: "month-end clamping, years, weeks, order of operations, subtract",
    async run(t) {
      await t.page.timezone("America/New_York");
      await t.go();
      let r = await dcalc(t, "2024-01-31", { m: 1 });
      t.eq(r.iso, "2024-02-29", "31 Jan 2024 + 1 month");
      t.assert(r.note.includes("31st doesn't exist in February 2024"), "clamp note: " + r.note);
      t.eq(r.main, "Thursday, 29 February 2024", "long date");
      t.eq((await dcalc(t, "2023-01-31", { m: 1 })).iso, "2023-02-28", "31 Jan 2023 + 1 month");
      t.eq((await dcalc(t, "2024-02-29", { y: 1 })).iso, "2025-02-28", "29 Feb 2024 + 1 year");
      t.eq((await dcalc(t, "2024-01-15", { m: 1 })).note.includes("doesn't exist"), false, "no note when the day exists");
      t.eq((await dcalc(t, "2024-01-31", { m: 2 })).iso, "2024-03-31", "31 Jan + 2 months");
      t.eq((await dcalc(t, "2024-01-31", { m: 13 })).iso, "2025-02-28", "13 months");
      t.eq((await dcalc(t, "2024-01-31", { m: 1, w: 1 })).iso, "2024-03-07", "month first (to 29 Feb), then a week");
      t.eq((await dcalc(t, "2024-03-31", { op: "sub", m: 1 })).iso, "2024-02-29", "31 Mar - 1 month");
      t.eq((await dcalc(t, "2024-03-05", { op: "sub", d: 10 })).iso, "2024-02-24", "- 10 days across leap day");
      t.eq((await dcalc(t, "2024-03-01", { w: 2 })).iso, "2024-03-15", "+ 2 weeks");
      t.eq((await dcalc(t, "2020-02-29", { y: 4 })).iso, "2024-02-29", "leap day + 4 years");
      t.eq((await dcalc(t, "2021-05-10", { y: 1, m: 2, w: 3, d: 4 })).iso, "2022-08-04", "1y 2m 3w 4d: 2022-07-10 + 25 days");
      t.eq((await dcalc(t, "2024-03-01", { d: 0 })).iso, "2024-03-01", "adding nothing");
      t.eq((await dcalc(t, "2024-03-01", { d: 365 })).span, "+365", "days from start");
      r = await dcalc(t, "2024-03-01", { op: "sub", d: 366 });
      t.eq([r.iso, r.span], ["2023-03-01", "-366"], "366 days back over a leap day");
      r = await dcalc(t, "2024-03-01", { d: -3 });
      t.assert(r.error && r.error.includes("whole numbers"), "negative amount rejected: " + JSON.stringify(r));
      t.eq(await attr(t, "#dc-d", "aria-invalid"), "true", "field flagged");
      r = await dcalc(t, "2024-03-01", { d: "2.5" });
      t.assert(r.error, "fractional amount rejected");
      await dcalc(t, "2024-01-31", { m: 1 });
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await t.page.timezone("UTC");
    },
  },
  {
    page: "date-calculator",
    name: "business days, weekends, weekday/ISO week/day of year, bounds",
    async run(t) {
      await t.page.timezone("America/New_York");
      await t.go();
      t.eq(new Date(utc("2026-10-09")).getUTCDay(), 5, "2026-10-09 is a Friday");
      let r = await dbiz(t, "2026-10-09", 10);
      t.eq([r.iso, r.wd], ["2026-10-23", "Friday"], "Fri + 10 business days");
      r = await dbiz(t, "2026-10-09", 10, "sub");
      t.eq([r.iso, r.wd], ["2026-09-25", "Friday"], "Fri - 10 business days");
      r = await dbiz(t, "2026-10-09", 1);
      t.eq(r.iso, "2026-10-12", "Fri + 1 = Monday");
      r = await dbiz(t, "2026-10-09", 3);
      t.eq(r.iso, "2026-10-14", "Fri + 3 = Wednesday");
      // starting on a Saturday: the first business day after is Monday, before is Friday
      t.eq(new Date(utc("2026-10-10")).getUTCDay(), 6, "2026-10-10 is a Saturday");
      r = await dbiz(t, "2026-10-10", 1);
      t.eq(r.iso, "2026-10-12", "Sat + 1 = Monday");
      t.assert(r.note.includes("Saturday") && r.note.includes("Monday, 12 October 2026"), "weekend start note: " + r.note);
      t.eq((await dbiz(t, "2026-10-10", 5)).iso, "2026-10-16", "Sat + 5 = Friday");
      t.eq((await dbiz(t, "2026-10-10", 1, "sub")).iso, "2026-10-09", "Sat - 1 = Friday");
      t.eq((await dbiz(t, "2026-10-11", 1, "sub")).iso, "2026-10-09", "Sun - 1 = Friday");
      t.eq((await dbiz(t, "2026-10-10", 0)).iso, "2026-10-10", "Sat + 0 stays on the Saturday");
      t.assert((await dbiz(t, "2026-10-09", 10)).note.includes("public holidays are not"), "holiday caveat on the page");
      // a long run agrees with a plain loop
      let cur = utc("2026-01-01"), left = 1000;
      while (left) { cur += DAY; const w = new Date(cur).getUTCDay(); if (w && w !== 6) left--; }
      t.eq((await dbiz(t, "2026-01-01", 1000)).iso, iso(cur), "1000 business days");
      r = await dbiz(t, "2026-10-09", "-3");
      t.assert(r.error, "bad business day count rejected");

      // weekday, ISO week, day of year (independent known values)
      r = await dcalc(t, "2026-10-09");
      t.eq([r.wd, r.week, r.doy], ["Friday", "41", "282 of 365"], "2026-10-09: Friday, ISO week 41, day 282");
      r = await dcalc(t, "2026-12-31");
      t.eq([r.wd, r.week.startsWith("53"), r.doy], ["Thursday", true, "365 of 365"], "2026-12-31 is in ISO week 53");
      r = await dcalc(t, "2027-01-01");
      t.eq(r.wd, "Friday", "2027-01-01 is a Friday");
      t.assert(r.week.startsWith("53") && r.week.includes("ISO year 2026"), "2027-01-01 belongs to week 53 of 2026: " + r.week);
      r = await dcalc(t, "2024-12-31");
      t.assert(r.week.startsWith("1") && r.week.includes("ISO year 2025"), "2024-12-31 is in week 1 of 2025: " + r.week);
      t.eq(r.doy, "366 of 366", "day of year in a leap year");
      r = await dcalc(t, "2021-01-03");
      t.assert(r.week.startsWith("53") && r.week.includes("ISO year 2020"), "2021-01-03 is week 53 of 2020: " + r.week);
      r = await dcalc(t, "2020-12-31");
      t.assert(r.week.startsWith("53"), "2020 has 53 weeks");
      t.eq((await dcalc(t, "2025-12-29")).week.startsWith("1"), true, "2025-12-29 starts week 1 of 2026");
      t.eq((await dcalc(t, "2024-02-29")).doy, "60 of 366", "29 Feb is day 60");

      // bounds
      r = await dcalc(t, "0001-01-01", { op: "sub", d: 1 });
      t.assert(r.error && r.error.includes("1 to 9999"), "before year 1: " + JSON.stringify(r));
      t.eq((await dcalc(t, "0001-01-01", { d: 1 })).iso, "0001-01-02", "year 1 works");
      t.eq((await dcalc(t, "0001-01-01", { d: 0 })).wd, "Monday", "1 Jan 0001 was a Monday (proleptic Gregorian)");
      r = await dcalc(t, "9999-12-31", { d: 1 });
      t.assert(r.error && r.error.includes("1 to 9999"), "after 9999: " + JSON.stringify(r));
      t.eq((await dcalc(t, "9999-12-31", { d: 0 })).iso, "9999-12-31", "year 9999 works");
      t.eq((await dcalc(t, "9999-12-31", { op: "sub", y: 9998 })).iso, "0001-12-31", "back 9998 years");
      r = await dcalc(t, "2024-01-01", { y: 9999 });
      t.assert(r.error, "years beyond 9999 rejected");
      r = await dbiz(t, "9999-12-30", 5);
      t.assert(r.error && r.error.includes("1 to 9999"), "business days past 9999");
      await dcalc(t, "2026-12-31", { d: 1 });
      await t.page.timezone("UTC");
    },
  },
  {
    page: "date-calculator",
    name: "daylight saving never shifts a day; Today button (New York)",
    async run(t) {
      const TZ = "America/New_York";
      await t.page.timezone(TZ);
      await t.go();
      t.eq(await getV(t, "#dc-start"), todayIn(TZ), "start date defaults to today in the device zone");
      await t.page.setValue("#dc-start", "2000-01-01");
      await t.page.click("#dc-today");
      t.eq(await getV(t, "#dc-start"), todayIn(TZ), "Today button");
      // US clock changes: 2026-03-08 (spring forward) and 2026-11-01 (fall back)
      for (const [start, op, n, want] of [
        ["2026-03-07", "add", 1, "2026-03-08"], ["2026-03-07", "add", 2, "2026-03-09"], ["2026-03-08", "add", 1, "2026-03-09"], ["2026-03-09", "sub", 1, "2026-03-08"], ["2026-03-09", "sub", 2, "2026-03-07"],
        ["2026-10-31", "add", 1, "2026-11-01"], ["2026-10-31", "add", 3, "2026-11-03"], ["2026-11-02", "sub", 1, "2026-11-01"], ["2026-11-02", "sub", 2, "2026-10-31"],
        ["2026-03-01", "add", 30, "2026-03-31"], ["2026-10-01", "add", 60, "2026-11-30"],
      ]) {
        const r = await dcalc(t, start, { op, d: n });
        t.eq([start, op, n, r.iso], [start, op, n, want], "across a DST change");
        t.eq(r.iso, iso(utc(start) + (op === "add" ? n : -n) * DAY), "agrees with plain UTC arithmetic");
      }
      t.eq((await dcalc(t, "2026-03-01", { w: 2 })).iso, "2026-03-15", "weeks across spring forward");
      t.eq((await dcalc(t, "2026-03-07", { m: 1 })).iso, "2026-04-07", "month across spring forward");
      t.eq((await dbiz(t, "2026-03-06", 1)).iso, "2026-03-09", "Fri + 1 business day across spring forward");
      t.eq((await dbiz(t, "2026-10-30", 1)).iso, "2026-11-02", "Fri + 1 business day across fall back");
      await t.page.timezone("Pacific/Kiritimati");
      await t.go();
      t.eq(await getV(t, "#dc-start"), todayIn("Pacific/Kiritimati"), "Today in a UTC+14 zone");
      await t.page.timezone("UTC");
    },
  },

  /* ============================================================ time zone converter */
  {
    page: "time-zone-converter",
    name: "conversions, offsets, half-hour and 45-minute zones, Lord Howe DST, next-day marker",
    async run(t) {
      await tzSetup(t);
      t.eq(await getV(t, "#tzc-from"), "local", "source defaults to the device zone");
      await tzSet(t, "2026-07-01", "09:00", "Europe/London");
      t.eq(await get(t, row("Europe/London", "time")), "09:00", "source row");
      t.eq(await get(t, row("Europe/London", "off")).then((s) => s.replace(/\s.*/, "")), "UTC+01:00", "London in July is UTC+01:00");
      t.eq(await get(t, row("UTC", "time")), "08:00", "09:00 BST = 08:00 UTC");
      t.eq(await get(t, row("Asia/Tokyo", "time")), "17:00", "Tokyo UTC+9");
      t.eq(await get(t, row("America/New_York", "time")), "04:00", "New York UTC-4 in July");
      t.eq((await get(t, row("America/New_York", "off"))).startsWith("UTC-04:00"), true, "New York offset");
      t.eq(await attr(t, 'li[data-zone="Europe/London"]', "class"), "tzc__row is-source", "source row marked");
      t.assert((await get(t, row("Asia/Tokyo", "date"))).startsWith("Wed 1 Jul 2026"), "date text: " + (await get(t, row("Asia/Tokyo", "date"))));
      t.assert((await get(t, row("Asia/Tokyo", "day"))) === "Same day", "same day marker");
      t.eq(await hidden(t, "#tzc-note"), true, "no DST note for an ordinary time");

      for (const z of ["Asia/Kolkata", "Asia/Kathmandu", "Australia/Lord_Howe", "Pacific/Kiritimati"]) await tzAdd(t, z);
      t.eq([await get(t, row("Asia/Kolkata", "time")), (await get(t, row("Asia/Kolkata", "off"))).slice(0, 9)], ["13:30", "UTC+05:30"], "Kolkata +05:30");
      t.eq([await get(t, row("Asia/Kathmandu", "time")), (await get(t, row("Asia/Kathmandu", "off"))).slice(0, 9)], ["13:45", "UTC+05:45"], "Kathmandu +05:45");
      t.eq([await get(t, row("Australia/Lord_Howe", "time")), (await get(t, row("Australia/Lord_Howe", "off"))).slice(0, 9)], ["18:30", "UTC+10:30"], "Lord Howe in July is +10:30");
      t.eq(await get(t, row("Pacific/Kiritimati", "time")), "22:00", "Kiritimati +14");
      // January: Lord Howe observes +11:00 (a 30-minute daylight saving shift); London is on GMT
      await tzSet(t, "2026-01-15", "09:00", "Europe/London");
      t.eq(await get(t, row("Europe/London", "time")), "09:00", "London in January");
      t.eq([await get(t, row("Australia/Lord_Howe", "time")), (await get(t, row("Australia/Lord_Howe", "off"))).slice(0, 9)], ["20:00", "UTC+11:00"], "Lord Howe in January is +11:00");
      t.eq((await get(t, row("Europe/London", "off"))).slice(0, 9), "UTC+00:00", "London winter offset");
      t.eq(await get(t, row("UTC", "time")), "09:00", "UTC equals London in winter");
      // Kiritimati: mid-day in London is already the next day
      await tzSet(t, "2026-07-01", "12:00", "Europe/London");
      t.eq([await get(t, row("Pacific/Kiritimati", "time")), await get(t, row("Pacific/Kiritimati", "day")), await attr(t, 'li[data-zone="Pacific/Kiritimati"]', "data-day")], ["01:00", "Next day", "1"], "Kiritimati is a day ahead");
      t.assert((await get(t, row("Pacific/Kiritimati", "date"))).startsWith("Thu 2 Jul 2026"), "next-day date");
      await tzSet(t, "2026-07-01", "02:00", "Asia/Tokyo");
      t.eq([await get(t, row("America/New_York", "time")), await get(t, row("America/New_York", "day"))], ["13:00", "Previous day"], "New York is the previous day");
      // 12-hour clock
      await t.page.click('input[name="tzc-fmt"][value="12"]');
      t.eq(await get(t, row("America/New_York", "time")), "1:00 PM", "12-hour format");
      await t.page.click('input[name="tzc-fmt"][value="24"]');
      // duplicates, remove
      await t.page.setValue("#tzc-add", "Asia/Tokyo");
      await t.page.click("#tzc-addbtn");
      t.assert((await get(t, "#tzc-msg")).includes("already shown"), "duplicate message");
      t.eq(await t.page.eval(`document.querySelectorAll('li[data-zone="Asia/Tokyo"]').length`), 1, "still one Tokyo row");
      await t.page.click('.tzc__rm[data-zone="Asia/Kathmandu"]');
      t.eq(await t.page.eval(`document.querySelectorAll('li[data-zone="Asia/Kathmandu"]').length`), 0, "removed");
      await tzSet(t, "2026-07-01", "09:00", "Europe/London");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await t.page.timezone("UTC");
    },
  },
  {
    page: "time-zone-converter",
    name: "spring-forward gap and fall-back overlap (device zone America/New_York)",
    async run(t) {
      await tzSetup(t);
      // 2026-03-08 02:30 does not exist in New York: clocks go from 02:00 to 03:00
      await tzSet(t, "2026-03-08", "02:30", "America/New_York");
      t.eq(await hidden(t, "#tzc-note"), false, "gap note shown");
      const gap = await get(t, "#tzc-note");
      t.assert(gap.includes("doesn't exist in New York") && gap.includes("skip forward by 1 hour") && gap.includes("03:30"), "gap explained: " + gap);
      t.eq(await get(t, row("America/New_York", "time")), "03:30", "resolved to 03:30");
      t.eq(await get(t, row("UTC", "time")), "07:30", "03:30 EDT is 07:30 UTC");
      t.eq(await hidden(t, "#tzc-amb"), true, "no overlap choice in a gap");
      // the same wall time the day after exists
      await tzSet(t, "2026-03-09", "02:30", "America/New_York");
      t.eq(await hidden(t, "#tzc-note"), true, "no note on a normal day");
      t.eq(await get(t, row("UTC", "time")), "06:30", "02:30 EDT on the 9th is 06:30 UTC");

      // 2026-11-01 01:30 happens twice
      await tzSet(t, "2026-11-01", "01:30", "America/New_York");
      t.eq(await hidden(t, "#tzc-amb"), false, "overlap choice shown");
      const labels = await t.page.eval(`Array.from(document.querySelectorAll("#tzc-amb-opts label")).map(l => l.textContent.trim())`);
      t.eq(labels.length, 2, "two possible instants");
      t.assert(labels[0].startsWith("Earlier") && labels[0].includes("-04:00"), "earlier is UTC-04:00: " + labels[0]);
      t.assert(labels[1].startsWith("Later") && labels[1].includes("-05:00"), "later is UTC-05:00: " + labels[1]);
      t.assert((await get(t, "#tzc-note")).includes("happens twice in New York"), "overlap explained");
      t.eq(await get(t, row("UTC", "time")), "05:30", "earlier instant: 01:30 EDT = 05:30 UTC");
      t.eq((await get(t, row("America/New_York", "off"))).slice(0, 9), "UTC-04:00", "source row offset, earlier");
      await t.page.click('input[name="tzc-amb"][value="1"]');
      t.eq(await get(t, row("UTC", "time")), "06:30", "later instant: 01:30 EST = 06:30 UTC");
      t.eq((await get(t, row("America/New_York", "off"))).slice(0, 9), "UTC-05:00", "source row offset, later");
      t.eq(await get(t, row("Asia/Tokyo", "time")), "15:30", "Tokyo UTC+9 for the later instant");
      t.eq(await t.page.eval(`${q('input[name="tzc-amb"][value="1"]')}.checked`), true, "the choice stays selected");
      // not ambiguous an hour later
      await tzSet(t, "2026-11-01", "02:30", "America/New_York");
      t.eq(await hidden(t, "#tzc-amb"), true, "02:30 is unambiguous");
      t.eq(await get(t, row("UTC", "time")), "07:30", "02:30 EST = 07:30 UTC");
      // the same dates read from a different source zone are plain
      await tzSet(t, "2026-11-01", "01:30", "Europe/London");
      t.eq(await hidden(t, "#tzc-amb"), true, "London has no overlap on that date");
      // half-hour gap at Lord Howe: 2026-10-04 02:00 jumps to 02:30
      await tzSet(t, "2026-10-04", "02:15", "Australia/Lord_Howe");
      t.assert((await get(t, "#tzc-note")).includes("skip forward by 30 minutes"), "30-minute gap: " + (await get(t, "#tzc-note")));
      t.eq(await get(t, row("Australia/Lord_Howe", "time")), "02:45", "02:15 becomes 02:45");
      await tzSet(t, "2026-11-01", "01:30", "America/New_York");
      await t.shot("overlap", 375);
      await t.page.timezone("UTC");
    },
  },
  {
    page: "time-zone-converter",
    name: "saved zone list, Now button, meeting planner",
    async run(t) {
      await tzSetup(t, "Asia/Tokyo");
      t.eq(await t.page.eval(`Array.from(document.querySelectorAll(".tzc__row")).map(r => r.dataset.zone)`), ["Asia/Tokyo", "UTC", "America/New_York", "Europe/London"], "default list, device zone first as the source");
      // Now button: the entered time equals the clock in the source zone
      await t.page.setValue("#tzc-date", "2000-01-01");
      await t.page.click("#tzc-now");
      t.eq(await getV(t, "#tzc-date"), todayIn("Asia/Tokyo"), "Now fills today's date in the source zone");
      t.assert(/^\d\d:\d\d$/.test(await getV(t, "#tzc-time")), "Now fills the time");
      // zones persist across a reload; removals persist too
      await tzAdd(t, "Asia/Kolkata");
      await t.go();
      t.eq(await t.page.eval(`document.querySelectorAll('li[data-zone="Asia/Kolkata"]').length`), 1, "added zone survives a reload");
      await t.page.click('.tzc__rm[data-zone="America/New_York"]');
      await t.go();
      t.eq(await t.page.eval(`document.querySelectorAll('li[data-zone="America/New_York"]').length`), 0, "removed zone stays removed");
      t.eq(await t.page.eval(`document.querySelectorAll('li[data-zone="Asia/Kolkata"]').length`), 1, "Kolkata still there");
      await t.page.eval(`localStorage.removeItem("tt:tz.zones"); true`);

      // planner: London 2026-07-01 09:00 with UTC and New York (July offsets: London +1, UTC 0, New York -4)
      await tzSetup(t, "America/New_York");
      await t.page.click('.tzc__rm[data-zone="Asia/Tokyo"]');
      await tzSet(t, "2026-07-01", "09:00", "Europe/London");
      t.eq(await hidden(t, "#tzc-plan-wrap"), false, "planner shown");
      t.eq(await t.page.eval(`document.querySelectorAll("#tzc-plan tr").length`), 4, "London, UTC, New York, and the Everyone row");
      t.eq(await t.page.eval(`Array.from(document.querySelectorAll("#tzc-plan tr")).map(r => r.querySelectorAll("td").length)`), [24, 24, 24, 24], "24 hourly cells per row");
      const cells = (rowIdx) => t.page.eval(`Array.from(document.querySelectorAll("#tzc-plan tr")[${rowIdx}].querySelectorAll("td")).map(c => c.className)`);
      const london = await cells(0);
      for (let k = 0; k < 24; k++) t.eq(london[k].includes("is-work"), k >= 9 && k < 17, `London hour ${k} working hours`);
      t.eq(london.map((c, k) => c.includes("is-sel") ? k : -1).filter((k) => k >= 0), [9], "selected column is 09:00");
      // UTC row aligned by instant: London hour k is UTC hour k-1; New York hour k is k-5
      const utcRow = await cells(1), ny = await cells(2), all = await cells(3);
      const wantAll = [];
      for (let k = 0; k < 24; k++) {
        const u = (k - 1 + 24) % 24, n = (k - 5 + 24) % 24;
        const w = (h) => h >= 9 && h < 17;
        t.eq(utcRow[k].includes("is-work"), w(u), `UTC row, column ${k}`);
        t.eq(ny[k].includes("is-work"), w(n), `New York row, column ${k}`);
        if (w(k) && w(u) && w(n)) wantAll.push(k);
      }
      t.eq(all.map((c, k) => c.includes("is-all") ? k : -1).filter((k) => k >= 0), wantAll, "Everyone row marks shared working hours");
      t.eq(wantAll, [14, 15, 16], "independent check: London 14:00 to 17:00");
      t.assert((await get(t, "#tzc-plan-sum")).includes("from 14:00 to 17:00 London time"), "summary: " + (await get(t, "#tzc-plan-sum")));
      t.assert((await get(t, ".tzc__legend")).includes("hatched"), "legend states the pattern in words");
      const wk = await get(t, "#tzc-plan tr:first-child td:nth-child(11)");
      t.assert(wk.includes("working hours") && wk.includes("selected time"), "cell text carries the meaning: " + wk);
      // half-hour zone cells show the minutes
      await tzAdd(t, "Asia/Kolkata");
      const half = await get(t, "#tzc-plan tr:nth-child(4) td:nth-child(11)");
      t.assert(half.startsWith("13") && half.includes(":30"), "Kolkata hour cell shows 13:30: " + half);
      // the strip scrolls inside its own box, never the page
      await t.page.viewport(375);
      const m = await t.page.eval(`(() => { const s = document.querySelector(".tzc__strip"); return { inner: s.scrollWidth > s.clientWidth, page: document.documentElement.scrollWidth <= document.documentElement.clientWidth }; })()`);
      t.eq(m, { inner: true, page: true }, "planner scrolls inside its box at 375 px");
      // no places to compare
      await t.page.eval(`localStorage.setItem("tt:tz.zones", "[]"); true`);
      await t.go();
      await tzSet(t, "2026-07-01", "09:00", "Europe/London");
      t.assert((await get(t, "#tzc-plan-sum")).includes("Add places"), "single-place hint");
      await t.page.eval(`localStorage.removeItem("tt:tz.zones"); true`);
      await t.go();
      await tzSet(t, "2026-07-01", "09:00", "Europe/London");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await t.page.timezone("UTC");
    },
  },
];
