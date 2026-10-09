import { $, live, Checker, showNotes, scriptWell, rowEditor, cell, rowInputs, radio, tx } from "./rosui.js?v=11";
import { checkIp4, parseTime } from "./roscore.js?v=11";
import { checkLabel, checkNtfy, checkToken, checkChat, checkEmail, netwatchScript } from "./rosnetwatch.js?v=11";

const root = $("#nw");
const well = scriptWell({ out: $("#nw-out"), copy: $("#nw-copy"), download: $("#nw-dl"), name: "mikrotik-netwatch.rsc" });

const hosts = rowEditor({
  list: $("#nw-hosts"), add: $("#nw-add"), min: 1, max: 20, onChange: () => build(),
  label: (r) => rowInputs(r).label.value,
  makeRow: (v) => [
    cell(tx("Host (IPv4)"), "text", { key: "ip", value: v.ip ?? "", placeholder: "203.0.113.1" }),
    cell(tx("Label"), "text", { key: "label", value: v.label ?? "", placeholder: tx("ISP gateway") }),
  ],
});
hosts.addRow({ ip: "203.0.113.1", label: tx("ISP gateway") });
hosts.addRow({ ip: "8.8.8.8", label: "Google DNS" });
hosts.addRow({ ip: "1.1.1.1", label: "Cloudflare DNS" });

function sync() {
  const k = radio("nw-notify", root);
  for (const id of ["ntfy", "telegram", "email"]) $(`#nw-${id}-f`).hidden = k !== id;
}

function build() {
  sync();
  const c = new Checker(root);
  const version = radio("nw-ver", root);
  const kind = radio("nw-notify", root);
  const interval = c.get($("#nw-interval"), (v) => parseTime(v));
  const timeout = c.get($("#nw-timeout"), (v) => parseTime(v));
  const router = c.get($("#nw-router"), (v) => checkLabel(v));
  const notify = { kind };
  if (kind === "ntfy") notify.url = c.get($("#nw-ntfy"), checkNtfy);
  else if (kind === "telegram") {
    notify.token = c.get($("#nw-tg-token"), checkToken);
    notify.chat = c.get($("#nw-tg-chat"), checkChat);
  } else if (kind === "email") notify.to = c.get($("#nw-mail-to"), checkEmail);

  const list = [];
  const seen = new Set();
  for (const r of hosts.rows()) {
    const i = rowInputs(r);
    const ip = c.get(i.ip, (v) => checkIp4(v));
    const label = c.get(i.label, (v) => checkLabel(v));
    if (ip) {
      if (seen.has(ip.text)) c.fail(i.ip, tx("{name} is listed twice.", { name: ip.text }));
      seen.add(ip.text);
    }
    if (ip && label) list.push({ ip: ip.text, label });
  }
  if (!c.ok) return well.blocked(c.count);

  const notes = [];
  if (timeout > interval) notes.push({ level: "warn", text: tx("The timeout is longer than the interval. Use a timeout shorter than the interval.") });
  if (kind === "none") notes.push({ level: "info", text: tx("With no notification method, the scripts only write to the router's log.") });
  else notes.push({ level: "info", text: tx("If a watched host is your internet gateway, the DOWN message cannot leave while the link is down. The UP message is sent when it returns.") });
  if (kind === "telegram") notes.push({ level: "warn", text: tx("The bot token is stored in plain text in the router's configuration and in its exports. Use a bot made only for alerts.") });
  if (kind === "email") notes.push({ level: "info", text: tx("This uses /tool e-mail, which must already be configured on the router.") });
  notes.push({ level: "info", text: tx("Netwatch runs on the router, so it cannot report the router itself going offline.") });
  well.set(netwatchScript({ hosts: list, router, interval, timeout, version, notify }));
  showNotes($("#nw-notes"), notes);
  return 0;
}

live(root, build);
