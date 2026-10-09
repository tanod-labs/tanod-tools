// Eight tools: invisible character detector, extract emails and URLs, number to words, loan calculator,
// compound interest calculator, markdown table generator, HTML entity encoder and decoder, word frequency counter.
// The maths and text logic is covered by check/unit/tools4.mjs; these tests drive the real pages.
const q = JSON.stringify;
const txt = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).textContent.trim()`);
const val = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).value`);
const hidden = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).hidden`);
const S = String.fromCodePoint;
const tags = (s) => Array.from(s, (c) => S(0xe0000 + c.charCodeAt(0))).join("");

export default [
  {
    page: "invisible-character-detector",
    name: "finds zero-width, bidi, tag and lookalike words; decodes hidden text; keeps flags and family emoji; cleans",
    async run(t) {
      const flag = "\u{1F3F4}" + tags("gbeng") + S(0xe007f);
      const family = S(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
      const text = "Hi" + S(0x200b) + " pay p" + S(0x430) + "ypal" + tags("secret") + " x" + S(0x202e) + "y " + flag + family + " end";
      await t.page.setValue("#ic-in", text);
      t.eq(await txt(t, "#ic-n-zero-width"), "1", "one zero-width (the family ZWJ is not counted)");
      t.eq(await txt(t, "#ic-n-bidi"), "1", "one bidi control");
      t.eq(await txt(t, "#ic-n-tag"), "6", "six tag characters (the England flag is not counted)");
      t.eq(await txt(t, "#ic-n-mixed"), "1", "one mixed-script word");
      t.eq(await hidden(t, "#ic-decoded"), false, "decoded box shown");
      t.eq(await txt(t, "#ic-dec-list q"), "secret", "hidden ASCII decoded");
      t.eq(await t.page.eval(`document.querySelectorAll("#ic-rows tr").length`), 4, "four findings");
      t.assert((await txt(t, "#ic-rows")).includes("U+200B"), "code point shown");
      t.assert((await txt(t, "#ic-report")).startsWith("4 items to check"), "report: " + await txt(t, "#ic-report"));
      const cleaned = await val(t, "#ic-clean");
      t.eq(cleaned, "Hi pay p" + S(0x430) + "ypal xy " + flag + family + " end", "cleaned text keeps flag, family and the lookalike word");
      t.eq(await t.page.eval(`document.querySelectorAll("#ic-view .ic-chip").length`), 3, "three chips (zero-width, tag run, bidi)");
      t.eq(await t.page.eval(`document.querySelectorAll("#ic-view .ic-mixed").length`), 1, "one highlighted word");
      await t.page.setValue("#ic-in", "plain text");
      t.eq(await hidden(t, "#ic-out"), true, "nothing hidden: results hidden");
      t.assert((await txt(t, "#ic-report")).startsWith("Nothing hidden"), "clean report");
      await t.page.click("#ic-example");
      t.eq(await hidden(t, "#ic-decoded"), false, "example has hidden text");
      t.assert((await txt(t, "#ic-dec-list q")).includes("evil.example"), "example decoded");
      await t.page.setValue("#ic-in", "");
      t.eq(await hidden(t, "#ic-out"), true, "empty input hides results");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "extract-emails-and-urls",
    name: "six lists, dedupe, sort, counts and CSV download",
    async run(t) {
      await t.page.setValue("#ex-in", "Mail Bob@x.com, bob@x.com and a.b@y.org. See https://x.com/p?q=1. and www.y.org, 10.0.0.1 and 10.0.0.1. Call +1 (555) 123-4567. #One #one #Two");
      t.eq(await val(t, "#ex-out-emails"), "Bob@x.com\na.b@y.org", "emails deduplicated ignoring case");
      t.eq(await val(t, "#ex-out-urls"), "https://x.com/p?q=1\nwww.y.org", "urls trimmed");
      t.eq(await val(t, "#ex-out-domains"), "x.com\ny.org", "domains");
      t.eq(await val(t, "#ex-out-ips"), "10.0.0.1", "ips deduplicated");
      t.eq(await val(t, "#ex-out-phones"), "+1 (555) 123-4567", "phone");
      t.eq(await val(t, "#ex-out-hashtags"), "#One\n#Two", "hashtags");
      t.assert((await txt(t, "#ex-h-emails")).includes("2 different, 3 found"), "heading counts: " + await txt(t, "#ex-h-emails"));
      await t.page.click("#ex-unique");
      t.eq(await val(t, "#ex-out-ips"), "10.0.0.1\n10.0.0.1", "dedupe off");
      await t.page.click("#ex-unique");
      await t.page.setValue("#ex-sort", "az");
      t.eq(await val(t, "#ex-out-emails"), "Bob@x.com\na.b@y.org", "A to Z (code point order)");
      await t.page.setValue("#ex-sort", "count");
      t.eq(await val(t, "#ex-out-emails"), "Bob@x.com\na.b@y.org", "by count");
      const dl = await t.dl("#ex-lists .ex-card:nth-child(1) .btn:nth-child(3)");
      t.eq(dl.name, "emails.csv", "csv name");
      const csv = Buffer.from(dl.bytes).toString("utf8").replace(/^﻿/, "");
      t.eq(csv, "value,count\r\nBob@x.com,2\r\na.b@y.org,1\r\n", "csv content");
      await t.page.click("#ex-clear");
      t.eq(await val(t, "#ex-out-emails"), "", "cleared");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "number-to-words",
    name: "cardinal, British and, ordinal, currency, cheque style, case and huge numbers",
    async run(t) {
      const main = () => txt(t, "#nw-main");
      const set = (v) => t.page.setValue("#nw-in", v);
      t.eq(await main(), "One thousand two hundred thirty-four point five six", "default 1234.56");
      await set("0");
      t.eq(await main(), "Zero", "zero");
      await set("1000000000000000");
      t.eq(await main(), "One quadrillion", "10^15");
      await set("9007199254740993");
      t.assert((await main()).endsWith("ninety-three"), "beyond 2^53 exact: " + await main());
      await set("105");
      await t.page.click("#nw-and");
      t.eq(await main(), "One hundred and five", "British and");
      await t.page.click("#nw-and");
      await t.page.setValue("#nw-case", "title");
      await set("42");
      t.eq(await main(), "Forty-Two", "title case");
      await t.page.setValue("#nw-case", "upper");
      t.eq(await main(), "FORTY-TWO", "upper case");
      await t.page.setValue("#nw-case", "lower");
      await t.page.click('input[name="nw-mode"][value="ordinal"]');
      await set("21");
      t.eq(await main(), "twenty-first", "ordinal");
      await set("112");
      t.eq(await main(), "one hundred twelfth", "ordinal 112");
      await set("1.5");
      t.eq(await t.page.eval(`document.querySelector("#nw-in").getAttribute("aria-invalid")`), "true", "ordinal needs a whole number");
      t.eq(await hidden(t, "#nw-res"), true, "result hidden on error");
      await t.page.click('input[name="nw-mode"][value="currency"]');
      await t.page.setValue("#nw-case", "sentence");
      await set("1,234.56");
      t.eq(await main(), "One thousand two hundred thirty-four dollars and fifty-six cents", "USD");
      await t.page.setValue("#nw-cents", "fraction");
      t.eq(await main(), "One thousand two hundred thirty-four dollars and 56/100", "cheque style");
      await t.page.setValue("#nw-cur", "GBP");
      await set("1.01");
      await t.page.setValue("#nw-cents", "words");
      t.eq(await main(), "One pound and one penny", "GBP");
      await t.page.setValue("#nw-cur", "JPY");
      await set("500");
      t.eq(await main(), "Five hundred yen", "JPY");
      t.eq(await hidden(t, "#nw-cents-f"), true, "no cents choice for yen");
      await t.page.setValue("#nw-cur", "USD");
      await set("1.239");
      t.eq(await main(), "One dollar and twenty-four cents", "rounded");
      t.assert((await txt(t, "#nw-note")).startsWith("Rounded to 1.24 USD"), "rounding noted: " + await txt(t, "#nw-note"));
      await set("1" + "0".repeat(36));
      t.eq(await t.page.eval(`document.querySelector("#nw-in").getAttribute("aria-invalid")`), "true", "too large");
      await set("abc");
      t.eq(await hidden(t, "#nw-res"), true, "not a number");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "loan-calculator",
    name: "250k at 6.5% for 30 years = 1,580.17; 0% loan; extra payment; CSV schedule",
    async run(t) {
      t.eq(await txt(t, "#ln-main"), "1,580.17", "monthly payment");
      t.eq(await txt(t, "#ln-n"), "360", "payments");
      t.eq(await t.page.eval(`document.querySelectorAll("#ln-rows tr").length`), 360, "schedule rows");
      t.eq(await t.page.eval(`document.querySelector("#ln-rows tr:last-child td:last-child").textContent`), "0.00", "ends at zero");
      t.eq(await t.page.eval(`document.querySelector("#ln-rows tr:first-child").textContent`), "11,580.17226.001,354.17249,774.00", "first row");
      const paid = Number((await txt(t, "#ln-paid")).replace(/,/g, "")), interest = Number((await txt(t, "#ln-int")).replace(/,/g, ""));
      t.assert(Math.abs(paid - interest - 250000) < 0.005, "paid - interest = principal");
      await t.page.setValue("#ln-p", "12000");
      await t.page.setValue("#ln-r", "0");
      await t.page.setValue("#ln-t", "12");
      await t.page.setValue("#ln-u", "months");
      t.eq(await txt(t, "#ln-main"), "1,000.00", "0% payment");
      t.eq(await txt(t, "#ln-int"), "0.00", "0% interest");
      await t.page.setValue("#ln-r", "12");
      await t.page.setValue("#ln-x", "500");
      t.assert(Number(await txt(t, "#ln-n")) < 12, "extra payment shortens the loan");
      t.assert((await txt(t, "#ln-note")).includes("you save"), "savings noted");
      await t.page.setValue("#ln-x", "");
      const dl = await t.dl("#ln-csv");
      t.eq(dl.name, "loan-schedule.csv", "csv name");
      const lines = Buffer.from(dl.bytes).toString("utf8").replace(/^﻿/, "").split("\r\n");
      t.eq(lines[0], "payment_number,payment,principal,interest,remaining_balance", "csv header");
      t.eq(lines.length, 14, "header + 12 rows + trailing break");
      await t.page.setValue("#ln-p", "-5");
      t.eq(await hidden(t, "#ln-res"), true, "bad amount hides the result");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "compound-interest-calculator",
    name: "10,000 at 5% for 10 years: yearly 16,288.95, monthly 16,470.09, daily 16,486.65, with contributions",
    async run(t) {
      t.eq(await txt(t, "#ci-main"), "16,470.09", "monthly compounding default");
      t.eq(await txt(t, "#ci-dep"), "10,000.00", "contributions = principal");
      t.eq(await txt(t, "#ci-int"), "6,470.09", "interest");
      t.eq(await txt(t, "#ci-ear"), "5.12%", "effective annual rate");
      t.eq(await t.page.eval(`document.querySelectorAll("#ci-rows tr").length`), 10, "ten rows");
      await t.page.setValue("#ci-f", "annually");
      t.eq(await txt(t, "#ci-main"), "16,288.95", "yearly");
      await t.page.setValue("#ci-f", "daily");
      t.eq(await txt(t, "#ci-main"), "16,486.65", "daily");
      await t.page.setValue("#ci-f", "continuous");
      t.eq(await txt(t, "#ci-main"), "16,487.21", "continuous");
      await t.page.setValue("#ci-f", "monthly");
      await t.page.setValue("#ci-m", "100");
      t.eq(await txt(t, "#ci-main"), "31,998.32", "with 100 a month");
      t.eq(await txt(t, "#ci-dep"), "22,000.00", "contributions total");
      t.eq(await t.page.eval(`document.querySelector("#ci-rows tr:last-child td:last-child").textContent`), "31,998.32", "last row balance");
      await t.page.setValue("#ci-t", "start");
      t.assert(Number((await txt(t, "#ci-main")).replace(/,/g, "")) > 31998.32, "contributions at the start earn more");
      await t.page.setValue("#ci-y", "0");
      t.eq(await hidden(t, "#ci-res"), true, "zero years rejected");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "markdown-table-generator",
    name: "grid to Markdown, alignment, add and remove, spreadsheet paste, CSV and Markdown import",
    async run(t) {
      const out = () => val(t, "#mt-out");
      t.eq(await out(), "| Item   | Qty | Price |\n| :----- | --: | ----: |\n| Apples |   3 |  1.50 |\n| Pears  |  12 |  0.80 |", "initial table");
      await t.page.setValue('#mt-grid input[data-r="1"][data-c="0"]', "Fig | dried");
      t.assert((await out()).includes("| Fig \\| dried |"), "pipe escaped");
      await t.page.setValue("#mt-grid tr.is-ctl td:nth-child(1) select", "center");
      t.assert((await out()).split("\n")[1].startsWith("| :"), "alignment changed");
      await t.page.click("#mt-add-col");
      t.eq(await t.page.eval(`document.querySelectorAll("#mt-grid tr.is-head input").length`), 4, "column added");
      await t.page.click("#mt-add-row");
      t.eq(await t.page.eval(`document.querySelectorAll("#mt-grid tr").length`), 5, "row added (control row + header + 3)");
      await t.page.click('#mt-grid button[aria-label="Remove column 4"]');
      t.eq(await t.page.eval(`document.querySelectorAll("#mt-grid tr.is-head input").length`), 3, "column removed");
      await t.page.click('#mt-grid button[aria-label="Remove row 3"]');
      t.eq(await t.page.eval(`document.querySelectorAll("#mt-grid tr").length`), 4, "row removed");
      // spreadsheet paste into a cell
      await t.page.eval(`(() => { const i = document.querySelector('#mt-grid input[data-r="0"][data-c="0"]'); i.focus();
        const dt = new DataTransfer(); dt.setData("text", "A\\tB\\n1\\t2\\n3\\t4\\n");
        i.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
      t.assert((await out()).startsWith("|  A  |   B | Price |"), "pasted cells fill the grid: " + await out());
      t.assert((await out()).includes("|  1  |   2 |"), "second pasted row");
      // CSV import
      await t.page.setValue("#mt-paste", 'Name,Note\n"Smith, J",ok\nLee,"two\nlines"');
      await t.page.click("#mt-import");
      t.eq(await out(), "| Name     | Note         |\n| -------- | ------------ |\n| Smith, J | ok           |\n| Lee      | two<br>lines |", "CSV import with quotes and a line break");
      await t.page.click("#mt-pad");
      t.eq(await out(), "| Name | Note |\n| --- | --- |\n| Smith, J | ok |\n| Lee | two<br>lines |", "compact form");
      await t.page.click("#mt-pad");
      // Markdown import with alignments
      await t.page.setValue("#mt-paste", "| a | b |\n| :-- | --: |\n| 1 | 2 |");
      await t.page.click("#mt-import");
      t.eq(await out(), "| a   |   b |\n| :-- | --: |\n| 1   |   2 |", "markdown import keeps alignments");
      await t.page.click("#mt-clear");
      t.eq(await t.page.eval(`document.querySelectorAll("#mt-grid tr").length`), 3, "cleared to a small grid");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "html-entity-encoder-decoder",
    name: "encode (unsafe, named, numeric, hex, all) and decode (named, numeric, browser-resolved names, unknown)",
    async run(t) {
      const out = () => val(t, "#he-out");
      await t.page.setValue("#he-in", "<a href=\"x\">Café & © €</a>");
      t.eq(await out(), "&lt;a href=&quot;x&quot;&gt;Caf&eacute; &amp; &copy; &euro;&lt;/a&gt;", "named");
      await t.page.setValue("#he-style", "unsafe");
      t.eq(await out(), "&lt;a href=&quot;x&quot;&gt;Café &amp; © €&lt;/a&gt;", "unsafe only");
      await t.page.setValue("#he-style", "numeric");
      t.eq(await out(), "&lt;a href=&quot;x&quot;&gt;Caf&#233; &amp; &#169; &#8364;&lt;/a&gt;", "numeric");
      await t.page.click("#he-hex");
      t.eq(await out(), "&lt;a href=&quot;x&quot;&gt;Caf&#xE9; &amp; &#xA9; &#x20AC;&lt;/a&gt;", "hex");
      await t.page.click("#he-hex");
      await t.page.click("#he-all");
      t.eq(await out(), "&#60;&#97;&#32;&#104;&#114;&#101;&#102;&#61;&#34;&#120;&#34;&#62;&#67;&#97;&#102;&#233;&#32;&#38;&#32;&#169;&#32;&#8364;&#60;&#47;&#97;&#62;", "every character");
      await t.page.click("#he-all");
      await t.page.setValue("#he-in", "\u{1F600}");
      t.eq(await out(), "&#128512;", "emoji is one numeric entity");
      await t.page.click('input[name="he-mode"][value="decode"]');
      t.eq(await hidden(t, "#he-opts"), true, "encode options hidden");
      await t.page.setValue("#he-in", "&lt;p&gt;Caf&eacute; &#233; &#xE9; &amp;amp; &fjlig; &NotEqualTilde; &bogus; &copy");
      const dec = await out();
      t.assert(dec.startsWith("<p>Café é é &amp; fj ≂̸ &bogus; &copy"), "decoded: " + dec);
      t.assert((await txt(t, "#he-report")).includes("&bogus;"), "unknown listed");
      await t.page.setValue("#he-in", "no entities here");
      t.assert((await txt(t, "#he-report")).startsWith("No entities"), "none found");
      await t.page.setValue("#he-in", "&#128512; &#x1F600; &#0;");
      t.eq(await out(), "\u{1F600} \u{1F600} �", "astral and invalid numbers");
      await t.page.click("#he-use");
      t.eq(await val(t, "#he-in"), "\u{1F600} \u{1F600} �", "use result as input");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "word-frequency-counter",
    name: "words, phrases, stop words, percentages, top N and CSV download",
    async run(t) {
      await t.page.click("#wf-example");
      const rows = () => t.page.eval(`[...document.querySelectorAll("#wf-rows tr")].map((r) => [...r.children].map((c) => c.textContent))`);
      let r = await rows();
      t.eq(r[0], ["1", "a", "4", "12.1%"], "a and the tie at 4, a first: " + JSON.stringify(r[0]));
      t.eq(await txt(t, "#wf-words"), "33", "word total");
      await t.page.setValue("#wf-stop", "en");
      r = await rows();
      t.eq(r[0].slice(1, 3), ["dog", "4"], "dog and fox tie at 4, dog first without stop words");
      t.eq(r[1].slice(1, 3), ["fox", "4"], "fox second");
      await t.page.click('input[name="wf-n"][value="2"]');
      r = await rows();
      t.eq(await txt(t, "#wf-th"), "Phrase", "column header");
      t.eq(r[0].slice(1, 3), ["lazy dog", "2"], "lazy dog twice");
      t.assert(r.every((x) => !/^(the|a|and|is|too) |\s(the|a|and|is|too)$/.test(x[1])), "no phrase starts or ends with a stop word");
      await t.page.click('input[name="wf-n"][value="1"]');
      await t.page.setValue("#wf-top", "10");
      t.assert((await rows()).length <= 10, "top 10");
      await t.page.setValue("#wf-stop", "");
      await t.page.setValue("#wf-in", "Café café CAFÉ, 2024 2024.");
      r = await rows();
      t.eq(r.map((x) => x.slice(1, 3)), [["2024", "2"], ["café", "3"]].sort((a, b) => b[1] - a[1]), "case folded accents, digits");
      await t.page.click("#wf-num");
      t.eq((await rows()).length, 1, "numbers can be excluded");
      const dl = await t.dl("#wf-csv");
      t.eq(dl.name, "word-frequency.csv", "csv name");
      t.eq(Buffer.from(dl.bytes).toString("utf8").replace(/^﻿/, ""), "rank,word,count,percent\r\n1,café,3,100.00\r\n", "csv content");
      await t.page.setValue("#wf-in", "");
      t.eq(await hidden(t, "#wf-res"), true, "empty input hides results");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
];
