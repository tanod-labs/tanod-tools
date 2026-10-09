// MikroTik tools in each language: findings, errors and read-outs come from the page's language, numbers follow
// the locale, and the generated RouterOS script stays plain ASCII English whatever the page language.
import { readFileSync } from "node:fs";

const FIX = (name) => readFileSync(new URL(`../ros-fixtures/${name}`, import.meta.url), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

export default [
  {
    page: "mikrotik-firewall-auditor",
    name: "mikrotik: auditor findings and severity labels in the page language",
    async run(t) {
      await t.page.setValue("#au-in", FIX("v7-weak.rsc"));
      await sleep(600);
      const title = await t.page.eval(`document.querySelector('[data-id="dns-open"] h3').textContent`);
      t.eq(title, await t.tx("The router is an open DNS resolver"), "finding title");
      const sev = await t.page.eval(`document.querySelector('[data-id="dns-open"] .ros-sev').textContent`);
      t.eq(sev, await t.tx("High"), "severity label");
      const fix = await t.page.eval(`document.querySelector('[data-id="dns-open"] pre:last-of-type').textContent`);
      t.assert(fix.startsWith("/ip firewall filter"), "the suggested fix stays RouterOS syntax");
    },
  },
  {
    page: "mikrotik-burst-calculator",
    name: "mikrotik: burst read-out uses the locale's decimal separator",
    async run(t) {
      await sleep(400);
      const facts = await t.text("#bc-facts");
      t.assert(facts.includes(t.num(3.5)), "3.5 s written for the locale: " + facts);
      t.assert(facts.includes(t.num(17.5)), "17.5 MB written for the locale");
    },
  },
  {
    page: "mikrotik-firewall-generator",
    name: "mikrotik: field errors translated, script stays ASCII",
    async run(t) {
      await sleep(400);
      const s = await t.page.eval(`document.querySelector("#fw-out").value`);
      t.assert(/^[\x09\x0a\x20-\x7e]*$/.test(s), "script is plain ASCII");
      t.assert(s.includes('add chain=input action=drop comment="input: drop everything else"'), "same script as on the English page");
      await t.page.setValue("#fw-lan", "ether1");
      await sleep(400);
      const err = await t.page.eval(`[...document.querySelectorAll(".ros-err")].filter((e) => !e.hidden).map((e) => e.textContent).join("|")`);
      t.eq(err, fill(await t.tx("{name} can't be both WAN and LAN."), { name: "ether1" }), "error message");
    },
  },
];
