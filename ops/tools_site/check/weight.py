"""Page weight per tool page: what loads with the page, and what a tool fetches on first use.

Follows static ES-module imports and classic <script src> tags from each page, then lists the
dynamic imports (vendor libraries loaded when the tool runs). Sizes are raw and gzip -6.

Usage: python3 ops/tools_site/check/weight.py
"""
import gzip
import re
from pathlib import Path

SITE = Path(__file__).resolve().parents[3] / "site"
TOOLS = SITE / "tools"
FONTS = ["/fonts/archivo-var.woff2", "/fonts/bungee-400.woff2", "/fonts/jetbrains-mono-var.woff2"]


def size(url: str) -> tuple[int, int]:
    p = SITE / url.lstrip("/").split("?")[0]
    b = p.read_bytes()
    gz = len(b) if p.suffix == ".woff2" else len(gzip.compress(b, 6))
    return len(b), gz


def resolve(base: str, spec: str) -> str:
    if spec.startswith("/"):
        return spec
    parts = base.rsplit("/", 1)[0].split("/")
    for seg in spec.split("/"):
        if seg == "..":
            parts.pop()
        elif seg != ".":
            parts.append(seg)
    return "/".join(parts)


def graph(entry: str, seen: set, dynamic: set) -> None:
    if entry in seen:
        return
    seen.add(entry)
    src = (SITE / entry.lstrip("/").split("?")[0]).read_text(errors="ignore")
    if "/vendor/" in entry:
        return
    for spec in re.findall(r'(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"', src):
        graph(resolve(entry, spec), seen, dynamic)
    for spec in re.findall(r'import\(\s*(?:V\s*\+\s*)?"([^"]+)"\s*\)', src):
        dynamic.add(spec if spec.startswith("/") else "/tools/vendor/" + spec)
    for spec in re.findall(r'new Worker\(\s*"([^"]+)"', src):
        dynamic.add(spec)
    for spec in re.findall(r'workerSrc\s*=\s*V\s*\+\s*"([^"]+)"', src):
        dynamic.add("/tools/vendor/" + spec)


def main() -> None:
    rows = []
    pages = ["index.html"] + sorted(str(p.relative_to(TOOLS)) for p in TOOLS.glob("*/index.html"))
    for rel in pages:
        html_path = TOOLS / rel
        html = html_path.read_text()
        url = "/tools/" + rel
        init = {url: (len(html.encode()), len(gzip.compress(html.encode(), 6)))}
        init["/tools/tools.css"] = size("/tools/tools.css")
        for f in FONTS[:2]:
            init[f] = size(f)
        seen, dynamic = set(), set()
        for s in re.findall(r'<script[^>]+src="([^"]+)"', html):
            s = s.split("?")[0]
            if s.endswith(".js") or s.endswith(".mjs"):
                graph(s, seen, dynamic)
        for s in seen:
            init[s] = size(s)
        lazy = {d: size(d) for d in sorted(dynamic) if (SITE / d.lstrip("/")).exists()}
        name = rel.replace("/index.html", "") if rel != "index.html" else "(index)"
        rows.append((name, sum(v[0] for v in init.values()), sum(v[1] for v in init.values()),
                     sum(v[0] for v in lazy.values()), sum(v[1] for v in lazy.values()),
                     ", ".join(Path(k).name for k in lazy)))
    print(f"{'page':28} {'initial raw':>12} {'initial gz':>11} {'on use raw':>11} {'on use gz':>10}  loaded on use")
    for r in rows:
        print(f"{r[0]:28} {r[1]/1024:10.0f}KB {r[2]/1024:9.0f}KB {r[3]/1024:9.0f}KB {r[4]/1024:8.0f}KB  {r[5]}")
    print("\ninitial = HTML + tools.css + Archivo and Bungee fonts (preloaded) + the page's JS module graph.")
    print("JetBrains Mono (%.0f KB) loads only on pages that show mono text." % (size(FONTS[2])[0] / 1024))
    print("pdf.js JPEG 2000 / JBIG2 decoders (%.0f KB) load only for PDFs that contain those images." % (
        (size("/tools/vendor/pdfjs/wasm/openjpeg_nowasm_fallback.js")[0] + size("/tools/vendor/pdfjs/wasm/jbig2_nowasm_fallback.js")[0]) / 1024))


if __name__ == "__main__":
    main()
