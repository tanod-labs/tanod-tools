import { loadScript } from "./vendorload.js?v=11";
import { initFormatter, loadFailed, $, $$ } from "./fmtcore.js?v=11";
import { tx } from "./core.js?v=11";

const SRC = "/tools/vendor/js-beautify/beautifier.min.js";
let lib = null;
const ready = () => (lib ? Promise.resolve(lib) : loadScript(SRC, "beautifier").then((l) => { lib = l; return l; }, loadFailed));

const SAMPLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sample page</title>
<style>body{margin:0;font:16px/1.5 sans-serif}.card{padding:1rem;border:1px solid #ccc}</style></head>
<body><header><nav><ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li></ul></nav></header>
<main><h1>Hello <em>world</em></h1><p>Some <strong>inline</strong> text that keeps flowing with the markup around it.</p>
<form action="/send"><label>Name <input name="n"></label><textarea name="t">  keep
   this   as typed</textarea><button>Send</button></form>
<pre>  preformatted
      text stays</pre></main>
<script>window.addEventListener("load",function(){var a=[1,2,3];if(a.length){console.log(a)}})</script></body></html>`;

initFormatter({
  label: "HTML",
  ready,
  loaded: () => !!lib,
  triggers: $$("input[name='indent'], #o-wrap, #o-assets, #o-blank"),
  sample: SAMPLE,
  filename: "formatted.html",
  mime: "text/html",
  done: tx("Formatted."),
  format(text) {
    const ind = $("input[name='indent']:checked").value;
    const keep = ["pre", "textarea"];
    if (!$("#o-assets").checked) keep.push("script", "style");
    const out = lib.html(text, {
      indent_size: ind === "tab" ? 1 : Number(ind),
      indent_char: ind === "tab" ? "\t" : " ",
      indent_with_tabs: ind === "tab",
      wrap_line_length: Number($("#o-wrap").value),
      content_unformatted: keep,
      preserve_newlines: $("#o-blank").checked,
      max_preserve_newlines: 1,
      end_with_newline: false,
      indent_inner_html: false,
      extra_liners: ["head", "body", "/html"],
    });
    return { out };
  },
});
