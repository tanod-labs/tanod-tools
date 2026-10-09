import { $, el, live, Checker, tx } from "./rosui.js?v=11";
import { copyText, txn, announce } from "./core.js?v=11";
import { InputError } from "./roscore.js?v=11";
import { audit, SEVERITIES } from "./rosaudit.js?v=11";

const root = $("#au");
const SEV_LABEL = { critical: tx("Critical"), high: tx("High"), medium: tx("Medium"), low: tx("Low"), info: tx("Info") };
let last = null;

const SAMPLE = `# 2024-03-01 10:00:00 by RouterOS 7.12.1
# model = RB4011iGS+
/interface bridge
add name=bridge
/interface bridge port
add bridge=bridge interface=ether2
add bridge=bridge interface=ether3
/ip address
add address=192.168.88.1/24 interface=bridge
/ip dhcp-client
add interface=ether1
/ip dns
set allow-remote-requests=yes servers=1.1.1.1
/ip firewall filter
add action=accept chain=input protocol=icmp
add action=accept chain=input protocol=tcp dst-port=8291
add action=accept chain=input protocol=icmp icmp-options=8:0 limit=5,10:packet
add action=drop chain=input in-interface=ether1 protocol=tcp dst-port=23
/ip firewall nat
add action=masquerade chain=srcnat out-interface=ether1
add action=dst-nat chain=dstnat dst-port=3389 in-interface=ether1 protocol=tcp to-addresses=192.168.88.20
/ip proxy
set enabled=yes
/ip service
set ftp disabled=yes
`;

function render(res) {
  const box = $("#au-res");
  box.textContent = "";
  box.hidden = false;
  const sum = el("ul", { class: "ros-sum", "aria-label": tx("Findings by severity") });
  for (const s of SEVERITIES) if (res.counts[s]) sum.append(el("li", { "data-sev": s }, el("b", {}, String(res.counts[s])), " ", SEV_LABEL[s]));
  const head = el("div", { class: "result__head" },
    el("p", { class: "result__title" }, res.findings.length
      ? txn(res.findings.length, "{n} finding", "{n} findings")
      : tx("No findings")),
    el("p", { class: "help" }, [res.info.version ? tx("RouterOS {v}", { v: res.info.version }) : tx("RouterOS version not in the export"),
      txn(res.stats.rules, "{n} filter rule", "{n} filter rules"), txn(res.stats.nat, "{n} NAT rule", "{n} NAT rules"),
      res.stats.wan.length ? tx("WAN: {list}", { list: res.stats.wan.join(", ") }) : tx("WAN interfaces not identified")].join(" · ")));
  box.append(head, sum);
  if (!res.findings.length) box.append(el("p", { class: "note" }, tx("None of the checks found a problem. That doesn't prove the router is secure: see what the auditor covers below.")));
  const list = el("ol", { class: "ros-findings" });
  for (const f of res.findings) {
    const li = el("li", { class: "ros-finding", "data-sev": f.sev, "data-id": f.id },
      el("div", { class: "ros-finding__head" }, el("span", { class: "ros-sev" }, SEV_LABEL[f.sev]), el("h3", {}, f.title)),
      el("p", {}, f.why));
    if (f.lines.length) {
      li.append(el("p", { class: "ros-finding__line" }, f.lines.length === 1 ? tx("Line {n}:", { n: f.lines[0].line }) : tx("Lines {list}:", { list: f.lines.map((l) => l.line).join(", ") })),
        el("pre", { class: "mono" }, f.lines.map((l) => l.raw).join("\n")));
    }
    if (f.fix) li.append(el("p", { class: "ros-finding__fix" }, tx("Suggested fix")), el("pre", { class: "mono" }, f.fix));
    list.append(li);
  }
  box.append(list);
  $("#au-copy").hidden = false;
}

function reportText(res) {
  const lines = [`RouterOS firewall audit (heuristic) - ${res.info.version ? "RouterOS " + res.info.version : "version unknown"}`, ""];
  for (const f of res.findings) {
    lines.push(`[${f.sev.toUpperCase()}] ${f.title}`, f.why);
    for (const l of f.lines) lines.push(`  line ${l.line}: ${l.raw}`);
    if (f.fix) lines.push("  fix:", ...f.fix.split("\n").map((x) => "    " + x));
    lines.push("");
  }
  return lines.join("\n");
}

function run() {
  const c = new Checker(root);
  const text = $("#au-in").value;
  if (!text.trim()) { $("#au-res").hidden = true; $("#au-copy").hidden = true; last = null; return; }
  try {
    last = audit(text, { users: $("#au-users").value });
    render(last);
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    c.fail($("#au-in"), e.message);
    $("#au-res").hidden = true;
    $("#au-copy").hidden = true;
  }
}

$("#au-sample").addEventListener("click", () => { $("#au-in").value = SAMPLE; run(); announce(tx("Sample export loaded.")); });
$("#au-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) { new Checker(root).fail($("#au-in"), tx("That file is larger than 8 MB; an export is usually far smaller.")); return; }
  $("#au-in").value = await f.text();
  run();
});
$("#au-copy").addEventListener("click", () => { if (last) copyText(reportText(last), $("#au-copy")); });
live($("#au-form"), run, 350);
