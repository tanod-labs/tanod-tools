// Load a classic (UMD) vendor script from /tools/vendor/ once, on first use, and resolve with the global it
// defines. The script comes from this site, so the page's Content-Security-Policy (script-src 'self') allows it.
import { tx } from "./i18n.js?v=11";
const loading = new Map();

export function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  let p = loading.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error(`${src} loaded but defined no ${globalName}`)));
      s.onerror = () => { loading.delete(src); s.remove(); reject(new Error(tx("The tool's code library couldn't be loaded. Check your connection and try again."))); };
      document.head.append(s);
    });
    loading.set(src, p);
  }
  return p;
}
