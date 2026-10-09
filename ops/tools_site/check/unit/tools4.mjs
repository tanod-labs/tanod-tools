// Unit tests for the maths and text logic behind eight tools, run with plain node:
//   node ops/tools_site/check/unit/tools4.mjs
// invisible-character-detector, extract-emails-and-urls, number-to-words, loan-calculator, compound-interest-calculator,
// markdown-table-generator, html-entity-encoder-decoder, word-frequency-counter.
// Reference values are literals (worked by hand or from the standard formulas), not the code's own output.
import * as inv from "../../../../site/tools/js/invischarcore.js";
import * as ex from "../../../../site/tools/js/extractcore.js";
import * as nw from "../../../../site/tools/js/numwordscore.js";
import * as fin from "../../../../site/tools/js/fincore.js";
import * as md from "../../../../site/tools/js/mdtablecore.js";
import * as en from "../../../../site/tools/js/entitycore.js";
import * as wf from "../../../../site/tools/js/wordfreqcore.js";

let n = 0, bad = 0;
const eq = (a, b, msg) => {
  n++;
  if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
};
const near = (a, b, tol, msg) => {
  n++;
  if (!(Math.abs(a - b) <= tol)) { bad++; console.log(`FAIL ${msg}: got ${a}, expected ${b} +/- ${tol}`); }
};
const throws = (fn, msg) => {
  n++;
  try { fn(); bad++; console.log(`FAIL ${msg}: did not throw`); } catch (_) { /* expected */ }
};
const S = String.fromCodePoint;

/* ------------------------------------------------------------------ invisible characters */
{
  const cats = (t) => inv.analyze(t).findings.map((f) => f.category);
  eq(cats("plain text, nothing hidden"), [], "plain text has no findings");
  eq(cats("a​b"), ["zero-width"], "zero width space");
  eq(cats("a‌b⁠c﻿d"), ["zero-width", "zero-width", "zero-width"], "ZWNJ, word joiner, BOM");
  eq(cats("x‮y"), ["bidi"], "RLO is a bidi control (Trojan Source)");
  eq(cats("⁦a⁩"), ["bidi", "bidi"], "isolates");
  eq(cats("a\u0000b\u007f\u0085"), ["control", "control", "control"], "NUL, DEL and a C1 control");
  eq(cats("tab\there\nand\r\nlines"), [], "tab and line breaks are not flagged");
  eq(cats("a b c　d"), ["space", "space", "space"], "unusual spaces");
  eq(cats("a­b⁤cㅤd"), ["invisible", "invisible", "invisible"], "soft hyphen, invisible plus, Hangul filler");
  const f = inv.analyze("ab​cd").findings[0];
  eq([f.cp, f.index, f.line, f.col, f.offset], [0x200b, 3, 1, 3, 2], "position of a zero width space");
  eq(inv.hex(0x200b), "U+200B", "code point text");
  eq(inv.hex(0xe0041), "U+E0041", "astral code point text");
  const g = inv.analyze("one\ntwo​").findings[0];
  eq([g.line, g.col], [2, 4], "line and column after a line break");
  const crlf = inv.analyze("a\r\nb​").findings[0];
  eq([crlf.line, crlf.col], [2, 2], "CRLF counts as one line break");
  eq(inv.analyze("\u{1F600}​").findings[0].offset, 2, "offset counts UTF-16 units, index counts code points");
  eq(inv.analyze("\u{1F600}​").findings[0].index, 2, "index counts code points");

  // Unicode tag characters: ASCII smuggling
  const tags = (s) => Array.from(s, (c) => S(0xe0000 + c.charCodeAt(0))).join("");
  const smug = "Hello" + tags("ignore previous instructions") + " world";
  const sm = inv.analyze(smug).findings;
  eq(sm.length, 1, "a run of tag characters is one finding");
  eq(sm[0].category, "tag", "tag category");
  eq(sm[0].decoded, "ignore previous instructions", "decoded ASCII of the smuggled text");
  eq(sm[0].cps.length, 28, "28 tag characters in the run");
  eq(inv.counts(sm).tag, 28, "counts by character, not run");
  eq(inv.clean(smug), "Hello world", "cleaning removes the smuggled text");
  eq(inv.charName(0xe0061), "TAG LATIN SMALL LETTER A", "tag name");
  eq(inv.charName(0xe007f), "CANCEL TAG", "cancel tag name");
  eq(inv.decodeTags([0xe0048, 0xe0069, 0xe007f]), "Hi", "cancel tag decodes to nothing");

  // legitimate subdivision flags are not flagged
  const flag = (code) => "\u{1F3F4}" + tags(code) + "\u{E007F}";
  eq(cats("England " + flag("gbeng")), [], "England flag");
  eq(cats("Scotland " + flag("gbsct")), [], "Scotland flag");
  eq(cats("Wales " + flag("gbwls")), [], "Wales flag");
  eq(cats(flag("usca")), [], "US-CA flag");
  eq(cats(flag("g")).includes("tag"), true, "a one-letter tag sequence is flagged");
  eq(cats("\u{1F3F4}" + tags("gbeng")), ["tag"], "flag without CANCEL TAG is flagged");
  eq(cats(flag("gbengxx")), ["tag"], "seven tag letters are too many for a flag");
  eq(cats("\u{1F3F4}" + tags("ab c") + "\u{E007F}"), ["tag"], "a space inside the tags is not a flag");
  eq(cats(tags("gbeng") + "\u{E007F}"), ["tag"], "tags without the black flag are flagged");
  eq(inv.analyze("x " + flag("gbeng") + tags("hidden")).findings.map((q) => q.decoded), ["hidden"], "hidden text after a flag is found");
  eq(inv.clean("A" + flag("gbeng") + "B"), "A" + flag("gbeng") + "B", "cleaning leaves a real flag alone");

  // ZWJ and variation selectors in emoji
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
  eq(cats(family), [], "ZWJ between emoji (family) is fine");
  eq(cats("\u{1F469}\u{1F3FD}‍\u{1F4BB}"), [], "ZWJ after a skin tone modifier (woman technologist)");
  eq(cats("❤️‍\u{1F525}"), [], "ZWJ after VS16 (heart on fire)");
  eq(cats("❤️"), [], "VS16 after an emoji");
  eq(cats("1️⃣"), [], "keycap sequence");
  eq(cats("\u{1F468}‍"), ["zero-width"], "trailing ZWJ is flagged");
  eq(cats("a‍b"), ["zero-width"], "ZWJ between letters is flagged");
  eq(cats("‍\u{1F469}"), ["zero-width"], "leading ZWJ is flagged");
  eq(cats("a️"), ["invisible"], "VS16 after a letter is flagged");
  eq(cats("️"), ["invisible"], "lone VS16 is flagged");
  eq(inv.clean(family + "​"), family, "cleaning keeps emoji joiners and removes other zero width characters");

  // mixed scripts
  const mx = inv.analyze("paypal and pаypal").findings;
  eq(mx.length, 1, "one lookalike word");
  eq([mx[0].category, mx[0].word, mx[0].odd, mx[0].scripts], ["mixed", "pаypal", ["а"], ["Latin", "Cyrillic"]], "Cyrillic a inside a Latin word");
  eq(mx[0].index, 12, "position of the mixed word");
  eq(cats("οne is Greek omicron"), ["mixed"], "Greek omicron in a Latin word");
  eq(cats("Привет world"), [], "separate words in two scripts are fine");
  eq(cats("Café naïve über"), [], "accented Latin is fine");
  eq(cats("привет"), [], "pure Cyrillic is fine");
  eq(cats("x1 а b2"), [], "numbers and single letters do not mix scripts");
  eq(inv.clean("pаypal"), "pаypal", "cleaning never rewrites mixed words");

  // clean
  eq(inv.clean("a​b‮c\u0000d"), "abcd", "clean removes zero width, bidi and control characters");
  eq(inv.clean("a b"), "a b", "clean keeps unusual spaces by default");
  eq(inv.clean("a b c", { spaces: true }), "a b c", "clean can turn unusual spaces into spaces");
  eq(inv.clean("a\u{1F600}​b"), "a\u{1F600}b", "clean keeps astral characters");
  eq(inv.counts(inv.analyze("a​​b‮").findings), { "zero-width": 2, bidi: 1, tag: 0, control: 0, invisible: 0, space: 0, mixed: 0 }, "counts per category");
}

/* ------------------------------------------------------------------ extract emails and urls */
{
  const t = "Write to Bob <bob@Example.com>, alice.smith+tag@mail.co.uk or BOB@example.com. See https://www.example.com/a?b=1&c=(2). "
    + "Also www.test.org, (http://foo.bar/x_(y)) and http://10.0.0.1:8080/path; ip 192.168.1.1, bad 999.1.1.1, v1.2.3.4.5. "
    + "Call +1 (555) 123-4567 or 555-123-4567 on 2024-03-05. Tags #Hello #hello #123 #tést, docs.python.org and file.txt.";
  eq(ex.findEmails(t), ["bob@Example.com", "alice.smith+tag@mail.co.uk", "BOB@example.com"], "emails");
  eq(ex.findUrls(t), ["https://www.example.com/a?b=1&c=(2)", "www.test.org", "http://foo.bar/x_(y)", "http://10.0.0.1:8080/path"], "urls: sentence punctuation trimmed, balanced brackets kept");
  eq(ex.findIps(t), ["10.0.0.1", "192.168.1.1"], "ipv4: out-of-range and five-part numbers rejected, URL host excluded only when part of a longer run");
  eq(ex.findPhones(t), ["+1 (555) 123-4567", "555-123-4567"], "phones: dates are not phones");
  eq(ex.findHashtags(t), ["#Hello", "#hello", "#tést"], "hashtags: numbers alone are not tags");
  eq(ex.findDomains(t), ["example.com", "test.org", "foo.bar", "example.com", "mail.co.uk", "example.com", "docs.python.org"], "domains from urls, emails and bare names");
  eq(ex.trimUrl("http://a.com/x)."), "http://a.com/x", "trim trailing ) and .");
  eq(ex.trimUrl("http://a.com/x_(y)"), "http://a.com/x_(y)", "keep balanced )");
  eq(ex.hostOf("https://User:pw@Sub.Example.com:8080/p"), "sub.example.com", "host of a URL");
  const all = ex.extractAll(t);
  eq(all.emails.rows.map((r) => [r.value, r.count]), [["bob@Example.com", 2], ["alice.smith+tag@mail.co.uk", 1]], "emails dedupe ignores case and counts");
  eq(all.emails.found, 3, "emails found before dedupe");
  eq(all.hashtags.rows.map((r) => r.count), [2, 1], "hashtags dedupe ignores case");
  eq(all.phones.rows.length, 2, "two different phones");
  eq(ex.extractAll("a@b.co a@b.co", { unique: false }).emails.rows.length, 2, "dedupe off keeps every match");
  eq(ex.extractAll("#b #a #a", { sort: "az" }).hashtags.rows.map((r) => r.value), ["#a", "#b"], "sort A to Z");
  eq(ex.extractAll("#b #a #a", { sort: "count" }).hashtags.rows.map((r) => r.value), ["#a", "#b"], "sort by count");
  eq(ex.listCsv([{ value: "a,b", count: 2 }, { value: 'say "hi"', count: 1 }]), 'value,count\r\n"a,b",2\r\n"say ""hi""",1\r\n', "CSV quoting");
  eq(ex.findEmails("no emails here, a@b, @user, x@.com"), [], "not emails");
  eq(ex.findIps("1.2.3.4 and 01.2.3.4 and 256.1.1.1"), ["1.2.3.4"], "ip leading zero and range");
  eq(ex.findPhones("order 12345 and 123456789012345678"), [], "digit runs of the wrong length");
  eq(ex.findPhones("Tel: 020 7946 0958."), ["020 7946 0958"], "UK style number without a plus");
  eq(ex.findUrls("see ftp://files.example.org/a.zip, ok"), ["ftp://files.example.org/a.zip"], "ftp urls");
}

/* ------------------------------------------------------------------ number to words */
{
  const c = (x, o) => nw.cardinal(BigInt(x), o);
  eq(c(0), "zero", "0");
  eq(c(7), "seven", "7");
  eq(c(13), "thirteen", "13");
  eq(c(20), "twenty", "20");
  eq(c(21), "twenty-one", "21");
  eq(c(99), "ninety-nine", "99");
  eq(c(100), "one hundred", "100");
  eq(c(101), "one hundred one", "101");
  eq(c(110), "one hundred ten", "110");
  eq(c(999), "nine hundred ninety-nine", "999");
  eq(c(1000), "one thousand", "1000");
  eq(c(1001), "one thousand one", "1001");
  eq(c(12345), "twelve thousand three hundred forty-five", "12345");
  eq(c(100000), "one hundred thousand", "100000");
  eq(c(1000000), "one million", "10^6");
  eq(c(1000001), "one million one", "1000001");
  eq(c(1234567), "one million two hundred thirty-four thousand five hundred sixty-seven", "1234567");
  eq(c("1000000000"), "one billion", "10^9");
  eq(c("1000000000000"), "one trillion", "10^12");
  eq(c("1000000000000000"), "one quadrillion", "10^15");
  eq(c("999999999999999"), "nine hundred ninety-nine trillion nine hundred ninety-nine billion nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine", "10^15 - 1");
  eq(c("9007199254740993"), "nine quadrillion seven trillion one hundred ninety-nine billion two hundred fifty-four million seven hundred forty thousand nine hundred ninety-three", "beyond 2^53 stays exact");
  eq(c("1000000000000000000000000000000000"), "one decillion", "10^33");
  eq(c("999" + "999".repeat(11)).endsWith("nine hundred ninety-nine"), true, "largest supported number");
  throws(() => c("1" + "0".repeat(36)), "10^36 is out of range");
  eq(c(-5), "minus five", "negative");
  eq(c(105, { and: true }), "one hundred and five", "British and");
  eq(c(1005, { and: true }), "one thousand and five", "British and before the last group");
  eq(c(1100, { and: true }), "one thousand one hundred", "British: no and before a round hundred");
  eq(c(1234567, { and: true }), "one million two hundred and thirty-four thousand five hundred and sixty-seven", "British full");
  eq(c(1000000, { and: true }), "one million", "British round million");
  eq(c(1000001, { and: true }), "one million and one", "British million and one");

  const o = (x, opt) => nw.ordinal(BigInt(x), opt);
  eq([o(0), o(1), o(2), o(3), o(4), o(5), o(8), o(9), o(12)], ["zeroth", "first", "second", "third", "fourth", "fifth", "eighth", "ninth", "twelfth"], "irregular ordinals");
  eq([o(11), o(13), o(19)], ["eleventh", "thirteenth", "nineteenth"], "teen ordinals");
  eq([o(20), o(30), o(90)], ["twentieth", "thirtieth", "ninetieth"], "tens ordinals");
  eq([o(21), o(22), o(23), o(35), o(99)], ["twenty-first", "twenty-second", "twenty-third", "thirty-fifth", "ninety-ninth"], "hyphenated ordinals");
  eq([o(100), o(101), o(123), o(1000), o(1000000)], ["one hundredth", "one hundred first", "one hundred twenty-third", "one thousandth", "one millionth"], "large ordinals");
  eq(o("1000000000000000"), "one quadrillionth", "ordinal of 10^15");
  throws(() => o(-1), "negative ordinal");

  eq(nw.parseDecimal("1,234.56"), { neg: false, int: "1234", frac: "56" }, "parse with English separators");
  eq(nw.parseDecimal("1.234,56", ","), { neg: false, int: "1234", frac: "56" }, "parse with decimal comma");
  eq(nw.parseDecimal("-0.5"), { neg: true, int: "0", frac: "5" }, "parse negative");
  eq(nw.parseDecimal(".5"), { neg: false, int: "0", frac: "5" }, "parse leading dot");
  eq(nw.parseDecimal("007"), { neg: false, int: "7", frac: "" }, "leading zeros");
  eq([nw.parseDecimal("abc"), nw.parseDecimal(""), nw.parseDecimal("1.2.3"), nw.parseDecimal("-")], [null, null, null, null], "not numbers");
  eq(nw.numberWords(nw.parseDecimal("3.14")), "three point one four", "decimal digits one by one");
  eq(nw.numberWords(nw.parseDecimal("-0.05")), "minus zero point zero five", "negative decimal");
  eq(nw.numberWords(nw.parseDecimal("-0")), "zero", "negative zero");

  const cur = (x, code, o) => nw.currencyWords(nw.parseDecimal(x), code, o);
  eq(cur("1234.56", "USD"), "one thousand two hundred thirty-four dollars and fifty-six cents", "USD");
  eq(cur("1", "USD"), "one dollar", "one dollar singular");
  eq(cur("1.01", "USD"), "one dollar and one cent", "one cent singular");
  eq(cur("0.99", "USD"), "ninety-nine cents", "cents only");
  eq(cur("0", "USD"), "zero dollars", "zero");
  eq(cur("100.00", "EUR"), "one hundred euros", "EUR whole");
  eq(cur("2.50", "GBP"), "two pounds and fifty pence", "GBP pence");
  eq(cur("1.01", "GBP"), "one pound and one penny", "GBP penny");
  eq(cur("15.75", "PHP"), "fifteen pesos and seventy-five centavos", "PHP");
  eq(cur("1500000.50", "INR"), "one million five hundred thousand rupees and fifty paise", "INR");
  eq(cur("500", "JPY"), "five hundred yen", "JPY has no minor unit");
  eq(cur("0.001", "KWD"), "one fils", "KWD three decimals");
  eq(cur("1234.56", "USD", { fraction: true }), "one thousand two hundred thirty-four dollars and 56/100", "cheque style fraction");
  eq(cur("12", "USD", { fraction: true }), "twelve dollars and 00/100", "cheque style whole amount");
  eq(cur("1234.56", "USD", { and: true }), "one thousand two hundred and thirty-four dollars and fifty-six cents", "British and with currency");
  eq(cur("-5.25", "USD"), "minus five dollars and twenty-five cents", "negative amount");
  eq(cur("9007199254740993.99", "USD").startsWith("nine quadrillion"), true, "big amount exact");
  eq(cur("1000000000000000.01", "USD"), "one quadrillion dollars and one cent", "10^15 plus a cent");
  throws(() => cur("1.234", "USD"), "too many decimals");
  eq(cur("1.235", "USD", { round: true }), "one dollar and twenty-four cents", "round half up at the midpoint");
  eq(cur("1.239", "USD", { round: true }), "one dollar and twenty-four cents", "round half up");
  eq(cur("0.995", "USD", { round: true }), "one dollar", "rounding carries into dollars");
  throws(() => cur("1", "XXX"), "unknown currency");
  eq(nw.roundTo({ int: "12", frac: "345" }, 2), { int: "12", frac: "35" }, "roundTo half up");
  eq(nw.roundTo({ int: "99", frac: "999" }, 2), { int: "100", frac: "00" }, "roundTo carry");
  eq(nw.applyCase("one hundred and five", "title"), "One Hundred and Five", "title case");
  eq(nw.applyCase("twenty-one dollars", "title"), "Twenty-One Dollars", "title case hyphen");
  eq(nw.applyCase("one hundred", "sentence"), "One hundred", "sentence case");
  eq(nw.applyCase("one hundred", "upper"), "ONE HUNDRED", "upper case");
}

/* ------------------------------------------------------------------ loan */
{
  // 200,000 at 6% for 30 years: payment 1,199.10 (standard published figure); total interest 231,676.38
  eq(fin.monthlyPaymentCents(20000000, 6, 360), 119910, "200k at 6% 30y payment");
  const a = fin.amortize(20000000, 6, 360);
  eq(a.rows.length, 360, "360 rows");
  eq(a.rows[0], { n: 1, payment: 119910, principal: 19910, interest: 100000, balance: 19980090 }, "first row");
  eq(a.rows[359].balance, 0, "balance clears to zero");
  eq(a.rows.reduce((s, r) => s + r.principal, 0), 20000000, "principal repaid adds up exactly");
  eq(a.totalPaid, a.rows.reduce((s, r) => s + r.payment, 0), "total paid is the sum");
  eq(a.totalInterest, a.totalPaid - 20000000, "interest = paid - principal");
  near(a.totalInterest / 100, 231676.38, 1, "total interest about 231,676.38 (last payment absorbs rounding)");
  // 10,000 at 5% for 12 months: payment 856.07
  eq(fin.monthlyPaymentCents(1000000, 5, 12), 85607, "10k 5% 12m");
  // 0% rate
  eq(fin.monthlyPaymentCents(120000, 0, 12), 10000, "0% payment is principal / months");
  const z = fin.amortize(120000, 0, 12);
  eq([z.totalInterest, z.rows[11].balance, z.rows.length], [0, 0, 12], "0% loan has no interest");
  const odd = fin.amortize(100000, 0, 3);
  eq(odd.rows.map((r) => r.payment), [33333, 33333, 33334], "0% rounding: last payment fixes the cents");
  eq(odd.rows[2].balance, 0, "0% odd split clears");
  eq(fin.amortize(1000000, 12, 1).rows[0], { n: 1, payment: 1010000, principal: 1000000, interest: 10000, balance: 0 }, "one month loan");
  // extra payments end the loan early
  const ex1 = fin.amortize(1000000, 5, 12, 50000);
  eq(ex1.rows.length < 12, true, "extra payment shortens the term");
  eq(ex1.rows[ex1.rows.length - 1].balance, 0, "early payoff clears");
  eq(ex1.totalInterest < fin.amortize(1000000, 5, 12).totalInterest, true, "extra payment saves interest");
  eq(fin.centsText(119910), "1199.10", "cents text");
  eq(fin.centsText(5), "0.05", "cents text small");
  eq(fin.centsText(-250), "-2.50", "cents text negative");
  eq(fin.scheduleCsv(odd.rows).split("\r\n")[0], "payment_number,payment,principal,interest,remaining_balance", "CSV header");
  eq(fin.scheduleCsv(odd.rows).split("\r\n")[3], "3,333.34,333.34,0.00,0.00", "CSV last row");
  throws(() => fin.monthlyPaymentCents(100, 5, 0), "zero months");
}

/* ------------------------------------------------------------------ compound interest */
{
  // 10,000 at 5%: annual 16,288.95; monthly 16,470.09; daily 16,486.65; continuous 16,487.21
  const bal = (freq, years, p = 10000, pct = 5, monthly = 0, start = false) => fin.compound({ principal: p, annualPct: pct, freq, months: years * 12, monthly, start }).final;
  near(bal(1, 10), 16288.946, 0.001, "annual compounding");
  near(bal(12, 10), 16470.095, 0.001, "monthly compounding");
  near(bal(4, 10), 16436.194, 0.001, "quarterly compounding");
  near(bal(2, 10), 16386.164, 0.001, "semiannual compounding");
  near(bal(365, 10), 16486.649, 0.001, "daily compounding");
  near(bal(Infinity, 10), 16487.213, 0.001, "continuous compounding (e^0.5)");
  near(bal(52, 10), 16483.0, 6, "weekly compounding is between monthly and daily");
  // contributions: 100 a month for 10 years at 5% monthly: FV of annuity = 100 * ((1+i)^120 - 1) / i = 15,528.23
  near(bal(12, 10, 0, 5, 100), 15528.2276, 0.001, "monthly contributions only (end of month)");
  near(bal(12, 10, 0, 5, 100, true), 15528.2276 * (1 + 0.05 / 12), 0.001, "contributions at the start of the month (annuity due)");
  near(bal(12, 10, 10000, 5, 100), 16470.095 + 15528.228, 0.002, "principal + contributions");
  near(bal(12, 1, 1000, 0, 50), 1600, 1e-9, "0% rate: just the deposits");
  const r = fin.compound({ principal: 10000, annualPct: 5, freq: 12, months: 120, monthly: 100 });
  near(r.contributed, 22000, 1e-9, "contributed = principal + 120 x 100");
  near(r.interest, r.final - r.contributed, 1e-6, "interest = final - contributed");
  eq(r.years.length, 10, "ten yearly rows");
  eq(r.years[0].year, 1, "first year is 1");
  near(r.years[9].balance, r.final, 1e-9, "last row balance is the final balance");
  near(r.years.reduce((s, y) => s + y.interest, 0), r.interest, 1e-6, "yearly interest adds up");
  near(r.years.reduce((s, y) => s + y.deposits, 0), 12000, 1e-9, "yearly deposits add up");
  const part = fin.compound({ principal: 1000, annualPct: 5, freq: 12, months: 18 });
  eq(part.years.map((y) => [y.year, y.months]), [[1, 12], [2, 18]], "a partial last year");
  near(fin.monthlyFactor(12, 12), 1.01, 1e-12, "12% monthly = 1% a month");
  near(fin.monthlyFactor(12, 1), Math.pow(1.12, 1 / 12), 1e-12, "annual factor spread over months");
  eq(fin.FREQUENCIES.quarterly, 4, "frequency table");
}

/* ------------------------------------------------------------------ markdown table */
{
  eq(md.parseDelimited("a,b\n1,2\n", ","), [["a", "b"], ["1", "2"]], "CSV rows");
  eq(md.parseDelimited('a,"b,c"\n"x ""y""",2', ","), [["a", "b,c"], ['x "y"', "2"]], "CSV quotes");
  eq(md.parseDelimited('a\t"line1\nline2"\n', "\t"), [["a", "line1\nline2"]], "quoted line break");
  eq(md.parseDelimited("a\tb\r\n1\t2\r\n\r\n3\t4", "\t"), [["a", "b"], ["1", "2"], ["3", "4"]], "TSV with CRLF and a blank line");
  eq(md.parseDelimited("a,,c\n,,", ","), [["a", "", "c"], ["", "", ""]], "empty fields");
  eq(md.detectDelimiter("a\tb\tc\n1\t2\t3"), "\t", "detect tab");
  eq(md.detectDelimiter("a;b\n1;2"), ";", "detect semicolon");
  eq(md.detectDelimiter("a,b\n1,2"), ",", "detect comma");
  eq(md.detectDelimiter("just text"), ",", "default comma");
  eq(md.toMarkdown([["Name", "Qty"], ["Apple", "3"]], ["left", "right"]),
    "| Name  | Qty |\n| :---- | --: |\n| Apple |   3 |", "padded table with alignments");
  eq(md.toMarkdown([["a", "b", "c"], ["1", "2", "3"]], ["none", "center", "left"], { pad: false }),
    "| a | b | c |\n| --- | :-: | :-- |\n| 1 | 2 | 3 |", "compact table");
  eq(md.toMarkdown([["h"], ["x|y"]], ["none"], { pad: false }), "| h |\n| --- |\n| x\\|y |", "pipes are escaped");
  eq(md.toMarkdown([["h"], ["l1\nl2"]], ["none"], { pad: false }), "| h |\n| --- |\n| l1<br>l2 |", "line breaks become <br>");
  eq(md.toMarkdown([["a", "b"], ["1"]], []), "| a   | b   |\n| --- | --- |\n| 1   |     |", "short rows are padded to the widest");
  eq(md.toMarkdown([["x"], ["y"]], ["center"], { header: false, pad: false }), "|  |\n| :-: |\n| x |\n| y |", "no header row writes an empty one");
  eq(md.toMarkdown([["éééé", "b"]], ["right", "none"]), "| éééé | b   |\n| ---: | --- |", "width counts characters");
  eq(md.looksLikeMarkdownTable("| a | b |\n| --- | :-: |\n| 1 | 2 |"), true, "recognises a Markdown table");
  eq(md.looksLikeMarkdownTable("a,b\n1,2"), false, "CSV is not Markdown");
  const p = md.parseMarkdownTable("| Name | Qty | Note |\n| :--- | ---: | :---: |\n| Apple | 3 | a\\|b |\n| Pear |");
  eq(p.aligns, ["left", "right", "center"], "alignments read back");
  eq(p.rows, [["Name", "Qty", "Note"], ["Apple", "3", "a|b"], ["Pear", "", ""]], "rows read back, short rows filled");
  eq(md.parseMarkdownTable("a | b\n--- | ---\n1 | 2").rows, [["a", "b"], ["1", "2"]], "table without outer pipes");
  eq(md.normalize([["a"], ["b", "c"]]).rows, [["a", ""], ["b", "c"]], "normalize widens rows");
  eq(md.addRow([["a", "b"]]), [["a", "b"], ["", ""]], "add row");
  eq(md.addRow([["a"], ["b"]], 1), [["a"], [""], ["b"]], "insert row");
  eq(md.removeRow([["a"], ["b"]], 0), [["b"]], "remove row");
  eq(md.removeRow([["a"]], 0), [["a"]], "the last row stays");
  eq(md.addColumn([["a"], ["b"]], ["left"]), { rows: [["a", ""], ["b", ""]], aligns: ["left", "none"] }, "add column");
  eq(md.removeColumn([["a", "b"]], ["left", "right"], 0), { rows: [["b"]], aligns: ["right"] }, "remove column");
  eq(md.removeColumn([["a"]], ["left"], 0), { rows: [["a"]], aligns: ["left"] }, "the last column stays");
  eq(md.escapeCell("a|b"), "a\\|b", "escape pipe");
}

/* ------------------------------------------------------------------ HTML entities */
{
  eq(en.encode("<a href=\"x\">Tom & 'Jerry'</a>", { mode: "unsafe" }), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;", "unsafe characters only");
  eq(en.encode("café © 2024 €5 — ü", { mode: "named" }), "caf&eacute; &copy; 2024 &euro;5 &mdash; &uuml;", "named entities");
  eq(en.encode("café €", { mode: "numeric" }), "caf&#233; &#8364;", "decimal numeric");
  eq(en.encode("café €", { mode: "numeric", hex: true }), "caf&#xE9; &#x20AC;", "hex numeric");
  eq(en.encode("\u{1F600}", { mode: "named" }), "&#128512;", "emoji with no name is numeric (one code point, not two surrogates)");
  eq(en.encode("\u{1F600}", { mode: "named", hex: true }), "&#x1F600;", "emoji in hex");
  eq(en.encode("中文", { mode: "named" }), "&#20013;&#25991;", "CJK numeric");
  eq(en.encode("a<b", { mode: "unsafe", hex: true }), "a&lt;b", "unsafe mode keeps names");
  eq(en.encode("it's", { mode: "named", hex: true }), "it&#x27;s", "apostrophe in hex mode");
  eq(en.encode("ab\ncd", { all: true }), "&#97;&#98;\n&#99;&#100;", "encode everything");
  eq(en.encode("plain text 123", { mode: "named" }), "plain text 123", "ASCII is untouched");
  eq(en.encode("a b", { mode: "named" }), "a&nbsp;b", "nbsp is named");
  eq(en.decode("&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;").text, "<p>Tom & Jerry</p>", "decode basics");
  eq(en.decode("caf&eacute; &#233; &#xE9; &#XE9;").text, "café é é é", "named, decimal and hex agree");
  eq(en.decode("&#128512; &#x1F600;").text, "\u{1F600} \u{1F600}", "astral numeric");
  eq(en.decode("&amp;lt;").text, "&lt;", "decodes one level only");
  eq(en.decode("&copy &amp").text, "&copy &amp", "references need the semicolon");
  eq(en.decode("&bogus; &#0; &#xD800; &#1114112;").text, "&bogus; � � �", "unknown names stay, invalid numbers give U+FFFD");
  eq(en.decode("&bogus; &bogus; &nope;").unknown, ["&bogus;", "&nope;"], "unknown references listed once");
  eq(en.decode("&#128;&#150;&#151;&#153;").text, "€–—™", "numeric 128-159 follow Windows-1252, as browsers do");
  eq(en.decode("&amp; &lt; &gt; &quot; &apos; &#39;").text, "& < > \" ' '", "the five XML entities");
  eq(en.decode("&Alpha;&beta;&Omega;&hearts;&hellip;&rarr;").text, "ΑβΩ♥…→", "Greek, symbols and arrows");
  eq(en.decode("&fjlig;", (name) => (name === "fjlig" ? "fj" : null)), { text: "fj", count: 1, unknown: [] }, "lookup supplies names the table lacks");
  eq(en.decode("a &amp; b &#65;").count, 2, "count of references decoded");
  const round = "Café <b>“quoted”</b> & © € \u{1F600} ÿ";
  for (const mode of ["unsafe", "named", "numeric"]) eq(en.decode(en.encode(round, { mode })).text, round, "round trip " + mode);
  eq(en.decode(en.encode(round, { all: true, hex: true })).text, round, "round trip all");
  eq(en.numericChar(65), "A", "numericChar");
  eq(en.NAMED.eacute, 233, "table spot check");
}

/* ------------------------------------------------------------------ word frequency */
{
  const text = "The cat and the dog. The cat sat on the mat! Don't stop; the cat's tail. 2024 2024";
  const all = wf.frequencies(text);
  eq(all.rows[0], { phrase: "the", count: 5, pct: all.rows[0].pct }, "most common word");
  eq(all.words, 18, "word count");
  eq(all.total, 18, "total counted without stop words");
  near(all.rows[0].pct, (5 / 18) * 100, 1e-9, "percentage");
  eq(all.rows.map((r) => r.phrase).slice(0, 4), ["the", "2024", "cat", "and"], "ties break A to Z (digits before letters)");
  const stop = wf.frequencies(text, { lang: "en" });
  eq(stop.rows.map((r) => [r.phrase, r.count]), [["cat", 2], ["2024", 2], ["cat's", 1], ["dog", 1], ["mat", 1], ["sat", 1], ["stop", 1], ["tail", 1]].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)), "English stop words removed");
  eq(stop.words, 18, "word total is of the whole text");
  eq(wf.frequencies(text, { lang: "en", numbers: false }).rows.some((r) => r.phrase === "2024"), false, "numbers can be dropped");
  eq(wf.frequencies("a bb ccc", { minLen: 2 }).rows.map((r) => r.phrase), ["bb", "ccc"], "minimum length");
  const two = wf.frequencies(text, { n: 2 });
  eq(two.rows[0], { phrase: "the cat", count: 2, pct: two.rows[0].pct }, "most common two-word phrase");
  eq(two.rows.some((r) => r.phrase === "dog the"), false, "phrases do not cross a full stop");
  eq(two.rows.some((r) => r.phrase === "stop the"), false, "phrases do not cross a semicolon");
  eq(wf.frequencies(text, { n: 2, lang: "en" }).rows.map((r) => r.phrase).sort(), ["2024 2024", "cat sat", "cat's tail"], "phrases starting or ending with a stop word are dropped");
  const three = wf.frequencies("big red car. big red car! small red car", { n: 3 });
  eq(three.rows[0], { phrase: "big red car", count: 2, pct: three.rows[0].pct }, "three-word phrases");
  near(three.rows[0].pct, (2 / 3) * 100, 1e-9, "phrase percentage");
  eq(wf.frequencies("Apple apple APPLE").rows, [{ phrase: "apple", count: 3, pct: 100 }], "case is ignored by default");
  eq(wf.frequencies("Apple apple", { lower: false }).rows.length, 2, "case sensitive");
  eq(wf.frequencies("").rows, [], "empty text");
  eq(wf.frequencies("...!!!").total, 0, "punctuation only");
  eq(wf.frequencies("don’t don't").rows, [{ phrase: "don't", count: 2, pct: 100 }], "curly apostrophe is the same word");
  eq(wf.frequencies("state-of-the-art state-of-the-art").rows[0].phrase, "state-of-the-art", "hyphenated words stay whole");
  eq(wf.frequencies("café CAFÉ naïve").rows[0], { phrase: "café", count: 2, pct: (2 / 3) * 100 }, "accented letters");
  eq(wf.frequencies("Привет мир, привет и мир", { lang: "ru" }).rows.map((r) => [r.phrase, r.count]), [["привет", 2], ["мир", 2]].sort((a, b) => (a[0] < b[0] ? -1 : 1)), "Russian stop word");
  eq(wf.frequencies("नमस्ते दुनिया और नमस्ते", { lang: "hi" }).rows[0], { phrase: "नमस्ते", count: 2, pct: (2 / 3) * 100 }, "Hindi words keep their combining marks");
  eq(wf.isStop("el", "es"), true, "es stop word");
  eq(wf.isStop("le", "fr"), true, "fr stop word");
  eq(wf.isStop("der", "de"), true, "de stop word");
  eq(wf.isStop("de", "pt-BR"), true, "pt stop word");
  eq(wf.isStop("il", "it"), true, "it stop word");
  eq(wf.isStop("yang", "id"), true, "id stop word");
  eq(wf.isStop("ve", "tr"), true, "tr stop word");
  eq(wf.isStop("và", "vi"), true, "vi stop word");
  eq(wf.isStop("и", "ru"), true, "ru stop word");
  eq(wf.isStop("nie", "pl"), true, "pl stop word");
  eq(wf.isStop("और", "hi"), true, "hi stop word");
  eq(wf.isStop("cat", "en"), false, "content word");
  eq(wf.isStop("the", ""), false, "no list means nothing is a stop word");
  eq(wf.STOP_LANGS.length, 12, "twelve stop word lists");
  eq(wf.frequencyCsv([{ phrase: "a,b", count: 2, pct: 50 }, { phrase: "c", count: 2, pct: 50 }]), 'rank,word,count,percent\r\n1,"a,b",2,50.00\r\n2,c,2,50.00\r\n', "CSV");
}

console.log(`${n - bad}/${n} unit checks passed`);
process.exit(bad ? 1 : 0);
