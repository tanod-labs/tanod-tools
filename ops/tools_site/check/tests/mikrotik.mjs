// MikroTik tools: the RouterOS core (export parser, quoting, CIDR aggregation, burst model), every generator's
// output and validation, the firewall auditor on a deliberately weak and a hardened export, the v6 to v7
// migration helper on a v6 export, and the export diff. Fixtures live in ../ros-fixtures/.
import { readFileSync } from "node:fs";

const FIX = (name) => readFileSync(new URL(`../ros-fixtures/${name}`, import.meta.url), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const val = (sel) => `document.querySelector(${JSON.stringify(sel)}).value`;
const txt = (sel) => `document.querySelector(${JSON.stringify(sel)}).innerText`;
/* Import a module the page already loaded (same ?v= stamp, so the same instance). */
const mod = (name) => `import(document.querySelector('script[type=module]').src.replace(/[\\w-]+\\.js/, ${JSON.stringify(name + ".js")}))`;
const errs = (t) => t.page.eval(`[...document.querySelectorAll(".ros-err")].filter((e) => !e.hidden).map((e) => e.textContent)`);
async function out(t, sel) { await sleep(350); return t.page.eval(val(sel)); }
async function check(t, sel, on) { if ((await t.page.eval(`document.querySelector(${JSON.stringify(sel)}).checked`)) !== on) await t.page.click(sel); await sleep(250); }
async function rowSet(t, list, row, key, value) {
  await t.page.eval(`(() => { const e = document.querySelectorAll(${JSON.stringify(list + " > .ros-row")})[${row}].querySelector('[data-k="${key}"]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", {bubbles: true})); e.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
  await sleep(300);
}
const has = (t, text, line, what) => t.assert(text.split("\n").includes(line), `${what || "script"} has line: ${line}\n--- got:\n${text.slice(0, 3000)}`);

export default [
  /* ------------------------------------------------------------------ core units */
  {
    page: "mikrotik-address-list-generator",
    name: "core: export parser, quoting, CIDR aggregation edge cases",
    async run(t) {
      const r = await t.page.eval(`(async () => {
        const c = await ${mod("roscore")};
        const p = c.parseExport('# jan/02/2024 10:15:22 by RouterOS 6.49.10\\n/ip firewall filter\\nadd chain=input comment="a \\\\"b\\\\" c" \\\\\\n    action=drop\\n/ip service set telnet disabled=yes\\n/ip/firewall/nat/add chain=srcnat action=masquerade');
        const cmds = p.entries.filter((e) => e.kind === "cmd");
        const merge = (list) => { const all = list.map(c.parseAddrItem); const out = []; for (const v of [4, 6]) for (const r of c.mergeIntervals(all.filter((x) => x.version === v))) for (const b of c.rangeToCidrs(r.lo, r.hi, v === 4 ? 32 : 128)) out.push(c.fmtCidr(v, b.addr, b.prefix)); return out; };
        let bad = [];
        for (const s of ["10.0.0.256", "abc", "010.1.1.1", "10.0.0.9-10.0.0.1", "1.2.3.4/33"]) { try { c.parseAddrItem(s); } catch (e) { bad.push(e instanceof c.InputError); } }
        return {
          version: [p.info.version, p.info.major], first: cmds[0].args, firstLine: cmds[0].line,
          svc: [cmds[1].menu, cmds[1].cmd, cmds[1].pos[0], cmds[1].args.disabled], slash: [cmds[2].menu, cmds[2].cmd, cmds[2].args.action],
          q: [c.q("bridge"), c.q("two words"), c.q('say "hi" $x?'), c.q("ñ"), c.q(""), c.q("!LAN")],
          a: merge(["10.0.0.0/25", "10.0.0.128/25"]), b: merge(["10.0.0.5-10.0.0.20"]), cc: merge(["10.0.0.0/8", "10.1.2.3"]),
          d: merge(["10.0.0.1", "10.0.0.2"]), e: merge(["0.0.0.0-255.255.255.255"]), f: merge(["192.168.1.77/24"]),
          g: merge(["2001:db8::/33", "2001:db8:8000::/33"]), h: merge(["255.255.255.255", "255.255.255.254"]), i: merge(["10.0.0.0/24", "10.0.1.0/24", "10.0.3.0/24"]),
          bad, list: c.fmtListAddr(4, 167772161n, 32),
          rates: [c.parseRate("1.5M"), c.parseRate("512k"), c.fmtRate(1500000), c.fmtRate(2e9), c.fmtRate(64000)],
          times: [c.parseTime("1h30m"), c.parseTime("00:10:00"), c.fmtTime(93784)],
          ports: [c.parsePorts("80, 443,8000-8010").text, c.portsCover(c.parsePorts("1-1024"), c.parsePorts("22,80")), c.portsCover(c.parsePorts("22"), c.parsePorts("22,23"))],
          mask: c.maskSecrets('add name=u1 password="p w" service=pppoe secret=abc'),
        };
      })()`);
      t.eq(r.version, ["6.49.10", 6], "version from header");
      t.eq(r.first, { chain: "input", comment: 'a "b" c', action: "drop" }, "continuation joined, escapes decoded");
      t.eq(r.firstLine, 3, "logical line keeps its first line number");
      t.eq(r.svc, ["/ip service", "set", "telnet", "yes"], "one-line menu command");
      t.eq(r.slash, ["/ip firewall nat", "add", "masquerade"], "slash-separated path");
      t.eq(r.q, ["bridge", '"two words"', '"say \\"hi\\" \\$x\\?"', '"\\C3\\B1"', '""', "!LAN"], "quoting");
      t.eq(r.a, ["10.0.0.0/24"], "two halves merge");
      t.eq(r.b, ["10.0.0.5/32", "10.0.0.6/31", "10.0.0.8/29", "10.0.0.16/30", "10.0.0.20/32"], "range to minimal CIDRs");
      t.eq(r.cc, ["10.0.0.0/8"], "contained address absorbed");
      t.eq(r.d, ["10.0.0.1/32", "10.0.0.2/32"], "adjacent but unaligned stay apart");
      t.eq(r.e, ["0.0.0.0/0"], "whole IPv4 space");
      t.eq(r.f, ["192.168.1.0/24"], "host bits cleared");
      t.eq(r.g, ["2001:db8::/32"], "IPv6 halves merge");
      t.eq(r.h, ["255.255.255.254/31"], "top of the address space");
      t.eq(r.i, ["10.0.0.0/23", "10.0.3.0/24"], "gap kept");
      t.eq(r.bad, [true, true, true, true, true], "invalid entries rejected with InputError");
      t.eq(r.list, "10.0.0.1", "a /32 list entry is a bare address");
      t.eq(r.rates, [1500000, 512000, "1500k", "2G", "64k"], "rates");
      t.eq(r.times, [5400, 600, "1d2h3m4s"], "times");
      t.eq(r.ports, ["80,443,8000-8010", true, false], "ports");
      t.eq(r.mask, "add name=u1 password=***** service=pppoe secret=*****", "secrets masked");
    },
  },
  {
    page: "mikrotik-burst-calculator",
    name: "core: burst model (16 slots) and the page's read-out",
    async run(t) {
      const r = await t.page.eval(`(async () => {
        const q = await ${mod("rosqueue")};
        const a = q.simulateBurst({ max: 20e6, burst: 40e6, threshold: 16e6, time: 8 });
        const b = q.simulateBurst({ max: 512e3, burst: 1024e3, threshold: 384e3, time: 8 });
        const n = q.simulateBurst({ max: 20e6, burst: 40e6, threshold: 30e6, time: 8 }, { windows: 6 });
        return { a: a.burstSecs, est: q.burstEstimate({ burst: 40e6, threshold: 16e6, time: 8 }), b: b.burstSecs,
          rebursts: n.points.filter((p, i) => i && p.rate > 20e6 && n.points[i - 1].rate <= 20e6).length,
          thr: q.thresholdFor({ burst: 40e6, time: 8 }, 5), probs: q.burstProblems({ max: 20e6, burst: 40e6, threshold: 25e6, time: 8 }, "download").length };
      })()`);
      t.eq(r.a, 3.5, "burst from idle ends at the first check after the threshold");
      t.eq(r.est, 3.2, "textbook estimate");
      t.eq(r.b, 3, "MikroTik's 512k/1M/384k/8s example bursts for 3 s");
      t.assert(r.rebursts >= 1, "threshold above max-limit bursts again while busy");
      t.eq(r.thr, 25e6, "threshold for a 5 s burst");
      t.eq(r.probs, 1, "threshold above max-limit is flagged");
      const facts = await t.page.eval(txt("#bc-facts"));
      t.assert(/burst from idle lasts\s+3\.5 s/.test(facts), "facts show 3.5 s: " + facts);
      t.assert(/17\.5 MB/.test(facts), "data during the burst");
      const s = await out(t, "#bc-out");
      t.assert(s.includes("max-limit=5M/20M burst-limit=10M/40M burst-threshold=4M/16M burst-time=8s/8s"), "simple queue line");
      t.assert(s.includes('rate-limit="5M/20M 10M/40M 4M/16M 8/8"'), "PPP rate-limit line");
      t.assert(await t.page.eval(`document.querySelectorAll("#bc-chart svg path.rate").length === 1`), "chart drawn");
      await t.page.setValue("#bc-down-thr", "fast");
      await sleep(300);
      t.assert((await errs(t)).length === 1, "invalid rate shows a field error");
      t.assert(await t.page.eval(`document.querySelector("#bc-copy").disabled`), "copy disabled while invalid");
    },
  },

  /* ------------------------------------------------------------------ generators */
  {
    page: "mikrotik-firewall-generator",
    name: "firewall generator: v7 baseline, options, validation, download",
    async run(t) {
      let s = await out(t, "#fw-out");
      for (const l of [
        "add chain=input action=accept connection-state=established,related,untracked comment=\"input: accept established, related, untracked\"",
        "add chain=input action=drop connection-state=invalid comment=\"input: drop invalid\"",
        "add chain=input action=accept src-address-list=mgmt protocol=tcp dst-port=8291,22 comment=\"input: WinBox and SSH from management subnets\"",
        "add chain=input action=drop comment=\"input: drop everything else\"",
        "add chain=forward action=fasttrack-connection connection-state=established,related hw-offload=yes comment=\"forward: fasttrack established and related\"",
        "add chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN comment=\"forward: drop new connections from WAN that are not port forwards\"",
        "add chain=srcnat action=masquerade out-interface-list=WAN ipsec-policy=out,none comment=\"masquerade to the internet\"",
        "set telnet disabled=yes", "set winbox address=192.168.88.0/24 disabled=no",
        ":if ([:len [/interface list member find list=\"WAN\" interface=ether1]] = 0) do={ /interface list member add list=WAN interface=ether1 }",
      ]) has(t, s, l);
      const lines = s.split("\n");
      t.assert(lines.indexOf("add chain=input action=drop comment=\"input: drop everything else\"") > lines.findIndex((l) => l.includes("accept everything from LAN")), "final drop after LAN accept");
      await check(t, "#fw-lanall", false);
      await check(t, "#fw-v6", true);
      await t.page.setValue("#fw-open", "udp/13231");
      s = await out(t, "#fw-out");
      has(t, s, "add chain=input action=accept in-interface-list=LAN protocol=udp dst-port=53,67,123 comment=\"input: DNS, DHCP and NTP from LAN\"");
      has(t, s, "add chain=input action=accept protocol=udp dst-port=13231 comment=\"input: open udp/13231\"");
      has(t, s, "add chain=forward action=drop protocol=icmpv6 hop-limit=equal:1 comment=\"v6 forward: RFC 4890 drop hop-limit=1\"");
      t.assert(!s.includes("accept everything from LAN"), "LAN not trusted");
      const dl = await t.dl("#fw-dl");
      t.eq(dl.name, "mikrotik-firewall.rsc", "download name");
      t.eq(dl.bytes.toString("utf8"), s, "download matches the script");
      await t.page.setValue("#fw-lan", "ether1");
      await sleep(300);
      t.assert((await errs(t)).some((e) => /both WAN and LAN/.test(e)), "WAN = LAN rejected");
      await t.page.setValue("#fw-lan", "bridge");
      await t.page.setValue("#fw-mgmt", "192.168.88.0/33");
      await sleep(300);
      t.eq((await errs(t)).length, 1, "bad CIDR rejected");
      t.eq(await t.page.eval(val("#fw-out")), "", "no script while invalid");
      await t.page.setValue("#fw-open", "13231");
      await sleep(300);
      t.eq((await errs(t)).length, 2, "open port needs a protocol");
      await t.shot("generator", 375);
    },
  },
  {
    page: "mikrotik-port-forwarding",
    name: "port forwarding: dst-nat, hairpin, sources, duplicates",
    async run(t) {
      let s = await out(t, "#pf-out");
      has(t, s, 'add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-port=443 to-addresses=192.168.88.10 comment="port forward: https-server"');
      has(t, s, 'add chain=dstnat action=dst-nat in-interface-list=WAN protocol=tcp dst-port=8443 to-addresses=192.168.88.20 to-ports=443 comment="port forward: nvr"');
      await check(t, "#pf-hair", true);
      t.assert((await errs(t)).some((e) => /Hairpin/.test(e)), "hairpin needs an address match");
      await t.page.click('input[name="pf-mode"][value="ip"]');
      await sleep(300);
      await t.page.setValue("#pf-src", "198.51.100.0/24");
      s = await out(t, "#pf-out");
      has(t, s, 'add chain=dstnat action=dst-nat dst-address=203.0.113.10 protocol=tcp dst-port=443 src-address-list=pf-allowed to-addresses=192.168.88.10 comment="port forward: https-server"');
      has(t, s, 'add chain=srcnat action=masquerade protocol=tcp src-address=192.168.88.0/24 dst-address=192.168.88.20 dst-port=443 comment="hairpin: nvr"');
      t.assert(s.includes("address=192.168.88.0/24 comment=\"port forward sources\""), "LAN added to allowed sources for hairpin");
      await rowSet(t, "#pf-rows", 1, "proto", "both");
      await rowSet(t, "#pf-rows", 1, "ext", "443");
      t.assert((await errs(t)).some((e) => /already forwarded/.test(e)), "duplicate public port rejected");
      await rowSet(t, "#pf-rows", 1, "ext", "5000-5010");
      t.assert((await errs(t)).some((e) => /internal port empty/.test(e)), "range with internal port rejected");
      await rowSet(t, "#pf-rows", 1, "int", "");
      s = await out(t, "#pf-out");
      has(t, s, 'add chain=dstnat action=dst-nat dst-address=203.0.113.10 protocol=udp dst-port=5000-5010 src-address-list=pf-allowed to-addresses=192.168.88.20 comment="port forward: nvr"');
    },
  },
  {
    page: "mikrotik-address-list-generator",
    name: "address list: dedupe, merge, timeout, skip-existing, download",
    async run(t) {
      let s = await out(t, "#al-out");
      for (const l of [":do { add list=blocklist address=203.0.113.0/24 } on-error={}", ":do { add list=blocklist address=198.51.100.10/31 } on-error={}",
        ":do { add list=blocklist address=192.0.2.55 } on-error={}", ":do { add list=blocklist address=2001:db8:bad::/48 } on-error={}"]) has(t, s, l);
      t.eq(s.split("\n").filter((l) => l.startsWith(":do")).length, 7, "seven entries after merging");
      t.assert(/Duplicates removed\s+1/.test(await t.page.eval(txt("#al-stats"))), "one duplicate");
      await check(t, "#al-skip", false);
      await check(t, "#al-merge", false);
      await t.page.setValue("#al-timeout", "1d12h");
      await t.page.setValue("#al-in", "10.0.0.1 # one\n10.0.0.0/24; two\nnot-an-ip\n10.0.0.1");
      s = await out(t, "#al-out");
      has(t, s, "add list=blocklist address=10.0.0.0/24 timeout=1d12h");
      has(t, s, "add list=blocklist address=10.0.0.1 timeout=1d12h");
      t.assert(/skipped/.test(await t.page.eval(txt("#al-notes"))), "invalid entry reported");
      await t.page.setValue("#al-name", "bad\"name");
      await sleep(400);
      t.eq((await errs(t)).length, 1, "list name validated");
      await t.page.setValue("#al-name", "scanners");
      await sleep(400);
      const dl = await t.dl("#al-dl");
      t.eq(dl.name, "scanners.rsc", "download named after the list");
      t.assert(dl.bytes.toString().includes("add list=scanners address=10.0.0.0/24"), "download content");
    },
  },
  {
    page: "mikrotik-simple-queue-generator",
    name: "simple queues: list and subnet modes, burst, parent",
    async run(t) {
      let s = await out(t, "#sq-out");
      has(t, s, "add name=alice target=192.168.88.10/32 max-limit=5M/20M");
      has(t, s, "add name=office target=192.168.88.64/28 max-limit=5M/20M");
      await t.page.click('input[name="sq-mode"][value="subnet"]');
      await t.page.setValue("#sq-net", "10.1.1.0/29");
      await t.page.setValue("#sq-skip", "10.1.1.1");
      await check(t, "#sq-burst", true);
      await check(t, "#sq-parent", true);
      await t.page.setValue("#sq-ptarget", "10.1.1.0/29");
      s = await out(t, "#sq-out");
      const qs = s.split("\n").filter((l) => l.startsWith("add name=client-"));
      t.eq(qs.length, 5, "hosts .2-.6 (network, broadcast and .1 skipped)");
      has(t, s, "add name=client-10.1.1.2 target=10.1.1.2/32 parent=total max-limit=5M/20M burst-limit=10M/40M burst-threshold=4M/16M burst-time=8s/8s");
      t.assert(s.indexOf("add name=total") < s.indexOf("add name=client-"), "parent first");
      t.assert(/3[.,]5 s/.test(await t.page.eval(txt("#sq-notes"))), "burst duration note");
      await t.page.setValue("#sq-net", "10.0.0.0/16");
      await sleep(300);
      t.assert((await errs(t)).some((e) => /\/21/.test(e)), "too many hosts rejected");
    },
  },
  {
    page: "mikrotik-pcq-generator",
    name: "PCQ: simple queue and queue tree methods",
    async run(t) {
      let s = await out(t, "#pcq-out");
      has(t, s, "add name=pcq-download kind=pcq pcq-classifier=dst-address pcq-rate=10M");
      has(t, s, "add name=pcq-upload kind=pcq pcq-classifier=src-address pcq-rate=2M");
      has(t, s, 'add name=pcq-lan target=192.168.88.0/24 queue=pcq-upload/pcq-download max-limit=45M/95M comment="PCQ per-client shaping"');
      await t.page.click('input[name="pcq-method"][value="tree"]');
      await t.page.setValue("#pcq-mask", "29");
      s = await out(t, "#pcq-out");
      has(t, s, 'add chain=forward action=mark-connection new-connection-mark=pcq-conn connection-mark=no-mark in-interface-list=LAN out-interface-list=WAN passthrough=yes comment="PCQ: mark LAN-to-WAN connections"');
      has(t, s, "add name=pcq-download parent=global packet-mark=pcq-down queue=pcq-download max-limit=95M");
      has(t, s, "add name=pcq-download kind=pcq pcq-classifier=dst-address pcq-rate=10M pcq-dst-address-mask=29");
    },
  },
  {
    page: "mikrotik-netwatch-generator",
    name: "netwatch: v7 ntfy, v6 form, Telegram, e-mail, escaping and validation",
    async run(t) {
      let s = await out(t, "#nw-out");
      const adds = () => s.split("\n").filter((l) => l.startsWith("add host="));
      t.eq(adds().length, 3, "three default hosts");
      t.assert(adds()[1].startsWith("add host=8.8.8.8 type=icmp interval=30s timeout=1s up-script="), "v7 uses type=icmp");
      t.assert(adds()[1].includes('http-method=post http-data=\\"MikroTik: Google DNS (8.8.8.8) is DOWN\\"'), "ntfy post with message");
      t.assert(adds()[1].includes('url=\\"https://ntfy.sh/my-router-alerts\\"'), "ntfy url");
      await rowSet(t, "#nw-hosts", 1, "label", 'A "q" $x \\ b');
      s = await out(t, "#nw-out");
      t.assert(adds()[1].endsWith('comment="A \\"q\\" \\$x \\\\ b"'), "comment escaped: " + adds()[1].slice(-60));
      t.assert(adds()[1].includes('A \\\\\\"q\\\\\\" \\\\\\$x'), "message double-escaped");
      await t.page.click('input[name="nw-ver"][value="v6"]');
      s = await out(t, "#nw-out");
      t.assert(adds()[0].startsWith("add host=203.0.113.1 interval=30s timeout=1s up-script="), "v6 has no type");
      t.assert(!s.includes("type=icmp\n") && !adds().some((l) => l.includes("type=icmp")), "no type=icmp on v6");
      await t.page.click('input[name="nw-notify"][value="telegram"]');
      await sleep(300);
      t.assert((await errs(t)).length === 2, "token and chat id required");
      await t.page.setValue("#nw-tg-token", "123456789:ABC-def_1");
      await t.page.setValue("#nw-tg-chat", "-100123");
      s = await out(t, "#nw-out");
      t.assert(s.includes("https://api.telegram.org/bot123456789:ABC-def_1/sendMessage"), "telegram url");
      t.assert(s.includes("chat_id=-100123&text=MikroTik%3A%20"), "telegram text encoded");
      await t.page.click('input[name="nw-notify"][value="email"]');
      await t.page.setValue("#nw-mail-to", "ops@example.com");
      s = await out(t, "#nw-out");
      t.assert(s.includes('/tool e-mail send to=\\"ops@example.com\\" subject='), "e-mail send");
      await t.page.click('input[name="nw-notify"][value="none"]');
      s = await out(t, "#nw-out");
      t.assert(!adds().some((l) => l.includes("/tool fetch") || l.includes("e-mail send")), "no notification commands");
      await rowSet(t, "#nw-hosts", 2, "ip", "8.8.8.8");
      t.assert((await errs(t)).some((e) => /8\.8\.8\.8/.test(e)), "duplicate host rejected");
    },
  },
  {
    page: "mikrotik-load-balancing",
    name: "load balancing: v7 PCC with weights and recursive failover",
    async run(t) {
      await rowSet(t, "#lb-wans", 0, "weight", "2");
      const s = await out(t, "#lb-out");
      for (const l of ["add name=to-isp1 fib", "add name=to-isp2 fib",
        'add chain=prerouting action=mark-connection new-connection-mark=isp1-conn connection-mark=no-mark in-interface-list=LAN dst-address-type=!local per-connection-classifier=both-addresses:3/0 passthrough=yes comment="PCC: share 1/3 to isp1"',
        'add chain=prerouting action=mark-connection new-connection-mark=isp1-conn connection-mark=no-mark in-interface-list=LAN dst-address-type=!local per-connection-classifier=both-addresses:3/1 passthrough=yes comment="PCC: share 2/3 to isp1"',
        'add chain=prerouting action=mark-connection new-connection-mark=isp2-conn connection-mark=no-mark in-interface-list=LAN dst-address-type=!local per-connection-classifier=both-addresses:3/2 passthrough=yes comment="PCC: share 3/3 to isp2"',
        'add dst-address=1.1.1.1/32 gateway=203.0.113.1 scope=10 comment="check host for isp1"',
        'add dst-address=9.9.9.9/32 gateway=pppoe-out1 scope=10 comment="check host for isp2"',
        'add dst-address=0.0.0.0/0 gateway=9.9.9.9 routing-table=to-isp1 target-scope=11 check-gateway=ping distance=2 comment="to-isp1: via isp2"',
        'add chain=output action=drop dst-address=1.1.1.1 protocol=icmp out-interface=!ether1 comment="check host isp1 only via ether1"',
        "disable [ find action=fasttrack-connection ]"]) has(t, s, l);
      t.assert(s.indexOf("/routing table") < s.indexOf("/ip firewall mangle"), "tables before mangle");
      await rowSet(t, "#lb-wans", 1, "mon", "1.1.1.1");
      t.assert((await errs(t)).length >= 1, "duplicate check host rejected");
      await rowSet(t, "#lb-wans", 1, "mon", "192.168.1.1");
      t.assert((await errs(t)).some((e) => /public address/.test(e)), "private check host rejected");
    },
  },
  {
    page: "mikrotik-pppoe-server-generator",
    name: "PPPoE server: pool, profiles, placeholder secrets only, RADIUS",
    async run(t) {
      await check(t, "#pp-radius", true);
      const s = await out(t, "#pp-out");
      for (const l of ["add name=pppoe-pool ranges=10.10.0.2-10.10.3.254",
        "add name=plan-10M local-address=10.10.0.1 remote-address=pppoe-pool dns-server=1.1.1.1,8.8.8.8 rate-limit=3M/10M only-one=yes change-tcp-mss=yes",
        "add service-name=isp interface=ether2 default-profile=plan-10M authentication=chap,mschap1,mschap2 one-session-per-host=yes max-mtu=1480 max-mru=1480 keepalive-timeout=10 disabled=no",
        "add name=customer001 password=CHANGE_ME_001 service=pppoe profile=plan-10M",
        'add service=ppp address=10.0.0.5 secret=CHANGE_ME comment="PPPoE RADIUS"', "set use-radius=yes accounting=yes interim-update=5m", "set accept=yes"]) has(t, s, l);
      const pw = [...s.matchAll(/(password|secret)=(\S+)/g)].map((m) => m[2]);
      t.assert(pw.length && pw.every((p) => p.startsWith("CHANGE_ME")), "every password and secret is a placeholder: " + pw.join(","));
      await t.page.setValue("#pp-user", "customer");
      await sleep(300);
      t.assert((await errs(t)).some((e) => /\{n\}/.test(e)), "pattern needs {n}");
    },
  },
  {
    page: "mikrotik-dhcp-server-generator",
    name: "DHCP server: pool, network, static leases, subnet checks",
    async run(t) {
      let s = await out(t, "#dh-out");
      for (const l of ["add name=dhcp-lan ranges=192.168.88.10-192.168.88.254",
        "add name=dhcp-lan interface=bridge address-pool=dhcp-lan lease-time=1d disabled=no",
        'add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1 domain=lan comment="dhcp-lan network"',
        "add address=192.168.88.5 mac-address=4C:5E:0C:12:34:56 server=dhcp-lan comment=printer"]) has(t, s, l);
      await t.page.setValue("#dh-net", "10.20.0.0/22");
      await sleep(300);
      t.assert((await errs(t)).some((e) => /outside 10\.20\.0\.0\/22/.test(e)), "static lease outside the new subnet flagged");
      await rowSet(t, "#dh-leases", 0, "ip", "10.20.0.1");
      t.assert((await errs(t)).some((e) => /gateway/.test(e)), "lease on the gateway rejected");
      await rowSet(t, "#dh-leases", 0, "ip", "10.20.0.5");
      s = await out(t, "#dh-out");
      has(t, s, "add name=dhcp-lan ranges=10.20.0.10-10.20.3.254");
      has(t, s, "add address=10.20.0.0/22 gateway=10.20.0.1 dns-server=10.20.0.1 domain=lan comment=\"dhcp-lan network\"");
      await t.page.setValue("#dh-pool", "10.20.0.1-10.20.0.50");
      await sleep(300);
      t.assert((await errs(t)).some((e) => /includes the gateway/.test(e)), "pool with gateway rejected");
      await t.page.setValue("#dh-pool", "10.20.0.10-10.20.0.50");
      await rowSet(t, "#dh-leases", 0, "mac", "zz:11");
      t.assert((await errs(t)).some((e) => /MAC/.test(e)), "bad MAC rejected");
    },
  },
  {
    page: "mikrotik-vlan-generator",
    name: "VLAN: bridge VLAN filtering order, membership and validation",
    async run(t) {
      const s = await out(t, "#vl-out");
      for (const l of ['set [ find interface=ether2 ] pvid=10 frame-types=admit-only-untagged-and-priority-tagged ingress-filtering=yes comment="access VLAN 10"',
        'set [ find interface=ether1 ] frame-types=admit-only-vlan-tagged ingress-filtering=yes comment=trunk',
        "add bridge=bridge vlan-ids=10 tagged=bridge,ether1 untagged=ether2,ether4 comment=staff",
        "add bridge=bridge vlan-ids=99 tagged=bridge,ether1,ether4 comment=mgmt",
        "add interface=bridge name=vlan20-guests vlan-id=20", 'add address=10.10.99.1/24 interface=vlan99-mgmt comment=mgmt']) has(t, s, l);
      const cmds = s.split("\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("/"));
      t.eq(cmds[cmds.length - 1], "set bridge vlan-filtering=yes", "VLAN filtering enabled in the last line");
      t.eq(cmds[0], "set bridge vlan-filtering=no", "and off in the first");
      await check(t, "#vl-inbridge", false);
      await check(t, "#vl-exists", false);
      const s2 = await out(t, "#vl-out");
      has(t, s2, 'add name=bridge vlan-filtering=no comment="VLAN-aware bridge"');
      has(t, s2, 'add bridge=bridge interface=ether3 pvid=20 frame-types=admit-only-untagged-and-priority-tagged ingress-filtering=yes comment="access VLAN 20"');
      await rowSet(t, "#vl-ports", 1, "pvid", "30");
      t.assert((await errs(t)).some((e) => /isn't in the VLAN list/.test(e)), "unknown VLAN rejected");
      await rowSet(t, "#vl-ports", 1, "pvid", "10");
      await rowSet(t, "#vl-vlans", 0, "addr", "10.10.10.0/24");
      t.assert((await errs(t)).some((e) => /not the network address/.test(e)), "network address as router address rejected");
    },
  },
  {
    page: "mikrotik-wireguard-generator",
    name: "WireGuard: keys from Web Crypto X25519 pair up, peer configs",
    async run(t) {
      await t.page.waitFor(`document.querySelector("#wg-out").value.includes("private-key=")`, { timeout: 8000 });
      const s = await out(t, "#wg-out");
      const routerPriv = s.match(/private-key="?([A-Za-z0-9+/]{43}=)/)[1];
      const peerPubs = [...s.matchAll(/public-key="?([A-Za-z0-9+/]{43}=)/g)].map((m) => m[1]);
      t.eq(peerPubs.length, 2, "two peers");
      has(t, s, "add address=10.66.0.1/24 interface=wireguard1 comment=\"WireGuard tunnel\"");
      t.assert(s.includes("allowed-address=10.66.0.2/32 comment=laptop"), "peer allowed-address");
      const confs = await t.page.eval(`[...document.querySelectorAll("#wg-confs textarea")].map((a) => a.value)`);
      t.eq(confs.length, 2, "two peer configs");
      const c0 = confs[0];
      for (const l of ["Address = 10.66.0.2/32", "AllowedIPs = 0.0.0.0/0", "Endpoint = vpn.example.com:13231", "PersistentKeepalive = 25", "DNS = 10.66.0.1"]) t.assert(c0.includes(l), "peer config has " + l);
      const peerPriv = c0.match(/PrivateKey = (\S+)/)[1];
      const routerPub = c0.match(/PublicKey = (\S+)/)[1];
      t.assert(c0.match(/PresharedKey = (\S+)/)[1] === s.match(/preshared-key="?([A-Za-z0-9+/]{43}=)/)[1], "same preshared key on both sides");
      const ok = await t.page.eval(`(async () => {
        const raw = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
        const pkcs8 = (k) => { const p = new Uint8Array(48); p.set([48,46,2,1,0,48,5,6,3,43,101,110,4,34,4,32]); p.set(raw(k), 16); return p; };
        const priv = (k) => crypto.subtle.importKey("pkcs8", pkcs8(k), { name: "X25519" }, true, ["deriveBits"]);
        const pub = (k) => crypto.subtle.importKey("raw", raw(k), { name: "X25519" }, true, []);
        const ab = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: await pub(${JSON.stringify(peerPubs[0])}) }, await priv(${JSON.stringify(routerPriv)}), 256));
        const ba = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: await pub(${JSON.stringify(routerPub)}) }, await priv(${JSON.stringify(peerPriv)}), 256));
        const jwk = await crypto.subtle.exportKey("jwk", await priv(${JSON.stringify(routerPriv)}));
        const clamped = raw(${JSON.stringify(routerPriv)});
        return { same: ab.every((x, i) => x === ba[i]), pubMatch: btoa(String.fromCharCode(...raw(jwk.x.replace(/-/g, "+").replace(/_/g, "/") + "="))) === ${JSON.stringify(routerPub)}, clamp: (clamped[0] & 7) === 0 && (clamped[31] & 128) === 0 && (clamped[31] & 64) === 64 };
      })()`);
      t.assert(ok.same, "router and peer derive the same shared secret");
      t.assert(ok.pubMatch, "router public key in the peer config matches the router's private key");
      t.assert(ok.clamp, "private key clamped like wg genkey");
      await t.page.click('input[name="wg-route"][value="split"]');
      await sleep(300);
      t.assert((await t.page.eval(`document.querySelector("#wg-confs textarea").value`)).includes("AllowedIPs = 10.66.0.0/24, 192.168.88.0/24"), "split tunnel AllowedIPs");
      await t.page.click('input[name="wg-keys"][value="elsewhere"]');
      await sleep(500);
      t.assert((await errs(t)).length >= 2, "keys made elsewhere: each peer needs its public key");
      await rowSet(t, "#wg-peers", 0, "pub", "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=");
      await rowSet(t, "#wg-peers", 1, "pub", "TrMvSoP4jYQlY6RIzBgbssQqY3vxI2Pi+y71lOWWXX0=");
      const s3 = await out(t, "#wg-out");
      t.assert(!/private-key=/.test(s3), "router generates its own private key");
      t.assert((await t.page.eval(`document.querySelector("#wg-confs textarea").value`)).includes("<router public key"), "placeholder for the router key");
    },
  },

  /* ------------------------------------------------------------------ auditor */
  {
    page: "mikrotik-firewall-auditor",
    name: "auditor: weak export gets the expected findings",
    async run(t) {
      await t.page.setValue("#au-in", FIX("v7-weak.rsc"));
      await t.page.setValue("#au-users", FIX("users-print.txt"));
      await sleep(600);
      const f = await t.page.eval(`[...document.querySelectorAll(".ros-finding")].map((e) => e.dataset.sev + ":" + e.dataset.id)`);
      for (const want of ["low:svc-telnet", "critical:svc-ftp", "critical:svc-www", "high:input-no-drop", "high:svc-winbox", "high:svc-ssh", "high:svc-api",
        "high:dns-open", "high:socks-open", "high:snmp", "medium:upnp", "medium:forward-open", "medium:input-no-established", "medium:risky-forward",
        "medium:admin-user", "medium:btest", "low:input-no-invalid", "low:shadowed", "low:l2-access"]) t.assert(f.includes(want), `finding ${want} in ${f.join(", ")}`);
      t.assert(!f.includes("high:svc-www-ssl"), "www-ssl is off by default");
      t.assert(!f.some((x) => x.endsWith(":svc-telnet") && !x.startsWith("low")), "telnet is dropped from the WAN by an explicit rule, so it is only low");
      const winbox = await t.page.eval(`document.querySelector('[data-id="svc-winbox"]').innerText`);
      t.assert(winbox.includes("Line 26") && winbox.includes("winbox from anywhere"), "winbox finding points at the accept rule: " + winbox);
      const shadow = await t.page.eval(`document.querySelector('[data-id="shadowed"]').innerText`);
      t.assert(/line 27 can never match/.test(shadow) && /line 25/.test(shadow), "ping limit rule shadowed by the earlier ICMP accept");
      await t.shot("weak", 1280, { selector: "#au-res" });
      await t.page.click("#au-copy");
    },
  },
  {
    page: "mikrotik-firewall-auditor",
    name: "auditor: hardened export is clean; old v6 and v7 rule logic",
    async run(t) {
      await t.page.setValue("#au-in", FIX("v7-hardened.rsc"));
      await t.page.setValue("#au-users", "0   netops   full\n1   monitor  read");
      await sleep(600);
      const f = await t.page.eval(`[...document.querySelectorAll(".ros-finding")].map((e) => e.dataset.sev + ":" + e.dataset.id + " " + e.querySelector("h3").textContent)`);
      t.eq(f, [], "no findings on the hardened export");
      t.assert(/No findings/.test(await t.page.eval(txt("#au-res"))), "says no findings");
      const r = await t.page.eval(`(async () => {
        const a = await ${mod("rosaudit")};
        const ids = (x, o) => a.audit(x, o).findings.map((f) => f.sev + ":" + f.id);
        return {
          old: ids("# apr/01/2018 10:00:00 by RouterOS 6.40.5\\n/ip firewall filter\\nadd chain=input action=drop in-interface=ether1\\n/ip firewall nat\\nadd chain=srcnat action=masquerade out-interface=ether1"),
          jump: ids("/interface list\\nadd name=WAN\\n/interface list member\\nadd interface=ether1 list=WAN\\n/ip firewall filter\\nadd chain=input action=jump jump-target=wan-in in-interface-list=WAN\\nadd chain=input action=accept connection-state=established,related\\nadd chain=input action=drop connection-state=invalid\\nadd chain=wan-in action=accept protocol=tcp dst-port=22\\nadd chain=wan-in action=drop\\n/ip service\\nset telnet disabled=yes\\nset ftp disabled=yes\\nset www disabled=yes\\nset api disabled=yes\\nset api-ssl disabled=yes"),
          restricted: ids("/interface list\\nadd name=WAN\\nadd name=LAN\\n/interface list member\\nadd interface=ether1 list=WAN\\n/ip firewall filter\\nadd chain=input action=accept connection-state=established,related\\nadd chain=input action=accept protocol=tcp dst-port=8291\\nadd chain=input action=drop in-interface-list=!LAN\\n/ip service\\nset winbox address=10.0.0.0/24"),
          noFilter: ids("/ip address\\nadd address=192.168.88.1/24 interface=bridge"),
          notExport: (() => { try { a.audit("hello world"); return "accepted"; } catch (e) { return e.message.slice(0, 30); } })(),
        };
      })()`);
      t.assert(r.old.includes("critical:version-winbox"), "6.40.5 has the WinBox credential leak");
      t.assert(r.jump.includes("high:svc-ssh") && !r.jump.includes("high:svc-winbox"), "jump chains followed: ssh accepted, winbox dropped: " + r.jump);
      t.assert(r.restricted.includes("medium:svc-winbox"), "service address alone is medium: " + r.restricted);
      t.assert(r.noFilter.includes("critical:no-filter"), "no filter rules is critical");
      t.assert(/doesn't look like/.test(r.notExport), "plain text rejected");
    },
  },

  /* ------------------------------------------------------------------ migration */
  {
    page: "routeros-v7-migration-helper",
    name: "v6 to v7: routing marks, rules, filters, OSPF, BGP, NTP, review markers",
    async run(t) {
      await t.page.setValue("#mg-in", FIX("v6-export.rsc"));
      const s = await out(t, "#mg-out");
      for (const l of [
        "add name=via-isp2 fib",
        "add distance=1 gateway=10.255.0.6 routing-table=via-isp2",
        "add dst-address=192.0.2.0/24 blackhole",
        "add src-address=192.168.10.200/32 action=lookup-only-in-table table=via-isp2",
        'add chain=ospf-in rule="if (dst in 10.0.0.0/8 && dst-len in 8-24) { accept }"',
        'add chain=ospf-in rule="if (dst == 0.0.0.0/0) { reject }"',
        'add chain=bgp-out rule="if (dst == 203.0.113.0/24) { set bgp-path-prepend 2; accept }"',
        'add chain=bgp-in rule="if (dst in 0.0.0.0/0 && dst-len in 0-32) { set bgp-local-pref 200; accept }"',
        "add name=default-v2 version=2 router-id=172.16.255.1 redistribute=connected originate-default=if-installed in-filter-chain=ospf-in",
        "add name=backbone-v2 area-id=0.0.0.0 instance=default-v2",
        "add area=backbone-v2 interfaces=ether1 networks=10.255.0.0/30 type=ptp auth=md5 auth-key=ospfsecret",
        "add area=backbone-v2 networks=192.168.10.0/24",
        "add list=bgp-networks address=203.0.113.0/24",
        "add name=upstream remote.address=198.51.100.1 remote.as=64500 as=64512 router-id=172.16.255.1 local.role=ebgp output.filter-chain=bgp-out output.network=bgp-networks tcp-md5-key=bgpsecret",
        "add address=162.159.200.1", "add address=pool.ntp.org", "set enabled=yes",
        "add distance=1 dst-address=198.18.0.0/15 gateway=10.255.0.2", "add distance=1 dst-address=198.18.0.0/15 gateway=10.255.0.6",
        "# v6: add action=accept bgp-communities=64512:100 chain=bgp-in",
        "# v6: set distribute-default=never",
      ]) has(t, s, l, "converted script");
      const lines = s.split("\n");
      t.assert(lines.indexOf("/routing table") < lines.indexOf("/ip firewall mangle"), "routing table before mangle");
      t.assert(!lines.some((l) => /^add (?!.*source=).*(^|\s)routing-mark=/.test(l)), "no active routing-mark= on routes");
      t.assert(!lines.some((l) => /^add .*bgp-communities/.test(l)), "community filter not activated");
      t.assert(!lines.some((l) => /^\/routing (ospf (network|interface)$|bgp peer|filter$)/.test(l)), "no v6 routing menus left active");
      t.assert(lines.some((l) => /long comment that the export wrapped onto a second line because it is very long indeed/.test(l)), "continuation joined");
      const review = await t.page.eval(`[...document.querySelectorAll(".ros-review li")].map((e) => e.textContent)`);
      for (const re of [/bgp-communities=64512:100 has no reliable/, /as-type-1/, /synchronize=no/, /KiB/, /ECMP/, /\/routing rip/, /This script uses commands/, /rejects routes that reach the end/]) {
        t.assert(review.some((x) => re.test(x)), `review list has ${re}: ${review.join(" | ")}`);
      }
      const dl = await t.dl("#mg-dl");
      t.eq(dl.name, "routeros-v7-converted.rsc", "download name");
      await t.page.setValue("#mg-in", FIX("v7-hardened.rsc"));
      await sleep(400);
      t.assert((await errs(t)).some((e) => /already comes from RouterOS 7/.test(e)), "v7 export refused");
    },
  },

  /* ------------------------------------------------------------------ diff */
  {
    page: "routeros-export-diff",
    name: "export diff: sections, counts, masking, no false changes",
    async run(t) {
      const a = FIX("v7-weak.rsc");
      const b = a.replace("set enabled=yes\n/ip upnp", "set enabled=no\n/ip upnp").replace("add interface=ether1\n", "add interface=ether1 use-peer-dns=no\n")
        + "/ppp secret\nadd name=u1 password=hunter2 service=pppoe\n";
      await t.page.setValue("#xd-a", a);
      await t.page.setValue("#xd-b", b);
      await sleep(600);
      const head = await t.page.eval(txt("#xd-res .result__title"));
      t.assert(/3 sections changed · 3 lines added · 2 lines removed/.test(head), "summary: " + head);
      const changed = await t.page.eval(`[...document.querySelectorAll('.ros-sec[data-changed="true"] summary')].map((s) => s.firstChild.textContent)`);
      t.eq(changed, ["/ip dhcp-client", "/ip socks", "/ppp secret"], "changed sections in export order");
      const body = await t.page.eval(txt("#xd-res"));
      t.assert(body.includes("password=*****") && !body.includes("hunter2"), "secret masked");
      await t.page.setValue("#xd-b", a.replace(/# 2024-05-14 09:12:40/, "# 2025-01-01 00:00:00").replace("add bridge=bridge interface=ether2", "add  bridge=bridge   interface=ether2"));
      await sleep(600);
      t.assert(/No differences/.test(await t.page.eval(txt("#xd-res"))), "header date and spacing don't count as changes");
      await t.page.setValue("#xd-b", "");
      await sleep(600);
      t.assert(/second export/.test(await t.page.eval(txt("#xd-res"))), "single export viewer");
    },
  },
];
