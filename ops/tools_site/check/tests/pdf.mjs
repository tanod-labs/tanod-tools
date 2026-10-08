import { makePdf, makeEncryptedPdf, pdfInfo, save, unzip, imageInfo } from "../fixtures.mjs";

export default [
  {
    page: "merge-pdf",
    name: "merges three PDFs in the chosen order",
    async run(t) {
      const a = save(t.fixtures, "a.pdf", await makePdf(2, { label: "A" }));
      const b = save(t.fixtures, "b.pdf", await makePdf(3, { label: "B" }));
      const c = save(t.fixtures, "c.pdf", await makePdf(1, { label: "C" }));
      await t.page.setFiles("#drop input[type=file]", [a, b, c]);
      await t.page.waitFor(`document.querySelectorAll("#files li").length === 3 && !document.querySelector("#go").disabled && document.querySelector("#summary").textContent.includes("6 pages")`);
      // move c (third) to the top: click its up arrow twice
      await t.page.click(`#files li:nth-child(3) [data-move="-1"]`);
      await t.page.click(`#files li:nth-child(2) [data-move="-1"]`);
      const names = await t.page.eval(`[...document.querySelectorAll("#files .files__name")].map(e => e.firstChild.textContent)`);
      t.eq(names, ["c.pdf", "a.pdf", "b.pdf"], "order after moving");
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "merged.pdf", "file name");
      const info = await pdfInfo(bytes);
      t.eq(info.pages, 6, "page count");
      t.eq(info.widths, [401, 401, 402, 401, 402, 403], "page order by width");
      await t.shot("done", 1280);
    },
  },
  {
    page: "merge-pdf",
    name: "refuses a non-PDF and explains an encrypted PDF",
    async run(t) {
      const txt = save(t.fixtures, "notes.txt", Buffer.from("hello"));
      await t.page.setFiles("#drop input[type=file]", [txt]);
      const msg = await t.waitError();
      t.assert(/isn't a PDF/.test(msg), "non-PDF message: " + msg);
      const enc = save(t.fixtures, "locked.pdf", await makeEncryptedPdf());
      const ok = save(t.fixtures, "ok.pdf", await makePdf(1));
      await t.page.setFiles("#drop input[type=file]", [enc, ok]);
      await t.page.waitFor(`document.querySelector("#files").textContent.includes("encrypted")`);
      await t.page.click("#go");
      const err = await t.waitError();
      t.assert(/password-protected or encrypted/.test(err), "encrypted message: " + err);
      await t.shot("error", 375);
    },
  },
  {
    page: "split-pdf",
    name: "splits by ranges, every N, and every page",
    async run(t) {
      const f = save(t.fixtures, "doc.pdf", await makePdf(7, { label: "S" }));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`!document.querySelector("#opts").hidden && document.querySelectorAll("#plan li").length === 2`);
      t.eq(await t.page.eval(`document.querySelector("#ranges").value`), "1-4, 5-", "default ranges");
      await t.page.setValue("#ranges", "1-2, 3, 5-");
      await t.page.waitFor(`document.querySelectorAll("#plan li").length === 3`);
      await t.page.click("#go");
      await t.waitDone();
      const zip = await t.dl();
      t.eq(zip.name, "doc-split.zip", "zip name");
      const parts = unzip(zip.bytes);
      t.eq(parts.map((p) => p.name), ["doc-pages-1-2.pdf", "doc-page-3.pdf", "doc-pages-5-7.pdf"], "part names");
      const widths = [];
      for (const p of parts) widths.push((await pdfInfo(p.data)).widths);
      t.eq(widths, [[401, 402], [403], [405, 406, 407]], "part pages");
      await t.shot("ranges-done", 375);
      // every 3 pages
      await t.page.click('input[name="mode"][value="every"]');
      await t.page.setValue("#every", "3");
      await t.page.waitFor(`document.querySelectorAll("#plan li").length === 3 && !document.querySelector("#go").disabled`);
      await t.page.click("#go");
      await t.waitDone();
      const every = unzip((await t.dl()).bytes);
      const counts = [];
      for (const p of every) counts.push((await pdfInfo(p.data)).pages);
      t.eq(counts, [3, 3, 1], "every 3 pages");
      // every page
      await t.page.click('input[name="mode"][value="single"]');
      await t.page.waitFor(`document.querySelectorAll("#plan li").length === 7`);
      await t.page.click("#go");
      await t.waitDone();
      t.eq(unzip((await t.dl()).bytes).length, 7, "one file per page");
      // bad range
      await t.page.click('input[name="mode"][value="ranges"]');
      await t.page.setValue("#ranges", "2-9");
      const err = await t.waitError();
      t.assert(/past the last page/.test(err), "range error: " + err);
      t.assert(await t.page.eval(`document.querySelector("#go").disabled`), "button disabled on bad range");
    },
  },
  {
    page: "extract-pdf-pages",
    name: "extracts clicked pages and typed ranges in typed order",
    async run(t) {
      const f = save(t.fixtures, "ex.pdf", await makePdf(6, { label: "E" }));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`document.querySelectorAll("#grid .thumb").length === 6`);
      await t.page.waitFor(`document.querySelectorAll("#grid .thumb canvas").length === 6`, { message: "thumbnails rendered" });
      await t.page.click(`#grid .thumb:nth-child(2) .thumb__hit`);
      await t.page.click(`#grid .thumb:nth-child(4) .thumb__hit`);
      await t.page.click(`#grid .thumb:nth-child(5) .thumb__hit`);
      t.eq(await t.page.eval(`document.querySelector("#ranges").value`), "2, 4-5", "ranges synced from clicks");
      await t.shot("selected", 1280);
      await t.page.click("#go");
      await t.waitDone();
      let out = await t.dl();
      t.eq(out.name, "ex-extracted.pdf", "name");
      t.eq((await pdfInfo(out.bytes)).widths, [402, 404, 405], "clicked pages");
      await t.page.setValue("#ranges", "6, 1-2");
      await t.page.waitFor(`[...document.querySelectorAll("#grid .thumb.is-selected")].map(e => e.dataset.index).join() === "0,1,5"`);
      await t.page.click("#go");
      await t.waitDone();
      out = await t.dl();
      t.eq((await pdfInfo(out.bytes)).widths, [406, 401, 402], "typed order kept");
      await t.page.click("#each");
      await t.page.click("#go");
      await t.waitDone();
      const parts = unzip((await t.dl()).bytes);
      t.eq(parts.map((p) => p.name), ["ex-page-6.pdf", "ex-page-1.pdf", "ex-page-2.pdf"], "one file per page");
      await t.shot("done", 375);
    },
  },
  {
    page: "remove-pdf-pages",
    name: "removes selected pages and refuses removing all",
    async run(t) {
      const f = save(t.fixtures, "rm.pdf", await makePdf(5, { label: "R" }));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`document.querySelectorAll("#grid .thumb").length === 5`);
      await t.page.setValue("#ranges", "2, 4");
      await t.page.waitFor(`document.querySelectorAll("#grid .thumb.is-selected").length === 2 && !document.querySelector("#go").disabled`);
      await t.page.waitFor(`document.querySelectorAll("#grid .thumb canvas").length === 5`);
      await t.shot("selected", 375);
      await t.page.click("#go");
      await t.waitDone();
      const out = await t.dl();
      t.eq(out.name, "rm-edited.pdf", "name");
      t.eq((await pdfInfo(out.bytes)).widths, [401, 403, 405], "remaining pages");
      await t.page.click("#all");
      await t.page.waitFor(`document.querySelector("#go").disabled && document.querySelector("#summary").textContent.includes("has to stay")`);
    },
  },
  {
    page: "rotate-pdf",
    name: "rotates single pages and all pages",
    async run(t) {
      const f = save(t.fixtures, "rot.pdf", await makePdf(3, { label: "T" }));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`document.querySelectorAll("#grid .thumb").length === 3`);
      t.assert(await t.page.eval(`document.querySelector("#go").disabled`), "disabled before any rotation");
      await t.page.click(`#grid .thumb:nth-child(1) [aria-label^="Rotate page 1 right"]`);
      await t.page.click(`#grid .thumb:nth-child(3) [aria-label^="Rotate page 3 left"]`);
      await t.page.waitFor(`document.querySelectorAll("#grid .thumb canvas").length === 3`);
      await t.shot("rotated", 1280, { selector: "#tool" });
      await t.page.click("#go");
      await t.waitDone();
      let out = await t.dl();
      t.eq((await pdfInfo(out.bytes)).rotations, [90, 0, 270], "per-page rotation");
      await t.page.click("#all-right");
      await t.page.click("#go");
      await t.waitDone();
      out = await t.dl();
      t.eq((await pdfInfo(out.bytes)).rotations, [180, 90, 0], "rotate all right on top");
    },
  },
  {
    page: "reorder-pdf-pages",
    name: "reorders with buttons, drag and reverse",
    async run(t) {
      const f = save(t.fixtures, "ord.pdf", await makePdf(4, { label: "O" }));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`document.querySelectorAll("#grid .thumb").length === 4`);
      // move page 4 earlier twice -> 1,4,2,3
      await t.page.click(`#grid .thumb[data-index="3"] [data-move="-1"]`);
      await t.page.click(`#grid .thumb[data-index="3"] [data-move="-1"]`);
      t.eq(await t.page.eval(`[...document.querySelectorAll("#grid .thumb")].map(e => +e.dataset.index + 1)`), [1, 4, 2, 3], "order after moves");
      // synthetic drag: drop page 1 onto the right half of page 3 -> 4,2,3,1
      await t.page.eval(`(() => {
        const src = document.querySelector('#grid .thumb[data-index="0"]');
        const dst = document.querySelector('#grid .thumb[data-index="2"]');
        const dt = new DataTransfer();
        const r = dst.getBoundingClientRect();
        src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
        dst.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.right - 5, clientY: r.top + 5 }));
        dst.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.right - 5, clientY: r.top + 5 }));
        src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
        return true;
      })()`);
      t.eq(await t.page.eval(`[...document.querySelectorAll("#grid .thumb")].map(e => +e.dataset.index + 1)`), [4, 2, 3, 1], "order after drag");
      await t.page.waitFor(`document.querySelectorAll("#grid .thumb canvas").length === 4`);
      await t.shot("moved", 375, { selector: "#tool" });
      await t.page.click("#go");
      await t.waitDone();
      let out = await t.dl();
      t.eq((await pdfInfo(out.bytes)).widths, [404, 402, 403, 401], "saved order");
      await t.page.click("#reset");
      await t.page.click("#reverse");
      await t.page.click("#go");
      await t.waitDone();
      out = await t.dl();
      t.eq((await pdfInfo(out.bytes)).widths, [404, 403, 402, 401], "reversed");
    },
  },
];
