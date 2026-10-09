const text = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).textContent`);
const wait = (page, expr) => page.waitFor(expr);
const levels = (page) => page.eval(`Object.fromEntries([...document.querySelectorAll("#l-list li")].map((li) => [li.querySelector(".ll-r__name").textContent, li.dataset.level]))`);

const good = {
  x402Version: 2,
  resource: { url: "https://api.example.com/v1/x", description: "Returns X for a city. Use when an agent needs X before booking.", mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "10000", payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" }],
  extensions: { bazaar: { schema: { properties: { output: { type: "object" } } } } },
};
const bad = {
  x402Version: 1,
  accepts: [{ scheme: "exact", network: "base", resource: "http://api.example.com/x", description: "x".repeat(501), mimeType: "", maxAmountRequired: "0.01", asset: "", payTo: "nope" }],
};

export default [
  {
    page: "x402-listing-lint",
    name: "passes a good v2 listing and flags the missing rules on a bad v1 one",
    async run(t) {
      await t.page.setValue("#l-in", JSON.stringify(good));
      await wait(t.page, `!document.querySelector("#l-result").hidden`);
      let l = await levels(t.page);
      t.eq(l["Description"], "pass", "description");
      t.eq(l["Description length"], "pass", "length");
      t.eq(l["When-to-use sentence"], "pass", "when");
      t.eq(l["outputSchema"], "pass", "schema");
      t.eq(l["payTo"], "pass", "payTo");
      t.eq(await text(t.page, "#l-sum"), "0 fail, 0 warn, 10 pass", "summary");

      await t.page.setValue("#l-in", JSON.stringify(bad));
      await wait(t.page, `document.querySelector("#l-sum").dataset.fail !== "0"`);
      l = await levels(t.page);
      t.eq(l["Description length"], "fail", "over 500");
      t.eq(l["When-to-use sentence"], "warn", "no when");
      t.eq(l["Resource URL"], "fail", "http");
      t.eq(l["mimeType"], "fail", "mime");
      t.eq(l["outputSchema"], "fail", "schema");
      t.eq(l["Amount"], "fail", "amount");
      t.eq(l["Network"], "pass", "network");
      t.eq(l["Asset"], "fail", "asset");
      t.eq(l["payTo"], "fail", "payTo");
      t.assert((await text(t.page, ".ll-r--fail .ll-r__fix")).startsWith("Fix: "), "fix line");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "x402-listing-lint",
    name: "bad JSON shows an error, base64 header decodes, URL gives a curl command",
    async run(t) {
      await t.page.setValue("#l-in", "{nope");
      const msg = await t.waitError();
      t.assert(/Not valid JSON/.test(msg), msg);
      const b64 = Buffer.from(JSON.stringify(good)).toString("base64");
      await t.page.setValue("#l-in", b64);
      await wait(t.page, `!document.querySelector("#l-result").hidden`);
      t.eq(await text(t.page, "#l-sum"), "0 fail, 0 warn, 10 pass", "base64 summary");
      await t.page.setValue("#l-url", "https://api.example.com/v1/x");
      await wait(t.page, `!document.querySelector("#l-curl").hidden`);
      t.eq(await text(t.page, "#l-curl"), "curl -s -i 'https://api.example.com/v1/x'", "curl");
    },
  },
];
