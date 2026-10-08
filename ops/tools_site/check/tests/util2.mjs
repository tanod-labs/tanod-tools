// Utilities batch 2: random number generator, name picker, countdown timer, stopwatch, text to speech.
// Expected values are computed here independently of the page code.
const q = (sel) => JSON.stringify(sel);
const txt = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).textContent.trim()`);
const val = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).value`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ random number generator */
async function draw(t, { min, max, count = 1, unique = false, places = 0, order = "drawn" }) {
  await t.page.setValue("#rn-min", String(min));
  await t.page.setValue("#rn-max", String(max));
  await t.page.setValue("#rn-count", String(count));
  await t.page.setValue("#rn-places", String(places));
  await t.page.setValue("#rn-order", order);
  await t.page.eval(`(() => { const c = document.querySelector("#rn-unique"); if (c.checked !== ${unique}) c.click(); return true; })()`);
  await t.page.click("#rn-gen");
  const text = await t.page.eval(`document.querySelector("#rn-out").textContent`);
  return text ? text.split("\n") : [];
}

const rng = [
  {
    page: "random-number-generator",
    name: "values stay in range and are integers; 1..2 shows both values",
    async run(t) {
      const a = await draw(t, { min: 10, max: 20, count: 2000 });
      t.eq(a.length, 2000, "count");
      t.assert(a.every((s) => /^-?\d+$/.test(s) && +s >= 10 && +s <= 20), "all integers in 10..20");
      t.eq([...new Set(a)].length, 11, "every value in 10..20 appears");
      const b = await draw(t, { min: 1, max: 2, count: 2000 });
      t.eq([...new Set(b)].sort(), ["1", "2"], "both of 1 and 2 appear");
      const c = await draw(t, { min: -5, max: -1, count: 1000 });
      t.assert(c.every((s) => +s >= -5 && +s <= -1 && Number.isInteger(+s)), "negative range");
      t.eq([...new Set(c)].length, 5, "all five negatives appear");
      const d = await draw(t, { min: 7, max: 7, count: 5 });
      t.eq(d, ["7", "7", "7", "7", "7"], "single-value range");
      const e = await draw(t, { min: -3, max: 3, count: 1000 });
      t.eq([...new Set(e)].length, 7, "range spanning zero covers -3..3");
    },
  },
  {
    page: "random-number-generator",
    name: "no repeats: correct count, no duplicates, impossible request explained",
    async run(t) {
      const a = await draw(t, { min: 1, max: 50, count: 50, unique: true });
      t.eq(a.length, 50, "count");
      t.eq([...new Set(a)].length, 50, "no duplicates");
      t.eq([...a].map(Number).sort((x, y) => x - y), Array.from({ length: 50 }, (_, i) => i + 1), "exactly 1..50");
      const b = await draw(t, { min: 1, max: 1000000000, count: 5000, unique: true });
      t.eq(b.length, 5000, "big range count");
      t.eq(new Set(b).size, 5000, "big range, no duplicates");
      t.assert(b.every((s) => +s >= 1 && +s <= 1e9), "big range in bounds");
      const c = await draw(t, { min: 1, max: 6, count: 7, unique: true });
      t.eq(c, [], "no output when impossible");
      const msg = await t.waitError();
      t.assert(/7 different numbers/.test(msg) && /holds 6/.test(msg), "message: " + msg);
      t.eq(await t.page.eval(`document.querySelector("#rn-count").getAttribute("aria-invalid")`), "true", "aria-invalid");
      await t.shot("error", 375);
    },
  },
  {
    page: "random-number-generator",
    name: "range near +-2^53 does not throw and stays in range",
    async run(t) {
      const MAX = 9007199254740991n;
      const a = await draw(t, { min: "-9007199254740991", max: "9007199254740991", count: 500 });
      t.eq(a.length, 500, "count");
      t.assert(a.every((s) => /^-?\d+$/.test(s) && BigInt(s) >= -MAX && BigInt(s) <= MAX), "within +-(2^53-1)");
      t.assert(new Set(a).size > 490, "values vary");
      const b = await draw(t, { min: "9007199254740980", max: "9007199254740991", count: 300 });
      t.assert(b.every((s) => BigInt(s) >= 9007199254740980n && BigInt(s) <= MAX), "top edge exact");
      t.assert(b.some((s) => s === "9007199254740991") && b.some((s) => s === "9007199254740980"), "both ends reachable");
      const c = await draw(t, { min: "-9007199254740991", max: "-9007199254740990", count: 100 });
      t.eq([...new Set(c)].sort(), ["-9007199254740990", "-9007199254740991"], "bottom edge exact");
      const d = await draw(t, { min: "0", max: "99999999999999999999999999", count: 50, unique: true });
      t.eq(new Set(d).size, 50, "huge unique");
      t.assert(await t.page.eval(`document.querySelector("#status").dataset.state`) === "done", "no error");
    },
  },
  {
    page: "random-number-generator",
    name: "frequency sanity: 1..6 over 60,000 draws within 5% of expected",
    async run(t) {
      const counts = new Array(7).fill(0);
      for (let i = 0; i < 6; i++) {
        const a = await draw(t, { min: 1, max: 6, count: 10000 });
        for (const s of a) counts[+s]++;
      }
      for (let f = 1; f <= 6; f++) t.assert(Math.abs(counts[f] - 10000) <= 500, `face ${f} count ${counts[f]}`);
      t.eq(counts.reduce((x, y) => x + y, 0), 60000, "total");
    },
  },
  {
    page: "random-number-generator",
    name: "sorted output, swap note, decimals with exact places",
    async run(t) {
      const a = await draw(t, { min: 1, max: 1000, count: 200, order: "asc" });
      t.eq(a.map(Number), [...a].map(Number).sort((x, y) => x - y), "ascending");
      const b = await draw(t, { min: 1, max: 1000, count: 200, order: "desc" });
      t.eq(b.map(Number), [...b].map(Number).sort((x, y) => y - x), "descending");
      const c = await draw(t, { min: 20, max: 10, count: 100 });
      t.assert(c.every((s) => +s >= 10 && +s <= 20), "swapped range respected");
      t.assert(/swapped/.test(await txt(t, "#status")), "swap announced: " + await txt(t, "#status"));
      const d = await draw(t, { min: "0", max: "1", count: 3000, places: 2 });
      t.assert(d.every((s) => /^[01]\.\d{2}$/.test(s) && +s <= 1), "exactly two places");
      t.assert(new Set(d).size > 90, "grid is well covered: " + new Set(d).size);
      const e = await draw(t, { min: "-1.5", max: "-1.4", count: 400, places: 1 });
      t.eq([...new Set(e)].sort(), ["-1.4", "-1.5"], "negative decimals");
      const f = await draw(t, { min: "0", max: "0.03", count: 20, places: 2, unique: true });
      t.eq(f, [], "request exceeds the 4 grid values -> no output");
      const g = await draw(t, { min: "0", max: "0.03", count: 4, places: 2, unique: true });
      t.eq([...g].sort(), ["0.00", "0.01", "0.02", "0.03"], "unique on a decimal grid");
      const h = await draw(t, { min: "0.123", max: "1", count: 1, places: 2 });
      t.eq(h, [], "too many decimals in bound");
      t.assert(/more than 2 decimal places/.test(await txt(t, "#status")), "decimal message");
    },
  },
  {
    page: "random-number-generator",
    name: "bad input messages, copy and download",
    async run(t) {
      await draw(t, { min: "abc", max: "5" });
      t.assert(/Minimum must be a number/.test(await txt(t, "#status")), "bad min");
      await draw(t, { min: "1", max: "5", count: 0 });
      t.assert(/How many/.test(await txt(t, "#status")), "bad count");
      await draw(t, { min: "1", max: "5", count: 10001 });
      t.assert(/1 to 10,000/.test(await txt(t, "#status")), "count over limit");
      const a = await draw(t, { min: 1, max: 9, count: 12, order: "asc" });
      const d = await t.dl("#rn-dl");
      t.eq(d.name, "random-numbers.txt", "file name");
      t.eq(d.bytes.toString("utf8"), a.join("\n") + "\n", "download content");
      t.eq(await txt(t, "#rn-big"), a[a.length - 1], "big shows last in list");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
];

/* ------------------------------------------------------------ random name picker */
const NAMES = Array.from({ length: 12 }, (_, i) => "Person " + (i + 1));
async function setNames(t, list) {
  await t.page.setValue("#rp-names", list.join("\n"));
}
const reduce = (t) => t.page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
const resultNames = (t) => t.page.eval(`[...document.querySelectorAll("#rp-result .rp-win, #rp-result .rp-wins li")].map(e => e.textContent)`);

const picker = [
  {
    page: "random-name-picker",
    name: "winners come from the list; N winners are distinct; empty list message",
    async run(t) {
      await reduce(t);
      await t.page.click("#rp-go");
      t.assert(/Add at least one name/.test(await txt(t, "#status")), "empty list message");
      t.eq(await t.page.eval(`document.querySelector("#rp-names").getAttribute("aria-invalid")`), "true", "aria-invalid");
      await setNames(t, ["  ", ...NAMES.slice(0, 5).map((n) => "  " + n + "  "), "", "   "]);
      t.eq(await txt(t, "#rp-info"), "5 names.", "blank lines ignored, trimmed");
      const seen = new Set();
      for (let i = 0; i < 40; i++) {
        await t.page.click("#rp-go");
        const w = await resultNames(t);
        t.eq(w.length, 1, "one winner");
        t.assert(NAMES.slice(0, 5).includes(w[0]), "from list: " + w[0]);
        seen.add(w[0]);
      }
      t.eq(seen.size, 5, "all five names win sometimes in 40 draws");
      await setNames(t, NAMES);
      await t.page.setValue("#rp-winners", "5");
      for (let i = 0; i < 20; i++) {
        await t.page.click("#rp-go");
        const w = await resultNames(t);
        t.eq(w.length, 5, "five winners");
        t.eq(new Set(w).size, 5, "distinct");
        t.assert(w.every((n) => NAMES.includes(n)), "all from list");
      }
      await t.page.setValue("#rp-winners", "13");
      await t.page.click("#rp-go");
      t.assert(/13 winners but the list has only 12 names/.test(await txt(t, "#status")), "too many winners: " + await txt(t, "#status"));
    },
  },
  {
    page: "random-name-picker",
    name: "duplicates reported; duplicate lines are separate entries",
    async run(t) {
      await reduce(t);
      await setNames(t, ["Ana", "Bo", "Ana", "Cy", "Ana", "Bo"]);
      const info = await txt(t, "#rp-info");
      t.assert(info.startsWith("6 names.") && /2 names appear more than once/.test(info) && /Ana x3/.test(info) && /Bo x2/.test(info), "duplicate report: " + info);
      await t.page.setValue("#rp-winners", "6");
      await t.page.click("#rp-go");
      const w = await resultNames(t);
      t.eq([...w].sort(), ["Ana", "Ana", "Ana", "Bo", "Bo", "Cy"], "all six entries drawn once each");
    },
  },
  {
    page: "random-name-picker",
    name: "remove picked names empties the list over successive draws",
    async run(t) {
      await reduce(t);
      await setNames(t, NAMES.slice(0, 4));
      await t.page.click("#rp-remove");
      const got = [];
      for (let i = 0; i < 4; i++) {
        const before = (await val(t, "#rp-names")).split("\n").filter(Boolean);
        await t.page.click("#rp-go");
        const [w] = await resultNames(t);
        got.push(w);
        const after = (await val(t, "#rp-names")).split("\n").filter(Boolean);
        t.eq(after.length, before.length - 1, "one removed");
        t.assert(!after.includes(w) && before.includes(w), "winner removed from list");
      }
      t.eq([...got].sort(), NAMES.slice(0, 4), "each name drawn exactly once");
      t.eq(await val(t, "#rp-names"), "", "list empty");
      await t.page.click("#rp-go");
      t.assert(/Add at least one name/.test(await txt(t, "#status")), "empty again");
      t.eq(await t.page.eval(`document.querySelectorAll("#rp-history li").length`), 4, "history has the four picks");
    },
  },
  {
    page: "random-name-picker",
    name: "teams cover every name once with balanced sizes",
    async run(t) {
      await reduce(t);
      await t.page.click('input[name="rp-mode"][value="teams"]');
      t.assert(await t.page.eval(`document.querySelector("#rp-win-box").hidden`), "winners field hidden");
      for (const [n, k] of [[10, 3], [7, 7], [9, 1], [25, 4], [2, 2]]) {
        const list = Array.from({ length: n }, (_, i) => "N" + i);
        await setNames(t, list);
        await t.page.setValue("#rp-teams", String(k));
        await t.page.click("#rp-go");
        const teams = await t.page.eval(`[...document.querySelectorAll("#rp-result .rp-team")].map(s => [...s.querySelectorAll("li")].map(l => l.textContent))`);
        t.eq(teams.length, k, `${k} teams`);
        t.eq(teams.flat().sort(), [...list].sort(), "every name exactly once");
        const sizes = teams.map((m) => m.length);
        t.assert(Math.max(...sizes) - Math.min(...sizes) <= 1, `balanced ${sizes}`);
      }
      await setNames(t, ["a", "b"]);
      await t.page.setValue("#rp-teams", "3");
      await t.page.click("#rp-go");
      t.assert(/3 teams but the list has only 2 names/.test(await txt(t, "#status")), "too many teams");
      // randomness: team 1 of a 6-name, 2-team split varies
      await setNames(t, ["a", "b", "c", "d", "e", "f"]);
      await t.page.setValue("#rp-teams", "2");
      const firsts = new Set();
      for (let i = 0; i < 30; i++) {
        await t.page.click("#rp-go");
        firsts.add(await t.page.eval(`document.querySelector("#rp-result .rp-team li").textContent`));
      }
      t.assert(firsts.size >= 4, "teams vary between draws");
    },
  },
  {
    page: "random-name-picker",
    name: "reduced motion shows the result at once; normal motion animates then announces",
    async run(t) {
      await setNames(t, NAMES);
      // normal motion: the result is not there straight away, and arrives after the spin
      await t.page.click("#rp-go");
      t.eq(await t.page.eval(`document.querySelector("#rp-result").dataset.state`), "spinning", "spinning state");
      t.assert(await t.page.eval(`document.querySelector("#rp-go").disabled`), "button busy while spinning");
      t.eq((await resultNames(t)).length, 0, "no result yet");
      await t.page.waitFor(`document.querySelector("#rp-result").dataset.state === "done"`, { timeout: 8000 });
      t.eq((await resultNames(t)).length, 1, "result after spin");
      t.eq(await t.page.eval(`document.querySelector("#rp-result").getAttribute("aria-live")`), "polite", "aria-live");
      // reduced motion: immediate
      await reduce(t);
      await t.page.eval(`document.querySelector("#rp-go").click(); true`);
      t.eq(await t.page.eval(`document.querySelector("#rp-result").dataset.state`), "done", "immediate with reduced motion");
      t.eq((await resultNames(t)).length, 1, "winner shown immediately");
    },
  },
  {
    page: "random-name-picker",
    name: "wheel draws labelled and unlabelled; screenshots",
    async run(t) {
      await reduce(t);
      await setNames(t, ["Amara", "Bruno", "Chen", "Dalia", "Emre", "Farah", "A very long name that cannot possibly fit inside one slice of the wheel"]);
      const painted = (sel) => t.page.eval(`(() => { const c = document.querySelector(${q(sel)}); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 40) if (d[i]) n++; return n; })()`);
      t.assert((await painted("#rp-wheel")) > 5000, "wheel painted");
      t.assert(/Wheel showing 7 names/.test(await t.page.eval(`document.querySelector("#rp-wheel").getAttribute("aria-label")`)), "canvas label");
      await t.page.click("#rp-go");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await reduce(t); // t.shot resets the emulated media
      const many = Array.from({ length: 250 }, (_, i) => "Entrant " + i);
      await setNames(t, many);
      await t.page.setValue("#rp-winners", "3");
      await t.page.click("#rp-go");
      const w = await resultNames(t);
      t.eq(new Set(w).size, 3, "three winners from 250");
      t.assert(w.every((n) => many.includes(n)), "from the list");
      await t.shot("many", 375);
    },
  },
];

/* ------------------------------------------------------------ countdown timer */
const CT_OSC = `(() => { window.__osc = 0; const o = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { window.__osc++; return o.call(this); }; return true; })()`;
const setMute = (t, on) => t.page.eval(`(() => { const c = document.querySelector("#ct-mute"); c.checked = ${on}; c.dispatchEvent(new Event("change")); return true; })()`);
const setDur = async (t, h, m, s) => { await t.page.setValue("#ct-h", String(h)); await t.page.setValue("#ct-m", String(m)); await t.page.setValue("#ct-s", String(s)); };
const digits = (t) => txt(t, "#ct-digits");
const dstate = (t) => t.page.eval(`document.querySelector("#ct-digits").dataset.state`);

async function readCountdown(t) {
  const [d, h, m, s] = await t.page.eval(`["#ct-days", "#ct-hours", "#ct-mins", "#ct-secs"].map(x => Number(document.querySelector(x).textContent))`);
  const now = Date.now();
  return { shown: d * 86400 + h * 3600 + m * 60 + s, now };
}

const countdown = [
  {
    page: "countdown-timer",
    name: "3-second timer runs, finishes, sets the title, plays the tone",
    async run(t) {
      await t.page.eval(CT_OSC);
      await setMute(t, false);
      t.eq(await digits(t), "00:05:00", "default 5 minutes");
      await setDur(t, 0, 0, 3);
      t.eq(await digits(t), "00:00:03", "idle display follows the inputs");
      const t0 = Date.now();
      await t.page.click("#ct-start");
      t.eq(await dstate(t), "running", "running");
      t.eq(await txt(t, "#ct-start"), "Pause", "button says Pause");
      await sleep(1000);
      t.assert(/^0?[0-3]:0?\d? ?left - Countdown timer$|left - Countdown timer$/.test(await t.page.eval("document.title")), "title shows time left: " + await t.page.eval("document.title"));
      t.assert(await t.page.eval(`document.querySelector("#ct-h").disabled`), "inputs locked while running");
      await t.page.waitFor(`document.querySelector("#ct-digits").dataset.state === "finished"`, { timeout: 6000 });
      const took = Date.now() - t0;
      t.assert(took >= 2800 && took <= 4300, "finished after about 3 s: " + took);
      t.eq(await digits(t), "00:00:00", "zero");
      t.eq(await t.page.eval("document.title"), "Time's up - Countdown timer", "finished title");
      t.assert(!(await t.page.eval(`document.querySelector("#ct-done").hidden`)), "finished message visible");
      await sleep(100);
      t.eq(await txt(t, "#ct-announce"), "Time's up.", "announced");
      t.eq(await t.page.eval("window.__osc"), 3, "three tones generated with Web Audio");
      await t.page.click("#ct-reset");
      t.eq(await t.page.eval("document.title"), "Countdown timer: set a duration or a date | Tanod Tools", "title restored by reset");
    },
  },
  {
    page: "countdown-timer",
    name: "mute toggle silences the end tone",
    async run(t) {
      await t.page.eval(CT_OSC);
      await setMute(t, true);
      await setDur(t, 0, 0, 2);
      await t.page.click("#ct-start");
      await t.page.waitFor(`document.querySelector("#ct-digits").dataset.state === "finished"`, { timeout: 5000 });
      t.eq(await t.page.eval("window.__osc"), 0, "no oscillator when muted");
      await setMute(t, false);
    },
  },
  {
    page: "countdown-timer",
    name: "pause keeps the remaining time, resume continues, reset restores",
    async run(t) {
      await setDur(t, 0, 0, 20);
      await t.page.eval(`(() => { const w = document.querySelector("#ct-wake"); if (!w.disabled) { w.checked = true; w.dispatchEvent(new Event("change")); } return true; })()`);
      await t.page.click("#ct-start");
      await sleep(1500);
      await t.page.click("#ct-start");
      t.eq(await dstate(t), "paused", "paused");
      t.eq(await txt(t, "#ct-start"), "Resume", "button says Resume");
      const p1 = await digits(t);
      t.assert(p1 === "00:00:18" || p1 === "00:00:19", "about 18.5 s left: " + p1);
      await sleep(1600);
      t.eq(await digits(t), p1, "no change while paused");
      await t.page.click("#ct-start");
      await sleep(2200);
      const p2 = await digits(t);
      t.assert(p2 < p1, "resumed and counting: " + p1 + " -> " + p2);
      t.assert(p2 >= "00:00:15", "only the running time was used: " + p2);
      await t.page.click("#ct-reset");
      t.eq(await dstate(t), "idle", "idle after reset");
      t.eq(await digits(t), "00:00:20", "back to the set time");
      t.assert(!(await t.page.eval(`document.querySelector("#ct-s").disabled`)), "inputs unlocked");
      t.eq(await t.page.eval("document.title"), "Countdown timer: set a duration or a date | Tanod Tools", "title restored");
    },
  },
  {
    page: "countdown-timer",
    name: "presets, zero and invalid input messages",
    async run(t) {
      await t.page.click('.ct-preset[data-min="25"]');
      t.eq(await digits(t), "00:25:00", "25 minute preset");
      await t.page.click('.ct-preset[data-min="1"]');
      t.eq(await digits(t), "00:01:00", "1 minute preset");
      await setDur(t, 1, 90, 75);
      t.eq(await digits(t), "02:31:15", "overflowing fields are normalised");
      await setDur(t, 0, 0, 0);
      await t.page.click("#ct-start");
      t.assert(/above zero/.test(await txt(t, "#ct-err")), "zero message: " + await txt(t, "#ct-err"));
      t.eq(await dstate(t), "idle", "did not start");
      await setDur(t, 0, 0, -4);
      t.assert(/whole numbers/.test(await txt(t, "#ct-err")), "negative message");
      await setDur(t, 100, 0, 0);
      t.assert(/99 hours/.test(await txt(t, "#ct-err")), "too long message");
      await setDur(t, 0, 10, 0);
      await t.page.click("#ct-start");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "countdown-timer",
    name: "date mode matches an independent computation (Tokyo, London winter, New York summer)",
    async run(t) {
      await t.page.click('input[name="ct-mode"][value="date"]');
      const cases = [
        ["2031-06-15", "12:30", "Asia/Tokyo", Date.UTC(2031, 5, 15, 3, 30)],
        ["2030-12-31", "23:59", "Europe/London", Date.UTC(2030, 11, 31, 23, 59)],
        ["2031-07-04", "09:00", "America/New_York", Date.UTC(2031, 6, 4, 13, 0)],
        ["2031-01-01", "00:00", "UTC", Date.UTC(2031, 0, 1, 0, 0)],
      ];
      for (const [d, tm, tz, ms] of cases) {
        await t.page.setValue("#ct-dd", d);
        await t.page.setValue("#ct-dt", tm);
        await t.page.setValue("#ct-dz", tz);
        await sleep(300);
        const { shown, now } = await readCountdown(t);
        const expected = Math.ceil((ms - now) / 1000);
        t.assert(Math.abs(shown - expected) <= 1, `${tz}: shown ${shown}, expected ${expected}`);
        t.assert(new RegExp(tz.replace("_", " ")).test(await txt(t, "#ct-target")), "target text names the zone: " + await txt(t, "#ct-target"));
      }
      // seconds really tick
      const a = await readCountdown(t);
      await sleep(2100);
      const b = await readCountdown(t);
      t.assert(a.shown - b.shown >= 1 && a.shown - b.shown <= 3, `ticks down: ${a.shown} -> ${b.shown}`);
      await t.shot("date", 375);
      await t.shot("date", 1280);
    },
  },
  {
    page: "countdown-timer",
    name: "date in the past and unreadable dates show messages",
    async run(t) {
      await t.page.click('input[name="ct-mode"][value="date"]');
      t.assert(/Pick a date/.test(await txt(t, "#ct-date-msg")), "empty message");
      await t.page.setValue("#ct-dd", "2020-01-01");
      await t.page.setValue("#ct-dt", "00:00");
      await t.page.setValue("#ct-dz", "UTC");
      t.assert(/already passed/.test(await txt(t, "#ct-date-msg")), "past message: " + await txt(t, "#ct-date-msg"));
      t.eq(await txt(t, "#ct-days"), "0", "zero days");
    },
  },
  {
    page: "countdown-timer",
    path: "/tools/countdown-timer/#to=2031-12-31T23:59&tz=Europe/London",
    name: "hash is read on load, written on edit, and followed on hashchange",
    async run(t) {
      t.eq(await t.page.eval(`document.querySelector('input[name="ct-mode"][value="date"]').checked`), true, "date mode from hash");
      t.eq([await val(t, "#ct-dd"), await val(t, "#ct-dt"), await val(t, "#ct-dz")], ["2031-12-31", "23:59", "Europe/London"], "fields from hash");
      const { shown, now } = await readCountdown(t);
      t.assert(Math.abs(shown - Math.ceil((Date.UTC(2031, 11, 31, 23, 59) - now) / 1000)) <= 1, "countdown matches");
      await t.page.setValue("#ct-dz", "Asia/Tokyo");
      await t.page.setValue("#ct-dd", "2032-02-03");
      t.eq(await t.page.eval("location.hash"), "#to=2032-02-03T23:59&tz=Asia/Tokyo", "hash written");
      await t.page.eval(`location.hash = "#to=2033-03-04T05:06&tz=America/Argentina/Buenos_Aires"; true`);
      await t.page.waitFor(`document.querySelector("#ct-dd").value === "2033-03-04"`, { timeout: 3000 });
      t.eq([await val(t, "#ct-dt"), await val(t, "#ct-dz")], ["05:06", "America/Argentina/Buenos_Aires"], "hashchange applied");
      await t.page.eval(`location.hash = "#to=2033-03-04T05:06&tz=Not/AZone"; true`);
      await t.page.waitFor(`/not known/.test(document.querySelector("#ct-date-msg").textContent)`, { timeout: 3000 });
      t.eq(await val(t, "#ct-dz"), "local", "unknown zone falls back to local");
      await t.page.eval(`location.hash = "#to=garbage"; true`);
      await t.page.waitFor(`/could not be read/.test(document.querySelector("#ct-date-msg").textContent)`, { timeout: 3000 });
    },
  },
];

/* ------------------------------------------------------------ stopwatch */
const parseCs = (s) => { const m = /^(\d\d):(\d\d):(\d\d)\.(\d\d)$/.exec(s); if (!m) throw new Error("bad time format: " + s); return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 100 + +m[4]; };
const lapRows = (t) => t.page.eval(`[...document.querySelectorAll("#sw-laps tr")].map(r => [...r.children].map(c => c.textContent.trim()))`);
const blur = (t) => t.page.eval(`document.activeElement && document.activeElement.blur(); true`);

const stopwatch = [
  {
    page: "stopwatch",
    name: "runs about 1.2 s, stops, holds the value, resumes and resets",
    async run(t) {
      t.eq(await txt(t, "#sw-display"), "00:00:00.00", "initial");
      await t.page.click("#sw-start");
      t.eq(await txt(t, "#sw-start"), "Stop", "Stop label");
      await sleep(1200);
      await t.page.click("#sw-start");
      const a = parseCs(await txt(t, "#sw-display"));
      t.assert(a >= 110 && a <= 160, "about 1.2 s: " + a / 100);
      await sleep(500);
      t.eq(parseCs(await txt(t, "#sw-display")), a, "frozen while stopped");
      t.eq(await txt(t, "#sw-start"), "Resume", "Resume label");
      await t.page.click("#sw-start");
      await sleep(600);
      await t.page.click("#sw-start");
      const b = parseCs(await txt(t, "#sw-display"));
      t.assert(b - a >= 50 && b - a <= 90, "resumed from the stored time: " + (b - a) / 100);
      await t.page.click("#sw-reset");
      t.eq(await txt(t, "#sw-display"), "00:00:00.00", "reset");
      t.assert(await t.page.eval(`document.querySelector("#sw-reset").disabled && document.querySelector("#sw-lap").disabled`), "buttons disabled after reset");
    },
  },
  {
    page: "stopwatch",
    name: "laps: splits sum to total, fastest and slowest labelled, reset clears",
    async run(t) {
      await t.page.click("#sw-start");
      for (const gap of [200, 700, 450]) { await sleep(gap); await t.page.click("#sw-lap"); }
      await sleep(250);
      await t.page.click("#sw-start");
      const rows = await lapRows(t); // newest first
      t.eq(rows.length, 3, "three laps");
      t.eq(rows.map((r) => r[0]), ["3", "2", "1"], "newest first, numbered");
      const times = rows.map((r) => parseCs(r[1])).reverse();
      const splits = rows.map((r) => parseCs(r[2])).reverse();
      let acc = 0;
      times.forEach((x, i) => { acc += x; t.eq(acc, splits[i], "split " + (i + 1) + " is the running sum of lap times"); });
      const display = parseCs(await txt(t, "#sw-display"));
      t.assert(display >= splits[2] && display - splits[2] <= 60, "last split is within the final display");
      t.assert(times[0] >= 18 && times[0] <= 60 && times[1] >= 65 && times[1] <= 110 && times[2] >= 40 && times[2] <= 80, "lap sizes: " + times);
      t.eq(rows.map((r) => r[3]), ["", "Slowest", "Fastest"], "marks in text");
      t.assert(await t.page.eval(`document.querySelector("#sw-laps tr.is-fastest th").textContent === "1"`), "fastest row class");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await t.page.click("#sw-reset");
      t.eq((await lapRows(t)).length, 0, "laps cleared");
      t.assert(await t.page.eval(`document.querySelector("#sw-lap-box").hidden`), "lap table hidden");
      t.eq(await txt(t, "#sw-display"), "00:00:00.00", "display cleared");
    },
  },
  {
    page: "stopwatch",
    name: "keyboard shortcuts Space, L and R; ignored when a button has focus",
    async run(t) {
      await blur(t);
      await t.page.press(" ");
      t.eq(await t.page.eval(`document.querySelector("#sw-display").dataset.state`), "running", "Space starts");
      await sleep(300);
      await t.page.press("l");
      await sleep(200);
      await t.page.press("L");
      t.eq((await lapRows(t)).length, 2, "L records laps");
      await t.page.press(" ");
      t.eq(await t.page.eval(`document.querySelector("#sw-display").dataset.state`), "stopped", "Space stops");
      t.assert(parseCs(await txt(t, "#sw-display")) >= 45, "time kept");
      await t.page.eval(`document.querySelector("#sw-start").focus(); true`);
      await t.page.press("r");
      t.eq((await lapRows(t)).length, 2, "R ignored while a button has focus");
      await blur(t);
      await t.page.press("r");
      t.eq((await lapRows(t)).length, 0, "R resets");
      t.eq(await txt(t, "#sw-display"), "00:00:00.00", "display zero after R");
      t.assert(/Space/.test(await txt(t, ".sw-keys")), "shortcuts documented on the page");
    },
  },
  {
    page: "stopwatch",
    name: "CSV download matches the lap table; copy button works",
    async run(t) {
      await t.page.click("#sw-start");
      await sleep(250); await t.page.click("#sw-lap");
      await sleep(350); await t.page.click("#sw-lap");
      await t.page.click("#sw-start");
      const rows = (await lapRows(t)).reverse();
      const d = await t.dl("#sw-csv");
      t.eq(d.name, "stopwatch-laps.csv", "file name");
      const lines = d.bytes.toString("utf8").split("\n");
      t.eq(lines[0], "Lap,Lap time,Split time", "header");
      t.eq(lines.slice(1, 3), rows.map((r) => `${r[0]},${r[1]},${r[2]}`), "rows");
      t.eq(lines[3], "", "trailing newline");
      t.assert(/^\d+,\d\d:\d\d:\d\d\.\d\d,\d\d:\d\d:\d\d\.\d\d$/.test(lines[1]), "format");
    },
  },
];

/* ------------------------------------------------------------ text to speech */
const FAKE_TTS = `(() => {
  const voices = [
    { name: "Remote Alpha", lang: "en-GB", localService: false, voiceURI: "r1", default: true },
    { name: "Local Beta", lang: "en-US", localService: true, voiceURI: "l1", default: false },
    { name: "Local Gamma", lang: "de-DE", localService: true, voiceURI: "l2", default: false },
  ];
  class U { constructor(t) { this.text = t; } }
  window.SpeechSynthesisUtterance = U;
  const listeners = {};
  let ready = false, cur = null, timer = 0;
  setTimeout(() => { ready = true; (listeners.voiceschanged || []).forEach((f) => f()); }, 300);
  const fake = {
    speaking: false, pending: false, paused: false,
    getVoices() { return ready ? voices : []; },
    addEventListener(n, f) { (listeners[n] = listeners[n] || []).push(f); },
    speak(u) {
      window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, rate: u.rate, pitch: u.pitch, volume: u.volume });
      fake.speaking = true; cur = u;
      u.onstart && u.onstart({});
      const words = [...u.text.matchAll(/\\S+/g)]; let i = 0;
      timer = setInterval(() => {
        if (fake.paused) return;
        if (i < words.length) { const w = words[i++]; u.onboundary && u.onboundary({ name: "word", charIndex: w.index, charLength: w[0].length }); }
        else { clearInterval(timer); cur = null; fake.speaking = false; u.onend && u.onend({}); }
      }, 25);
    },
    cancel() { clearInterval(timer); if (cur) { const u = cur; cur = null; fake.speaking = false; fake.paused = false; u.onerror && u.onerror({ error: "interrupted" }); } },
    pause() { fake.paused = true; }, resume() { fake.paused = false; },
  };
  Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
  window.__spoken = [];
})();`;
const NO_TTS = `Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });`;
const sentences = (n) => Array.from({ length: n }, (_, i) => `Sentence number ${String(i + 1).padStart(2, "0")} has exactly fifty characters in it.`.slice(0, 50).replace(/.$/, ".")).join(" ");
const vstate = (t) => t.page.eval(`document.querySelector("#tts-voice-status").dataset.state`);
const dis = (t) => t.page.eval(`Object.fromEntries(["play","pause","resume","stop"].map(k => [k, document.querySelector("#tts-" + k).disabled]))`);

const tts = [
  {
    page: "text-to-speech",
    name: "real engine: voices state, character count, chunk plan, button states",
    async run(t) {
      await t.page.waitFor(`["ready", "none"].includes(document.querySelector("#tts-voice-status").dataset.state)`, { timeout: 8000 });
      const st = await vstate(t);
      t.eq(await txt(t, "#tts-count"), "0 characters", "empty count");
      t.eq(await t.page.eval(`document.querySelector("#tts-parts").dataset.parts`), "0", "no parts when empty");
      t.assert((await dis(t)).play, "Play disabled with no text");
      t.eq(await dis(t), { play: true, pause: true, resume: true, stop: true }, "all disabled at rest");
      await t.page.setValue("#tts-text", "Hello.");
      t.eq(await txt(t, "#tts-count"), "6 characters", "count");
      t.eq(await txt(t, "#tts-parts"), "Will be read in 1 part.", "one part");
      const s12 = sentences(12);
      t.eq(s12.length, 12 * 51 - 1, "fixture is 50-character sentences");
      await t.page.setValue("#tts-text", s12);
      t.eq(await txt(t, "#tts-count"), `${s12.length} characters`, "count of long text");
      t.eq(await txt(t, "#tts-parts"), "Will be read in 4 parts.", "12 sentences of 51 characters: 3 per part");
      await t.page.setValue("#tts-text", ("lorem ipsum dolor ").repeat(26)); // 468 characters, no sentence end
      t.eq(await t.page.eval(`document.querySelector("#tts-parts").dataset.parts`), "3", "long run-on text is split at spaces");
      await t.page.setValue("#tts-text", "x".repeat(1000));
      t.eq(await t.page.eval(`document.querySelector("#tts-parts").dataset.parts`), "5", "no spaces: hard split at 200");
      await t.page.setValue("#tts-text", "   \n  ");
      t.eq(await txt(t, "#tts-parts"), "Nothing to read yet.", "whitespace only");
      if (st === "none") {
        t.assert(/No speech voices were found/.test(await txt(t, "#tts-voice-status")), "no-voices message");
        await t.page.setValue("#tts-text", "Hello there.");
        t.assert((await dis(t)).play, "Play stays disabled without voices");
        t.assert(await t.page.eval(`document.querySelector("#tts-voice").disabled`), "voice list disabled");
      } else {
        await t.page.setValue("#tts-text", "Hello there. This is a test of the speech engine.");
        t.assert(!(await dis(t)).play, "Play enabled with voices and text");
        await t.page.click("#tts-play");
        await t.page.waitFor(`speechSynthesis.speaking || speechSynthesis.pending`, { timeout: 4000 });
        t.assert(!(await dis(t)).stop, "Stop enabled while speaking");
        await t.page.click("#tts-stop");
        await t.page.waitFor(`!speechSynthesis.speaking`, { timeout: 3000 });
        t.assert((await dis(t)).stop, "Stop disabled again");
      }
      await t.page.setValue("#tts-text", sentences(9));
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "text-to-speech",
    name: "no speechSynthesis: clear message, everything disabled",
    async run(t) {
      await t.page.send("Page.addScriptToEvaluateOnNewDocument", { source: NO_TTS });
      await t.go();
      t.eq(await vstate(t), "unsupported", "state");
      t.assert(/does not support speech synthesis/.test(await txt(t, "#tts-voice-status")), "message");
      t.eq(await dis(t), { play: true, pause: true, resume: true, stop: true }, "buttons disabled");
      await t.page.setValue("#tts-text", "Typing still works.");
      t.eq(await txt(t, "#tts-count"), "19 characters", "count still works");
      t.assert((await dis(t)).play, "Play still disabled");
      await t.shot("unsupported", 375);
    },
  },
  {
    page: "text-to-speech",
    name: "voices arriving late, grouping, online marks, safe default, online notice",
    async run(t) {
      await t.page.send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_TTS });
      await t.go();
      t.eq(await vstate(t), "loading", "loading first");
      await t.page.waitFor(`document.querySelector("#tts-voice-status").dataset.state === "ready"`, { timeout: 3000 });
      t.eq(await txt(t, "#tts-voice-status"), "3 voices found, 1 of them online.", "status");
      const groups = await t.page.eval(`[...document.querySelectorAll("#tts-voice optgroup")].map(g => [g.label, [...g.children].map(o => o.textContent)])`);
      t.eq(groups.map((g) => g[0]).sort(), ["American English", "British English", "German (Germany)"].sort(), "grouped by language");
      const flat = groups.flatMap((g) => g[1]);
      t.assert(flat.some((s) => s.startsWith("Remote Alpha") && s.endsWith("(online)")), "online voice marked");
      t.assert(flat.filter((s) => s.includes("(online)")).length === 1, "only the online voice is marked");
      const sel = await t.page.eval(`document.querySelector("#tts-voice").selectedOptions[0].textContent`);
      t.assert(!sel.includes("(online)") && sel.startsWith("Local"), "default is an on-device voice (browser default voice is online): " + sel);
      t.assert(await t.page.eval(`document.querySelector("#tts-online").hidden`), "no online notice for a local voice");
      await t.page.eval(`(() => { const s = document.querySelector("#tts-voice"); s.selectedIndex = [...s.options].findIndex(o => o.textContent.startsWith("Remote")); s.dispatchEvent(new Event("change")); return true; })()`);
      t.assert(!(await t.page.eval(`document.querySelector("#tts-online").hidden`)), "online notice shown");
      t.assert(/sent to the browser maker's speech service/.test(await txt(t, "#tts-online")), "notice text");
      await t.shot("voices", 375);
      await t.shot("voices", 1280);
    },
  },
  {
    page: "text-to-speech",
    name: "play speaks every part in order with the chosen settings and highlights words; pause, resume, stop",
    async run(t) {
      await t.page.send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_TTS });
      await t.go();
      await t.page.waitFor(`document.querySelector("#tts-voice-status").dataset.state === "ready"`, { timeout: 3000 });
      const text = sentences(9);
      await t.page.setValue("#tts-text", text);
      await t.page.setValue("#tts-rate", "1.5");
      await t.page.setValue("#tts-pitch", "0.8");
      await t.page.setValue("#tts-vol", "0.5");
      t.eq(await txt(t, "#tts-rate-v"), "1.5x", "rate readout");
      t.eq(await t.page.eval(`document.querySelector("#tts-parts").dataset.parts`), "3", "3 parts");
      await t.page.click("#tts-play");
      t.eq(await dis(t), { play: true, pause: false, resume: true, stop: false }, "states while speaking");
      await t.page.waitFor(`window.__spoken.length >= 1 && document.querySelector("#tts-follow mark") && !document.querySelector("#tts-follow").hidden`, { timeout: 3000 });
      const mark = await t.page.eval(`document.querySelector("#tts-follow mark").textContent`);
      t.assert(mark.length > 0 && text.includes(mark), "a highlighted piece of the text: " + mark);
      await t.page.waitFor(`document.querySelector("#tts-follow mark").textContent !== ${JSON.stringify(mark)}`, { timeout: 3000 });
      // pause
      await t.page.click("#tts-pause");
      t.eq(await t.page.eval(`speechSynthesis.paused`), true, "engine paused");
      t.eq(await dis(t), { play: true, pause: true, resume: false, stop: false }, "states while paused");
      const before = await t.page.eval(`document.querySelector("#tts-follow mark").textContent`);
      await sleep(300);
      t.eq(await t.page.eval(`document.querySelector("#tts-follow mark").textContent`), before, "highlight frozen while paused");
      await t.page.click("#tts-resume");
      t.eq(await t.page.eval(`speechSynthesis.paused`), false, "engine resumed");
      await t.page.waitFor(`document.querySelector("#status").dataset.state === "done"`, { timeout: 8000 });
      t.eq(await txt(t, "#status"), "Finished reading.", "finished message");
      const spoken = await t.page.eval(`window.__spoken`);
      t.eq(spoken.length, 3, "three parts spoken");
      t.eq(spoken.map((s) => s.text).join(""), text, "parts rebuild the text exactly, in order");
      t.assert(spoken.every((s) => s.text.length <= 200), "every part is at most 200 characters");
      t.assert(spoken.every((s) => s.rate === 1.5 && s.pitch === 0.8 && s.volume === 0.5 && s.voice === "Local Beta"), "voice, rate, pitch and volume applied");
      t.eq(await dis(t), { play: false, pause: true, resume: true, stop: true }, "idle again");
      // stop mid-way
      await t.page.click("#tts-play");
      await t.page.waitFor(`speechSynthesis.speaking`, { timeout: 2000 });
      await t.page.click("#tts-stop");
      t.eq(await t.page.eval(`speechSynthesis.speaking`), false, "stopped");
      const n = await t.page.eval(`window.__spoken.length`);
      await sleep(400);
      t.eq(await t.page.eval(`window.__spoken.length`), n, "nothing more is spoken after Stop");
      t.eq(await dis(t), { play: false, pause: true, resume: true, stop: true }, "idle after stop");
      t.assert(await t.page.eval(`document.querySelector("#tts-follow").hidden`), "read-along hidden when idle");
    },
  },
];

export default [...rng, ...picker, ...countdown, ...stopwatch, ...tts];
