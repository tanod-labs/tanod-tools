import { $, el, debounce, copyText, tx } from "./core.js?v=5";
import { loadScript } from "./vendorload.js?v=5";

const input = $("#u-in"), info = $("#u-info"), rows = $("#u-rows"), notes = $("#u-notes");
const hintRows = $("#u-hints"), hintInfo = $("#u-hints-info");
const OWN = navigator.userAgent;
let UAParser = null, summary = "";
let hints = null; // {low, high} for this browser, once collected

/* Crawlers and HTTP tools that ua-parser-js's browser list does not name. */
const CLIENTS = [
  [/\bGooglebot(?:-\w+)?\/([\d.]+)/i, "Googlebot", tx("Search engine crawler")],
  [/\bbingbot\/([\d.]+)/i, "Bingbot", tx("Search engine crawler")],
  [/\bDuckDuckBot\/([\d.]+)/i, "DuckDuckBot", tx("Search engine crawler")],
  [/\bBaiduspider\/([\d.]+)/i, "Baiduspider", tx("Search engine crawler")],
  [/\bYandex(?:Bot)?\/([\d.]+)/i, "YandexBot", tx("Search engine crawler")],
  [/\bApplebot\/([\d.]+)/i, "Applebot", tx("Search engine crawler")],
  [/\bfacebookexternalhit\/([\d.]+)/i, "Facebook link preview", tx("Link preview crawler")],
  [/\bTwitterbot\/([\d.]+)/i, "Twitterbot", tx("Link preview crawler")],
  [/\bSlackbot(?:-LinkExpanding)?\s+([\d.]+)/i, "Slackbot", tx("Link preview crawler")],
  [/\bGPTBot\/([\d.]+)/i, "GPTBot", tx("AI crawler")],
  [/\bClaudeBot\/([\d.]+)/i, "ClaudeBot", tx("AI crawler")],
  [/\bAhrefsBot\/([\d.]+)/i, "AhrefsBot", tx("SEO crawler")],
  [/\bSemrushBot\/([\d.]+)/i, "SemrushBot", tx("SEO crawler")],
  [/\bcurl\/([\d.]+)/i, "curl", tx("Command-line or library HTTP client")],
  [/\bWget\/([\d.]+)/i, "Wget", tx("Command-line or library HTTP client")],
  [/\bpython-requests\/([\d.]+)/i, "python-requests", tx("Command-line or library HTTP client")],
  [/\bPython-urllib\/([\d.]+)/i, "Python urllib", tx("Command-line or library HTTP client")],
  [/\bGo-http-client\/([\d.]+)/i, "Go http client", tx("Command-line or library HTTP client")],
  [/\bokhttp\/([\d.]+)/i, "OkHttp", tx("Command-line or library HTTP client")],
  [/\bPostmanRuntime\/([\d.]+)/i, "Postman", tx("Command-line or library HTTP client")],
  [/\bHTTPie\/([\d.]+)/i, "HTTPie", tx("Command-line or library HTTP client")],
  [/\baxios\/([\d.]+)/i, "axios", tx("Command-line or library HTTP client")],
];
function client(ua) {
  for (const [re, name, kind] of CLIENTS) { const m = re.exec(ua); if (m) return { name, version: m[1], kind }; }
  if (/\b(bot|crawler|spider|slurp)\b/i.test(ua)) return { name: null, version: null, kind: tx("Crawler or bot (self-described)") };
  return null;
}

const DESKTOP_OS = /^(Windows|Mac OS|Linux|Ubuntu|Debian|Fedora|Chrome OS|Arch|CentOS|Red Hat|SUSE|Gentoo|FreeBSD|OpenBSD|NetBSD|Solaris)/;
const join = (...p) => p.filter(Boolean).join(" ");
const NONE = tx("Not stated");
const L = { kind: tx("Client type"), browser: tx("Browser"), engine: tx("Engine"), os: tx("Operating system"), deviceType: tx("Device type"),
  vendor: tx("Device vendor"), model: tx("Device model"), cpu: tx("CPU architecture"), ua: tx("User agent") };

/* ua-parser-js names device types in lowercase English; anything it adds later is shown as it came. */
function deviceLabel(t) {
  switch (t) {
    case "mobile": return tx("mobile");
    case "tablet": return tx("tablet");
    case "console": return tx("console");
    case "smarttv": return tx("smarttv");
    case "wearable": return tx("wearable");
    case "xr": return tx("xr");
    case "embedded": return tx("embedded");
    default: return t;
  }
}

function parse(ua) {
  const r = new UAParser(ua).getResult();
  const c = client(ua);
  const out = {};
  if (c) {
    out.browser = join(c.name, c.version) || tx("Not identified");
    out.kind = c.kind;
  } else {
    out.browser = r.browser.name ? join(r.browser.name, r.browser.version) : tx("Not identified");
    out.kind = r.browser.name ? tx("Web browser") : tx("Unknown");
  }
  out.engine = r.engine.name ? join(r.engine.name, r.engine.version) : NONE;
  out.os = r.os.name ? join(r.os.name, r.os.version) : NONE;
  const t = r.device.type;
  out.deviceType = t ? deviceLabel(t) : (r.os.name && DESKTOP_OS.test(r.os.name) ? tx("Desktop or laptop (assumed; the string has no device type)") : NONE);
  out.vendor = r.device.vendor || NONE;
  out.model = r.device.model || NONE;
  out.cpu = r.cpu.architecture || NONE;
  out.raw = r;
  return out;
}

function row(k, label, value) {
  return el("div", { "data-k": k }, el("dt", {}, label), el("dd", {}, value));
}

function notesFor(ua, p) {
  const n = [];
  const own = ua === OWN;
  const r = p.raw;
  if (/Chrome\/\d+\.0\.0\.0/.test(ua)) n.push(tx("This string is reduced: Chrome shows the version as MAJOR.0.0.0 and keeps the rest back. Client Hints can supply the full version."));
  if (r.os.name === "Windows" && r.os.version === "10") n.push(tx("Windows 11 also reports Windows NT 10.0 in the string, so this may be Windows 11. In Chromium browsers, Client Hints with a platform version of 13 or higher mean Windows 11."));
  if (r.os.name === "Mac OS" && r.os.version === "10.15.7") n.push(tx("macOS 10.15.7 is a frozen value. Safari and Chrome report it for every macOS version since Catalina, so the real version is not in the string."));
  if (r.device.model === "Macintosh" || (r.os.name === "Mac OS")) {
    if (own && navigator.maxTouchPoints > 1) n.push(tx("You are on a Macintosh string with a touch screen, which is how iPad Safari presents itself in desktop mode."));
    else n.push(tx("iPads in desktop mode send a Macintosh string, so a Mac string can also be an iPad. Only a page that checks for touch support can tell them apart."));
  }
  if (r.device.model === "K" || /Android [\d.]+; K\)/.test(ua)) n.push(tx("The device model K is a placeholder. Chrome on Android hides the real model in the reduced string."));
  if (own && hints && hints.high && hints.high.platform === "Windows" && hints.high.platformVersion) {
    const major = parseInt(hints.high.platformVersion, 10);
    n.push(major >= 13 ? tx("Client Hints say platform version {version}, so this is Windows 11 or newer.", { version: hints.high.platformVersion }) : tx("Client Hints say platform version {version}, so this is Windows 10 or earlier.", { version: hints.high.platformVersion }));
  }
  return n;
}

function update() {
  const ua = input.value.trim();
  if (!UAParser) return;
  if (!ua) {
    rows.replaceChildren();
    notes.hidden = true;
    summary = "";
    info.textContent = tx("Paste a user agent string, or press Use my browser's.");
    return;
  }
  const p = parse(ua);
  info.textContent = ua === OWN ? tx("This is your own browser's user agent.") : ua.length > 500 ? tx("Very long strings are cut to 500 characters when parsed.") : "";
  rows.replaceChildren(
    row("kind", L.kind, p.kind),
    row("browser", L.browser, p.browser),
    row("engine", L.engine, p.engine),
    row("os", L.os, p.os),
    row("device-type", L.deviceType, p.deviceType),
    row("device-vendor", L.vendor, p.vendor),
    row("device-model", L.model, p.model),
    row("cpu", L.cpu, p.cpu));
  summary = [[L.kind, p.kind], [L.browser, p.browser], [L.engine, p.engine], [L.os, p.os], [L.deviceType, p.deviceType],
    [L.vendor, p.vendor], [L.model, p.model], [L.cpu, p.cpu], [L.ua, ua]].map(([a, b]) => `${a}: ${b}`).join("\n");
  const n = notesFor(ua, p);
  notes.textContent = n.join(" ");
  notes.hidden = !n.length;
}

async function loadHints() {
  const d = navigator.userAgentData;
  if (!d) {
    hintRows.replaceChildren();
    hintInfo.textContent = tx("This browser does not provide Client Hints through JavaScript. Chromium browsers such as Chrome, Edge, Opera and Samsung Internet do; Firefox and Safari do not.");
    return;
  }
  const low = { brands: d.brands.map((b) => `${b.brand} ${b.version}`).join(", "), mobile: d.mobile ? tx("Yes") : tx("No"), platform: d.platform || NONE };
  const list = (x) => x.map((b) => `${b.brand} ${b.version}`).join(", ");
  const draw = (high) => {
    const rs = [row("brands", tx("Brands"), low.brands), row("mobile", tx("Mobile"), low.mobile), row("platform", tx("Platform"), low.platform)];
    if (high) {
      rs.push(row("platform-version", tx("Platform version"), high.platformVersion || NONE), row("architecture", tx("Architecture"), high.architecture ? join(high.architecture, high.bitness ? tx("({bits}-bit)", { bits: high.bitness }) : "") : NONE),
        row("model", tx("Model"), high.model || NONE), row("full-version", tx("Full version list"), high.fullVersionList && high.fullVersionList.length ? list(high.fullVersionList) : NONE));
    }
    hintRows.replaceChildren(...rs);
  };
  draw(null);
  hintInfo.textContent = tx("Reading the detailed values…");
  try {
    const high = await d.getHighEntropyValues(["platformVersion", "architecture", "bitness", "model", "fullVersionList"]);
    hints = { low, high: { ...high, platform: d.platform } };
    draw(high);
    hintInfo.textContent = tx("These details come from your browser's own answer to a request for more information, which sites must ask for.");
    update();
  } catch (_) {
    hintInfo.textContent = tx("The browser declined to share the detailed values, so only the basic hints are shown.");
  }
}

input.addEventListener("input", debounce(update, 100));
$("#u-own").addEventListener("click", () => { input.value = OWN; update(); });
$("#u-copy").addEventListener("click", (e) => { if (summary) copyText(summary, e.currentTarget); });
input.value = OWN;
info.textContent = tx("Loading the parser…");
loadScript("/tools/vendor/ua-parser-js/ua-parser.min.js", "UAParser").then((P) => { UAParser = P; update(); }, (e) => { info.textContent = e.message; });
loadHints();
