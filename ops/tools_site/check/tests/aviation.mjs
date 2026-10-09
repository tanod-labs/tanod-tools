// Aviation & Space tools. Expected values are literals (published constants, textbook figures, or arithmetic
// written here), never the page's own code. The pure maths is also covered by check/unit/aviation.mjs.
const q = (sel) => JSON.stringify(sel);
const txt = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).textContent.trim()`);
const stat = (t, id, label) => t.page.eval(`(() => { for (const d of document.querySelectorAll(${q("#" + id)} + " > div")) if (d.querySelector("dt").textContent.trim() === ${q(label)}) return d.querySelector("dd").textContent.trim(); return null; })()`);
const set = (t, sel, v) => t.page.setValue(sel, v);

export default [
  {
    page: "metar-taf-decoder",
    name: "decodes a METAR and a TAF with change groups, reports unknown groups, rejects junk",
    async run(t) {
      const out = () => txt(t, "#mt-out");
      let s = await out();
      for (const w of ["KSFO", "From 290° (west-northwest) at 16 kt (30 km/h)", "10 SM (16.1 km)", "Few clouds at 300 ft (91 m)", "16°C (60.8°F)", "13°C (55.4°F)", "1,011.2 hPa (29.86 inHg)", "VFR: ceiling above 3,000 ft"]) t.assert(s.includes(w), `METAR text has ${w}: ${s.slice(0, 400)}`);
      t.assert(s.includes("AO2 SLP112"), "remarks kept as written");
      await set(t, "#mt-in", "TAF AMD KSFO 080300Z 0803/0906 30015KT P6SM FEW005 FM080600 28007KT P6SM FEW004 TEMPO 0900/0902 3SM BR PROB30 0902/0904 1SM FG TX20/0821Z TN12/0913Z");
      s = await out();
      t.eq(await t.page.eval(`document.querySelectorAll(".mt-period").length`), 5, "four periods plus temperature extremes");
      for (const w of ["amended", "Base forecast", "Conditions change", "Temporary fluctuations", "30% probability", "IFR: ceiling 500", "LIFR: ceiling below 500", "Maximum temperature"]) t.assert(s.includes(w), `TAF text has ${w}`);
      await set(t, "#mt-in", "METAR EGLL 081020Z 24012G25KT 9999 +TSRA SCT015CB 12/09 Q1008 ZZZ99 NOSIG RMK TEST");
      s = await out();
      for (const w of ["gusting to 25 kt", "10 km or more", "+TSRA: Rain + thunderstorm"[0], "Rain (heavy, thunderstorm)", "(cumulonimbus)", "1,008 hPa (29.77 inHg)", "ZZZ99", "NOSIG", "TEST"]) t.assert(s.includes(w), `METAR 2 has ${w}: ${s}`);
      await set(t, "#mt-in", "hello world");
      t.assert((await txt(t, "#mt-msg")).includes("4-character station"), "junk message");
      t.eq(await t.page.eval(`document.querySelector("#mt-in").getAttribute("aria-invalid")`), "true", "aria-invalid");
      await set(t, "#mt-in", "METAR LFPG 081000Z 00000KT CAVOK 10/09 Q1020=\nMETAR EDDF 081000Z VRB02KT 8000 BR OVC004 08/08 Q1019=");
      t.eq(await t.page.eval(`document.querySelectorAll(".mt-card").length`), 2, "two reports");
      t.assert((await out()).includes("LIFR: ceiling below 500"), "second report category");
      await t.shot("tafs", 375);
    },
  },
  {
    page: "flight-distance-calculator",
    name: "JFK to LHR is about 5,540 km; coordinates mode; swap; flight time",
    async run(t) {
      await t.page.waitFor(`document.querySelector("#fd-res") && !document.querySelector("#fd-res").hidden`, { timeout: 10000 });
      const m = /^([\d,]+) km · ([\d,]+) NM · ([\d,]+) mi$/.exec(await txt(t, "#fd-main"));
      t.assert(m, "main line " + (await txt(t, "#fd-main")));
      const km = Number(m[1].replace(/,/g, ""));
      t.assert(Math.abs(km - 5540) <= 12, "JFK-LHR km " + km);
      t.assert(Math.abs(Number(m[2].replace(/,/g, "")) - 2991) <= 7, "NM");
      const b = await stat(t, "fd-stats", "Initial bearing");
      t.assert(/^5\d(\.\d)?° \(northeast\)$/.test(b), "initial bearing " + b);
      const ft = await stat(t, "fd-stats", "Flight time at this speed");
      t.assert(/^6 h \d+ min$/.test(ft), "flight time at 450 kt: " + ft);
      t.assert((await txt(t, "#fd-route")).includes("John F. Kennedy"), "route names the airports");
      await t.page.click("#fd-swap");
      t.eq(await t.page.eval(`document.querySelector("#fd-a").value`), "LHR", "swapped");
      await set(t, "#fd-a", "manila");
      t.assert((await t.page.eval(`document.querySelector("#fd-a-pick").textContent`)).includes("Ninoy Aquino"), "name search finds Manila");
      await t.page.click("input[name=fd-mode][value=geo]");
      await set(t, "#fd-lat1", "0"); await set(t, "#fd-lon1", "0"); await set(t, "#fd-lat2", "0"); await set(t, "#fd-lon2", "90");
      t.eq(await txt(t, "#fd-main"), "10,008 km · 5,404 NM · 6,218 mi", "quarter of the equator");
      t.eq(await stat(t, "fd-stats", "Midpoint"), "0° N, 45° E", "midpoint");
      await set(t, "#fd-lat2", "95");
      t.assert((await txt(t, "#fd-msg")).includes("between -90 and 90"), "latitude range message");
      await t.shot("geo", 375);
    },
  },
  {
    page: "crosswind-calculator",
    name: "runway 27 with wind 320 at 18 gusting 26 gives the textbook components for both ends",
    async run(t) {
      const cells = () => t.page.eval(`Array.from(document.querySelectorAll("#cw-rows tr"), (r) => Array.from(r.children, (c) => c.textContent.trim()))`);
      let rows = await cells();
      t.eq(rows.length, 4, "two ends, steady and gust");
      // 50 degrees off: 18 kt -> head 11.6 (cos 50), cross 13.8 (sin 50); 26 kt -> 16.7 and 19.9
      t.eq(rows[0], ["Runway 27", "18 kt", "11.6 kt headwind", "13.8 kt from the right"], "27 steady");
      t.eq(rows[1], ["Runway 27", "gusts 26 kt", "16.7 kt headwind", "19.9 kt from the right"], "27 gust");
      t.eq(rows[2], ["Runway 09", "18 kt", "11.6 kt tailwind", "13.8 kt from the left"], "09 steady");
      await set(t, "#cw-rwy", "275"); await set(t, "#cw-dir", "275"); await set(t, "#cw-gust", "");
      rows = await cells();
      t.eq(rows[0].slice(2), ["18 kt headwind", "none"], "directly on the nose");
      await set(t, "#cw-unit", "kmh");
      t.assert((await cells())[0][1].includes("km/h"), "unit label");
      await set(t, "#cw-rwy", "40");
      t.assert((await txt(t, "#cw-msg")).includes("01 to 36"), "runway message");
      await t.shot("cw", 375);
    },
  },
  {
    page: "density-altitude-calculator",
    name: "ISA at sea level gives 0 ft; hot high airport; inHg and Fahrenheit inputs",
    async run(t) {
      await set(t, "#da-elev", "0"); await set(t, "#da-qnh", "1013.25"); await set(t, "#da-oat", "15");
      t.eq(await txt(t, "#da-main"), "0 ft (0 m)", "standard day");
      t.eq(await stat(t, "da-stats", "Pressure altitude"), "0 ft (0 m)", "PA");
      t.eq(await stat(t, "da-stats", "ISA temperature at that altitude"), "15°C (59°F)", "ISA temperature");
      t.eq(await stat(t, "da-stats", "Air density"), "1.225 kg/m³", "ISA density");
      await set(t, "#da-oat", "30"); // +15 above ISA -> about +1,800 ft
      const da = Number((await txt(t, "#da-main")).replace(/,/g, "").match(/^(-?\d+) ft/)[1]);
      t.assert(Math.abs(da - 1800) <= 80, "30 C at sea level " + da);
      await set(t, "#da-elev", "5000"); await set(t, "#da-qnh", "1013.25"); await set(t, "#da-oat", "5.1");  // ISA at 5,000 ft is 5.1 C
      t.assert(/^5,\d{3} ft/.test(await stat(t, "da-stats", "Pressure altitude")), "PA 5,000 ft");
      t.eq(await set(t, "#da-qnh-u", "inhg") ?? true, true, "switch pressure unit");
      t.assert(/^29\.92/.test(await t.page.eval(`document.querySelector("#da-qnh").value`)), "QNH converted to inHg: " + await t.page.eval(`document.querySelector("#da-qnh").value`));
      await set(t, "#da-oat-u", "f");
      t.assert(/^41/.test(await t.page.eval(`document.querySelector("#da-oat").value`)), "5.1 C is 41.2 F");
      await set(t, "#da-qnh", "2");
      t.assert((await txt(t, "#da-msg")).includes("850 and 1,100"), "range message");
      await t.shot("da", 375);
    },
  },
  {
    page: "aviation-unit-converter",
    name: "knots, hPa/inHg, feet/metres/NM and temperature",
    async run(t) {
      await set(t, "#ac-from", "100");
      t.eq(await t.page.eval(`document.querySelector("#ac-to").value`), "185.2", "100 kt in km/h");
      await set(t, "#ac-to-u", "mph");
      t.eq(await t.page.eval(`document.querySelector("#ac-to").value`), "115.07794", "100 kt in mph");
      await t.page.click("input[name=ac-cat][value=pressure]");
      await set(t, "#ac-from", "1013.25");
      t.eq(await t.page.eval(`document.querySelector("#ac-to").value`), "29.921256", "standard pressure in inHg");
      await t.page.click("input[name=ac-cat][value=length]");
      await set(t, "#ac-from", "10000");
      t.eq(await t.page.eval(`document.querySelector("#ac-to").value`), "3,048", "10,000 ft in m");
      await set(t, "#ac-to-u", "nm");
      await set(t, "#ac-from-u", "km"); await set(t, "#ac-from", "1.852");
      t.eq(await t.page.eval(`document.querySelector("#ac-to").value`), "1", "1.852 km is 1 NM");
      await t.page.click("input[name=ac-cat][value=temperature]");
      await set(t, "#ac-from", "-40");
      t.eq(await t.page.eval(`document.querySelector("#ac-to").value`), "-40", "-40 C is -40 F");
      await set(t, "#ac-from", "-300");
      t.assert(!(await t.page.eval(`document.querySelector("#ac-warn").hidden`)), "below absolute zero warns");
      t.eq(await t.page.eval(`document.querySelectorAll("#ac-all tr").length`), 3, "table rows");
      await t.shot("ac", 375);
    },
  },
  {
    page: "zulu-time-converter",
    name: "local to UTC, DDHHMMZ group, time group parsing",
    async run(t) {
      await t.page.timezone("Asia/Manila");
      await t.go();
      await set(t, "#zt-date", "2026-10-08"); await set(t, "#zt-time", "22:05");
      t.eq(await stat(t, "zt-stats", "Zulu (UTC)"), "2026-10-08 14:05 Z", "Manila is UTC+8");
      t.eq(await stat(t, "zt-stats", "Time group"), "081405Z", "time group");
      await set(t, "#zt-from", "America/New_York"); await set(t, "#zt-time", "09:30");
      t.eq(await stat(t, "zt-stats", "Zulu (UTC)"), "2026-10-08 13:30 Z", "New York in October is UTC-4");
      await set(t, "#zt-date", "2026-03-08"); await set(t, "#zt-time", "02:30");
      t.assert(!(await t.page.eval(`document.querySelector("#zt-note").hidden`)), "the spring-forward gap is reported");
      await set(t, "#zt-date", "2026-11-01"); await set(t, "#zt-time", "01:30");
      t.assert((await txt(t, "#zt-note")).includes("twice"), "the fall-back overlap is reported");
      await set(t, "#zt-ref", "2026-10-30"); await set(t, "#zt-grp", "010100Z");
      t.eq(await stat(t, "zt-grp-stats", "Zulu (UTC)"), "2026-11-01 01:00 Z", "nearest 1st of the month to 30 Oct");
      await set(t, "#zt-grp", "322400Z");
      t.assert((await txt(t, "#zt-grp-msg")).includes("DDHHMM"), "bad group message");
      await t.shot("zt", 375);
    },
  },
  {
    page: "sunrise-sunset-calculator",
    name: "Manila 2026-10-08 matches the JPL DE421 reference times; polar day; invalid input",
    async run(t) {
      await set(t, "#ss-lat", "14.5995"); await set(t, "#ss-lon", "120.9842"); await set(t, "#ss-tz", "Asia/Manila"); await set(t, "#ss-date", "2026-10-08");
      // DE421: sunrise 21:46:21Z (05:46 local), sunset 09:40:51Z (17:40 local); solar noon 03:43:35Z (11:43)
      const near = (s, hh, mm, tol = 1) => { const [h, m] = s.split(":").map(Number); return Math.abs(h * 60 + m - (hh * 60 + mm)) <= tol; };
      t.assert(near(await stat(t, "ss-sun", "Sunrise"), 5, 46), "sunrise " + await stat(t, "ss-sun", "Sunrise"));
      t.assert(near(await stat(t, "ss-sun", "Sunset"), 17, 41), "sunset " + await stat(t, "ss-sun", "Sunset"));
      t.assert(near((await stat(t, "ss-sun", "Solar noon")).slice(0, 5), 11, 44), "solar noon");
      t.assert(near(await stat(t, "ss-sun", "Civil twilight begins"), 5, 24, 2), "civil dawn");
      t.assert(/^11 h 5\d min$/.test(await txt(t, "#ss-main")), "day length " + await txt(t, "#ss-main"));
      t.assert((await stat(t, "ss-moon", "Phase at midday")).includes("Waning crescent"), "moon phase");
      t.assert(/^[4-8] %$/.test(await stat(t, "ss-moon", "Illuminated")), "illumination about 5.3%");
      await set(t, "#ss-lat", "69.65"); await set(t, "#ss-lon", "18.96"); await set(t, "#ss-tz", "Europe/Oslo"); await set(t, "#ss-date", "2026-06-21");
      t.eq(await stat(t, "ss-sun", "Sunrise"), "does not occur on this date", "midnight sun");
      t.eq(await txt(t, "#ss-main"), "24 h (polar day)", "polar day");
      await set(t, "#ss-lat", "91");
      t.assert((await txt(t, "#ss-msg")).includes("between -90 and 90"), "range message");
      await t.shot("ss", 375);
    },
  },
  {
    page: "moon-phase-calendar",
    name: "October 2026: full moon on the 26th, new moon on the 10th; grid shape",
    async run(t) {
      await set(t, "#mc-tz", "UTC"); await set(t, "#mc-month", "10"); await set(t, "#mc-year", "2026");
      t.eq(await txt(t, "#mc-title"), "October 2026", "title");
      t.eq(await t.page.eval(`document.querySelectorAll("#mc-body td:not(.mc__empty)").length`), 31, "31 days");
      t.eq(await t.page.eval(`document.querySelectorAll("#mc-body tr").length`), 5, "five weeks (Sunday first)");
      // 1 October 2026 is a Thursday: four empty cells before it
      t.eq(await t.page.eval(`document.querySelectorAll("#mc-body tr:first-child td.mc__empty").length`), 4, "leading blanks");
      const ph = await t.page.eval(`Array.from(document.querySelectorAll("#mc-phases > div"), (d) => [d.querySelector("dt").textContent.trim(), d.querySelector("dd").textContent.trim()])`);
      const names = ph.map((p) => p[0].replace(/^\S+\s/, ""));
      t.eq(names, ["Last quarter", "New moon", "First quarter", "Full moon"], "order of the principal phases in October 2026");
      t.assert(ph[3][1].includes("26") && /04:\d\d|03:\d\d|05:\d\d/.test(ph[3][1]), "full moon on 26 Oct around 04:12 UTC: " + ph[3][1]);
      t.assert(ph[1][1].includes("10") || ph[1][1].includes("9"), "new moon about the 10th: " + ph[1][1]);
      t.assert((await t.page.eval(`document.querySelector("#mc-body td.mc__key").textContent`)).length > 0, "highlighted key days");
      await t.page.click("#mc-next");
      t.eq(await txt(t, "#mc-title"), "November 2026", "next month");
      await set(t, "#mc-year", "abc");
      t.assert((await txt(t, "#mc-msg")).includes("year"), "year message");
      await t.shot("mc", 375);
    },
  },
  {
    page: "aurora-visibility-estimator",
    name: "Fairbanks overhead at Kp 4, London on the horizon, Rome unlikely",
    async run(t) {
      const main = () => txt(t, "#ao-main");
      t.eq(await main(), "Possible overhead", "Fairbanks at Kp 4");
      const g = await stat(t, "ao-stats", "Geomagnetic latitude");
      t.assert(Math.abs(parseFloat(g) - 65.4) <= 1.2, "Fairbanks geomagnetic latitude " + g);
      t.eq(await stat(t, "ao-stats", "Oval edge at Kp 4"), "58.5°", "oval edge");
      await set(t, "#ao-lat", "51.5"); await set(t, "#ao-lon", "-0.12");
      t.eq(await main(), "Possible low on the horizon", "London at Kp 4");
      await set(t, "#ao-kp", "7");
      t.eq(await main(), "Possible overhead", "London at Kp 7");
      await set(t, "#ao-lat", "41.9"); await set(t, "#ao-lon", "12.5"); await set(t, "#ao-kp", "4");
      t.eq(await main(), "Unlikely", "Rome at Kp 4");
      t.eq(await t.page.eval(`document.querySelectorAll("#ao-table tr").length`), 10, "table of Kp 0 to 9");
      t.assert(await t.page.eval(`!!document.querySelector('.below a[href="https://tanod.dev/learn/space-weather-kp-index-aurora-api.html"]') && !!document.querySelector('a[href="/learn/space-weather-kp-index-aurora-api.html"]')`), "links the live data guide, in the tool and in the Automate block");
      await set(t, "#ao-kp", "12");
      t.assert((await txt(t, "#ao-msg")).includes("0 to 9"), "Kp range message");
      await t.shot("ao", 375);
    },
  },
  {
    page: "julian-date-converter",
    name: "J2000, MJD, GPS week rollover and carrying a value between modes",
    async run(t) {
      await set(t, "#jd-date", "2000-01-01"); await set(t, "#jd-time", "12:00:00");
      t.eq(await stat(t, "jd-stats", "Julian date"), "2451545.000000", "J2000.0");
      t.eq(await stat(t, "jd-stats", "Modified Julian date"), "51544.500000", "MJD");
      t.eq(await stat(t, "jd-stats", "Unix time (seconds)"), "946728000.000", "Unix time");
      t.eq(await stat(t, "jd-stats", "Day of the year"), "1", "day of year");
      t.eq(await stat(t, "jd-stats", "GPS week (full count)"), "1042", "GPS week at J2000");
      await set(t, "#jd-date", "2019-04-06"); await set(t, "#jd-time", "23:59:42");
      t.eq(await stat(t, "jd-stats", "GPS week (full count)"), "2048", "second rollover");
      t.eq(await stat(t, "jd-stats", "GPS week (10-bit, as broadcast)"), "0 (rollover 2)", "10-bit week");
      await t.page.click("input[name=jd-mode][value=jd]");
      t.eq(await t.page.eval(`document.querySelector("#jd-jd").value`), "2458580.499792", "value carried over to the JD box");
      await set(t, "#jd-jd", "2460000.5");
      t.eq(await stat(t, "jd-stats", "Date and time (UTC)"), "2023-02-25 00:00:00", "JD 2460000.5");
      await t.page.click("input[name=jd-mode][value=gps]");
      await set(t, "#jd-week", "2048"); await set(t, "#jd-sow", "0");
      t.eq(await stat(t, "jd-stats", "Date and time (UTC)"), "2019-04-06 23:59:42", "GPS week 2048 sow 0");
      await set(t, "#jd-week", "1.5");
      t.assert((await txt(t, "#jd-msg")).includes("whole number"), "week message");
      await t.shot("jd", 375);
    },
  },
  {
    page: "light-time-calculator",
    name: "Moon 1.282 s, Sun 8 min 19 s, custom distance",
    async run(t) {
      t.eq(await txt(t, "#lt-main"), "1.282 s", "Moon mean");
      await set(t, "#lt-body", "sun");
      t.eq(await txt(t, "#lt-main"), "8 min 19 s", "Sun mean");
      await set(t, "#lt-body", "mars"); await set(t, "#lt-kind", "near");
      // |1.52366 - 1| AU = 78.3 million km -> 261 s = 4 min 21 s
      t.eq(await txt(t, "#lt-main"), "4 min 21 s", "Mars closest (circular approximation)");
      await set(t, "#lt-body", "custom"); await set(t, "#lt-unit", "au"); await set(t, "#lt-dist", "1");
      t.eq(await txt(t, "#lt-main"), "8 min 19 s", "1 AU");
      t.eq(await stat(t, "lt-stats", "Round trip"), "16 min 38 s", "round trip");
      await set(t, "#lt-dist", "-3");
      t.assert((await txt(t, "#lt-msg")).includes("0 or more"), "negative distance message");
      t.eq(await t.page.eval(`document.querySelectorAll("#lt-table tr").length`), 11, "table rows");
      await t.shot("lt", 375);
    },
  },
  {
    page: "orbital-period-calculator",
    name: "ISS 420 km is 93 min at 7.66 km/s; GEO at 35,786 km is a sidereal day; period to altitude",
    async run(t) {
      t.eq(await txt(t, "#ob-main"), "1 h 33 min", "ISS period");
      t.assert(/^92\.[89]\d?$/.test(await stat(t, "ob-stats", "Period in minutes")), "ISS minutes " + await stat(t, "ob-stats", "Period in minutes"));
      t.assert((await stat(t, "ob-stats", "Orbital speed")).startsWith("7.657 km/s"), "ISS speed (7.66 km/s)");
      await set(t, "#ob-preset", "35786");
      t.eq(await txt(t, "#ob-main"), "23 h 56 min", "GEO period");
      t.assert((await txt(t, "#ob-info")).includes("geostationary"), "GEO hint");
      await t.page.click("input[name=ob-mode][value=per]");
      await set(t, "#ob-per-u", "s"); await set(t, "#ob-per", "86164.0905");
      t.assert(/^35,78[5-7] km/.test(await txt(t, "#ob-main")), "GEO altitude from the sidereal day " + await txt(t, "#ob-main"));
      await set(t, "#ob-per-u", "min"); await set(t, "#ob-per", "60");
      t.assert((await txt(t, "#ob-msg")).includes("at least"), "too short a period");
      await t.page.click("input[name=ob-mode][value=alt]");
      await set(t, "#ob-alt", "100");
      t.assert((await txt(t, "#ob-info")).includes("160 km"), "low-orbit warning");
      await t.shot("ob", 375);
    },
  },
];
