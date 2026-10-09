// Decodes HEIC photos off the main thread (a 12-megapixel photo takes several seconds in plain JavaScript).
// Message in:  { id, buffer }   the file's bytes (transferred)
// Message out: { id, width, height, buffer }   RGBA pixels (transferred), or { id, error: { code, width?, height?, detail? } }
import * as lib from "/tools/vendor/ts-heic/ts-heic.esm.js";
import { decodeChecked, HeicError } from "./heiccore.js?v=11";

self.onmessage = (e) => {
  const { id, buffer } = e.data;
  try {
    const out = decodeChecked(lib, new Uint8Array(buffer));
    const d = out.data;
    const pixels = d.byteOffset === 0 && d.byteLength === d.buffer.byteLength ? d.buffer : d.slice().buffer;
    self.postMessage({ id, width: out.width, height: out.height, buffer: pixels }, [pixels]);
  } catch (err) {
    const error = err instanceof HeicError
      ? { code: err.code, width: err.width, height: err.height, detail: err.detail }
      : { code: "unsupported", detail: String((err && err.message) || err) };
    self.postMessage({ id, error });
  }
};
