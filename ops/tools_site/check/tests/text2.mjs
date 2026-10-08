// Text tools, batch 2: character counter, sort lines, slug, remove line breaks, reverse, binary, Morse.
const val = (sel) => `document.querySelector(${JSON.stringify(sel)}).value`;
const txt = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent.trim()`;
const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
const graphemes = (s) => Array.from(seg.segment(s), (x) => x.segment);
/* Length-limits table: col 1 = Limit, 2 = Used, 3 = Left (the row header is the first child). */
const cell = (row, col) => `document.querySelector("#lim-body tr:nth-child(${row}) > :nth-child(${col + 1})").textContent.trim()`;

export default [
  /* ------------------------------------------------------------ character counter */
  {
    page: "character-counter",
    name: "counts graphemes, code points, bytes; emoji and combining marks count once",
    async run(t) {
      const S = "Héllo 👨‍👩‍👧 é!\nLine 2";
      await t.page.setValue("#text", S);
      const g = graphemes(S);
      await t.page.waitFor(`${txt("#c-chars")} === "${g.length}"`);
      t.eq(g.length, 17, "fixture grapheme count");
      t.eq(await t.page.eval(txt("#c-nospace")), "13", "without spaces (3 spaces, 1 line break)");
      t.eq(await t.page.eval(txt("#c-letters")), "10", "letters (é composed and decomposed both count once)");
      t.eq(await t.page.eval(txt("#c-digits")), "1", "digits");
      t.eq(await t.page.eval(txt("#c-spaces")), "3", "spaces");
      t.eq(await t.page.eval(txt("#c-words")), "4", "words");
      t.eq(await t.page.eval(txt("#c-lines")), "2", "lines");
      t.eq(await t.page.eval(txt("#c-cp")), String([...S].length), "code points");
      t.eq(await t.page.eval(txt("#c-bytes")), String(Buffer.byteLength(S, "utf8")), "UTF-8 bytes");
      t.eq(await t.page.eval(txt("#bar-chars")), "17", "sticky bar");
      // the emoji makes the SMS Unicode: limit 70, units are UTF-16 code units
      t.eq(await t.page.eval(cell(2, 1)), "70 (Unicode)", "SMS encoding");
      t.eq(await t.page.eval(cell(2, 2)), `${S.length} · 1 message`, "SMS units");
      t.eq(await t.page.eval(cell(2, 3)), String(70 - S.length), "SMS left");
      await t.shot("counts", 375);
      await t.shot("counts", 1280);
    },
  },
  {
    page: "character-counter",
    name: "SMS GSM-7 rules and multipart; X weighting; over-limit rows",
    async run(t) {
      await t.page.setValue("#text", "Hi {there}");
      await t.page.waitFor(`${cell(2, 1)} === "160 (GSM-7)"`);
      t.eq(await t.page.eval(cell(2, 2)), "12 · 1 message", "braces count double in GSM-7");
      t.eq(await t.page.eval(cell(2, 3)), "148", "GSM left");
      await t.page.setValue("#text", "a".repeat(161));
      await t.page.waitFor(`${cell(2, 2)} === "161 · 2 messages"`);
      t.eq(await t.page.eval(cell(2, 3)), "145", "two parts of 153");
      t.eq(await t.page.eval(cell(3, 3)), "101 over", "title tag 60 exceeded");
      // X: Latin 1 each, CJK 2 each, emoji 2, link 23 → 5+1+4+1+2+1+23 = 37
      await t.page.setValue("#text", "Hello 日本 😀 https://example.com/a/very/long/path");
      await t.page.waitFor(`${cell(1, 2)} === "37"`);
      t.eq(await t.page.eval(cell(1, 3)), "243", "X left");
      await t.page.setValue("#text", "x".repeat(300));
      await t.page.waitFor(`${cell(1, 3)} === "20 over"`);
      await t.shot("over", 375);
      await t.shot("limits", 375, { selector: ".wc__more" });
    },
  },

  /* ------------------------------------------------------------ sort lines */
  {
    page: "sort-lines-alphabetically",
    name: "alphabetical, natural, character code, dedupe, Z to A, length; download",
    async run(t) {
      await t.page.setValue("#text", "banana\nApple\napple\nCherry\n\nitem 10\nitem 2\nbanana");
      await t.page.waitFor(`${val("#out")} === "Apple\\napple\\nbanana\\nbanana\\nCherry\\nitem 10\\nitem 2"`);
      t.eq(await t.page.eval(txt("#report")), "7 lines sorted, 1 empty removed", "report");
      await t.page.setValue("#by", "natural");
      await t.page.waitFor(`${val("#out")}.endsWith("Cherry\\nitem 2\\nitem 10")`);
      await t.page.click("#dedupe");
      await t.page.waitFor(`${val("#out")} === "Apple\\nbanana\\nCherry\\nitem 2\\nitem 10"`);
      t.eq(await t.page.eval(txt("#report")), "5 lines sorted, 2 duplicates removed, 1 empty removed", "dedupe report");
      await t.page.setValue("#by", "code");
      await t.page.waitFor(`${val("#out")} === "Apple\\nCherry\\nbanana\\nitem 10\\nitem 2"`);
      await t.page.setValue("#by", "alpha");
      await t.page.click('input[name="dir"][value="desc"]');
      await t.page.waitFor(`${val("#out")} === "item 2\\nitem 10\\nCherry\\nbanana\\nApple"`);
      await t.page.click("#ci"); // case-sensitive dedupe keeps apple and Apple
      await t.page.waitFor(`${val("#out")}.split("\\n").length === 6`);
      await t.page.setValue("#by", "length");
      t.eq(await t.page.eval(txt("#desc-l")), "Longest first", "length labels");
      await t.page.click('input[name="dir"][value="asc"]');
      await t.page.waitFor(`${val("#out")} === "Apple\\napple\\nbanana\\nCherry\\nitem 2\\nitem 10"`);
      await t.page.setValue("#by", "shuffle");
      await t.page.waitFor(`!document.querySelector("#shuffle").hidden && document.querySelector("#dir-field").hidden`);
      t.eq((await t.page.eval(val("#out"))).split("\n").sort().join("|"), "Apple|Cherry|apple|banana|item 10|item 2", "shuffle keeps lines");
      await t.page.setValue("#by", "alpha");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      const { name, bytes } = await t.dl("#dl");
      t.eq(name, "sorted-lines.txt", "download name");
      t.eq(bytes.toString("utf8"), "apple\nApple\nbanana\nCherry\nitem 10\nitem 2", "download content (case-sensitive: lower case first)");
    },
  },

  /* ------------------------------------------------------------ slug */
  {
    page: "text-to-slug",
    name: "accents, ß, &, Cyrillic and Greek, apostrophes; separators, stop words, max length",
    async run(t) {
      await t.page.setValue("#text", "Crème Brûlée & Café — Ünïcödé Straße!");
      await t.page.waitFor(`${val("#out")} === "creme-brulee-and-cafe-unicode-strasse"`);
      t.eq(await t.page.eval(txt("#preview-slug")), "creme-brulee-and-cafe-unicode-strasse", "preview");
      await t.page.setValue("#text", "Москва 2026\nΑθήνα\n  don't   STOP --- now  ");
      await t.page.waitFor(`${val("#out")} === "moskva-2026\\nathina\\ndont-stop-now"`);
      t.eq(await t.page.eval(txt("#report")), "3 slugs.", "count");
      await t.page.setValue("#text", "The Lord of the Rings");
      await t.page.click('input[name="sep"][value="_"]');
      await t.page.click("#stop");
      await t.page.waitFor(`${val("#out")} === "lord_rings"`);
      await t.page.click("#stop");
      await t.page.click('input[name="sep"][value="-"]');
      await t.page.setValue("#text", "How to bake sourdough bread at home");
      await t.page.setValue("#max", "20");
      await t.page.waitFor(`${val("#out")} === "how-to-bake"`);
      await t.page.setValue("#text", "Supercalifragilisticexpialidocious");
      await t.page.waitFor(`${val("#out")} === "supercalifragilistic"`);
      await t.page.setValue("#max", "");
      await t.page.setValue("#text", "Hello 世界 Wörld");
      await t.page.waitFor(`${val("#out")} === "hello-world"`);
      t.assert((await t.page.eval(txt("#report"))).includes("2 characters with no Latin equivalent dropped"), "dropped report");
      await t.page.click("#ascii");
      await t.page.waitFor(`${val("#out")} === "hello-世界-wörld"`);
      await t.page.click("#ascii");
      await t.page.click("#lower");
      await t.page.waitFor(`${val("#out")} === "Hello-World"`);
      await t.page.click("#lower");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      const { name, bytes } = await t.dl("#dl");
      t.eq([name, bytes.toString("utf8")], ["slugs.txt", "hello-world"], "download");
    },
  },

  /* ------------------------------------------------------------ remove line breaks */
  {
    page: "remove-line-breaks",
    name: "keeps paragraphs, joins hyphenated words, remove all, custom separator",
    async run(t) {
      const IN = "This is a para-\ngraph that was\r\nbroken.\n\n\nSecond   para\n  here.  \n";
      await t.page.setValue("#text", IN);
      await t.page.waitFor(`${val("#out")} === "This is a para- graph that was broken.\\n\\nSecond para here."`);
      t.eq(await t.page.eval(txt("#report")), "5 line breaks removed.", "report");
      await t.page.click("#hyphen");
      await t.page.waitFor(`${val("#out")} === "This is a paragraph that was broken.\\n\\nSecond para here."`);
      await t.page.click('input[name="mode"][value="all"]');
      await t.page.waitFor(`${val("#out")} === "This is a paragraph that was broken. Second para here."`);
      await t.shot("done", 375);
      await t.shot("done", 1280);
      const { name, bytes } = await t.dl("#dl");
      t.eq([name, bytes.toString("utf8")], ["text-without-line-breaks.txt", "This is a paragraph that was broken. Second para here."], "download");
      await t.page.setValue("#text", "a\nb\n\nc");
      await t.page.setValue("#joiner", "custom");
      await t.page.waitFor(`!document.querySelector("#custom-field").hidden`);
      await t.page.waitFor(`${val("#out")} === "a, b, c"`);
      await t.page.setValue("#joiner", "none");
      await t.page.waitFor(`${val("#out")} === "abc"`);
    },
  },

  /* ------------------------------------------------------------ reverse */
  {
    page: "reverse-text",
    name: "reverses whole graphemes; word order, each word, line order; palindrome",
    async run(t) {
      await t.page.setValue("#text", "Aé👨‍👩‍👧 x🇵🇭");
      await t.page.waitFor(`${val("#out")} === ${JSON.stringify("🇵🇭x 👨‍👩‍👧éA")}`);
      await t.page.setValue("#text", "Hello, world!\nfoo bar");
      await t.page.click('input[name="mode"][value="words"]');
      await t.page.waitFor(`${val("#out")} === "world! Hello,\\nbar foo"`);
      await t.page.click('input[name="mode"][value="each"]');
      await t.page.waitFor(`${val("#out")} === ",olleH !dlrow\\noof rab"`);
      await t.page.click('input[name="mode"][value="lines"]');
      await t.page.waitFor(`${val("#out")} === "foo bar\\nHello, world!"`);
      await t.page.click('input[name="mode"][value="chars"]');
      await t.page.setValue("#text", "A man, a plan, a canal: Panama");
      await t.page.waitFor(`${txt("#report")}.includes("palindrome")`);
      t.eq(await t.page.eval(val("#out")), "amanaP :lanac a ,nalp a ,nam A", "letters");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      const { name, bytes } = await t.dl("#dl");
      t.eq([name, bytes.toString("utf8")], ["reversed-text.txt", "amanaP :lanac a ,nalp a ,nam A"], "download");
    },
  },

  /* ------------------------------------------------------------ binary */
  {
    page: "text-to-binary",
    name: "UTF-8 bytes in binary, hex and decimal; round trip; separators",
    async run(t) {
      const S = "Hé 😀";
      const bin = [...Buffer.from(S, "utf8")].map((b) => b.toString(2).padStart(8, "0"));
      await t.page.setValue("#text", S);
      await t.page.waitFor(`${val("#out")} === ${JSON.stringify(bin.join(" "))}`);
      t.eq(await t.page.eval(txt("#report")), "4 characters → 8 bytes.", "report");
      t.assert(bin.join(" ").startsWith("01001000 11000011 10101001"), "fixture: H é");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await t.page.click("#swap");
      await t.page.waitFor(`${val("#out")} === ${JSON.stringify(S)}`);
      t.eq(await t.page.eval(`document.querySelector('input[name="dir"]:checked').value`), "decode", "swapped to decode");
      await t.page.setValue("#text", "0100100001101001");
      await t.page.waitFor(`${val("#out")} === "Hi"`);
      await t.page.setValue("#text", "1001000,1101001\n100001");
      await t.page.waitFor(`${val("#out")} === "Hi!"`);
      await t.page.setValue("#base", "16");
      await t.page.setValue("#text", "48 c3 a9");
      await t.page.waitFor(`${val("#out")} === "Hé"`);
      await t.page.setValue("#base", "10");
      await t.page.setValue("#text", "65 66 67");
      await t.page.waitFor(`${val("#out")} === "ABC"`);
      await t.page.click('input[name="dir"][value="encode"]');
      await t.page.setValue("#base", "8");
      await t.page.setValue("#sep", "");
      await t.page.setValue("#text", "AB");
      await t.page.waitFor(`${val("#out")} === "101102"`);
      await t.page.setValue("#base", "16");
      await t.page.setValue("#sep", "\\n");
      await t.page.waitFor(`${val("#out")} === "41\\n42"`);
      const { name, bytes } = await t.dl("#dl");
      t.eq([name, bytes.toString("utf8")], ["converted.txt", "41\n42"], "download");
    },
  },
  {
    page: "text-to-binary",
    name: "invalid digits, odd-length runs and invalid UTF-8 explain the problem",
    async run(t) {
      await t.page.click('input[name="dir"][value="decode"]');
      await t.page.setValue("#text", "01000001 0100002");
      let msg = await t.waitError();
      t.assert(msg.includes('"2" at position 16'), "bad digit position: " + msg);
      t.eq(await t.page.eval(val("#out")), "", "no output on error");
      await t.page.setValue("#text", "010000010");
      msg = await t.waitError();
      t.assert(/multiple|split into bytes/.test(msg), "odd run: " + msg);
      await t.page.setValue("#text", "11000011 01000001");
      msg = await t.waitError();
      t.assert(msg.includes("aren't valid UTF-8") && msg.includes("byte 1"), "utf-8: " + msg);
      await t.shot("error", 375);
      await t.page.setValue("#text", "01000001");
      await t.page.waitFor(`${val("#out")} === "A" && document.querySelector("#status").hidden`);
    },
  },

  /* ------------------------------------------------------------ Morse */
  {
    page: "morse-code-translator",
    name: "text to Morse and back; accents folded; unknown characters reported",
    async run(t) {
      await t.page.setValue("#text", "SOS Help!\nÉté 73");
      const want = "... --- ... / .... . .-.. .--. -.-.--\n. - . / --... ...--";
      await t.page.waitFor(`${val("#out")} === ${JSON.stringify(want)}`);
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await t.page.click("#swap");
      await t.page.waitFor(`${val("#out")} === "SOS HELP!\\nETE 73"`);
      await t.page.setValue("#text", "··· −−− ···  .- ...---");
      await t.page.waitFor(`${val("#out")} === "SOS A#"`);
      t.assert((await t.page.eval(txt("#report"))).includes('"...---"'), "unknown sequence reported");
      await t.page.click('input[name="dir"][value="encode"]');
      await t.page.setValue("#text", "a#b 😀");
      await t.page.waitFor(`${val("#out")} === ".- -..."`);
      const rep = await t.page.eval(txt("#report"));
      t.assert(rep.includes('"#"') && rep.includes('"😀"'), "unknown chars reported: " + rep);
      const { name, bytes } = await t.dl("#dl");
      t.eq([name, bytes.toString("utf8")], ["morse-code.txt", ".- -..."], "download");
      await t.page.setValue("#wpm", "25");
      await t.page.click("#play");
      await t.page.waitFor(`!document.querySelector("#stop").hidden`);
      await t.page.click("#stop");
      await t.page.waitFor(`!document.querySelector("#play").hidden && document.querySelector("#stop").hidden`);
    },
  },
];
