// Minimal Chrome DevTools Protocol client over Node's built-in WebSocket. No dependencies.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, bin = "chromium" } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "tt-chrome-"));
  const proc = spawn(bin, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-features=Translate,MediaRouter", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let wsUrl;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await r.json()).webSocketDebuggerUrl;
      break;
    } catch (_) { await sleep(100); }
  }
  if (!wsUrl) throw new Error("chromium did not start");
  const conn = new Conn(wsUrl);
  await conn.ready;
  conn.close = async () => {
    try { await conn.send("Browser.close"); } catch (_) { /* gone */ }
    proc.kill("SIGKILL");
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* leave the temp profile */ }
  };
  return conn;
}

class Conn {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async newPage() {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    return new Page(this, targetId, sessionId);
  }
}

export class Page {
  constructor(conn, targetId, sessionId) {
    this.conn = conn;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.errors = [];
    this.events = [];
    this.off = conn.on((m) => {
      if (m.sessionId !== sessionId) return;
      this.events.push(m);
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        this.errors.push("exception: " + ((d.exception && d.exception.description) || d.text));
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        this.errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
      } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
        this.errors.push("log: " + m.params.entry.text + (m.params.entry.url ? " " + m.params.entry.url : ""));
      } else if (m.method === "Network.requestWillBeSent") {
        this.requests = this.requests || [];
        this.requests.push({ url: m.params.request.url, method: m.params.request.method });
      }
    });
  }
  send(method, params) { return this.conn.send(method, params, this.sessionId); }

  /* Serve a stand-in for Cloudflare Turnstile's script from memory: nothing leaves the machine, and the page's CSP
     still decides whether the script may load. Counts the loads in turnstileLoads. */
  async fakeTurnstile(script) {
    this.turnstileLoads = 0;
    await this.send("Fetch.enable", { patterns: [{ urlPattern: "https://challenges.cloudflare.com/*" }] });
    this.offFetch = this.conn.on((m) => {
      if (m.sessionId !== this.sessionId || m.method !== "Fetch.requestPaused") return;
      this.turnstileLoads++;
      this.send("Fetch.fulfillRequest", {
        requestId: m.params.requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "text/javascript; charset=utf-8" }],
        body: Buffer.from(script).toString("base64"),
      }).catch(() => {});
    });
  }

  async init() {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("Network.enable");
    await this.send("DOM.enable");
  }

  waitEvent(name, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { off(); reject(new Error("timeout waiting for " + name)); }, timeout);
      const off = this.conn.on((m) => {
        if (m.sessionId === this.sessionId && m.method === name) { clearTimeout(t); off(); resolve(m.params); }
      });
    });
  }

  async goto(url) {
    this.requests = [];
    const loaded = this.waitEvent("Page.loadEventFired", 30000);
    await this.send("Page.navigate", { url });
    await loaded;
    await this.eval("document.fonts ? document.fonts.ready.then(() => true) : true");
  }

  async eval(expression, { timeout = 60000 } = {}) {
    const r = await Promise.race([
      this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }),
      sleep(timeout).then(() => { throw new Error("eval timeout: " + expression.slice(0, 80)); }),
    ]);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error("eval failed: " + ((d.exception && d.exception.description) || d.text) + "\n  in: " + expression.slice(0, 200));
    }
    return r.result.value;
  }

  async waitFor(expression, { timeout = 30000, interval = 100, message } = {}) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try { last = await this.eval(`(() => { return ${expression}; })()`); } catch (e) { last = e.message; }
      if (last) return last;
      await sleep(interval);
    }
    throw new Error((message || "timed out waiting for") + ": " + expression + " (last: " + JSON.stringify(last) + ")");
  }

  async setFiles(selector, paths) {
    const { root } = await this.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error("no element for " + selector);
    await this.send("DOM.setFileInputFiles", { nodeId, files: paths });
  }

  async click(selector) {
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error("no element ${selector.replace(/"/g, "'")}"); e.click(); return true; })()`);
  }

  /* Real mouse click at the element's centre (for things that need trusted input). */
  async mouseClick(selector) {
    const box = await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:"center"}); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
  }

  /* Real mouse click at a point inside the element, given as fractions of its width and height. */
  async mouseClickAt(selector, fx = 0.5, fy = 0.5) {
    const box = await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:"center"}); const r = e.getBoundingClientRect(); return {x: r.x + r.width*${fx}, y: r.y + r.height*${fy}}; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
  }

  /* A trusted key press on the focused element, e.g. press("ArrowRight") or press("Enter"). */
  async press(key) {
    const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, " ": 32 };
    const vk = codes[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const base = { key, code: key.length === 1 ? "Key" + key.toUpperCase() : key, windowsVirtualKeyCode: vk };
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: key.length === 1 ? key : undefined });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /* Emulate an IANA time zone for date code (applies to pages loaded afterwards and to new Date work). */
  async timezone(tz) { await this.send("Emulation.setTimezoneOverride", { timezoneId: tz }); }

  async type(selector, text, { replace = true } = {}) {
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); ${replace ? 'e.value = "";' : ""} if (e.setSelectionRange) e.setSelectionRange(e.value.length, e.value.length); return true; })()`);
    await this.send("Input.insertText", { text });
  }

  async setValue(selector, value) {
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", {bubbles:true})); e.dispatchEvent(new Event("change", {bubbles:true})); return true; })()`);
  }

  async viewport(width, height = 900, { dark = false } = {}) {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  }

  async screenshot(path, { full = true } = {}) {
    const m = await this.send("Page.getLayoutMetrics");
    const w = Math.ceil(m.cssLayoutViewport.clientWidth);
    const h = full ? Math.min(Math.ceil(m.cssContentSize.height), 12000) : Math.ceil(m.cssLayoutViewport.clientHeight);
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: full, clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
    });
    writeFileSync(path, Buffer.from(data, "base64"));
  }

  async close() {
    this.off();
    if (this.offFetch) this.offFetch();
    await this.conn.send("Target.closeTarget", { targetId: this.targetId });
  }
}

/* Downloads: browser-wide behaviour, events arrive on the browser session. */
export async function trackDownloads(conn, dir) {
  await conn.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
}

export function waitDownload(conn, timeout = 60000) {
  return new Promise((resolve, reject) => {
    let name;
    const t = setTimeout(() => { off(); reject(new Error("timeout waiting for a download")); }, timeout);
    const off = conn.on((m) => {
      if (m.method === "Browser.downloadWillBegin") name = m.params.suggestedFilename;
      if (m.method === "Browser.downloadProgress" && m.params.state === "completed") {
        clearTimeout(t); off(); resolve(name);
      }
      if (m.method === "Browser.downloadProgress" && m.params.state === "canceled") {
        clearTimeout(t); off(); reject(new Error("download canceled"));
      }
    });
  });
}
