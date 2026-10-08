// Stand-in for https://challenges.cloudflare.com/turnstile/v0/api.js in the tools check (served from memory by
// cdp.mjs fakeTurnstile). Implements the explicit-render API the server tool pages use: render, execute, reset,
// remove. window.__tsMode = "error" makes the next execute fail; "ask" shows an interaction first.
(function () {
  var n = 0, widgets = {};
  window.turnstile = {
    render: function (el, opts) {
      var id = "w" + (++n);
      widgets[id] = { el: el, opts: opts };
      el.setAttribute("data-fake-turnstile", opts.sitekey + "|" + (opts.action || ""));
      return id;
    },
    execute: function (id) {
      var w = widgets[id];
      setTimeout(function () {
        if (window.__tsMode === "error") { window.__tsMode = ""; if (w.opts["error-callback"]) w.opts["error-callback"]("110200"); return; }
        if (window.__tsMode === "ask") {
          window.__tsMode = "";
          if (w.opts["before-interactive-callback"]) w.opts["before-interactive-callback"]();
          var b = document.createElement("button");
          b.type = "button"; b.textContent = "I am human"; b.id = "fake-human";
          b.addEventListener("click", function () {
            b.remove();
            if (w.opts["after-interactive-callback"]) w.opts["after-interactive-callback"]();
            w.opts.callback("fake-token-" + Date.now() + "-" + Math.random().toString(36).slice(2));
          });
          w.el.append(b);
          return;
        }
        w.opts.callback("fake-token-" + Date.now() + "-" + Math.random().toString(36).slice(2));
      }, 20);
    },
    reset: function () {},
    remove: function (id) { delete widgets[id]; },
    getResponse: function () { return undefined; },
  };
})();
