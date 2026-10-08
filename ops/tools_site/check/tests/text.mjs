const PARA = "The quick brown fox jumps over the lazy dog. It was a sunny day! Was it really?\n\nSecond paragraph here.";
const val = (sel) => `document.querySelector(${JSON.stringify(sel)}).value`;
const txt = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent.trim()`;

export default [
  {
    page: "word-counter",
    name: "counts a fixed paragraph exactly",
    async run(t) {
      await t.page.setValue("#text", PARA);
      await t.page.waitFor(`${txt("#c-words")} === "20"`);
      // words 20; characters 103 (incl. spaces and 2 line breaks); no spaces 83; sentences 4; paragraphs 2; lines 3
      t.eq(await t.page.eval(txt("#c-chars")), "103", "characters");
      t.eq(await t.page.eval(txt("#c-nospace")), "83", "characters without spaces");
      t.eq(await t.page.eval(txt("#c-sent")), "4", "sentences");
      t.eq(await t.page.eval(txt("#c-para")), "2", "paragraphs");
      t.eq(await t.page.eval(txt("#c-lines")), "3", "lines");
      t.eq(await t.page.eval(txt("#c-read")), "5s", "reading time (20 words at 238 wpm)");
      t.eq(await t.page.eval(txt("#c-speak")), "8s", "speaking time");
      t.eq(await t.page.eval(txt("#bar-words")), "20", "sticky bar words");
      await t.shot("counts", 375);
      await t.shot("counts", 1280);
    },
  },
  {
    page: "word-counter",
    name: "CJK text counts as more than one word; keyword table top entry",
    async run(t) {
      await t.page.setValue("#text", "今日は天気がいいです。散歩に行きましょう。");
      await t.page.waitFor(`Number(${txt("#c-words")}.replace(/,/g, "")) > 1`);
      t.assert(Number(await t.page.eval(txt("#c-words"))) > 1, "CJK words > 1");
      await t.page.setValue("#text", "Cats like fish. Cats chase mice. The cats nap. A dog barks.");
      await t.page.waitFor(`${txt("#c-words")} === "12"`);
      await t.page.waitFor(`document.querySelector("#dens-body th")?.textContent === "cats"`);
      t.eq(await t.page.eval(`document.querySelector("#dens-body tr td").textContent`), "3", "cats count");
      t.eq(await t.page.eval(`document.querySelector("#dens-body tr td:nth-child(3)").textContent.includes("25.0%")`), true, "cats density 3/12");
      await t.page.click("#stop"); // stop-word filter off: "the" and "a" appear but cats stays on top
      await t.page.setValue("#text", "the the the cat sat");
      await t.page.waitFor(`document.querySelector("#dens-body th")?.textContent === "cat" || document.querySelector("#dens-body th")?.textContent === "the"`);
      t.eq(await t.page.eval(`document.querySelector("#dens-body th").textContent`), "the", "top with stop words shown");
      await t.page.click('input[name="ngram"][value="2"]');
      await t.page.waitFor(`document.querySelector("#dens-body th")?.textContent === "the the"`);
    },
  },
  {
    page: "word-counter",
    name: "stays responsive on about 5 MB of text and shows readability",
    async run(t) {
      const t0 = Date.now();
      await t.page.eval(`(() => { const e = document.querySelector("#text"); e.value = "lorem ipsum dolor ".repeat(290000); e.dispatchEvent(new Event("input", {bubbles:true})); return true; })()`);
      await t.page.waitFor(`${txt("#c-words")} === "870,000"`, { timeout: 15000 });
      t.assert(Date.now() - t0 < 15000, "big input too slow");
      const sentence = "The cat sat on the warm mat and looked at the small bird in the tree. ";
      await t.page.setValue("#text", sentence.repeat(10));
      await t.page.waitFor(`!document.querySelector("#read-box").hidden`);
      const ease = Number(await t.page.eval(txt("#r-ease")));
      t.assert(ease > 80 && ease < 130, "ease plausible for simple text: " + ease);
      await t.page.setValue("#text", "Short text only.");
      await t.page.waitFor(`document.querySelector("#read-box").hidden`);
    },
  },
  {
    page: "case-converter",
    name: "converts a fixed input in every mode",
    async run(t) {
      const IN = "the quick brown fox jumps over the lazy dog";
      const expect = {
        upper: "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG",
        title: "The Quick Brown Fox Jumps Over the Lazy Dog",
        camel: "theQuickBrownFoxJumpsOverTheLazyDog",
        pascal: "TheQuickBrownFoxJumpsOverTheLazyDog",
        snake: "the_quick_brown_fox_jumps_over_the_lazy_dog",
        kebab: "the-quick-brown-fox-jumps-over-the-lazy-dog",
        constant: "THE_QUICK_BROWN_FOX_JUMPS_OVER_THE_LAZY_DOG",
      };
      for (const [mode, want] of Object.entries(expect)) {
        await t.page.setValue("#text", IN);
        await t.page.click(`[data-mode="${mode}"]`);
        t.eq(await t.page.eval(val("#text")), want, mode);
      }
      await t.page.setValue("#text", "hELLO wORLD. this is it! i think ok");
      await t.page.click('[data-mode="sentence"]');
      t.eq(await t.page.eval(val("#text")), "Hello world. This is it! I think ok", "sentence");
      await t.page.click('[data-mode="lower"]');
      t.eq(await t.page.eval(val("#text")), "hello world. this is it! i think ok", "lower");
      await t.page.setValue("#text", "Hello");
      await t.page.click('[data-mode="alternating"]');
      t.eq(await t.page.eval(val("#text")), "hElLo", "alternating");
      await t.page.setValue("#text", "Hello");
      await t.page.click('[data-mode="inverse"]');
      t.eq(await t.page.eval(val("#text")), "hELLO", "inverse");
      await t.page.click("#undo");
      t.eq(await t.page.eval(val("#text")), "Hello", "undo");
      await t.page.setValue("#text", "fooBar and XMLHttp\nsecond line");
      await t.page.click('[data-mode="snake"]');
      t.eq(await t.page.eval(val("#text")), "foo_bar_and_xml_http\nsecond_line", "snake splits camel and per line");
      await t.shot("done", 1280);
      const { name, bytes } = await t.dl("#dl");
      t.eq(name, "converted-text.txt", "download name");
      t.eq(bytes.toString("utf8"), "foo_bar_and_xml_http\nsecond_line", "download content");
    },
  },
  {
    page: "remove-duplicate-lines",
    name: "dedupes case-insensitively with trim; natural sort; keep last",
    async run(t) {
      await t.page.setValue("#text", "Apple\n apple \nBanana\n\nbanana\nCherry\napple\n10\n9\n");
      await t.page.click("#ci");
      await t.page.click("#trim");
      await t.page.waitFor(`${val("#out")} === "Apple\\nBanana\\nCherry\\n10\\n9"`);
      t.eq(await t.page.eval(txt("#report")), "9 lines in, 5 out, 3 duplicates removed, 1 empty removed", "report");
      await t.page.setValue("#sort", "natural");
      await t.page.waitFor(`${val("#out")} === "9\\n10\\nApple\\nBanana\\nCherry"`);
      await t.page.setValue("#sort", "none");
      await t.page.setValue("#keep", "last");
      await t.page.waitFor(`${val("#out")} === "banana\\nCherry\\napple\\n10\\n9"`);
      await t.page.setValue("#sort", "length");
      await t.page.waitFor(`${val("#out")} === "9\\n10\\napple\\nbanana\\nCherry"`);
      await t.page.setValue("#sort", "shuffle");
      await t.page.waitFor(`${val("#out")}.split("\\n").sort().join("|") === "10|9|Cherry|apple|banana"`);
      await t.page.setValue("#sort", "reverse");
      await t.page.waitFor(`${val("#out")} === "9\\n10\\napple\\nCherry\\nbanana"`);
      await t.shot("done", 375);
      const { bytes } = await t.dl("#dl");
      t.eq(bytes.toString("utf8"), "9\n10\napple\nCherry\nbanana", "download");
    },
  },
  {
    page: "find-and-replace",
    name: "literal counts and replaces; whole word; regex with $1",
    async run(t) {
      await t.page.setValue("#text", "The cat sat on the category mat. Cat!");
      await t.page.setValue("#find", "cat");
      await t.page.waitFor(`${txt("#info")} === "3 matches"`);
      await t.page.click("#whole");
      await t.page.waitFor(`${txt("#info")} === "2 matches"`);
      await t.page.setValue("#repl", "dog$&");
      await t.page.click("#go");
      await t.waitDone();
      t.eq(await t.page.eval(val("#out")), "The dog$& sat on the category mat. dog$&!", "literal result (no $ expansion)");
      t.eq(await t.page.eval(`document.querySelector("#status").textContent`), "Replaced 2 matches.", "status");
      const { bytes } = await t.dl("#dl");
      t.eq(bytes.toString("utf8"), "The dog$& sat on the category mat. dog$&!", "download");
      await t.page.click("#whole");
      await t.page.click("#regex");
      await t.page.setValue("#text", "bob@example alice@site");
      await t.page.setValue("#find", "(\\w+)@(\\w+)");
      await t.page.setValue("#repl", "$2 at $1");
      await t.page.waitFor(`${txt("#info")} === "2 matches"`);
      await t.page.click("#go");
      await t.waitDone();
      t.eq(await t.page.eval(val("#out")), "example at bob site at alice", "regex groups");
      await t.shot("done", 375);
    },
  },
  {
    page: "find-and-replace",
    name: "invalid regex and catastrophic pattern show clear messages",
    async run(t) {
      await t.page.click("#regex");
      await t.page.setValue("#text", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!");
      await t.page.setValue("#find", "(unclosed");
      await t.page.waitFor(`${txt("#info")}.startsWith("Not a valid pattern")`);
      t.eq(await t.page.eval(`document.querySelector("#go").disabled`), true, "replace disabled");
      const t0 = Date.now();
      await t.page.setValue("#find", "^(a+)+$");
      await t.page.waitFor(`${txt("#info")}.includes("took too long")`, { timeout: 8000 });
      t.assert(Date.now() - t0 < 6000, "timeout took too long");
      await t.shot("timeout", 1280);
      // page still responsive: a good pattern works afterwards
      await t.page.setValue("#find", "a+");
      await t.page.waitFor(`${txt("#info")} === "1 match"`);
    },
  },
  {
    page: "text-diff",
    name: "line diff counts and marks added and removed lines",
    async run(t) {
      await t.page.setValue("#a", "a\nb\nc\nd");
      await t.page.setValue("#b", "a\nB\nc\nd\ne");
      await t.page.click("#go");
      await t.waitDone();
      t.eq(await t.page.eval(txt("#sum-add")), "2 lines added", "added");
      t.eq(await t.page.eval(txt("#sum-del")), "1 line removed", "removed");
      const add = await t.page.eval(`[...document.querySelectorAll(".diff__cell--add .diff__txt")].map(e => e.textContent.replace("Added: ", ""))`);
      const del = await t.page.eval(`[...document.querySelectorAll(".diff__cell--del .diff__txt")].map(e => e.textContent.replace("Removed: ", ""))`);
      t.eq(add, ["B", "e"], "added lines in DOM");
      t.eq(del, ["b"], "removed lines in DOM");
      await t.shot("side", 1280);
      await t.page.mouseClick('input[name="layout"][value="inline"]');
      await t.page.waitFor(`document.querySelector(".diff--inline")`);
      await t.shot("inline", 375);
      await t.page.click("#swap");
      await t.page.waitFor(`${txt("#sum-add")} === "1 line added"`);
      t.eq(await t.page.eval(txt("#sum-del")), "2 lines removed", "after swap");
    },
  },
  {
    page: "text-diff",
    name: "word mode and a 10k-line comparison",
    async run(t) {
      await t.page.mouseClick('input[name="mode"][value="words"]');
      await t.page.setValue("#a", "the quick brown fox");
      await t.page.setValue("#b", "the slow brown fox jumps");
      await t.page.click("#go");
      await t.waitDone();
      t.eq(await t.page.eval(txt("#sum-add")), "2 words added", "word adds");
      t.eq(await t.page.eval(txt("#sum-del")), "1 word removed", "word removes");
      await t.page.mouseClick('input[name="mode"][value="lines"]');
      await t.page.eval(`(() => {
        const l = Array.from({length: 10000}, (_, i) => "line number " + i);
        const m = l.slice(); m[100] = "changed 100"; m[5000] = "changed 5000"; m.splice(7000, 1); m.push("tail");
        document.querySelector("#a").value = l.join("\\n"); document.querySelector("#b").value = m.join("\\n"); return true; })()`);
      const t0 = Date.now();
      await t.page.click("#go");
      await t.page.waitFor(`document.querySelector("#status").dataset.state === "done"`, { timeout: 30000 });
      t.assert(Date.now() - t0 < 15000, "10k lines too slow");
      t.eq(await t.page.eval(txt("#sum-add")), "3 lines added", "10k adds");
      t.eq(await t.page.eval(txt("#sum-del")), "3 lines removed", "10k removes");
      t.assert(await t.page.eval(`document.querySelectorAll(".diff__fold").length >= 3`), "unchanged runs folded");
    },
  },
  {
    page: "lorem-ipsum-generator",
    name: "three paragraphs start with the classic line; p tags; words",
    async run(t) {
      await t.page.setValue("#count", "3");
      const out = await t.page.eval(val("#out"));
      t.assert(out.startsWith("Lorem ipsum dolor sit amet"), "starts with classic line");
      t.eq(out.split("\n\n").length, 3, "three blocks");
      await t.page.click("#wrap");
      const tagged = await t.page.eval(val("#out"));
      t.eq(tagged.split("\n\n").length, 3, "three tagged blocks");
      t.assert(tagged.split("\n\n").every((p) => p.startsWith("<p>") && p.endsWith("</p>")), "p tags");
      await t.page.click('input[name="unit"][value="words"]');
      await t.page.setValue("#count", "10");
      const w = await t.page.eval(val("#out"));
      t.eq(w.replace(/\.$/, "").split(" ").length, 10, "ten words");
      await t.page.click("#start");
      await t.page.setValue("#count", "0");
      t.eq(await t.page.eval(val("#out")), "", "invalid count -> empty");
      await t.page.click('input[name="unit"][value="paragraphs"]');
      await t.page.setValue("#count", "2");
      await t.shot("done", 375);
      const { name } = await t.dl("#dl");
      t.eq(name, "lorem-ipsum.txt", "download");
    },
  },
];
