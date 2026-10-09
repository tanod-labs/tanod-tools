// Calculators: percentage, unit converter, age, date difference, aspect ratio.
// Expected values are worked out here independently (plain Date.UTC arithmetic, literal constants).
const txt = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent.trim()`;
const val = (sel) => `document.querySelector(${JSON.stringify(sel)}).value`;
const get = (t, sel) => t.page.eval(txt(sel));
const getV = (t, sel) => t.page.eval(val(sel));

const DAY = 86400000;
const utc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY);
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const long = (s) => { const d = new Date(utc(s)); return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
function weekdays(a, n) { let k = 0; for (let i = 0; i < n; i++) { const w = new Date(utc(a) + i * DAY).getUTCDay(); if (w && w !== 6) k++; } return k; }
const todayIn = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function pct(t, row, a, b) {
  await t.page.setValue(`#${row}-a`, a);
  await t.page.setValue(`#${row}-b`, b);
}

export default [
  /* ------------------------------------------------------------ percentage */
  {
    page: "percentage-calculator",
    name: "all five question forms, float noise, zero and bad input",
    async run(t) {
      t.eq(await get(t, "#p1-out"), "Enter both numbers to see the answer.", "empty state");
      await pct(t, "p1", "15", "80");
      t.eq(await get(t, "#p1-out .pc__val"), "12", "15% of 80");
      t.assert((await get(t, "#p1-out .pc__formula")).includes("15 ÷ 100 × 80 = 12"), "formula shown");
      await pct(t, "p1", "10", "3"); // 0.1 * 3 = 0.30000000000000004 in binary floating point
      t.eq(await get(t, "#p1-out .pc__val"), "0.3", "no float noise");
      await pct(t, "p1", "15", "1,000,000");
      t.eq(await get(t, "#p1-out .pc__val"), "150,000", "grouping and comma input");
      await pct(t, "p1", "-20", "50");
      t.eq(await get(t, "#p1-out .pc__val"), "-10", "negative percentage");
      await pct(t, "p1", "abc", "50");
      t.eq(await t.page.eval(`document.querySelector("#p1-a").getAttribute("aria-invalid")`), "true", "bad input flagged");
      t.assert((await get(t, "#p1-out")).includes("numbers only"), "bad input message");

      await pct(t, "p2", "12", "80");
      t.eq(await get(t, "#p2-out .pc__val"), "15%", "12 of 80");
      await pct(t, "p2", "1", "3");
      t.eq(await get(t, "#p2-out .pc__val"), "33.33333333%", "1 of 3 at 10 significant figures");
      await pct(t, "p2", "5", "0");
      t.assert((await get(t, "#p2-out")).includes("can't be 0"), "divide by zero");

      await pct(t, "p3", "12", "15");
      t.eq(await get(t, "#p3-out .pc__val"), "80", "12 is 15% of 80");

      await pct(t, "p4", "80", "100");
      t.eq(await get(t, "#p4-out .pc__val"), "+25%", "increase");
      t.eq(await get(t, "#p4-out .pc__extra"), "increase", "increase word");
      await pct(t, "p4", "100", "80");
      t.eq(await get(t, "#p4-out .pc__val"), "-20%", "decrease");
      await pct(t, "p4", "-50", "-25");
      t.eq(await get(t, "#p4-out .pc__val"), "+50%", "negative base measured by its size");
      await pct(t, "p4", "0", "40");
      t.assert((await get(t, "#p4-out")).includes("change from 0"), "change from zero message");

      await pct(t, "p5", "80", "15");
      t.eq(await get(t, "#p5-out .pc__val"), "92", "increase by 15%");
      await t.page.setValue("#p5-op", "down");
      await pct(t, "p5", "120", "20");
      t.eq(await get(t, "#p5-out .pc__val"), "96", "decrease by 20%");
      t.eq(await get(t, "#p5-out .pc__extra"), "down by 24", "decrease amount");
      await pct(t, "p1", "15", "80");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await t.page.click("#pc-clear");
      t.eq(await getV(t, "#p1-a"), "", "cleared");
    },
  },

  /* ------------------------------------------------------------ units */
  {
    page: "unit-converter",
    name: "exact factors, both directions, swap and significant figures",
    async run(t) {
      t.eq(await getV(t, "#uc-to"), "1.609344", "1 mile in km (default)");
      t.eq(await get(t, '#uc-all td[data-unit="m"]'), "1,609.344", "table: metres");
      t.eq(await get(t, '#uc-all td[data-unit="ft"]'), "5,280", "table: feet");
      await t.page.setValue("#uc-to", "1.609344");
      t.eq(await getV(t, "#uc-from"), "1", "typing in To fills From");
      await t.page.click("#uc-swap");
      t.eq([await getV(t, "#uc-from-u"), await getV(t, "#uc-to-u")], ["km", "mi"], "swapped units");
      await t.page.setValue("#uc-from", "1");
      t.eq(await getV(t, "#uc-to"), "0.6213711922", "1 km in miles to 10 figures");
      await t.page.setValue("#uc-sig", "3");
      t.eq(await getV(t, "#uc-to"), "0.621", "3 significant figures");
      await t.page.setValue("#uc-sig", "10");

      await t.page.click('input[name="uc-cat"][value="volume"]');
      await t.page.setValue("#uc-from", "1");
      t.eq([await getV(t, "#uc-from-u"), await getV(t, "#uc-to-u")], ["gal-us", "L"], "volume defaults");
      t.eq(await getV(t, "#uc-to"), "3.785411784", "US gallon in litres");
      t.eq(await get(t, '#uc-all td[data-unit="gal-uk"]'), "0.8326741846", "US gallon in UK gallons");
      t.eq(await get(t, '#uc-all td[data-unit="floz-us"]'), "128", "US gallon = 128 US fl oz");

      await t.page.click('input[name="uc-cat"][value="area"]');
      await t.page.setValue("#uc-sig", "12");
      t.eq(await getV(t, "#uc-to"), "4046.8564224", "acre in square metres");
      await t.page.setValue("#uc-sig", "10");
      await t.page.setValue("#uc-to-u", "ha");
      t.eq(await getV(t, "#uc-to"), "0.40468564224".slice(0, 12), "acre in hectares (10 figures)");

      await t.page.click('input[name="uc-cat"][value="speed"]');
      await t.page.setValue("#uc-from-u", "kn");
      await t.page.setValue("#uc-to-u", "kmh");
      t.eq(await getV(t, "#uc-to"), "1.852", "knot in km/h");

      await t.page.click('input[name="uc-cat"][value="weight"]');
      await t.page.setValue("#uc-from", "1");
      t.eq(await getV(t, "#uc-to"), "0.45359237", "pound in kg");
      t.eq(await get(t, '#uc-all td[data-unit="oz"]'), "16", "pound in ounces");

      await t.page.click('input[name="uc-cat"][value="temperature"]');
      await t.page.setValue("#uc-from-u", "C");
      await t.page.setValue("#uc-to-u", "F");
      await t.page.setValue("#uc-from", "-40");
      t.eq(await getV(t, "#uc-to"), "-40", "-40 C = -40 F");
      await t.page.setValue("#uc-from", "100");
      t.eq(await getV(t, "#uc-to"), "212", "boiling point");
      t.assert((await get(t, "#uc-formula")).startsWith("°F = °C × 9/5 + 32"), "temperature formula");
      t.eq(await t.page.eval(`document.querySelector("#uc-warn").hidden`), true, "no warning above absolute zero");
      await t.page.setValue("#uc-from-u", "K");
      await t.page.setValue("#uc-to-u", "C");
      await t.page.setValue("#uc-from", "0");
      t.eq(await getV(t, "#uc-to"), "-273.15", "0 K in C");
      await t.page.setValue("#uc-from-u", "F");
      await t.page.setValue("#uc-to-u", "K");
      await t.page.setValue("#uc-from", "-500");
      t.eq(await t.page.eval(`document.querySelector("#uc-warn").hidden`), false, "below absolute zero flagged");
      t.assert((await get(t, "#uc-warn")).includes("below absolute zero"), "warning text");
      t.eq(await getV(t, "#uc-to"), "-22.40555556", "-500 F in K still converted");
      await t.shot("temperature", 375);
      await t.page.setValue("#uc-from", "x1");
      t.eq(await t.page.eval(`document.querySelector("#uc-from").getAttribute("aria-invalid")`), "true", "bad input flagged");
      t.eq(await getV(t, "#uc-to"), "", "no result for bad input");
      await t.page.click('input[name="uc-cat"][value="length"]');
      await t.page.setValue("#uc-from", "1");
      await t.shot("done", 1280);
    },
  },

  /* ------------------------------------------------------------ age */
  {
    page: "age-calculator",
    name: "leap-day birthdays, month ends, totals and future dates (New York time)",
    async run(t) {
      const TZ = "America/New_York";
      await t.page.timezone(TZ);
      await t.go();
      t.eq(await getV(t, "#ag-on"), todayIn(TZ), "Age on defaults to today in the device's zone");
      const age = async (dob, on) => {
        await t.page.setValue("#ag-dob", dob);
        await t.page.setValue("#ag-on", on);
        return get(t, "#ag-main");
      };
      t.eq(await age("2000-02-29", "2023-02-28"), "23 years", "29 Feb birthday counts on 28 Feb in a common year");
      t.eq(await get(t, "#ag-next"), "Today: 23 years old", "birthday today");
      t.eq(await get(t, "#ag-until"), "0", "0 days to go");
      t.eq(await t.page.eval(`document.querySelector("#ag-leap").hidden`), false, "leap-day note");
      t.eq(await age("2000-02-29", "2023-03-01"), "23 years, 1 day", "day after");
      t.eq(await get(t, "#ag-next"), `${long("2024-02-29")} (turns 24)`, "next birthday is 29 Feb 2024");
      t.eq(await get(t, "#ag-until"), String(daysBetween("2023-03-01", "2024-02-29")), "days to next birthday");
      t.eq(await age("2000-02-29", "2024-02-29"), "24 years", "leap year birthday");
      t.eq(await get(t, "#ag-days"), daysBetween("2000-02-29", "2024-02-29").toLocaleString("en-US"), "total days");
      t.eq(await age("1990-01-31", "2024-03-01"), "34 years, 1 month, 1 day", "month-end birth date");
      t.eq(await get(t, "#ag-months"), "409", "total months");
      const days = daysBetween("1990-01-31", "2024-03-01");
      t.eq(await get(t, "#ag-days"), days.toLocaleString("en-US"), "total days 1990-2024");
      t.assert((await get(t, "#ag-weeks")).startsWith(Math.floor(days / 7).toLocaleString("en-US")), "total weeks");
      // a range that crosses the March daylight saving change still counts whole days
      t.eq(await age("2024-03-09", "2024-03-11"), "2 days", "across DST start");
      t.eq(await age("2024-11-02", "2024-11-04"), "2 days", "across DST end");
      await age("1985-06-15", "2026-10-08");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await age("2030-01-01", "2026-10-08");
      const err = await t.waitError();
      t.assert(/after the Age on date/.test(err), "future birth date: " + err);
      t.eq(await t.page.eval(`document.querySelector("#ag-res").hidden`), true, "result hidden on error");
      await t.page.timezone("UTC");
    },
  },

  /* ------------------------------------------------------------ date difference */
  {
    page: "date-difference-calculator",
    name: "days, business days, end-date toggle, DST and adding months",
    async run(t) {
      await t.page.timezone("America/New_York");
      await t.go();
      const diff = async (a, b) => {
        await t.page.setValue("#dd-a", a);
        await t.page.setValue("#dd-b", b);
      };
      await diff("2024-02-01", "2024-03-01");
      t.eq(await get(t, "#dd-days"), "29", "leap February");
      t.eq(await get(t, "#dd-main"), "1 month", "calendar split");
      t.eq(await get(t, "#dd-biz"), String(weekdays("2024-02-01", 29)), "business days");
      await t.page.click("#dd-incl");
      t.eq(await get(t, "#dd-days"), "30", "end date included");
      t.eq(await get(t, "#dd-main"), "1 month, 1 day", "inclusive split");
      t.eq(await get(t, "#dd-biz"), String(weekdays("2024-02-01", 30)), "inclusive business days");
      await diff("2024-03-01", "2024-03-04"); // Friday to Monday
      t.eq(await get(t, "#dd-biz"), "2", "Fri..Mon inclusive = 2 business days");
      await t.page.click("#dd-incl");
      t.eq(await get(t, "#dd-biz"), "1", "Fri..Mon exclusive = 1 business day");
      t.eq(await get(t, "#dd-days"), "3", "Fri..Mon exclusive = 3 days");
      await diff("2024-03-09", "2024-03-11"); // crosses 2024-03-10, the US clock change
      t.eq(await get(t, "#dd-days"), "2", "whole days across DST");
      await diff("2023-01-01", "2024-01-01");
      t.eq(await get(t, "#dd-weeks"), "52 + 1 day", "weeks plus days");
      t.eq(await get(t, "#dd-main"), "1 year", "one year");
      await diff("2024-03-01", "2024-02-01");
      t.eq(await get(t, "#dd-days"), "29", "reversed dates");
      t.assert((await get(t, "#dd-note")).includes("before the start date"), "reversed note");
      await diff("2024-03-10", "2024-03-10");
      await t.page.setValue("#dd-at", "09:30");
      await t.page.setValue("#dd-bt", "17:45");
      t.eq(await get(t, "#dd-main"), "8 hours, 15 minutes", "times on one day");
      t.eq(await get(t, "#dd-hours"), "8.25", "total hours");
      t.eq(await t.page.eval(`document.querySelector("#dd-incl").disabled`), true, "include-end off with times");
      await diff("2024-02-28", "2024-03-01");
      await t.page.setValue("#dd-at", "18:00");
      await t.page.setValue("#dd-bt", "06:00");
      t.eq(await get(t, "#dd-main"), "1 day, 12 hours", "times across midnight");
      await t.page.setValue("#dd-at", "");
      await t.page.setValue("#dd-bt", "");
      await diff("2024-02-01", "2024-12-25");

      const add = async (d, n, unit, op = "add") => {
        await t.page.setValue("#ad-date", d);
        await t.page.click(`input[name="ad-op"][value="${op}"]`);
        await t.page.setValue("#ad-unit", unit);
        await t.page.setValue("#ad-n", String(n));
        return get(t, "#ad-out");
      };
      t.eq(await add("2024-01-31", 1, "months"), long("2024-02-29"), "Jan 31 + 1 month in a leap year");
      t.assert((await get(t, "#ad-note")).includes("31st doesn't exist"), "clamp note");
      t.eq(await add("2023-01-31", 1, "months"), long("2023-02-28"), "Jan 31 + 1 month in a common year");
      t.eq(await add("2024-02-29", 1, "years"), long("2025-02-28"), "29 Feb + 1 year");
      t.eq(await add("2024-03-05", 10, "days", "sub"), long("2024-02-24"), "subtract 10 days across leap day");
      t.eq(await add("2024-03-01", 2, "weeks"), long("2024-03-15"), "add 2 weeks");
      t.eq(await add("2024-03-01", -3, "days"), "-", "negative amount rejected");
      await add("2024-01-31", 1, "months");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await t.page.timezone("UTC");
    },
  },

  /* ------------------------------------------------------------ aspect ratio */
  {
    page: "aspect-ratio-calculator",
    name: "ratio, ultrawide name, resize with and without rounding, bad sizes",
    async run(t) {
      t.eq(await get(t, "#ar-ratio"), "16:9", "1920x1080 default");
      t.eq(await get(t, "#ar-dec"), "1.778:1", "decimal");
      await t.page.setValue("#ar-w", "2560");
      t.eq(await get(t, "#ar-ratio"), "64:27", "2560x1080");
      t.assert((await get(t, "#ar-name")).includes("21:9"), "sold as 21:9");
      await t.page.setValue("#ar-w", "3440");
      await t.page.setValue("#ar-h", "1440");
      t.eq(await get(t, "#ar-ratio"), "43:18", "3440x1440");
      await t.page.setValue("#ar-w", "1366");
      await t.page.setValue("#ar-h", "768");
      t.eq(await get(t, "#ar-ratio"), "683:384", "1366x768 is not exactly 16:9");
      t.assert((await get(t, "#ar-name")).startsWith("Close to 16:9"), "near 16:9");
      await t.page.setValue("#ar-w", "1.5");
      await t.page.setValue("#ar-h", "1");
      t.eq(await get(t, "#ar-ratio"), "3:2", "decimal sides");
      await t.page.setValue("#ar-w", "0");
      t.eq(await get(t, "#ar-ratio"), "-", "zero rejected");
      t.assert((await get(t, "#ar-name")).includes("more than 0"), "zero message");
      await t.page.setValue("#ar-w", "-1920");
      t.eq(await get(t, "#ar-ratio"), "-", "negative rejected");
      await t.page.setValue("#ar-w", "1920");
      await t.page.setValue("#ar-h", "1080");

      t.eq(await getV(t, "#ar-preset"), "16:9", "default preset");
      await t.page.setValue("#ar-nh", "720");
      t.eq(await getV(t, "#ar-nw"), "1280", "16:9 at height 720");
      t.eq(await get(t, "#ar-size"), "1280 × 720", "new size");
      t.assert((await get(t, "#ar-rs-note")).includes("exactly"), "exact note");
      await t.page.setValue("#ar-nw", "1000");
      t.eq(await getV(t, "#ar-nh"), "563", "1000 wide at 16:9 rounds 562.5 up");
      t.assert((await get(t, "#ar-rs-note")).includes("562.5, rounded to 563"), "rounding note");
      await t.page.setValue("#ar-preset", "4:3");
      t.eq(await getV(t, "#ar-nh"), "750", "4:3 at width 1000");
      await t.page.setValue("#ar-rw", "21");
      t.eq(await getV(t, "#ar-preset"), "custom", "editing the ratio switches to custom");
      await t.page.setValue("#ar-w", "2560");
      await t.page.setValue("#ar-preset", "found");
      t.eq([await getV(t, "#ar-rw"), await getV(t, "#ar-rh")], ["64", "27"], "use the found ratio");
      await t.page.setValue("#ar-nw", "-5");
      t.eq(await get(t, "#ar-size"), "-", "negative new width rejected");
      await t.page.setValue("#ar-w", "1920");
      await t.page.setValue("#ar-preset", "16:9");
      await t.page.setValue("#ar-nh", "720");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },

  /* ------------------------------------------------------------ business days */
  {
    page: "business-days-calculator",
    name: "count (both ends, exclusions, weekends, holidays) and add/subtract",
    async run(t) {
      await t.go();
      const set = (sel, v) => t.page.setValue(sel, v);
      const stats = async () => [await get(t, "#bd-main"), await get(t, "#bd-cal"), await get(t, "#bd-wk"), await get(t, "#bd-hd")];
      const range = async (a, b) => { await set("#bd-a", a); await set("#bd-b", b); };
      await range("2024-03-04", "2024-03-08"); // Monday to Friday
      t.eq(await stats(), ["5", "5", "0", "0"], "Mon-Fri counts both ends like NETWORKDAYS");
      await t.page.click("#bd-ins");
      t.eq(await get(t, "#bd-main"), "4", "start date excluded");
      await t.page.click("#bd-ine");
      t.eq(await get(t, "#bd-main"), "3", "both excluded");
      await t.page.click("#bd-ins");
      await t.page.click("#bd-ine");
      await range("2024-03-01", "2024-03-04"); // Friday to Monday
      t.eq(await stats(), ["2", "4", "2", "0"], "Fri..Mon: 2 business, 4 calendar, 2 weekend");
      await set("#bd-hol", "2024-03-04 Monday holiday\n# comment\n2024-03-02\n2024-03-04");
      t.eq(await stats(), ["1", "4", "2", "1"], "holiday on Monday skipped once; Saturday holiday ignored");
      await set("#bd-hol", "");
      await set("#bd-we", "fri-sat");
      t.eq(await stats(), ["2", "4", "2", "0"], "Fri+Sat weekend: Sun and Mon work");
      await set("#bd-we", "sun");
      t.eq(await stats(), ["3", "4", "1", "0"], "Sunday-only weekend");
      await set("#bd-we", "custom");
      t.eq(await get(t, "#bd-main"), "2", "custom defaults to Sat+Sun");
      await t.page.click("#bd-wd input[value='1']");
      t.eq(await stats(), ["1", "4", "3", "0"], "custom: Mon, Sat, Sun off");
      await set("#bd-we", "sat-sun");
      await range("2024-03-04", "2024-03-01"); // end before start
      t.eq(await get(t, "#bd-main"), "2", "reversed dates swap");
      t.assert((await get(t, "#bd-note")).includes("swapped"), "swap noted");
      await range("2024-03-06", "2024-03-06");
      t.eq(await stats(), ["1", "1", "0", "0"], "same day counted once");
      await t.page.click("#bd-ins");
      t.eq(await get(t, "#bd-main"), "0", "same day with start excluded is empty");
      await t.page.click("#bd-ins");
      await range("2024-03-04", "2024-03-");
      t.eq(await t.page.eval(`document.querySelector("#bd-res").hidden`), true, "bad date hides result");
      await range("2024-03-04", "2024-03-08");
      await set("#bd-hol", "2024-13-45");
      t.assert((await get(t, "#status")).includes("YYYY-MM-DD"), "bad holiday line reported");
      await set("#bd-hol", "");
      // add / subtract
      await t.page.click('input[name="bd-mode"][value="add"]');
      await set("#bd-s", "2024-03-01"); // Friday
      await set("#bd-n", "1");
      t.eq(await get(t, "#bd-main"), "Monday, 4 March 2024", "Friday + 1 business day");
      t.eq(await stats().then((s) => s.slice(1)), ["3", "2", "0"], "3 calendar days, 2 weekend days");
      await set("#bd-n", "10");
      t.eq(await get(t, "#bd-main"), "Friday, 15 March 2024", "Friday + 10");
      await set("#bd-n", "0");
      t.eq(await get(t, "#bd-main"), "Friday, 1 March 2024", "+0 returns the start date");
      await set("#bd-s", "2024-03-02"); // Saturday
      await set("#bd-n", "1");
      t.eq(await get(t, "#bd-main"), "Monday, 4 March 2024", "Saturday + 1");
      await t.page.click('input[name="bd-op"][value="sub"]');
      t.eq(await get(t, "#bd-main"), "Friday, 1 March 2024", "Saturday - 1");
      await set("#bd-s", "2024-03-04");
      await set("#bd-hol", "2024-03-01");
      t.eq(await get(t, "#bd-main"), "Thursday, 29 February 2024", "Monday - 1 skipping a Friday holiday and the weekend");
      t.eq(await stats().then((s) => s.slice(1)), ["4", "2", "1"], "4 calendar, 2 weekend, 1 holiday");
      await set("#bd-hol", "");
      await t.page.click('input[name="bd-op"][value="add"]');
      await set("#bd-we", "fri-sat");
      await set("#bd-s", "2024-03-01"); // Friday, a weekend day here
      await set("#bd-n", "1");
      t.eq(await get(t, "#bd-main"), "Sunday, 3 March 2024", "Fri+Sat weekend: next working day is Sunday");
      await set("#bd-n", "1.5");
      t.eq(await t.page.eval(`document.querySelector("#bd-n").getAttribute("aria-invalid")`), "true", "fraction rejected");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
];
