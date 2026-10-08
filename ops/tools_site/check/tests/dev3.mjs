// Developer tools set 3: JSON to TypeScript, subnet calculator, chmod calculator, HTTP status codes, user agent parser, cron generator.
const txt = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent.trim()`;
const all = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim())`;
const val = (sel) => `document.querySelector(${JSON.stringify(sel)}).value`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const runIsos = `[...document.querySelectorAll("#g-runs time")].map((e) => e.getAttribute("datetime"))`;

/* ------------------------------------------------------------------ independent IPv4 reference (plain numbers) */
const dotted = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
function refV4(ip, p) {
  const o = ip.split(".").map(Number);
  const a = ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
  const size = 2 ** (32 - p);
  const net = Math.floor(a / size) * size;
  const last = net + size - 1;
  return {
    network: `${dotted(net)}/${p}`, netmask: dotted(2 ** 32 - size), wildcard: dotted(size - 1),
    broadcast: p >= 31 ? null : dotted(last), first: dotted(p >= 31 ? net : net + 1), last: dotted(p >= 31 ? last : last - 1),
    total: group(size), usable: group(p === 32 ? 1 : p === 31 ? 2 : size - 2),
    bin: (n) => [24, 16, 8, 0].map((s) => (Math.floor(n / 2 ** s) % 256).toString(2).padStart(8, "0")).join("."),
    addrBin: [24, 16, 8, 0].map((s) => (Math.floor(a / 2 ** s) % 256).toString(2).padStart(8, "0")).join("."),
    maskBin: [24, 16, 8, 0].map((s) => (Math.floor((2 ** 32 - size) / 2 ** s) % 256).toString(2).padStart(8, "0")).join("."),
    normalised: a !== net,
  };
}
const snRow = (k) => txt(`#s-rows [data-k="${k}"] dd`);
async function subnet(t, text) {
  await t.page.setValue("#s-in", text);
  await t.page.waitFor(`document.querySelector("#s-in").value === ${JSON.stringify(text)} && (${txt("#s-info")}).length > 0`);
  await sleep(220);
}

/* ------------------------------------------------------------------ JSON to TypeScript helpers */
async function setChk(t, sel, on) {
  if ((await t.page.eval(`document.querySelector(${JSON.stringify(sel)}).checked`)) !== on) await t.page.click(sel);
}
async function ts(t, json, o = {}) {
  const { root = "Root", style = "interface", exp = true, ro = false, opt = true } = o;
  await t.page.setValue("#t-root", root);
  await t.page.click(`input[name="t-style"][value="${style}"]`);
  await setChk(t, "#t-export", exp);
  await setChk(t, "#t-readonly", ro);
  await setChk(t, "#t-optional", opt);
  await t.page.setValue("#t-in", json);
  await sleep(260);
  return t.page.eval(`document.querySelector("#t-out").textContent`);
}

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  ffLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
  samsung: "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  curl: "curl/8.4.0",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
};
const uaRow = (k) => txt(`#u-rows [data-k="${k}"] dd`);
async function parseUa(t, ua) {
  await t.page.setValue("#u-in", ua);
  await t.page.waitFor(`document.querySelector("#u-in").value === ${JSON.stringify(ua)}`);
  await sleep(250);
}

export default [
  /* ============================================================ JSON to TypeScript */
  {
    page: "json-to-typescript",
    name: "default sample: nested names, null, array item merge with optional field",
    async run(t) {
      await sleep(250);
      const want = `export interface Root {
  id: number;
  name: string;
  email: null;
  tags: string[];
  address: Address;
  orders: Order[];
}

export interface Address {
  city: string;
  geo: Geo;
}

export interface Geo {
  lat: number;
  lng: number;
}

export interface Order {
  sku: string;
  qty: number;
  gift?: boolean;
}
`;
      t.eq(await t.page.eval(`document.querySelector("#t-out").textContent`), want, "default output");
      t.eq(await t.page.eval(txt("#t-info")), "4 declarations generated.", "info");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "json-to-typescript",
    name: "top-level array: merged shapes, optional, null union",
    async run(t) {
      t.eq(await ts(t, '[{"id":1,"name":"a","tags":["x"]},{"id":2,"name":null,"nick":"z"}]'),
        `export type Root = RootItem[];

export interface RootItem {
  id: number;
  name: string | null;
  tags?: string[];
  nick?: string;
}
`, "array root");
      t.eq(await ts(t, '[{"a":1},{"a":2,"b":null}]', { opt: false }), `export type Root = RootItem[];

export interface RootItem {
  a: number;
  b: null;
}
`, "optional detection off: b is not optional, null only");
      t.eq(await ts(t, '[{"a":1},{"a":2,"b":null}]'), `export type Root = RootItem[];

export interface RootItem {
  a: number;
  b?: null;
}
`, "optional detection on");
    },
  },
  {
    page: "json-to-typescript",
    name: "mixed arrays, empty array, nested arrays, union members",
    async run(t) {
      t.eq(await ts(t, '{"a":[1,"x",true,null],"b":[],"c":[[1,2],[3]],"d":[{"x":1},{"x":"s"}],"e":[1,null]}'),
        `export interface Root {
  a: (string | number | boolean | null)[];
  b: unknown[];
  c: number[][];
  d: DItem[];
  e: (number | null)[];
}

export interface DItem {
  x: string | number;
}
`, "mixed");
      t.eq(await ts(t, "[]"), "export type Root = unknown[];\n", "empty root array");
      t.eq(await ts(t, "[1,\"a\"]"), "export type Root = (string | number)[];\n", "mixed root array");
      t.eq(await ts(t, '[[1],["a"]]'), "export type Root = (string | number)[][];\n", "nested mixed");
    },
  },
  {
    page: "json-to-typescript",
    name: "keys that are not identifiers are quoted",
    async run(t) {
      t.eq(await ts(t, '{"first-name":"A","2fast":1,"ok_key":2,"$x":3,"":4,"class":5,"a b":6}'), `export interface Root {
  "first-name": string;
  "2fast": number;
  ok_key: number;
  $x: number;
  "": number;
  class: number;
  "a b": number;
}
`, "quoting");
      t.eq(await ts(t, '{"billing_address":{"zip-code":"1"}}'), `export interface Root {
  billing_address: BillingAddress;
}

export interface BillingAddress {
  "zip-code": string;
}
`, "PascalCase from snake_case key");
    },
  },
  {
    page: "json-to-typescript",
    name: "identical shapes share one declaration; clashes are numbered; built-in names avoided",
    async run(t) {
      t.eq(await ts(t, '{"user":{"id":1},"owner":{"user":{"id":"a"}},"team":[{"id":1},{"id":2}]}'), `export interface Root {
  user: User;
  owner: Owner;
  team: User[];
}

export interface User {
  id: number;
}

export interface Owner {
  user: User2;
}

export interface User2 {
  id: string;
}
`, "dedup + User2");
      t.eq(await ts(t, '{"billing":{"street":"a"},"shipping":{"street":"b"}}'), `export interface Root {
  billing: Billing;
  shipping: Billing;
}

export interface Billing {
  street: string;
}
`, "same shape under two keys");
      t.eq(await ts(t, '{"date":{"x":1}}'), `export interface Root {
  date: Date2;
}

export interface Date2 {
  x: number;
}
`, "Date is a built-in: Date2");
    },
  },
  {
    page: "json-to-typescript",
    name: "item names from plural keys",
    async run(t) {
      t.eq(await ts(t, '{"users":[{"n":1}],"address":[{"a":1}],"status":[{"s":"x"}],"ids":[{"i":1}]}'), `export interface Root {
  users: User[];
  address: AddressItem[];
  status: StatusItem[];
  ids: IdsItem[];
}

export interface User {
  n: number;
}

export interface AddressItem {
  a: number;
}

export interface StatusItem {
  s: string;
}

export interface IdsItem {
  i: number;
}
`, "item names");
    },
  },
  {
    page: "json-to-typescript",
    name: "options: type alias, readonly, no export, custom root; primitives at the top level",
    async run(t) {
      t.eq(await ts(t, '[{"a":1},{"a":2,"b":[1]}]', { root: "Items", style: "type", exp: false, ro: true, opt: false }), `type Items = readonly Item[];

type Item = {
  readonly a: number;
  readonly b: readonly number[];
};
`, "type, readonly, no export");
      t.eq(await ts(t, '{"a":1}', { root: "ApiResponse" }), "export interface ApiResponse {\n  a: number;\n}\n", "root name");
      t.eq(await ts(t, '{"a":[1,"x"]}', { style: "type", ro: true }), "export type Root = {\n  readonly a: readonly (string | number)[];\n};\n", "readonly union array");
      t.eq(await ts(t, "42"), "export type Root = number;\n", "number root");
      t.eq(await ts(t, '"s"'), "export type Root = string;\n", "string root");
      t.eq(await ts(t, "null"), "export type Root = null;\n", "null root");
      t.eq(await ts(t, "true"), "export type Root = boolean;\n", "boolean root");
      t.eq(await ts(t, "{}"), "export interface Root {}\n", "empty object");
      t.eq(await ts(t, "{}", { style: "type" }), "export type Root = {};\n", "empty object as type");
    },
  },
  {
    page: "json-to-typescript",
    name: "errors for bad JSON and bad type names; download",
    async run(t) {
      await ts(t, "{a:1}");
      t.assert((await t.page.eval(txt("#t-info"))).startsWith("This isn't valid JSON"), "invalid JSON message");
      t.eq(await t.page.eval(`document.querySelector("#t-in").getAttribute("aria-invalid")`), "true", "aria-invalid on input");
      t.eq(await t.page.eval(`document.querySelector("#t-out").textContent`), "", "no output on error");
      await ts(t, '{"a":1}', { root: "1abc" });
      t.assert((await t.page.eval(txt("#t-info"))).includes("can't be used as a type name"), "bad type name message");
      t.eq(await t.page.eval(`document.querySelector("#t-root").getAttribute("aria-invalid")`), "true", "aria-invalid on name");
      await ts(t, '{"a":1}', { root: "Thing" });
      const f = await t.dl("#t-dl");
      t.eq(f.name, "Thing.ts", "download name");
      t.eq(f.bytes.toString("utf8"), "export interface Thing {\n  a: number;\n}\n", "download content");
    },
  },

  /* ============================================================ subnet calculator */
  {
    page: "subnet-calculator",
    name: "192.168.1.10/24 in full, with normalisation note and binary view",
    async run(t) {
      await sleep(200);
      t.eq(await t.page.eval(txt("#s-info")), "IPv4 subnet 192.168.1.0/24.", "info");
      t.eq(await t.page.eval(snRow("network")), "192.168.1.0/24", "network");
      t.eq(await t.page.eval(snRow("netmask")), "255.255.255.0", "netmask");
      t.eq(await t.page.eval(snRow("wildcard")), "0.0.0.255", "wildcard");
      t.eq(await t.page.eval(snRow("broadcast")), "192.168.1.255", "broadcast");
      t.eq(await t.page.eval(snRow("first")), "192.168.1.1", "first");
      t.eq(await t.page.eval(snRow("last")), "192.168.1.254", "last");
      t.eq(await t.page.eval(snRow("total")), "256", "total");
      t.eq(await t.page.eval(snRow("usable")), "254", "usable");
      t.eq(await t.page.eval(snRow("type")), "Private (RFC 1918)", "type");
      t.eq(await t.page.eval(snRow("bin-addr")), "11000000.10101000.00000001.00001010", "binary address");
      t.eq(await t.page.eval(snRow("bin-mask")), "11111111.11111111.11111111.00000000", "binary mask");
      t.eq(await t.page.eval(snRow("bin-net")), "11000000.10101000.00000001.00000000", "binary network");
      t.eq(await t.page.eval(`document.querySelectorAll('[data-k="bin-addr"] .sn-net')[0].textContent`), "11000000.10101000.00000001.", "network bits emphasised (24 bits and the dots between)");
      const note = await t.page.eval(txt("#s-note"));
      t.assert(note.includes("normalised to 192.168.1.0/24") && note.includes("host bits set"), "normalisation note: " + note);
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "subnet-calculator",
    name: "boundaries /0 /8 /24 /30 /31 /32 against an independent calculation",
    async run(t) {
      for (const [ip, p] of [["10.0.0.0", 8], ["172.16.40.9", 24], ["203.0.113.77", 30], ["198.51.100.4", 31], ["8.8.8.8", 32], ["0.0.0.0", 0], ["10.5.5.5", 0], ["192.168.200.201", 17], ["1.2.3.4", 29]]) {
        const r = refV4(ip, p);
        await subnet(t, `${ip}/${p}`);
        const label = `${ip}/${p}`;
        t.eq(await t.page.eval(snRow("network")), r.network, label + " network");
        t.eq(await t.page.eval(snRow("netmask")), r.netmask, label + " netmask");
        t.eq(await t.page.eval(snRow("wildcard")), r.wildcard, label + " wildcard");
        t.eq(await t.page.eval(snRow("first")), r.first, label + " first");
        t.eq(await t.page.eval(snRow("last")), r.last, label + " last");
        t.eq(await t.page.eval(snRow("total")), r.total, label + " total");
        t.eq(await t.page.eval(snRow("usable")), r.usable, label + " usable");
        t.eq(await t.page.eval(snRow("bin-addr")), r.addrBin, label + " binary address");
        t.eq(await t.page.eval(snRow("bin-mask")), r.maskBin, label + " binary mask");
        const b = await t.page.eval(snRow("broadcast"));
        if (r.broadcast) t.eq(b, r.broadcast, label + " broadcast");
        else t.assert(b.startsWith("None"), label + " has no broadcast: " + b);
      }
      await subnet(t, "10.0.0.0/8");
      t.eq(await t.page.eval(snRow("usable")), "16,777,214", "10.0.0.0/8 usable, exact text");
      await subnet(t, "192.168.1.0/31");
      t.assert((await t.page.eval(snRow("broadcast"))).includes("RFC 3021"), "/31 broadcast row cites RFC 3021");
      t.assert((await t.page.eval(txt("#s-note"))).includes("both are usable"), "/31 note");
      t.eq([await t.page.eval(snRow("first")), await t.page.eval(snRow("last"))], ["192.168.1.0", "192.168.1.1"], "/31 hosts");
      await subnet(t, "192.168.1.7/32");
      t.assert((await t.page.eval(txt("#s-note"))).includes("single host"), "/32 note");
      t.eq(await t.page.eval(`document.querySelector("#s-note").textContent.includes("normalised")`), false, "no normalisation note for /32");
      await subnet(t, "0.0.0.0/0");
      t.assert((await t.page.eval(txt("#s-note"))).includes("entire IPv4 address space"), "/0 note");
      t.eq(await t.page.eval(snRow("total")), "4,294,967,296", "/0 total");
    },
  },
  {
    page: "subnet-calculator",
    name: "address plus mask forms and prefix-less input",
    async run(t) {
      for (const text of ["192.168.1.10 255.255.255.0", "192.168.1.10/255.255.255.0", "  192.168.1.10/24  "]) {
        await subnet(t, text);
        t.eq(await t.page.eval(snRow("network")), "192.168.1.0/24", text);
      }
      await subnet(t, "172.16.5.9 255.255.240.0");
      t.eq(await t.page.eval(snRow("network")), "172.16.0.0/20", "mask /20");
      t.eq(await t.page.eval(snRow("last")), "172.16.15.254", "/20 last host");
      await subnet(t, "10.1.2.3");
      t.eq(await t.page.eval(snRow("network")), "10.1.2.3/32", "no prefix is a /32");
      t.assert((await t.page.eval(txt("#s-info"))).includes("no prefix given"), "says no prefix given");
    },
  },
  {
    page: "subnet-calculator",
    name: "IPv4 address types",
    async run(t) {
      const cases = [
        ["10.1.1.1/32", "Private (RFC 1918)"], ["172.16.0.1/32", "Private (RFC 1918)"], ["172.31.255.255/32", "Private (RFC 1918)"],
        ["172.32.0.1/32", "Public (globally routable)"], ["172.15.255.255/32", "Public (globally routable)"], ["192.168.0.1/32", "Private (RFC 1918)"],
        ["100.64.1.1/32", "Carrier-grade NAT shared space (RFC 6598)"], ["100.127.255.255/32", "Carrier-grade NAT shared space (RFC 6598)"], ["100.128.0.1/32", "Public (globally routable)"],
        ["127.0.0.1/8", "Loopback (RFC 1122)"], ["169.254.10.10/16", "Link-local (RFC 3927)"], ["224.0.0.251/32", "Multicast (RFC 5771)"], ["239.1.1.1/32", "Multicast (RFC 5771)"],
        ["192.0.2.5/24", "Documentation, TEST-NET-1 (RFC 5737)"], ["198.51.100.9/24", "Documentation, TEST-NET-2 (RFC 5737)"], ["203.0.113.9/24", "Documentation, TEST-NET-3 (RFC 5737)"],
        ["8.8.8.8/32", "Public (globally routable)"], ["1.1.1.1/32", "Public (globally routable)"],
      ];
      for (const [text, want] of cases) { await subnet(t, text); t.eq(await t.page.eval(snRow("type")), want, text); }
      await subnet(t, "10.0.0.0/7");
      t.assert((await t.page.eval(snRow("type"))).startsWith("Mixed"), "a range that straddles private and public is labelled mixed");
    },
  },
  {
    page: "subnet-calculator",
    name: "IPv4 errors: octets, leading zeros, counts, prefix, masks",
    async run(t) {
      const err = async (text) => { await subnet(t, text); return { msg: await t.page.eval(txt("#s-info")), bad: await t.page.eval(`document.querySelector("#s-in").getAttribute("aria-invalid")`), hidden: await t.page.eval(`document.querySelector("#s-result").hidden`) }; };
      let e = await err("1.2.3.256");
      t.assert(e.msg.includes("256 is larger than 255") && e.bad === "true" && e.hidden, "256: " + e.msg);
      e = await err("010.0.0.1");
      t.assert(e.msg.includes("leading zero") && e.msg.includes("octal") && e.msg.includes("ambiguous"), "010: " + e.msg);
      e = await err("1.2.3");
      t.assert(e.msg.includes("3 parts") && e.msg.includes("exactly 4"), "3 parts: " + e.msg);
      e = await err("1.2.3.4.5");
      t.assert(e.msg.includes("5 parts"), "5 parts: " + e.msg);
      e = await err("1.2.3.4/33");
      t.assert(e.msg.includes("/33 is too long"), "/33: " + e.msg);
      e = await err("1.2.3.4/255.0.255.0");
      t.assert(e.msg.includes("isn't a valid subnet mask"), "non-contiguous mask: " + e.msg);
      e = await err("1.2.3.4/0.0.0.255");
      t.assert(e.msg.includes("isn't a valid subnet mask"), "wildcard as mask: " + e.msg);
      e = await err("1.2.3.x");
      t.assert(e.msg.includes("isn't a number"), "letters: " + e.msg);
      e = await err("1.2.3.4/");
      t.assert(e.msg.includes("nothing after the /"), "empty prefix: " + e.msg);
      e = await err("");
      t.assert(e.msg.startsWith("Type an address"), "empty: " + e.msg);
      await subnet(t, "1.2.3.4/24");
      t.eq(await t.page.eval(`document.querySelector("#s-in").getAttribute("aria-invalid")`), "false", "error clears");
      await subnet(t, "0.0.0.0/0");
      t.eq(await t.page.eval(snRow("netmask")), "0.0.0.0", "0.0.0.0 is a fine address");
      await subnet(t, "255.255.255.255/32");
      t.eq(await t.page.eval(snRow("network")), "255.255.255.255/32", "255.255.255.255 is accepted");
      await t.page.setValue("#s-in", "1.2.3.256");
      await sleep(250);
      await t.shot("error", 375);
    },
  },
  {
    page: "subnet-calculator",
    name: "IPv6: counts, prefixes, RFC 5952 compression, expanded form, types",
    async run(t) {
      const v6 = async (text) => { await subnet(t, text); };
      await v6("2001:db8::/32");
      t.eq(await t.page.eval(snRow("count")), group(2n ** 96n), "2001:db8::/32 count, grouped");
      t.eq(await t.page.eval(snRow("count")), "79,228,162,514,264,337,593,543,950,336", "literal");
      t.eq(await t.page.eval(snRow("power")), "2^96", "power");
      t.eq(await t.page.eval(snRow("network")), "2001:db8::/32", "network");
      t.eq(await t.page.eval(snRow("first")), "2001:db8::", "first");
      t.eq(await t.page.eval(snRow("last")), "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", "last");
      t.eq(await t.page.eval(snRow("type")), "Documentation (2001:db8::/32, RFC 3849)", "type");
      t.eq(await t.page.eval(snRow("network-full")), "2001:0db8:0000:0000:0000:0000:0000:0000/32", "expanded network");
      await v6("::/0");
      t.eq(await t.page.eval(snRow("count")), group(2n ** 128n), "::/0 count");
      t.eq(await t.page.eval(snRow("network")), "::/0", "::/0 network");
      t.eq(await t.page.eval(snRow("last")), "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "::/0 last");
      t.assert((await t.page.eval(txt("#s-note"))).includes("entire IPv6 address space"), "/0 note");
      await v6("::1/128");
      t.eq(await t.page.eval(snRow("count")), "1", "::1/128 count");
      t.eq(await t.page.eval(snRow("type")), "Loopback (::1)", "loopback");
      t.eq(await t.page.eval(snRow("first")), "::1", "first");
      await v6("::");
      t.eq(await t.page.eval(snRow("type")), "Unspecified address (::)", "unspecified");
      t.eq(await t.page.eval(snRow("network")), "::/128", "no prefix is /128");
      // RFC 5952
      await v6("2001:db8:0:0:1:0:0:1");
      t.eq(await t.page.eval(snRow("addr")), "2001:db8::1:0:0:1", "tie: leftmost run compressed");
      t.eq(await t.page.eval(snRow("addr-full")), "2001:0db8:0000:0000:0001:0000:0000:0001", "expanded");
      await v6("2001:db8:0:1:1:1:1:1");
      t.eq(await t.page.eval(snRow("addr")), "2001:db8:0:1:1:1:1:1", "single zero group is not compressed");
      await v6("2001:0DB8:0000:0000:0000:0000:0000:0001");
      t.eq(await t.page.eval(snRow("addr")), "2001:db8::1", "lower case, leading zeros dropped");
      await v6("1:0:0:2:0:0:0:3");
      t.eq(await t.page.eval(snRow("addr")), "1:0:0:2::3", "longest run wins");
      await v6("1:2:3:4:5:6:7::");
      t.eq(await t.page.eval(snRow("addr")), "1:2:3:4:5:6:7:0", ":: standing for one group parses, and is printed as a plain 0");
      await v6("fe80::");
      t.eq(await t.page.eval(snRow("addr")), "fe80::", "trailing run");
      await v6("0:0:0:0:0:0:0:1");
      t.eq(await t.page.eval(snRow("addr")), "::1", "leading run");
      // embedded IPv4
      await v6("::ffff:192.0.2.1");
      t.eq(await t.page.eval(snRow("addr")), "::ffff:c000:201", "IPv4-mapped in hex");
      t.eq(await t.page.eval(snRow("addr-mixed")), "::ffff:192.0.2.1", "mixed notation row");
      t.eq(await t.page.eval(snRow("type")), "IPv4-mapped (::ffff:0:0/96)", "mapped type");
      await v6("64:ff9b::192.0.2.33");
      t.eq(await t.page.eval(snRow("addr")), "64:ff9b::c000:221", "NAT64 with embedded IPv4");
      // types
      for (const [text, want] of [["fe80::1/64", "Link-local unicast (fe80::/10)"], ["fd12:3456:789a::/48", "Unique local address, ULA (fc00::/7)"], ["fc00::/7", "Unique local address, ULA (fc00::/7)"],
        ["ff02::1/128", "Multicast (ff00::/8)"], ["2606:4700::1/128", "Global unicast (2000::/3)"], ["3fff::/20", "Documentation (3fff::/20, RFC 9637)"], ["4000::/3", "Reserved or unassigned (outside the global unicast range 2000::/3)"]]) {
        await v6(text); t.eq(await t.page.eval(snRow("type")), want, text);
      }
      // normalisation
      await v6("2001:db8::1/32");
      t.eq(await t.page.eval(snRow("network")), "2001:db8::/32", "normalised network");
      t.assert((await t.page.eval(txt("#s-note"))).includes("normalised to 2001:db8::/32"), "normalisation note");
      await v6("[2001:db8::1]/64");
      t.eq(await t.page.eval(snRow("network")), "2001:db8::/64", "brackets accepted");
      await v6("2001:db8:0:0:1:0:0:1/64");
      await t.shot("v6", 375);
      await t.shot("v6", 1280);
    },
  },
  {
    page: "subnet-calculator",
    name: "IPv6 errors: double ::, 9 groups, bad groups, zone IDs, IPv4 mask",
    async run(t) {
      const msg = async (text) => { await subnet(t, text); return t.page.eval(txt("#s-info")); };
      t.assert((await msg("1::2::3")).includes("only once"), "two ::");
      t.assert((await msg("1:2:3:4:5:6:7:8:9")).includes("8 groups, but this has 9"), "9 groups");
      t.assert((await msg("1:2:3:4:5:6:7")).includes("8 groups, but this has 7"), "7 groups");
      t.assert((await msg("12345::1")).includes("1 to 4 hexadecimal digits"), "group too long");
      t.assert((await msg("1:2:3:4:5:6:7:8::")).includes("at most 7"), ":: with 8 groups");
      t.assert((await msg(":::")).includes("Three colons"), "three colons");
      t.assert((await msg(":1:2:3:4:5:6:7")).includes("single colon"), "leading colon");
      t.assert((await msg("1:2:3:4:5:6:7:")).includes("single colon"), "trailing colon");
      t.assert((await msg("fe80::1%eth0")).includes("zone ID"), "zone id");
      t.assert((await msg("::g")).includes("don't belong"), "non-hex character");
      t.assert((await msg("::1.2.3.4:5")).includes("embedded IPv4"), "IPv4 part not last");
      t.assert((await msg("::1.2.3.256")).includes("256 is larger than 255"), "bad embedded IPv4");
      t.assert((await msg("2001:db8::/129")).includes("/129 is too long"), "prefix 129");
      t.assert((await msg("2001:db8::/255.255.0.0")).includes("IPv6 uses prefix lengths"), "dotted mask on IPv6");
      t.eq(await t.page.eval(`document.querySelector("#s-in").getAttribute("aria-invalid")`), "true", "aria-invalid");
    },
  },
  {
    page: "subnet-calculator",
    name: "subnet split: /26s, 256-row cap, IPv6, invalid prefix",
    async run(t) {
      const split = async (v) => { await t.page.setValue("#s-split", v); await sleep(250); };
      await subnet(t, "192.168.1.0/24");
      await split("26");
      t.eq(await t.page.eval(all("#s-table tbody tr td:nth-child(2)")), ["192.168.1.0/26", "192.168.1.64/26", "192.168.1.128/26", "192.168.1.192/26"], "four /26s");
      t.eq(await t.page.eval(all("#s-table tbody tr:first-child td")), ["1", "192.168.1.0/26", "192.168.1.1 – 192.168.1.62", "192.168.1.63"], "first row");
      t.eq(await t.page.eval(all("#s-table tbody tr:last-child td")), ["4", "192.168.1.192/26", "192.168.1.193 – 192.168.1.254", "192.168.1.255"], "last row");
      t.eq(await t.page.eval(txt("#s-split-info")), "4 subnets of 64 addresses each.", "split info");
      await split("30");
      t.eq(await t.page.eval(`document.querySelectorAll("#s-table tbody tr").length`), 64, "64 /30s");
      t.eq(await t.page.eval(all("#s-table tbody tr:nth-child(2) td")), ["2", "192.168.1.4/30", "192.168.1.5 – 192.168.1.6", "192.168.1.7"], "/30 row");
      await split("31");
      t.eq(await t.page.eval(all("#s-table tbody tr:first-child td")), ["1", "192.168.1.0/31", "192.168.1.0 – 192.168.1.1", "none"], "/31 row");
      await split("32");
      t.eq(await t.page.eval(all("#s-table tbody tr:nth-child(3) td")), ["3", "192.168.1.2/32", "192.168.1.2", "none"], "/32 row");
      await subnet(t, "10.0.0.0/8");
      await split("16");
      t.eq(await t.page.eval(`document.querySelectorAll("#s-table tbody tr").length`), 256, "exactly 256 rows, not capped");
      t.eq(await t.page.eval(txt("#s-split-info")), "256 subnets of 65,536 addresses each.", "no cap message at exactly 256");
      await split("24");
      t.eq(await t.page.eval(`document.querySelectorAll("#s-table tbody tr").length`), 256, "capped at 256 rows");
      t.eq(await t.page.eval(txt("#s-split-info")), "65,536 subnets of 256 addresses each. Only the first 256 are listed; the table stops at 256 rows.", "cap message");
      t.eq(await t.page.eval(all("#s-table tbody tr:last-child td")).then((r) => r[1]), "10.0.255.0/24", "256th subnet");
      await subnet(t, "2001:db8::/32");
      await split("36");
      t.eq(await t.page.eval(`document.querySelectorAll("#s-table tbody tr").length`), 16, "16 IPv6 /36s");
      t.eq(await t.page.eval(all("#s-table tbody tr:nth-child(2) td")), ["2", "2001:db8:1000::/36", "2001:db8:1000:: – 2001:db8:1fff:ffff:ffff:ffff:ffff:ffff"], "second IPv6 subnet");
      await split("64");
      t.eq(await t.page.eval(txt("#s-split-info")), "4,294,967,296 subnets of 18,446,744,073,709,551,616 addresses each. Only the first 256 are listed; the table stops at 256 rows.", "2^32 /64s, exact");
      await split("32");
      t.assert((await t.page.eval(txt("#s-split-info"))).includes("from 33 to 128"), "not longer than the prefix: " + (await t.page.eval(txt("#s-split-info"))));
      t.eq(await t.page.eval(`document.querySelector("#s-split").getAttribute("aria-invalid")`), "true", "aria-invalid");
      t.eq(await t.page.eval(`document.querySelector("#s-table-wrap").hidden`), true, "table hidden on error");
      await subnet(t, "192.168.1.0/24");
      await split("26");
      await t.shot("split", 375);
      await t.shot("split", 1280);
    },
  },

  /* ============================================================ chmod calculator */
  {
    page: "chmod-calculator",
    name: "octal to symbolic including special bits",
    async run(t) {
      const mode = async (oct) => { await t.page.setValue("#m-octal", oct); return { sym: await t.page.eval(val("#m-sym")), info: await t.page.eval(txt("#m-info")) }; };
      for (const [oct, sym] of [["755", "rwxr-xr-x"], ["644", "rw-r--r--"], ["0644", "rw-r--r--"], ["600", "rw-------"], ["777", "rwxrwxrwx"], ["000", "---------"], ["4755", "rwsr-xr-x"],
        ["1777", "rwxrwxrwt"], ["2750", "rwxr-s---"], ["4644", "rwSr--r--"], ["1776", "rwxrwxrwT"], ["6755", "rwsr-sr-x"], ["7777", "rwsrwsrwt"], ["7000", "--S--S--T"], ["2644", "rw-r-Sr--"]]) {
        const r = await mode(oct);
        t.eq(r.sym, sym, oct);
      }
      const r = await mode("4755");
      t.eq(r.info, "Mode 4755 is rwsr-xr-x.", "info line");
      t.eq(await t.page.eval(txt("#m-cmd-num")), "chmod 4755 file", "numeric command with special bit");
      t.eq(await t.page.eval(txt("#m-cmd-sym")), "chmod u=rwxs,g=rx,o=rx file", "symbolic command with setuid");
      t.eq(await t.page.eval(`["#m-suid", "#m-sgid", "#m-sticky"].map((s) => document.querySelector(s).checked)`), [true, false, false], "setuid box");
      t.assert((await t.page.eval(txt("#m-warn"))).includes("Setuid"), "setuid warning");
    },
  },
  {
    page: "chmod-calculator",
    name: "symbolic to octal, incl. s S t T, and ls -l style 10 characters",
    async run(t) {
      const sym = async (s) => { await t.page.setValue("#m-sym", s); return t.page.eval(val("#m-octal")); };
      for (const [s, oct] of [["rwxr-xr-x", "755"], ["rw-r--r--", "644"], ["---------", "000"], ["rwxrwxrwx", "777"], ["rwsr-xr-x", "4755"], ["rwSr--r--", "4644"], ["rwxrwxrwt", "1777"], ["rwxrwxrwT", "1776"],
        ["rwxr-s---", "2750"], ["rwxr-S---", "2740"], ["rwsrwsrwt", "7777"], ["--S--S--T", "7000"], ["drwxr-xr-x", "755"], ["-rw-r--r--", "644"], ["lrwxrwxrwx", "777"]]) {
        t.eq(await sym(s), oct, s);
      }
      await sym("rwsr-xr-x");
      t.eq(await t.page.eval(`["#m-u-r", "#m-u-w", "#m-u-x", "#m-g-r", "#m-g-w", "#m-g-x", "#m-o-r", "#m-o-w", "#m-o-x", "#m-suid"].map((s) => document.querySelector(s).checked)`),
        [true, true, true, true, false, true, true, false, true, true], "grid follows symbolic");
    },
  },
  {
    page: "chmod-calculator",
    name: "invalid input: digits 8 and 9, 5 digits, too short, bad symbolic",
    async run(t) {
      const bad = async (sel, v) => { await t.page.setValue(sel, v); return { msg: await t.page.eval(txt("#m-info")), inv: await t.page.eval(`document.querySelector(${JSON.stringify(sel)}).getAttribute("aria-invalid")`) }; };
      let r = await bad("#m-octal", "789");
      t.assert(r.msg.includes("8 isn't an octal digit") && r.inv === "true", "digit 8: " + r.msg);
      r = await bad("#m-octal", "649");
      t.assert(r.msg.includes("9 isn't an octal digit"), "digit 9: " + r.msg);
      r = await bad("#m-octal", "04755");
      t.assert(r.msg.includes("at most 4 digits"), "5 digits: " + r.msg);
      r = await bad("#m-octal", "12345");
      t.assert(r.msg.includes("at most 4 digits"), "5 digits (2): " + r.msg);
      r = await bad("#m-octal", "75");
      t.assert(r.msg.includes("Give 3 digits"), "2 digits: " + r.msg);
      r = await bad("#m-octal", "rwx");
      t.assert(r.msg.includes("aren't digits"), "letters: " + r.msg);
      r = await bad("#m-octal", "");
      t.assert(r.msg.startsWith("Type an octal"), "empty: " + r.msg);
      r = await bad("#m-sym", "rwxr-xr-");
      t.assert(r.msg.includes("9 characters") && r.msg.includes("has 8"), "short symbolic: " + r.msg);
      r = await bad("#m-sym", "rwxrwxrwq");
      t.assert(r.msg.includes("Character 9") && r.inv === "true", "bad char: " + r.msg);
      r = await bad("#m-sym", "rwtr-xr-x");
      t.assert(r.msg.includes("Character 3"), "t in the owner position: " + r.msg);
      r = await bad("#m-sym", "rwxr-xr-s");
      t.assert(r.msg.includes("Character 9"), "s in the others position: " + r.msg);
      await t.page.setValue("#m-octal", "644");
      t.eq(await t.page.eval(`document.querySelector("#m-octal").getAttribute("aria-invalid")`), "false", "error clears");
      t.eq(await t.page.eval(val("#m-sym")), "rw-r--r--", "valid input applies");
    },
  },
  {
    page: "chmod-calculator",
    name: "checkboxes drive octal, symbolic and commands; presets; warnings; file name quoting",
    async run(t) {
      t.eq([await t.page.eval(val("#m-octal")), await t.page.eval(val("#m-sym"))], ["755", "rwxr-xr-x"], "starts at 755");
      for (const id of ["#m-u-x", "#m-g-x", "#m-o-x"]) await t.page.click(id);
      t.eq(await t.page.eval(val("#m-octal")), "644", "execute off everywhere");
      t.eq(await t.page.eval(val("#m-sym")), "rw-r--r--", "symbolic");
      t.eq(await t.page.eval(txt("#m-cmd-num")), "chmod 644 file", "numeric command");
      t.eq(await t.page.eval(txt("#m-cmd-sym")), "chmod u=rw,g=r,o=r file", "symbolic command");
      t.eq(await t.page.eval(`document.querySelector("#m-warn").hidden`), true, "no warning for 644");
      await t.page.click("#m-o-w");
      t.eq(await t.page.eval(val("#m-octal")), "646", "others write");
      t.assert((await t.page.eval(txt("#m-warn"))).startsWith("World-writable"), "world-writable warning");
      await t.page.click("#m-sticky");
      t.eq(await t.page.eval(val("#m-octal")), "1646", "sticky");
      t.eq(await t.page.eval(val("#m-sym")), "rw-r--rwT", "T without execute");
      t.assert((await t.page.eval(txt("#m-warn"))).includes("upper-case S or T"), "S/T warning");
      await t.page.click("#m-sticky");
      for (const [m, sym] of [["644", "rw-r--r--"], ["755", "rwxr-xr-x"], ["600", "rw-------"], ["700", "rwx------"], ["775", "rwxrwxr-x"], ["777", "rwxrwxrwx"]]) {
        await t.page.click(`[data-mode="${m}"]`);
        t.eq([await t.page.eval(val("#m-octal")), await t.page.eval(val("#m-sym"))], [m, sym], "preset " + m);
      }
      t.assert((await t.page.eval(txt("#m-warn"))).startsWith("World-writable"), "777 warns");
      await t.page.click(`[data-mode="755"]`);
      t.eq(await t.page.eval(`document.querySelector("#m-warn").hidden`), true, "755 clears the warning");
      await t.page.setValue("#m-octal", "1777");
      t.assert((await t.page.eval(txt("#m-warn"))).includes("sticky bit limits"), "sticky directory is described, not just warned");
      await t.page.setValue("#m-file", "my file's.sh");
      t.eq(await t.page.eval(txt("#m-cmd-num")), "chmod 1777 'my file'\\''s.sh'", "name with space and quote is shell-quoted");
      await t.page.setValue("#m-file", "/var/www/html");
      t.eq(await t.page.eval(txt("#m-cmd-sym")), "chmod u=rwx,g=rwx,o=rwxt /var/www/html", "plain path is not quoted");
      t.eq(await t.page.eval(val("#m-octal")), "1777", "editing the file name keeps the octal text");
      await t.page.setValue("#m-file", "");
      t.eq(await t.page.eval(txt("#m-cmd-num")), "chmod 1777 file", "empty name falls back to file");
    },
  },
  {
    page: "chmod-calculator",
    name: "what-this-allows table and screenshots",
    async run(t) {
      await t.page.setValue("#m-octal", "750");
      t.eq(await t.page.eval(`[...document.querySelectorAll("#m-means tbody tr")].map((r) => [...r.children].map((c) => c.textContent))`), [
        ["Owner", "Can read it, change it and run it as a program.", "Can list the names in it, add, rename and delete entries (needs execute too) and enter it and reach entries by name."],
        ["Group", "Can read it and run it as a program.", "Can list the names in it and enter it and reach entries by name."],
        ["Others", "No access.", "No access."],
      ], "meaning rows for 750");
      await t.page.setValue("#m-octal", "4755");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },

  /* ============================================================ HTTP status codes */
  {
    page: "http-status-codes",
    name: "search by number and word, class filters with counts, no-result message",
    async run(t) {
      const ids = `[...document.querySelectorAll("#h-list .hs:not([hidden])")].map((e) => e.id)`;
      const search = async (q) => { await t.page.setValue("#h-q", q); await sleep(200); return t.page.eval(ids); };
      t.eq((await t.page.eval(ids)).length, 73, "all 73 shown");
      t.eq(await t.page.eval(txt("#h-count")), "Showing 73 of 73 status codes.", "count line");
      t.eq(await search("404"), ["404"], "search 404");
      t.eq(await t.page.eval(txt("#h-count")), "Showing 1 of 73 status codes.", "count line after search");
      t.eq(await search("teapot"), ["418"], "search teapot");
      t.assert((await search("rate limit")).includes("429"), "search rate limit finds 429");
      t.eq((await search("rate limit"))[0], "429", "429 first for rate limit");
      t.eq(await search("40"), ["400", "401", "402", "403", "404", "405", "406", "407", "408", "409"], "numeric prefix 40");
      t.eq(await search("not found"), ["404"], "phrase not found");
      t.eq(await search("BAD GATEWAY"), ["502"], "case-insensitive words");
      t.eq(await search("5xx").then((r) => r.length), 18, "5xx as a word matches the class, official (11) and unofficial (7)");
      t.eq(await search("cloudflare").then((r) => r.join(",")), "520,521,522,523,524,525,526", "cloudflare codes");
      t.eq((await search("nginx")).filter((c) => c === "444" || c === "499"), ["444", "499"], "nginx codes include 444 and 499");
      t.eq(await search("rfc 6585"), ["428", "429", "431", "511"], "RFC 6585 codes");
      t.eq(await search("zzzqq"), [], "no results");
      t.eq(await t.page.eval(`document.querySelector("#h-none").hidden`), false, "no-result message shown");
      t.assert((await t.page.eval(txt("#h-none"))).startsWith('No status code matches "zzzqq"'), "message text: " + (await t.page.eval(txt("#h-none"))));
      t.eq(await t.page.eval(txt("#h-count")), "Showing 0 of 73 status codes.", "zero count");
      await search("");
      t.eq(await t.page.eval(`document.querySelector("#h-none").hidden`), true, "message hidden again");
      const counts = { all: 73, 1: 4, 2: 10, 3: 9, 4: 29, 5: 11, u: 10 };
      const labels = { all: "All (73)", 1: "1xx (4)", 2: "2xx (10)", 3: "3xx (9)", 4: "4xx (29)", 5: "5xx (11)", u: "Unofficial (10)" };
      for (const g of Object.keys(counts)) {
        t.eq(await t.page.eval(`document.querySelector("#h-g-${g}").parentElement.textContent.trim()`), labels[g], "chip label " + g);
        await t.page.click(`#h-g-${g}`);
        t.eq((await t.page.eval(ids)).length, counts[g], "class filter " + g);
      }
      await t.page.click("#h-g-3");
      t.eq(await t.page.eval(ids), ["300", "301", "302", "303", "304", "305", "306", "307", "308"], "3xx list in order");
      await t.page.click("#h-g-u");
      t.eq(await t.page.eval(ids), ["419", "444", "499", "520", "521", "522", "523", "524", "525", "526"], "unofficial list");
      t.eq(await t.page.eval(`document.querySelectorAll("#h-list .hs:not([hidden]) .hs-tag").length`), 10, "each unofficial entry is tagged");
      await t.page.setValue("#h-q", "cloudflare");
      await sleep(200);
      t.eq((await t.page.eval(ids)).length, 7, "filter and search combine");
      await t.page.click("#h-g-2");
      t.eq(await t.page.eval(ids), [], "search within the wrong class is empty");
      t.assert((await t.page.eval(txt("#h-none"))).includes("in this group"), "no-result message names the group");
    },
  },
  {
    page: "http-status-codes",
    name: "registry content: official codes present, reserved and unofficial labelled",
    async run(t) {
      const official = [];
      for (let c = 100; c <= 103; c++) official.push(c);
      for (let c = 200; c <= 208; c++) official.push(c);
      official.push(226);
      for (let c = 300; c <= 308; c++) official.push(c);
      for (let c = 400; c <= 418; c++) official.push(c);
      official.push(421, 422, 423, 424, 425, 426, 428, 429, 431, 451);
      for (let c = 500; c <= 508; c++) official.push(c);
      official.push(510, 511);
      const unofficial = [419, 444, 499, 520, 521, 522, 523, 524, 525, 526];
      const have = (await t.page.eval(`[...document.querySelectorAll("#h-list .hs")].map((e) => Number(e.id))`));
      t.eq(have, [...official, ...unofficial], "exact set of codes, official then unofficial");
      t.eq(await t.page.eval(`document.querySelector("[id='418'] .hs-name").textContent`), "(Unused)Reserved, not for use", "418 reserved, not an assigned code");
      t.eq(await t.page.eval(`document.querySelector("[id='306'] .hs-name").textContent`), "(Unused)Reserved, not for use", "306 reserved");
      t.eq(await t.page.eval(`document.querySelector("[id='404'] .hs-name").textContent`), "Not Found", "404 name");
      t.eq(await t.page.eval(`document.querySelector("[id='499'] .hs-name").textContent`), "Client Closed RequestUnofficial, nginx", "499 labelled with source");
      t.eq(await t.page.eval(`document.querySelector("[id='522'] .hs-name").textContent`), "Connection Timed OutUnofficial, Cloudflare", "522 labelled with source");
      t.eq(await t.page.eval(`document.querySelector("[id='413'] .hs-name").textContent`), "Content Too Large", "2022 name for 413");
      t.eq(await t.page.eval(`document.querySelector("[id='422'] .hs-name").textContent`), "Unprocessable Content", "2022 name for 422");
      t.eq(await t.page.eval(`document.querySelector("[id='404'] .hs-body > div:last-child dd").textContent.startsWith("RFC 9110 §15.5.5")`), true, "404 cites RFC 9110 section");
      t.eq(await t.page.eval(`[...document.querySelectorAll("#h-list .hs")].every((e) => e.querySelectorAll(".hs-body > div").length === 4 && [...e.querySelectorAll("dd")].every((d) => d.textContent.trim().length > 3))`), true, "every entry has all four detail rows");
      t.eq(await t.page.eval(`document.querySelector("[id='404'] .hs-body > div:last-child dt").textContent`), "Defined in", "official label");
      t.eq(await t.page.eval(`document.querySelector("[id='444'] .hs-body > div:last-child dt").textContent`), "Source", "unofficial label");
    },
  },
  {
    page: "http-status-codes",
    path: "/tools/http-status-codes/#429",
    name: "deep link #429 opens and highlights; hashchange follows; hidden target clears the filter",
    async run(t) {
      const state = (id) => t.page.eval(`(() => { const e = document.getElementById(${JSON.stringify(id)}); const r = e.getBoundingClientRect(); return {open: e.open, target: e.classList.contains("is-target"), hidden: e.hidden, top: Math.round(r.top), vh: innerHeight, others: document.querySelectorAll(".is-target").length}; })()`);
      await sleep(200);
      let s = await state("429");
      t.assert(s.open && s.target && !s.hidden && s.others === 1, "429 open and highlighted " + JSON.stringify(s));
      t.assert(s.top >= -2 && s.top < s.vh / 2, "429 scrolled into view " + JSON.stringify(s));
      await t.shot("deeplink", 375);
      await t.shot("deeplink", 1280);
      await t.page.eval(`location.hash = "#503"; true`);
      await sleep(250);
      s = await state("503");
      t.assert(s.open && s.target && s.others === 1, "hashchange to 503 " + JSON.stringify(s));
      t.eq((await state("429")).target, false, "429 no longer highlighted");
      await t.page.click("#h-g-2");
      await t.page.setValue("#h-q", "zzz");
      await sleep(200);
      await t.page.eval(`location.hash = "#404"; true`);
      await sleep(250);
      s = await state("404");
      t.assert(s.target && !s.hidden && s.open, "hidden target is revealed " + JSON.stringify(s));
      t.eq(await t.page.eval(val("#h-q")), "", "search cleared");
      t.eq(await t.page.eval(`document.querySelector("#h-g-all").checked`), true, "filter reset to All");
      await t.page.eval(`location.hash = "#nope"; true`);
      await sleep(200);
      t.eq(await t.page.eval(`document.querySelectorAll(".is-target").length`), 0, "unknown hash clears the highlight");
      const link = await t.page.eval(`document.querySelector("[id='451'] .hs-link").getAttribute("href")`);
      t.eq(link, "#451", "each entry has its own link");
    },
  },
  {
    page: "http-status-codes",
    name: "keyboard: entries open with Enter; layout screenshots",
    async run(t) {
      await t.page.eval(`document.querySelector("[id='200'] summary").focus(); true`);
      await t.page.press(" ");
      t.eq(await t.page.eval(`document.getElementById("200").open`), true, "Space on the summary opens the details");
      t.eq(await t.page.eval(`document.querySelector("[id='200'] summary").tabIndex`), 0, "summary is in the tab order");
      await t.page.eval(`document.getElementById("404").open = true; true`);
      await t.page.setValue("#h-q", "redirect");
      await sleep(200);
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },

  /* ============================================================ user agent parser */
  {
    page: "user-agent-parser",
    name: "own user agent is parsed on load; Client Hints section matches navigator.userAgentData",
    async run(t) {
      await t.page.waitFor(`document.querySelectorAll("#u-rows > div").length > 0`);
      const own = await t.page.eval("navigator.userAgent");
      t.eq(await t.page.eval(val("#u-in")), own, "textarea holds navigator.userAgent");
      t.eq(await t.page.eval(txt("#u-info")), "This is your own browser's user agent.", "info line");
      t.assert(/Chrome/.test(await t.page.eval(`document.querySelector('#u-rows [data-k="browser"] dd').textContent`)), "browser row mentions Chrome (headless Chromium)");
      t.eq(await t.page.eval(`document.querySelectorAll("#u-rows > div").length`), 8, "eight result rows");
      await t.page.waitFor(`document.querySelector('#u-hints [data-k="full-version"]')`, { timeout: 8000 });
      const want = await t.page.eval(`(async () => { const d = navigator.userAgentData; const h = await d.getHighEntropyValues(["platformVersion", "architecture", "bitness", "model", "fullVersionList"]); return { brands: d.brands.map((b) => b.brand + " " + b.version).join(", "), mobile: d.mobile ? "Yes" : "No", platform: d.platform, pv: h.platformVersion, arch: h.architecture, full: h.fullVersionList.map((b) => b.brand + " " + b.version).join(", ") }; })()`);
      t.eq(await t.page.eval(txt('#u-hints [data-k="brands"] dd')), want.brands, "brands");
      t.eq(await t.page.eval(txt('#u-hints [data-k="mobile"] dd')), want.mobile, "mobile");
      t.eq(await t.page.eval(txt('#u-hints [data-k="platform"] dd')), want.platform, "platform");
      t.eq(await t.page.eval(txt('#u-hints [data-k="platform-version"] dd')), want.pv || "Not stated", "platform version");
      t.eq(await t.page.eval(txt('#u-hints [data-k="full-version"] dd')), want.full, "full version list");
      t.assert((await t.page.eval(txt('#u-hints [data-k="architecture"] dd'))).startsWith(want.arch || "Not stated"), "architecture");
      await t.page.setValue("#u-in", "curl/8.4.0");
      await sleep(250);
      await t.page.click("#u-own");
      t.eq(await t.page.eval(val("#u-in")), own, "Use my browser's restores it");
      t.eq(await t.page.eval(txt("#u-info")), "This is your own browser's user agent.", "info again");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "user-agent-parser",
    name: "fixed strings: Chrome/Windows, Safari/iPhone, Firefox/Linux, Edge, Samsung Internet, macOS Safari",
    async run(t) {
      await t.page.waitFor(`document.querySelectorAll("#u-rows > div").length > 0`);
      const all8 = async () => ({
        kind: await t.page.eval(uaRow("kind")), browser: await t.page.eval(uaRow("browser")), engine: await t.page.eval(uaRow("engine")), os: await t.page.eval(uaRow("os")),
        type: await t.page.eval(uaRow("device-type")), vendor: await t.page.eval(uaRow("device-vendor")), model: await t.page.eval(uaRow("device-model")), cpu: await t.page.eval(uaRow("cpu")),
      });
      await parseUa(t, UA.chromeWin);
      let r = await all8();
      t.eq([r.kind, r.browser, r.engine, r.os, r.cpu, r.vendor, r.model], ["Web browser", "Chrome 120.0.0.0", "Blink 120.0.0.0", "Windows 10", "amd64", "Not stated", "Not stated"], "Chrome on Windows");
      t.assert(r.type.startsWith("Desktop or laptop"), "desktop type: " + r.type);
      t.assert((await t.page.eval(txt("#u-notes"))).includes("Windows 11") && (await t.page.eval(txt("#u-notes"))).includes("reduced"), "Windows 11 and reduction notes");
      await parseUa(t, UA.iphone);
      r = await all8();
      t.eq([r.kind, r.browser, r.engine, r.os, r.type, r.vendor, r.model, r.cpu], ["Web browser", "Mobile Safari 17.2", "WebKit 605.1.15", "iOS 17.2", "mobile", "Apple", "iPhone", "Not stated"], "Safari on iPhone");
      await parseUa(t, UA.ffLinux);
      r = await all8();
      t.eq([r.browser, r.engine, r.os, r.cpu], ["Firefox 121.0", "Gecko 121.0", "Linux", "amd64"], "Firefox on Linux");
      t.assert(r.type.startsWith("Desktop or laptop"), "Linux is a desktop");
      await parseUa(t, UA.edge);
      r = await all8();
      t.eq([r.browser, r.engine, r.os], ["Edge 120.0.2210.91", "Blink 120.0.0.0", "Windows 10"], "Edge");
      await parseUa(t, UA.samsung);
      r = await all8();
      t.eq([r.browser, r.engine, r.os, r.type, r.vendor, r.model], ["Samsung Internet 23.0", "Blink 115.0.0.0", "Android 13", "mobile", "Samsung", "SM-S918B"], "Samsung Internet on Android");
      await parseUa(t, UA.mac);
      r = await all8();
      t.eq([r.browser, r.engine, r.os], ["Safari 17.2", "WebKit 605.1.15", "Mac OS 10.15.7"], "Safari on macOS");
      const n = await t.page.eval(txt("#u-notes"));
      t.assert(n.includes("frozen") && n.includes("iPad"), "frozen version and iPad notes: " + n);
      t.eq(await t.page.eval(txt("#u-info")), "", "no own-browser line for a pasted string");
    },
  },
  {
    page: "user-agent-parser",
    name: "bots and tools: Googlebot, curl, Bingbot, python-requests; empty and unknown input; copy",
    async run(t) {
      await t.page.waitFor(`document.querySelectorAll("#u-rows > div").length > 0`);
      await parseUa(t, UA.googlebot);
      t.eq([await t.page.eval(uaRow("kind")), await t.page.eval(uaRow("browser"))], ["Search engine crawler", "Googlebot 2.1"], "Googlebot");
      await parseUa(t, UA.curl);
      t.eq([await t.page.eval(uaRow("kind")), await t.page.eval(uaRow("browser")), await t.page.eval(uaRow("os"))], ["Command-line or library HTTP client", "curl 8.4.0", "Not stated"], "curl");
      await parseUa(t, "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)");
      t.eq([await t.page.eval(uaRow("kind")), await t.page.eval(uaRow("browser"))], ["Search engine crawler", "Bingbot 2.0"], "Bingbot");
      await parseUa(t, "python-requests/2.31.0");
      t.eq([await t.page.eval(uaRow("kind")), await t.page.eval(uaRow("browser"))], ["Command-line or library HTTP client", "python-requests 2.31.0"], "python-requests");
      await parseUa(t, "Mozilla/5.0 (compatible; ExampleCrawler/1.0; +https://example.com/bot)");
      t.eq([await t.page.eval(uaRow("kind")), await t.page.eval(uaRow("browser"))], ["Crawler or bot (self-described)", "Not identified"], "unknown crawler");
      await parseUa(t, "totally-unknown-agent");
      t.eq([await t.page.eval(uaRow("kind")), await t.page.eval(uaRow("browser"))], ["Unknown", "Not identified"], "unknown string");
      await parseUa(t, "   ");
      t.eq(await t.page.eval(`document.querySelectorAll("#u-rows > div").length`), 0, "no rows when empty");
      t.assert((await t.page.eval(txt("#u-info"))).startsWith("Paste a user agent"), "empty prompt");
      await parseUa(t, UA.chromeWin);
      await t.page.click("#u-copy");
      await sleep(100);
      t.assert(["Copied", "Copy failed"].includes(await t.page.eval(txt("#u-copy"))), "copy gives feedback");
      await t.shot("bot", 375);
    },
  },

  /* ============================================================ cron expression generator */
  {
    page: "cron-expression-generator",
    name: "controls build exact expressions: weekdays 09:30, every 15 minutes, 1st and 15th, Mon/Wed/Fri, ranges",
    async run(t) {
      const expr = () => t.page.eval(txt("#g-expr"));
      const mode = async (f, m) => { await t.page.setValue(`#g-${f}-mode`, m); };
      const chip = (f, v) => t.page.click(`#g-${f}-v${v}`);
      // the page starts from the 30 9 * * 1-5 preset
      t.eq(await expr(), "30 9 * * 1-5", "initial preset");
      // weekdays at 09:30 from scratch
      await t.page.click('[data-cron="* * * * *"]');
      t.eq(await expr(), "* * * * *", "every minute preset");
      await mode("minute", "values"); await chip("minute", 30);
      await mode("hour", "values"); await chip("hour", 9);
      await mode("dow", "values");
      t.assert((await t.page.eval(txt("#g-info"))).includes("Pick at least one"), "empty selection is explained");
      t.eq(await t.page.eval(`document.querySelector("#g-say").textContent`), "", "no description while invalid");
      for (const d of [1, 2, 3, 4, 5]) await chip("dow", d);
      t.eq(await expr(), "30 9 * * 1-5", "Mon-Fri selection compresses to 1-5");
      t.eq(await t.page.eval(txt("#g-say")), "At 09:30, on Monday through Friday.", "description");
      // Mon/Wed/Fri
      await t.page.click("#g-dow-v2"); await t.page.click("#g-dow-v4");
      t.eq(await expr(), "30 9 * * 1,3,5", "Mon, Wed, Fri stays a list");
      await t.page.click("#g-dow-v6");
      t.eq(await expr(), "30 9 * * 1,3,5,6", "Mon Wed Fri Sat");
      await t.page.click("#g-dow-v0");
      t.eq(await expr(), "30 9 * * 0,1,3,5,6", "Sunday is 0 and does not join Saturday into a range");
      for (const d of [0, 6, 1, 3, 5]) await t.page.click(`#g-dow-v${d}`);
      for (const d of [0, 6]) await t.page.click(`#g-dow-v${d}`);
      t.eq(await expr(), "30 9 * * 0,6", "weekends");
      await t.page.click("#g-dow-v0"); await t.page.click("#g-dow-v6");
      for (const d of [1, 2, 3]) await t.page.click(`#g-dow-v${d}`);
      t.eq(await expr(), "30 9 * * 1-3", "three in a row make a range");
      await t.page.click("#g-dow-v3");
      t.eq(await expr(), "30 9 * * 1,2", "two in a row stay a list");
      await mode("dow", "every");
      t.eq(await expr(), "30 9 * * *", "back to every");
      // every 15 minutes
      await t.page.click('[data-cron="* * * * *"]');
      await mode("minute", "step");
      t.eq(await expr(), "*/15 * * * *", "default step is every 15 starting at 0");
      t.eq(await t.page.eval(txt("#g-say")), "Every 15 minutes, every day.", "every 15 description");
      await t.page.setValue("#g-minute-step", "10");
      await t.page.setValue("#g-minute-start", "5");
      t.eq(await expr(), "5-59/10 * * * *", "start 5 step 10 is written 5-59/10");
      await t.page.setValue("#g-minute-start", "0");
      t.eq(await expr(), "*/10 * * * *", "start 0 is */10");
      await t.page.setValue("#g-minute-step", "1");
      t.eq(await expr(), "* * * * *", "step 1 from the start is *");
      await t.page.setValue("#g-minute-step", "0");
      t.assert((await t.page.eval(txt("#g-info"))).includes("whole number of 1 or more"), "step 0 rejected: " + (await t.page.eval(txt("#g-info"))));
      t.eq(await expr(), "—", "no expression while invalid");
      t.eq(await t.page.eval(`document.querySelector('[data-field="minute"]').classList.contains("is-bad")`), true, "bad panel marked");
      await t.page.setValue("#g-minute-step", "60");
      t.assert((await t.page.eval(txt("#g-info"))).includes("larger than the whole field"), "step 60 rejected");
      // 1st and 15th at midnight
      await t.page.click('[data-cron="* * * * *"]');
      await mode("minute", "values"); await chip("minute", 0);
      await mode("hour", "values"); await chip("hour", 0);
      await mode("dom", "values"); await chip("dom", 1); await chip("dom", 15);
      t.eq(await expr(), "0 0 1,15 * *", "1st and 15th at midnight");
      t.eq(await t.page.eval(txt("#g-say")), "At 00:00, on days 1 and 15 of the month.", "description");
      // hour range, month values, dom step
      await mode("hour", "range");
      await t.page.setValue("#g-hour-from", "9"); await t.page.setValue("#g-hour-to", "17");
      t.eq(await expr(), "0 9-17 1,15 * *", "between 9 and 17");
      await t.page.setValue("#g-hour-from", "18");
      t.assert((await t.page.eval(txt("#g-info"))).includes("runs backwards"), "backwards range rejected");
      await t.page.setValue("#g-hour-from", "0"); await t.page.setValue("#g-hour-to", "23");
      t.eq(await expr(), "0 * 1,15 * *", "range covering the whole field is *");
      await mode("month", "values"); for (const m of [1, 2, 3]) await chip("month", m);
      t.eq(await expr(), "0 * 1,15 1-3 *", "January to March");
      await mode("dom", "step");
      await t.page.setValue("#g-dom-step", "7");
      t.eq(await expr(), "0 * */7 1-3 *", "every 7 days");
      await t.page.setValue("#g-dom-start", "5");
      t.eq(await expr(), "0 * 5-31/7 1-3 *", "every 7 days from the 5th");
      await mode("month", "step");
      await t.page.setValue("#g-month-step", "3");
      t.eq(await expr(), "0 * 5-31/7 */3 *", "every 3 months");
      await mode("dow", "step"); await t.page.setValue("#g-dow-step", "2"); await t.page.setValue("#g-dow-start", "1");
      t.eq((await expr()).split(" ")[4], "1-6/2", "weekday step from Monday");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "cron-expression-generator",
    name: "all 59 minutes values and all-day selection collapse to *; chips are labelled",
    async run(t) {
      await t.page.click('[data-cron="* * * * *"]');
      await t.page.setValue("#g-dow-mode", "values");
      for (let d = 0; d <= 6; d++) await t.page.click(`#g-dow-v${d}`);
      t.eq(await t.page.eval(txt("#g-expr")), "* * * * *", "all seven days is *");
      t.eq(await t.page.eval(`[...document.querySelectorAll('[data-field="dow"] .cg-chip span')].map((e) => e.textContent)`), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "weekday chips start on Monday");
      t.eq(await t.page.eval(`[...document.querySelectorAll('[data-field="dow"] .cg-chip')].map((e) => e.title)`), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], "chips have full-name titles");
      await t.page.setValue("#g-month-mode", "values");
      t.eq(await t.page.eval(`document.querySelectorAll('[data-field="month"] .cg-chip').length`), 12, "twelve month chips");
      t.eq(await t.page.eval(`document.querySelector("#g-month-v12").parentElement.textContent`), "Dec", "month chip label");
      await t.page.setValue("#g-minute-mode", "values");
      t.eq(await t.page.eval(`document.querySelectorAll('[data-field="minute"] .cg-chip').length`), 60, "sixty minute chips");
      // keyboard: a focused chip toggles with Space
      await t.page.eval(`document.querySelector("#g-minute-v7").focus(); true`);
      t.eq(await t.page.eval(`document.activeElement.id`), "g-minute-v7", "a chip is a real checkbox and takes focus");
      t.eq(await t.page.eval(`document.activeElement.type`), "checkbox", "native checkbox, so Space toggles it");
      await t.page.setValue("#g-month-mode", "every");
      await t.page.click("#g-minute-v7");
      t.eq((await t.page.eval(txt("#g-expr"))).split(" ")[0], "7", "expression follows");
    },
  },
  {
    page: "cron-expression-generator",
    name: "description equals the explainer's for the same expression",
    async run(t) {
      const exprs = ["30 9 * * 1-5", "*/15 * * * *", "0 0 1,15 * *", "5-59/10 9-17 * * 1,3,5", "0 0 * 1-3 *", "0 9 1 * 1"];
      const mine = [];
      for (const e of exprs) {
        await t.page.setValue("#g-load", e);
        await t.page.click("#g-load-btn");
        t.eq(await t.page.eval(txt("#g-expr")), e, "loaded " + e);
        mine.push(await t.page.eval(txt("#g-say")));
      }
      await t.go("/tools/");
      await t.go("/tools/cron-expression-explainer/");
      for (let i = 0; i < exprs.length; i++) {
        await t.page.setValue("#c-in", exprs[i]);
        await t.page.waitFor(`document.querySelector("#c-in").value === ${JSON.stringify(exprs[i])}`);
        await sleep(300);
        t.eq(mine[i], await t.page.eval(txt("#c-say")), "description for " + exprs[i]);
      }
    },
  },
  {
    page: "cron-expression-generator",
    name: "next runs equal an independent minute-by-minute reference",
    async run(t) {
      await t.page.setValue("#g-tz", "UTC");
      await t.page.setValue("#g-from", "2026-10-09T17:40");
      await t.page.setValue("#g-count", "10");
      for (const e of ["30 9 * * 1-5", "*/15 * * * *", "0 0 1,15 * *", "5-59/10 9-17 * * 1,3,5", "0 0 29 2 *", "0 12 * 1-3 6,0", "0 9 1 * 1", "0 0 */9 * *", "15 3 31 * *"]) {
        await t.page.setValue("#g-load", e);
        await t.page.click("#g-load-btn");
        await t.page.waitFor(`document.querySelectorAll("#g-runs time").length > 0`);
        const want = refCron(e, Date.UTC(2026, 9, 9, 17, 40), 10);
        const got = await t.page.eval(runIsos);
        if (e === "0 0 29 2 *") {
          // the reference only looks four years ahead; the page keeps going to the next leap days
          t.eq(got.slice(0, want.length), want, "runs for " + e);
          t.eq(got.slice(0, 4), ["2028-02-29T00:00:00.000Z", "2032-02-29T00:00:00.000Z", "2036-02-29T00:00:00.000Z", "2040-02-29T00:00:00.000Z"], "leap days");
        } else t.eq(got, want, "runs for " + e);
      }
      t.eq(await t.page.eval(txt("#g-runs-info")), "Next 10 runs from 2026-10-09 17:40, in UTC.", "info line");
      await t.page.setValue("#g-count", "5");
      t.eq(await t.page.eval(`document.querySelectorAll("#g-runs time").length`), 5, "count 5");
      // New York across the autumn change
      await t.page.setValue("#g-tz", "America/New_York");
      await t.page.setValue("#g-from", "2026-10-30T00:00");
      await t.page.setValue("#g-load", "30 1 * * *");
      await t.page.click("#g-load-btn");
      t.eq(await t.page.eval(runIsos), ["2026-10-30T05:30:00.000Z", "2026-10-31T05:30:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z", "2026-11-03T06:30:00.000Z"], "NY fall back");
      t.assert((await t.page.eval(txt("#g-runs-note"))).includes("happens twice"), "DST note");
      // never runs
      await t.page.setValue("#g-load", "0 0 31 2 *");
      await t.page.click("#g-load-btn");
      t.assert((await t.page.eval(txt("#g-runs-info"))).startsWith("This schedule never runs"), "impossible date");
      t.eq(await t.page.eval(`document.querySelectorAll("#g-runs li").length`), 0, "no runs");
    },
  },
  {
    page: "cron-expression-generator",
    name: "paste round trip: builder state, normalisation, custom fields, shortcuts",
    async run(t) {
      const load = async (e) => { await t.page.setValue("#g-load", e); await t.page.click("#g-load-btn"); };
      const modes = () => t.page.eval(`["minute", "hour", "dom", "month", "dow"].map((k) => document.querySelector("#g-" + k + "-mode").value)`);
      await load("*/10 8-18 * * 1-5");
      t.eq(await t.page.eval(txt("#g-expr")), "*/10 8-18 * * 1-5", "round trip");
      t.eq(await modes(), ["step", "range", "every", "every", "range"], "modes");
      t.eq(await t.page.eval(`["#g-minute-step", "#g-minute-start", "#g-hour-from", "#g-hour-to", "#g-dow-from", "#g-dow-to"].map((s) => document.querySelector(s).value)`), ["10", "0", "8", "18", "1", "5"], "control values");
      t.eq(await t.page.eval(txt("#g-info")), "", "no custom note");
      t.eq(await t.page.eval(txt("#g-load-info")), "Loaded into the controls.", "load message");
      await load("0 0 1,15 * *");
      t.eq(await modes(), ["values", "values", "values", "every", "every"], "list modes");
      t.eq(await t.page.eval(`[...document.querySelectorAll('[data-field="dom"] input:checked')].map((e) => e.value)`), ["1", "15"], "chips 1 and 15");
      t.eq(await t.page.eval(txt("#g-expr")), "0 0 1,15 * *", "unchanged");
      // normalisation: equivalent spellings become the builder's own form
      for (const [input, out] of [["1,2,3,4,5 * * * *", "1-5 * * * *"], ["5/10 * * * *", "5-59/10 * * * *"], ["0 9 * * MON-FRI", "0 9 * * 1-5"], ["0 0 1 jan,jul *", "0 0 1 1,7 *"], ["@daily", "0 0 * * *"],
        ["@hourly", "0 * * * *"], ["@weekly", "0 0 * * 0"], ["0-59/15 * * * *", "*/15 * * * *"], ["0 0 * * 7", "0 0 * * 0"], ["0 5 * * * /usr/bin/backup --all", "0 5 * * *"], ["  0   12  *  *  * ", "0 12 * * *"]]) {
        await load(input);
        t.eq(await t.page.eval(txt("#g-expr")), out, `${input} -> ${out}`);
      }
      // anything the controls cannot show stays as typed, with the description still working
      for (const [input, field] of [["0 9 1 * 1-5/2", 4], ["*/10,5 * * * *", 0], ["0 0 * * 0-7", 4], ["1-31/2 * * * *", 0], ["0 0 1-31/2 * 1", 2]]) {
        await load(input);
        t.eq(await t.page.eval(txt("#g-expr")), input.replace(/ \/usr.*/, ""), "custom stays as typed: " + input);
        t.eq((await modes())[field], "custom", "custom mode in field " + field + " for " + input);
        t.assert((await t.page.eval(txt("#g-say"))).length > 10, "description still works for " + input);
        t.assert((await t.page.eval(txt("#g-info"))).includes("kept exactly as typed"), "custom note for " + input);
        t.assert((await t.page.eval(`document.querySelectorAll("#g-runs time").length`)) > 0, "runs still listed for " + input);
      }
      await load("0 9 1 * 1-5/2");
      t.eq(await t.page.eval(txt("#g-say")), "At 09:00, on day 1 of the month or on Monday, Wednesday and Friday.", "custom dow with a day of month: OR rule description");
    },
  },
  {
    page: "cron-expression-generator",
    name: "custom field can be replaced, invalid pasted input explained",
    async run(t) {
      const load = async (e) => { await t.page.setValue("#g-load", e); await t.page.click("#g-load-btn"); };
      await load("0 9 * * 1-5/2");
      t.eq(await t.page.eval(`document.querySelector("#g-dow-mode").value`), "custom", "custom");
      t.eq(await t.page.eval(`[...document.querySelectorAll("#g-dow-mode option")].map((o) => o.value)`), ["every", "step", "values", "range", "custom"], "custom option present only when needed");
      await t.page.setValue("#g-dow-mode", "values");
      await t.page.click("#g-dow-v1");
      t.eq(await t.page.eval(txt("#g-expr")), "0 9 * * 1", "custom replaced by a normal choice");
      t.eq(await t.page.eval(`[...document.querySelectorAll("#g-dow-mode option")].map((o) => o.value)`), ["every", "step", "values", "range"], "custom option gone");
      // invalid input leaves the builder alone
      for (const [bad, part] of [["61 * * * *", "outside 0–59"], ["0 0 * *", "this has 4"], ["0 0 12 * * ?", "6 fields"], ["@reboot", "no schedule"], ["0 0 * * FRI-MON", "runs backwards"], ["", "Type a cron expression"], ["0 0 * * 1#2", "Quartz"]]) {
        await load(bad);
        const msg = await t.page.eval(txt("#g-load-info"));
        t.assert(msg.includes(part), `${JSON.stringify(bad)}: ${msg}`);
        t.eq(await t.page.eval(`document.querySelector("#g-load").getAttribute("aria-invalid")`), "true", "aria-invalid for " + bad);
        t.eq(await t.page.eval(txt("#g-expr")), "0 9 * * 1", "builder unchanged after " + JSON.stringify(bad));
      }
      await t.page.setValue("#g-load", "30 2 * * 0");
      await t.page.press("Enter");
      await t.page.eval(`document.querySelector("#g-load").focus(); true`);
      await t.page.press("Enter");
      t.eq(await t.page.eval(txt("#g-expr")), "30 2 * * 0", "Enter in the box loads it");
      t.eq(await t.page.eval(`document.querySelector("#g-load").getAttribute("aria-invalid")`), "false", "error state clears");
    },
  },
  {
    page: "cron-expression-generator",
    name: "day-of-month OR day-of-week note, explainer link, copy, screenshots",
    async run(t) {
      await t.page.setValue("#g-load", "0 9 1 * 1");
      await t.page.click("#g-load-btn");
      t.assert((await t.page.eval(txt("#g-note"))).includes("either one"), "OR note");
      await t.page.setValue("#g-load", "0 9 * * 1");
      await t.page.click("#g-load-btn");
      t.eq(await t.page.eval(`document.querySelector("#g-note").hidden`), true, "no note when only one day field is set");
      t.eq(await t.page.eval(`!!document.querySelector('a[href="/tools/cron-expression-explainer/"]')`), true, "link to the explainer");
      await t.page.click("#g-copy");
      await sleep(100);
      t.assert(["Copied", "Copy failed"].includes(await t.page.eval(txt("#g-copy"))), "copy feedback");
      await t.page.setValue("#g-load", "30 9 * * 1-5");
      await t.page.click("#g-load-btn");
      await t.page.setValue("#g-tz", "UTC");
      await t.page.setValue("#g-minute-mode", "values");
      await t.page.click("#g-minute-v30");
      await t.shot("done", 375);
      await t.shot("done", 1280);
      await t.page.setValue("#g-hour-mode", "values");
      await t.shot("error", 375);
    },
  },
];
