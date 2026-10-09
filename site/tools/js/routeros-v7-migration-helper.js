import { $, el, live, Checker, scriptWell, tx } from "./rosui.js?v=11";
import { txn, announce } from "./core.js?v=11";
import { InputError } from "./roscore.js?v=11";
import { migrate } from "./rosmigrate.js?v=11";

const root = $("#mg");
const well = scriptWell({ out: $("#mg-out"), copy: $("#mg-copy"), download: $("#mg-dl"), name: "routeros-v7-converted.rsc" });

const SAMPLE = `# jan/02/2024 10:15:22 by RouterOS 6.49.10
# software id = ABCD-1234
#
# model = RB3011UiAS
/interface bridge
add name=bridge-lan
add name=loopback
/ip address
add address=192.168.10.1/24 interface=bridge-lan
add address=10.255.0.1/30 interface=ether1
add address=10.255.0.5/30 interface=ether2
add address=172.16.255.1 interface=loopback
/routing ospf instance
set [ find default=yes ] distribute-default=if-installed-as-type-2 redistribute-connected=as-type-1 router-id=172.16.255.1
/routing ospf interface
add authentication=md5 authentication-key=ospfsecret interface=ether1 network-type=point-to-point
/routing ospf network
add area=backbone network=10.255.0.0/30
add area=backbone network=10.255.0.4/30
add area=backbone network=192.168.10.0/24
/routing filter
add action=accept chain=ospf-in prefix=10.0.0.0/8 prefix-length=8-24
add action=discard chain=ospf-in prefix=0.0.0.0/0
add action=accept chain=bgp-out prefix=203.0.113.0/24 set-bgp-prepend=2
/routing bgp instance
set default as=64512 router-id=172.16.255.1
/routing bgp network
add network=203.0.113.0/24 synchronize=no
/routing bgp peer
add name=upstream out-filter=bgp-out remote-address=198.51.100.1 remote-as=64500 tcp-md5-key=bgpsecret ttl=default
/ip firewall mangle
add action=mark-routing chain=prerouting new-routing-mark=via-isp2 src-address=192.168.10.128/25 passthrough=no
/ip route
add distance=1 gateway=10.255.0.2
add distance=1 gateway=10.255.0.6 routing-mark=via-isp2
add dst-address=192.0.2.0/24 type=blackhole
/ip route rule
add src-address=192.168.10.200/32 action=lookup-only-in-table table=via-isp2
/queue type
add kind=pcq name=pcq-down pcq-classifier=dst-address pcq-rate=10M pcq-limit=100
/system ntp client
set enabled=yes primary-ntp=162.159.200.1 server-dns-names=pool.ntp.org
`;

function run() {
  const c = new Checker(root);
  const text = $("#mg-in").value;
  const res = $("#mg-res");
  if (!text.trim()) { well.set(""); res.hidden = true; return; }
  let r;
  try { r = migrate(text); } catch (e) {
    if (!(e instanceof InputError)) throw e;
    c.fail($("#mg-in"), e.message);
    well.blocked(1);
    res.hidden = true;
    return;
  }
  well.set(r.text);
  res.textContent = "";
  res.hidden = false;
  res.append(el("p", { class: "result__title" }, [
    r.info.version ? tx("From RouterOS {v}", { v: r.info.version }) : tx("RouterOS version not in the export"),
    txn(r.stats.converted, "{n} block converted", "{n} blocks converted"),
    txn(r.stats.kept, "{n} line unchanged", "{n} lines unchanged"),
    txn(r.review.length, "{n} item to review", "{n} items to review"),
  ].join(" · ")));
  if (r.review.length) {
    const list = el("ol", { class: "ros-review" });
    for (const it of r.review) list.append(el("li", {}, el("strong", {}, tx("Line {n}", { n: it.line }) + ": "), it.msg));
    res.append(list);
  } else {
    res.append(el("p", { class: "note" }, tx("Nothing needs manual review. Still read the converted script before applying it.")));
  }
}

$("#mg-sample").addEventListener("click", () => { $("#mg-in").value = SAMPLE; run(); announce(tx("Sample export loaded.")); });
$("#mg-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) { new Checker(root).fail($("#mg-in"), tx("That file is larger than 8 MB; an export is usually far smaller.")); return; }
  $("#mg-in").value = await f.text();
  run();
});
well.set("");
live($("#mg-form"), run, 350);
