// Developer tools set 2: Unix timestamp converter, cron explainer, regex tester, colour converter.
const txt = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent.trim()`;
const all = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim())`;

/* ------------------------------------------------------------------ independent cron reference (minute by minute, UTC) */

const NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function refField(s, lo, hi) {
  const out = new Set();
  for (const part of s.toLowerCase().replace(/[a-z]{3}/g, (w) => NAMES[w]).split(",")) {
    const [range, step = "1"] = part.split("/");
    let a = lo, b = hi;
    if (range !== "*") { [a, b] = range.split("-").map(Number); if (b === undefined) b = a; }
    for (let v = a; v <= b; v += Number(step)) out.add(v === 7 && hi === 7 ? 0 : v);
  }
  return out;
}
function refCron(expr, startMs, n) {
  const [mi, ho, dom, mo, dow] = expr.split(/\s+/);
  const M = refField(mi, 0, 59), H = refField(ho, 0, 23), D = refField(dom, 1, 31), MO = refField(mo, 1, 12), W = refField(dow, 0, 7);
  const domStar = dom.startsWith("*"), dowStar = dow.startsWith("*");
  const out = [];
  for (let t = Math.ceil(startMs / 60000) * 60000; out.length < n && t < startMs + 4 * 366 * 864e5; t += 60000) {
    const d = new Date(t);
    if (!M.has(d.getUTCMinutes()) || !H.has(d.getUTCHours()) || !MO.has(d.getUTCMonth() + 1)) continue;
    const a = D.has(d.getUTCDate()), b = W.has(d.getUTCDay());
    if (domStar || dowStar ? a && b : a || b) out.push(d.toISOString());
  }
  return out;
}
const runIsos = `[...document.querySelectorAll("#c-runs time")].map((e) => e.getAttribute("datetime"))`;

/* ------------------------------------------------------------------ colour reference */

function refHslHsvCmyk(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  let h = 0;
  if (c) {
    if (max === r) h = 60 * (((g - b) / c + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / c + 2);
    else h = 60 * ((r - g) / c + 4);
  }
  const l = (max + min) / 2;
  const sl = c ? c / (1 - Math.abs(2 * l - 1)) : 0;
  const sv = max ? c / max : 0;
  const k = 1 - max;
  const one = (x) => String(Math.round(x * 10) / 10);
  return {
    hsl: `hsl(${one(h)}, ${one(sl * 100)}%, ${one(l * 100)}%)`,
    hsv: `hsv(${one(h)}, ${one(sv * 100)}%, ${one(max * 100)}%)`,
    cmyk: `cmyk(${one((1 - r - k) / (1 - k) * 100)}%, ${one((1 - g - k) / (1 - k) * 100)}%, ${one((1 - b - k) / (1 - k) * 100)}%, ${one(k * 100)}%)`,
  };
}
function refRatio(fg, bg) {
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export default [
  /* ------------------------------------------------------------ timestamps */
  {
    page: "unix-timestamp-converter",
    name: "seconds, negatives, 2038 limit, unit detection",
    async run(t) {
      await t.page.setValue("#tz", "UTC");
      await t.page.setValue("#ts-in", "0");
      t.eq(await t.page.eval(txt("#o-utc")), "1970-01-01 00:00:00 (Thu) UTC+00:00", "epoch UTC");
      t.eq(await t.page.eval(txt("#o-iso")), "1970-01-01T00:00:00Z", "epoch ISO");
      t.eq(await t.page.eval(txt("#o-rfc")), "Thu, 01 Jan 1970 00:00:00 +0000", "epoch RFC 2822");
      t.eq(await t.page.eval(txt("#ts-detected")), "Read as seconds (detected from its length).", "unit");
      await t.page.setValue("#ts-in", "-1");
      t.eq(await t.page.eval(txt("#o-iso")), "1969-12-31T23:59:59Z", "-1");
      t.assert((await t.page.eval(txt("#ts-note"))).includes("before 1 January 1970"), "negative note");
      await t.page.setValue("#ts-in", "2147483647");
      t.eq(await t.page.eval(txt("#o-iso")), "2038-01-19T03:14:07Z", "int32 max");
      t.assert((await t.page.eval(txt("#ts-note"))).includes("largest value a signed 32-bit"), "2038 note");
      await t.page.setValue("#ts-in", "2147483648");
      t.assert((await t.page.eval(txt("#ts-note"))).includes("year 2038 problem"), "past 2038 note");
      await t.page.setValue("#ts-in", "1000000000000");
      t.eq(await t.page.eval(txt("#ts-detected")), "Read as milliseconds (detected from its length).", "1e12 is ms");
      t.eq(await t.page.eval(txt("#o-iso")), "2001-09-09T01:46:40.000Z", "1e12 ms ISO");
      t.eq(await t.page.eval(txt("#o-s")), "1000000000", "seconds row");
      await t.page.setValue("#ts-in", "1700000000123456789");
      t.eq(await t.page.eval(txt("#ts-detected")), "Read as nanoseconds (detected from its length).", "ns");
      t.eq(await t.page.eval(txt("#o-iso")), "2023-11-14T22:13:20.123456789Z", "ns keeps all digits");
      await t.page.setValue("#ts-unit", "ms");
      await t.page.setValue("#ts-in", "-1500");
      t.eq(await t.page.eval(txt("#o-iso")), "1969-12-31T23:59:58.500Z", "negative ms");
      t.eq(await t.page.eval(txt("#o-s")), "-2", "floor seconds");
      await t.page.setValue("#ts-in", "12abc");
      t.assert(/whole number/.test(await t.page.eval(txt("#ts-detected"))), "bad input message");
      t.eq(await t.page.eval(`document.querySelector("#ts-out").hidden`), true, "rows hidden on error");
      await t.page.setValue("#ts-unit", "auto");
      await t.page.setValue("#ts-in", "1700000000");
      const now = Number(await t.page.eval(txt("#now-s")));
      t.assert(Math.abs(now - Date.now() / 1000) < 5, "live clock");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "unix-timestamp-converter",
    name: "1700000000 in New York and Manila (emulated local zone)",
    async run(t) {
      await t.page.timezone("America/New_York");
      await t.go();
      await t.page.setValue("#ts-in", "1700000000");
      t.eq(await t.page.eval(txt("#o-zone-l")), "America/New York", "zone label");
      t.eq(await t.page.eval(txt("#o-zone")), "2023-11-14 17:13:20 (Tue) UTC-05:00, EST", "New York");
      t.eq(await t.page.eval(txt("#o-isoz")), "2023-11-14T17:13:20-05:00", "ISO offset");
      t.eq(await t.page.eval(txt("#o-rfc")), "Tue, 14 Nov 2023 17:13:20 -0500", "RFC 2822 NY");
      await t.page.timezone("Asia/Manila");
      await t.go();
      await t.page.setValue("#ts-in", "1700000000");
      t.eq(await t.page.eval(txt("#o-zone")), "2023-11-15 06:13:20 (Wed) UTC+08:00", "Manila");
      t.eq(await t.page.eval(txt("#o-utc")), "2023-11-14 22:13:20 (Tue) UTC+00:00", "UTC row");
    },
  },
  {
    page: "unix-timestamp-converter",
    name: "date to timestamp in Europe/London across DST, gap and overlap",
    async run(t) {
      await t.page.setValue("#tz", "Europe/London");
      const at = async (d, time) => {
        await t.page.setValue("#d-date", d);
        await t.page.setValue("#d-time", time);
        return t.page.eval(txt("#d-s"));
      };
      t.eq(await at("2024-03-30", "12:00:00"), String(Date.UTC(2024, 2, 30, 12) / 1000), "GMT day");
      t.eq(await t.page.eval(`document.querySelector("#d-note").hidden`), true, "no note on a normal time");
      t.eq(await at("2024-04-01", "12:00:00"), String(Date.UTC(2024, 3, 1, 11) / 1000), "BST day");
      t.eq(await at("2024-03-31", "01:30:00"), String(Date.UTC(2024, 2, 31, 1, 30) / 1000), "gap moved forward");
      t.assert((await t.page.eval(txt("#d-note"))).includes("doesn't exist"), "gap note");
      t.assert((await t.page.eval(txt("#d-note"))).includes("2024-03-31 02:30:00"), "gap note names the new clock time");
      t.eq(await at("2024-10-27", "01:30:00"), String(Date.UTC(2024, 9, 27, 0, 30) / 1000), "overlap first");
      t.assert((await t.page.eval(txt("#d-note"))).includes(String(Date.UTC(2024, 9, 27, 1, 30) / 1000)), "overlap second listed");
      t.eq(await t.page.eval(txt("#d-iso")), "2024-10-27T00:30:00Z", "ISO");
      await t.shot("dst", 375);
      await t.page.setValue("#tz", "UTC");
      t.eq(await t.page.eval(txt("#d-s")), String(Date.UTC(2024, 9, 27, 1, 30) / 1000), "zone change re-reads the date");
      await t.page.setValue("#d-date", "0100-01-01");
      await t.page.setValue("#d-time", "00:00:00");
      t.eq(await t.page.eval(txt("#d-ms")), String(new Date("0100-01-01T00:00:00Z").getTime()), "year 100 not mapped to 1900");
    },
  },

  /* ------------------------------------------------------------ cron */
  {
    page: "cron-expression-explainer",
    name: "weekday business-hours schedule: description and next runs (UTC, fixed start)",
    async run(t) {
      const expr = "*/15 9-17 * * 1-5";
      await t.page.setValue("#c-in", expr);
      await t.page.setValue("#c-tz", "UTC");
      await t.page.setValue("#c-from", "2026-10-09T17:40");
      await t.page.setValue("#c-count", "10");
      await t.page.waitFor(`${txt("#c-say")} !== ""`);
      t.eq(await t.page.eval(txt("#c-say")), "Every 15 minutes, between 09:00 and 17:59, on Monday through Friday.", "description");
      const want = refCron(expr, Date.UTC(2026, 9, 9, 17, 40), 10);
      t.eq(await t.page.eval(runIsos), want, "next runs");
      t.eq(want[0], "2026-10-09T17:45:00.000Z", "reference sanity: same day 17:45");
      t.eq(want[1], "2026-10-12T09:00:00.000Z", "reference sanity: next Monday");
      t.eq(await t.page.eval(all("#c-fields dd")), ["*/15every 15", "9-179–17", "*every day", "*every month", "1-5Mon–Fri"], "field cells");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "cron-expression-explainer",
    name: "day-of-month OR day-of-week, leap day, impossible date, Vixie star quirk",
    async run(t) {
      await t.page.setValue("#c-tz", "UTC");
      await t.page.setValue("#c-from", "2026-10-01T00:00");
      await t.page.setValue("#c-in", "0 9 1 * 1");
      await t.page.waitFor(`${txt("#c-say")} === "At 09:00, on day 1 of the month or on Monday."`);
      t.assert((await t.page.eval(txt("#c-note"))).includes("either one"), "OR note");
      t.eq(await t.page.eval(runIsos), refCron("0 9 1 * 1", Date.UTC(2026, 9, 1), 10), "OR runs");
      await t.page.setValue("#c-in", "0 9 */2 * 1");
      await t.page.waitFor(`${txt("#c-say")}.includes("but only if it is a Monday")`);
      t.eq(await t.page.eval(runIsos), refCron("0 9 */2 * 1", Date.UTC(2026, 9, 1), 10), "star-quirk AND runs");
      await t.page.setValue("#c-from", "");
      const t0 = Date.now();
      await t.page.setValue("#c-in", "0 0 29 2 *");
      await t.page.waitFor(`${txt("#c-say")} === "At 00:00, on day 29 of the month, in February."`);
      t.assert(Date.now() - t0 < 3000, "leap search fast");
      t.eq(await t.page.eval(`document.querySelectorAll("#c-runs time").length`), 10, "ten leap days");
      const leap = await t.page.eval(runIsos);
      const y = new Date().getUTCFullYear();
      const leaps = []; for (let yy = y; leaps.length < 10; yy++) if ((yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0) { const iso = new Date(Date.UTC(yy, 1, 29)).toISOString(); if (Date.parse(iso) >= Date.now() - 60000) leaps.push(iso); }
      t.eq(leap, leaps, "next ten 29 Februaries (2100 skipped)");
      await t.page.setValue("#c-in", "0 0 31 2 *");
      await t.page.waitFor(`${txt("#c-runs-info")}.startsWith("This schedule never runs")`);
      t.eq(await t.page.eval(`document.querySelectorAll("#c-runs li").length`), 0, "no runs listed");
      await t.shot("never", 375);
    },
  },
  {
    page: "cron-expression-explainer",
    name: "DST in New York: repeated hour listed once, skipped hour left out",
    async run(t) {
      await t.page.setValue("#c-tz", "America/New_York");
      await t.page.setValue("#c-count", "5");
      await t.page.setValue("#c-from", "2026-10-30T00:00");
      await t.page.setValue("#c-in", "30 1 * * *");
      await t.page.waitFor(`document.querySelectorAll("#c-runs time")[0]?.getAttribute("datetime") === "2026-10-30T05:30:00.000Z"`);
      t.eq(await t.page.eval(runIsos), ["2026-10-30T05:30:00.000Z", "2026-10-31T05:30:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z", "2026-11-03T06:30:00.000Z"], "fall back");
      t.assert((await t.page.eval(txt("#c-runs-note"))).includes("happens twice"), "repeated note");
      await t.page.setValue("#c-from", "2026-03-07T00:00");
      await t.page.setValue("#c-in", "30 2 * * *");
      await t.page.waitFor(`document.querySelectorAll("#c-runs time")[0]?.getAttribute("datetime") === "2026-03-07T07:30:00.000Z"`);
      t.eq(await t.page.eval(runIsos), ["2026-03-07T07:30:00.000Z", "2026-03-09T06:30:00.000Z", "2026-03-10T06:30:00.000Z", "2026-03-11T06:30:00.000Z", "2026-03-12T06:30:00.000Z"], "spring forward");
      t.assert((await t.page.eval(txt("#c-runs-note"))).includes("skipped"), "skipped note");
      await t.shot("dst", 1280);
    },
  },
  {
    page: "cron-expression-explainer",
    name: "errors, macros, Quartz and crontab lines",
    async run(t) {
      const info = async (expr) => { await t.page.setValue("#c-in", expr); await t.page.waitFor(`document.querySelector("#c-in").value === ${JSON.stringify(expr)}`); await new Promise((r) => setTimeout(r, 250)); return t.page.eval(txt("#c-info")); };
      t.eq(await info("61 * * * *"), 'Minute field ("61"): 61 is outside 0–59.', "range error");
      t.eq(await t.page.eval(`document.querySelectorAll("#c-fields .is-bad").length === 1 && document.querySelector("#c-fields > div").classList.contains("is-bad")`), true, "bad field marked");
      t.eq(await t.page.eval(`document.querySelector("#c-in").getAttribute("aria-invalid")`), "true", "aria-invalid");
      t.assert((await info("0 0 * * FRI-MON")).includes("runs backwards"), "backwards range");
      t.assert((await info("0 0 * * 1#2")).includes("Quartz"), "Quartz char");
      t.assert((await info("0 0 12 * * ?")).includes("6 fields"), "six fields");
      t.assert((await info("0 0 12 * * ? 2026")).includes("Quartz"), "seven fields");
      t.assert((await info("0 0 * *")).includes("this has 4"), "too few");
      t.assert((await info("@reboot")).includes("no schedule"), "@reboot");
      t.eq(await info("@weekly"), "@weekly is the same as 0 0 * * 0.", "macro");
      t.eq(await t.page.eval(txt("#c-say")), "At 00:00, on Sunday.", "weekly description");
      await info("0 5 * * * /usr/bin/backup --all");
      t.assert((await t.page.eval(txt("#c-note"))).includes("command"), "command ignored");
      t.eq(await t.page.eval(txt("#c-say")), "At 05:00, every day.", "crontab line description");
      await info("0 0 1 jan,jul *");
      t.eq(await t.page.eval(txt("#c-say")), "At 00:00, on day 1 of the month, in January and July.", "month names");
      await info("0 */2 * * *");
      t.eq(await t.page.eval(txt("#c-say")), "At minute 0, every 2 hours from 00:00, every day.", "every 2 hours");
      await info("0 0 1 * 0-7");
      t.eq(await t.page.eval(txt("#c-say")), "At 00:00, every day.", "0-7 covers every day, OR rule");
      await t.shot("error", 375);
    },
  },

  /* ------------------------------------------------------------ regex */
  {
    page: "regex-tester",
    name: "named groups, highlighting and replace preview",
    async run(t) {
      await t.page.waitFor(`${txt("#r-info")} === "3 matches."`);
      t.eq(await t.page.eval(all("#r-view mark")), ["2024-03-31", "2025-12-01", "2026-10-08"], "highlighted");
      t.eq(await t.page.eval(`document.querySelectorAll("#r-list tr").length`), 3, "rows");
      t.eq(await t.page.eval(all("#r-list tr:first-child .rx-g")), ["1 year2024", "203", "331"], "groups");
      t.eq(await t.page.eval(all("#r-list tr:first-child td")).then((r) => r.slice(0, 3)), ["1", "10–20", "2024-03-31"], "position");
      await t.page.setValue("#r-repl", "$<year>/$2/$3");
      await t.page.waitFor(`!document.querySelector("#r-out-wrap").hidden`);
      t.eq(await t.page.eval(`document.querySelector("#r-out").textContent`), "Releases: 2024/03/31, 2025/12/01 and 2026/10/08.", "replace");
      t.eq(await t.page.eval(`document.querySelector("#r-view").innerHTML.includes("<script")`), false, "no markup injected");
      await t.page.setValue("#r-text", "<img src=x onerror=alert(1)> 2020-01-02");
      await t.page.waitFor(`${txt("#r-info")} === "1 match."`);
      t.eq(await t.page.eval(`document.querySelectorAll("#r-view img").length`), 0, "text shown as text");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "regex-tester",
    name: "flags, empty matches, cap and optional groups",
    async run(t) {
      await t.page.setValue("#r-pattern", "cat");
      await t.page.setValue("#r-text", "Cat cat CAT");
      await t.page.waitFor(`${txt("#r-info")} === "1 match."`);
      await t.page.click('[data-flag="i"]');
      await t.page.waitFor(`${txt("#r-info")} === "3 matches."`);
      t.eq(await t.page.eval(txt("#r-flagtext")), "/gi", "flag text");
      await t.page.click('[data-flag="g"]');
      await t.page.waitFor(`${txt("#r-info")}.startsWith("1 match. Without the g flag")`);
      await t.page.click('[data-flag="g"]');
      await t.page.setValue("#r-pattern", "\\b");
      await t.page.setValue("#r-text", "ab cd");
      await t.page.waitFor(`${txt("#r-info")} === "4 matches."`);
      t.eq(await t.page.eval(`document.querySelectorAll("#r-view mark.rx-empty").length`), 4, "empty marks");
      await t.page.setValue("#r-pattern", "(a)|(b)");
      await t.page.setValue("#r-text", "b");
      await t.page.waitFor(`${txt("#r-info")} === "1 match."`);
      t.eq(await t.page.eval(all("#r-list .rx-g")), ["1no match", "2b"], "unmatched group");
      await t.page.setValue("#r-pattern", ".");
      await t.page.setValue("#r-text", "x".repeat(1500));
      await t.page.waitFor(`${txt("#r-info")} === "1,500 matches; the first 1,000 are listed and highlighted."`);
      t.eq(await t.page.eval(`document.querySelectorAll("#r-list tr").length`), 1000, "capped rows");
      await t.page.setValue("#r-pattern", "\\u{1F600}");
      await t.page.click('[data-flag="u"]');
      await t.page.setValue("#r-text", "a😀b😀");
      await t.page.waitFor(`${txt("#r-info")} === "2 matches."`);
    },
  },
  {
    page: "regex-tester",
    name: "invalid pattern and catastrophic backtracking are reported",
    async run(t) {
      await t.page.setValue("#r-pattern", "(unclosed");
      await t.page.waitFor(`${txt("#r-info")}.startsWith("Not a valid pattern")`);
      t.eq(await t.page.eval(`document.querySelector("#r-pattern").getAttribute("aria-invalid")`), "true", "aria-invalid");
      await t.page.setValue("#r-text", "a".repeat(36) + "!");
      const t0 = Date.now();
      await t.page.setValue("#r-pattern", "^(a+)+$");
      await t.page.waitFor(`${txt("#r-info")}.includes("took too long")`, { timeout: 8000 });
      t.assert(Date.now() - t0 < 6000, "stopped in time");
      await t.shot("timeout", 375);
      await t.page.setValue("#r-pattern", "a+");
      await t.page.waitFor(`${txt("#r-info")} === "1 match."`);
    },
  },

  /* ------------------------------------------------------------ colour */
  {
    page: "color-converter",
    name: "converts #1636a3 and other notations exactly",
    async run(t) {
      const ref = refHslHsvCmyk("#1636a3");
      t.eq(await t.page.eval(txt("#o-hex")), "#1636a3", "hex");
      t.eq(await t.page.eval(txt("#o-rgb")), "rgb(22, 54, 163)", "rgb");
      t.eq(await t.page.eval(txt("#o-hsl")), ref.hsl, "hsl");
      t.eq(await t.page.eval(txt("#o-hsv")), ref.hsv, "hsv");
      t.eq(await t.page.eval(txt("#o-cmyk")), ref.cmyk, "cmyk");
      t.eq(ref.hsl, "hsl(226.4, 76.2%, 36.3%)", "reference sanity");
      const conv = async (s) => { await t.page.setValue("#c-in", s); return t.page.eval(txt("#o-hex")); };
      t.eq(await conv("rebeccapurple"), "#663399", "name");
      t.eq(await t.page.eval(txt("#o-name")), "rebeccapurple", "name back");
      t.eq(await conv("hsl(0, 100%, 50%)"), "#ff0000", "hsl red");
      t.eq(await t.page.eval(txt("#o-name")), "red", "red name");
      t.eq(await conv("cmyk(0%, 100%, 100%, 0%)"), "#ff0000", "cmyk red");
      t.eq(await conv("hsv(120, 100%, 100%)"), "#00ff00", "hsv lime");
      t.eq(await t.page.eval(txt("#o-name")), "lime", "lime");
      t.eq(await conv("#0ff"), "#00ffff", "short hex");
      t.eq(await t.page.eval(txt("#o-name")), "aqua, cyan", "two names");
      t.eq(await conv("#0f08"), "#00ff0088", "4-digit hex with alpha");
      t.eq(await t.page.eval(txt("#o-rgb")), "rgba(0, 255, 0, 0.533)", "rgba");
      t.eq(await conv("rgb(100% 0% 0% / 50%)"), "#ff000080", "modern rgb syntax");
      t.eq(await conv("hsl(0.5turn 100% 25%)"), "#008080", "turn unit");
      t.eq(await t.page.eval(`document.querySelector("#c-pick").value`), "#008080", "picker synced");
      await t.page.setValue("#c-in", "notacolour");
      t.assert((await t.page.eval(txt("#c-info"))).startsWith("That isn't a colour"), "error");
      t.eq(await t.page.eval(`document.querySelector("#c-out").hidden`), true, "rows hidden on error");
      await t.page.setValue("#c-pick", "#ff8800");
      t.eq(await t.page.eval(`document.querySelector("#c-in").value`), "#ff8800", "picker writes the text box");
      t.eq(await t.page.eval(txt("#o-rgb")), "rgb(255, 136, 0)", "picker converts");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "color-converter",
    name: "WCAG contrast: thresholds, no rounding up, alpha blending",
    async run(t) {
      const check = async (fg, bg) => { await t.page.setValue("#k-fg", fg); await t.page.setValue("#k-bg", bg); return t.page.eval(txt("#k-ratio")); };
      const badges = () => t.page.eval(all(".col-badge"));
      t.eq(await check("#767676", "#ffffff"), "4.54:1", "767676");
      t.eq((Math.round(refRatio([118, 118, 118], [255, 255, 255]) * 100) / 100).toFixed(2), "4.54", "reference");
      t.eq(await badges(), ["Pass", "Fail", "Pass", "Pass", "Pass"], "767676 badges");
      const r777 = refRatio([119, 119, 119], [255, 255, 255]);
      t.eq((Math.round(r777 * 100) / 100).toFixed(2), "4.48", "reference 777");
      t.eq(await check("#777", "#fff"), "4.48:1", "777");
      t.eq(await badges(), ["Fail", "Fail", "Pass", "Fail", "Pass"], "777 badges");
      t.eq(await check("black", "white"), "21:1", "max");
      t.eq(await check("#fff", "#fff"), "1:1", "min");
      // 0.5 black over white blends to 128 (rounded), measured as a solid colour
      const blended = refRatio([128, 128, 128], [255, 255, 255]);
      t.eq(await check("rgba(0, 0, 0, 0.5)", "#ffffff"), (Math.round(blended * 100) / 100) + ":1", "alpha blend");
      t.assert((await t.page.eval(txt("#k-note"))).includes("blended"), "alpha note");
      await t.page.click("#k-swap");
      t.eq(await t.page.eval(`document.querySelector("#k-fg").value`), "#ffffff", "swap");
      // a ratio just under 4.5 never shows as 4.5: #757575 on white
      const r757 = refRatio([117, 117, 117], [255, 255, 255]);
      const shown = await check("#757575", "#ffffff");
      if (r757 < 4.5) t.assert(parseFloat(shown) < 4.5, "not rounded up: " + shown);
      await t.page.setValue("#k-fg", "nope");
      t.assert((await t.page.eval(txt("#k-info"))).startsWith("Text colour:"), "fg error");
      await t.page.setValue("#k-fg", "#1636a3");
      await t.shot("contrast", 375);
    },
  },
  /* ------------------------------------------------------------ colour contrast checker */
  {
    page: "color-contrast-checker",
    name: "WCAG ratio: #777 on white 4.48, black on white 21, white on white 1, thresholds, names and hsl",
    async run(t) {
      const set = async (fg, bg) => { await t.page.setValue("#cc-fg", fg); await t.page.setValue("#cc-bg", bg); };
      const badges = () => t.page.eval(`[...document.querySelectorAll(".col-badge")].map((e) => e.textContent.trim())`);
      // defaults are #777777 on #ffffff
      t.eq(await t.page.eval(txt("#cc-ratio")), "4.48:1", "#777777 on #ffffff");
      t.eq(await badges(), ["Fail", "Fail", "Pass", "Fail"], "AA normal fail, AAA normal fail, AA large pass, AAA large fail");
      const raw = Number(await t.page.eval(`document.querySelector("#cc-ratio").dataset.ratio`));
      t.assert(Math.abs(raw - 4.478089453577214) < 1e-9, "unrounded ratio kept: " + raw);
      t.assert((await t.page.eval(txt("#cc-raw"))).includes("4.478089"), "unrounded text shown");
      await set("#000", "#fff");
      t.eq(await t.page.eval(txt("#cc-ratio")), "21.00:1", "black on white");
      t.eq(await badges(), ["Pass", "Pass", "Pass", "Pass"], "all pass");
      await set("#fff", "#fff");
      t.eq(await t.page.eval(txt("#cc-ratio")), "1.00:1", "white on white");
      t.eq(await badges(), ["Fail", "Fail", "Fail", "Fail"], "all fail");
      await set("#767676", "white");
      t.eq(await t.page.eval(txt("#cc-ratio")), "4.54:1", "#767676 on a CSS name");
      t.eq((await badges())[0], "Pass", "AA normal pass at 4.54");
      await set("hsl(0, 0%, 0%)", "rgb(255, 255, 255)");
      t.eq(await t.page.eval(txt("#cc-ratio")), "21.00:1", "hsl and rgb notations");
      await set("rebeccapurple", "#fff");
      t.eq(await t.page.eval(txt("#cc-ratio")), "8.41:1", "rebeccapurple on white");
      await t.page.setValue("#cc-fg", "notacolour");
      t.assert((await t.page.eval(txt("#cc-info"))).startsWith("Text colour: That isn't a colour"), "error shown");
      t.eq(await t.page.eval(txt("#cc-ratio")), "–", "ratio cleared on error");
      await set("#777777", "#ffffff");
      await t.page.click("#cc-swap");
      t.eq(await t.page.eval(`document.querySelector("#cc-fg").value`), "#ffffff", "swap");
      t.eq(await t.page.eval(txt("#cc-ratio")), "4.48:1", "ratio symmetric");
      await t.page.setValue("#cc-fg-pick", "#000000");
      t.eq(await t.page.eval(`document.querySelector("#cc-fg").value`), "#000000", "picker writes the text box");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
];
