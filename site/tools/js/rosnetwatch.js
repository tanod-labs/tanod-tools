// RouterOS Netwatch script builder shared by the Netwatch generator page. Pure functions; nothing is sent anywhere.
import { tx } from "./core.js?v=11";
import { Script, InputError, fmtTime } from "./roscore.js?v=11";

/* Escape user text for the inside of a RouterOS double-quoted string: backslash, double quote, dollar sign and
   question mark (the terminal would otherwise show help), plus line breaks. */
export function esc(s) {
  let out = "";
  for (const ch of String(s)) {
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "$") out += "\\$";
    else if (ch === "?") out += "\\?";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  return out;
}

/* A one-line label or router name of up to 64 characters. */
export function checkLabel(s, { optional = false } = {}) {
  const v = String(s ?? "").trim();
  if (!v) {
    if (optional) return "";
    throw new InputError(tx("Enter a label."));
  }
  if ([...v].length > 64 || /[\u0000-\u001f\u007f]/.test(v)) throw new InputError(tx("Use up to 64 characters on one line."));
  return v;
}

export function checkNtfy(s) {
  const v = String(s ?? "").trim();
  if (!/^https?:\/\/[^\s"\\$]+$/i.test(v) || /^https?:\/\/[^/]*$/i.test(v)) throw new InputError(tx("Enter the ntfy topic URL, such as https://ntfy.sh/my-router-alerts."));
  return v;
}

export function checkToken(s) {
  const v = String(s ?? "").trim();
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(v)) throw new InputError(tx("Enter the bot token from @BotFather, such as 123456789:ABC-DEF."));
  return v;
}

export function checkChat(s) {
  const v = String(s ?? "").trim();
  if (!/^(-?\d+|@[A-Za-z0-9_]{4,})$/.test(v)) throw new InputError(tx("Enter the chat id: a number, or @channelname for a public channel."));
  return v;
}

export function checkEmail(s) {
  const v = String(s ?? "").trim();
  if (!/^[^\s@"\\$,;<>]+@[^\s@"\\$,;<>]+\.[^\s@"\\$,;<>]+$/.test(v)) throw new InputError(tx("Enter an e-mail address, such as ops@example.com."));
  return v;
}

/* The commands that report one state change, as the text of a RouterOS script. state: "DOWN" or "UP". */
export function notifyScript({ host, label, router, state, notify }) {
  const text = `${router}: ${label} (${host}) is ${state}`;
  const logLevel = state === "DOWN" ? "warning" : "info";
  const lines = [`:log ${logLevel} "netwatch: ${esc(`${label} (${host}) is ${state}`)}"`];
  const fail = (what) => `on-error={ :log warning "netwatch: could not send the ${what} message" }`;
  if (notify.kind === "ntfy") {
    lines.push(`:do { /tool fetch url="${esc(notify.url)}" http-method=post http-data="${esc(text)}" keep-result=no } ${fail("ntfy")}`);
  } else if (notify.kind === "telegram") {
    const url = `https://api.telegram.org/bot${notify.token}/sendMessage?chat_id=${encodeURIComponent(notify.chat)}&text=${encodeURIComponent(text)}`;
    lines.push(`:do { /tool fetch url="${esc(url)}" keep-result=no } ${fail("Telegram")}`);
  } else if (notify.kind === "email") {
    lines.push(`:do { /tool e-mail send to="${esc(notify.to)}" subject="${esc(`Netwatch: ${label} is ${state}`)}" body="${esc(text)}" } ${fail("e-mail")}`);
  }
  return lines.join("; ");
}

/* o: {hosts: [{ip, label}], router, interval (s), timeout (s), version: "v7" | "v6", notify: {kind, ...}} */
export function netwatchScript(o) {
  const v7 = o.version === "v7";
  const s = new Script().header("Netwatch: host monitoring with up/down notifications", v7 ? "v7" : "v6");
  s.note("Netwatch runs on this router, so it cannot report the router itself going offline (power loss, crash, dead uplink). Use an outside check for that: https://tanod.dev/monitor/");
  s.note("Running this script twice adds every entry twice. Remove old ones first with /tool netwatch remove.");
  if (v7) s.note("type=icmp is the RouterOS v7 syntax. If your v7 release is old and rejects it, delete type=icmp from each line.");
  else s.note("RouterOS v6 syntax: no type= parameter. If /tool fetch rejects http-method on an old v6 release, update RouterOS first.");
  if (o.notify.kind === "email") s.note("/tool e-mail must already be configured (server, from, user and password) or no message is sent.");
  if (o.notify.kind === "none") s.note("No notification method chosen: the scripts only write a line to the log.");
  s.note("A message about a lost uplink cannot leave while the uplink is down; the UP message goes out when it returns.");
  s.section("/tool netwatch");
  for (const h of o.hosts) {
    const up = notifyScript({ host: h.ip, label: h.label, router: o.router, state: "UP", notify: o.notify });
    const down = notifyScript({ host: h.ip, label: h.label, router: o.router, state: "DOWN", notify: o.notify });
    s.cmd("add", [["host", h.ip], ["type", v7 ? "icmp" : ""], ["interval", fmtTime(o.interval)], ["timeout", fmtTime(o.timeout)],
      ["up-script", up], ["down-script", down], ["comment", h.label]]);
  }
  return s.toString();
}
