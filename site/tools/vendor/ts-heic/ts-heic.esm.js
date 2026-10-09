// @bun
// src/color.ts
function imagePixelCount(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new RangeError("ts-heic: image dimensions must be positive integers");
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels))
    throw new RangeError("ts-heic: image dimensions are too large");
  return pixels;
}
function yuv420ToRgba(y, cb, cr, width, height, options = {}) {
  const pixels = imagePixelCount(width, height);
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  if (y.length < pixels || cb.length < cw * ch || cr.length < cw * ch)
    throw new RangeError("ts-heic: YUV planes are smaller than the requested image dimensions");
  const matrix = options.matrixCoeffs ?? 6;
  const fullRange = options.fullRange ?? true;
  const kr = matrix === 1 ? 0.2126 : 0.299;
  const kb = matrix === 1 ? 0.0722 : 0.114;
  const crR = 2 * (1 - kr);
  const cbB = 2 * (1 - kb);
  const crG = 2 * kr * (1 - kr) / (1 - kr - kb);
  const cbG = 2 * kb * (1 - kb) / (1 - kr - kb);
  const yScale = fullRange ? 1 : 255 / 219;
  const cScale = fullRange ? 1 : 255 / 224;
  const yOffset = fullRange ? 0 : 16;
  const out = new Uint8Array(pixels * 4);
  let o = 0;
  for (let py = 0;py < height; py++) {
    const cRow = (py >> 1) * cw;
    const yRow = py * width;
    for (let px = 0;px < width; px++) {
      const lum = (y[yRow + px] - yOffset) * yScale;
      const cIdx = cRow + (px >> 1);
      const u = (cb[cIdx] - 128) * cScale;
      const v = (cr[cIdx] - 128) * cScale;
      const r = lum + crR * v;
      const g = lum - cbG * u - crG * v;
      const b = lum + cbB * u;
      out[o] = r < 0 ? 0 : r > 255 ? 255 : r + 0.5 | 0;
      out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g + 0.5 | 0;
      out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b + 0.5 | 0;
      out[o + 3] = 255;
      o += 4;
    }
  }
  return out;
}
function applyOrientation(rgba, width, height, rotation, mirror) {
  const pixels = imagePixelCount(width, height);
  if (rgba.length < pixels * 4)
    throw new RangeError("ts-heic: RGBA buffer is smaller than the requested image dimensions");
  if (!Number.isInteger(rotation))
    throw new RangeError("ts-heic: rotation must be an integer number of quarter turns");
  if (mirror !== null && mirror !== 0 && mirror !== 1)
    throw new RangeError("ts-heic: mirror must be 0, 1, or null");
  let data = rgba;
  let w = width;
  let h = height;
  const rot = (rotation % 4 + 4) % 4;
  if (rot !== 0) {
    const dw = rot % 2 === 0 ? w : h;
    const dh = rot % 2 === 0 ? h : w;
    const out = new Uint8Array(dw * dh * 4);
    for (let dy = 0;dy < dh; dy++) {
      for (let dx = 0;dx < dw; dx++) {
        let sx;
        let sy;
        if (rot === 1) {
          sx = w - 1 - dy;
          sy = dx;
        } else if (rot === 2) {
          sx = w - 1 - dx;
          sy = h - 1 - dy;
        } else {
          sx = dy;
          sy = h - 1 - dx;
        }
        const s = (sy * w + sx) * 4;
        const d = (dy * dw + dx) * 4;
        out[d] = data[s];
        out[d + 1] = data[s + 1];
        out[d + 2] = data[s + 2];
        out[d + 3] = data[s + 3];
      }
    }
    data = out;
    w = dw;
    h = dh;
  }
  if (mirror !== null && mirror !== undefined) {
    const out = new Uint8Array(w * h * 4);
    for (let yPos = 0;yPos < h; yPos++) {
      for (let xPos = 0;xPos < w; xPos++) {
        const sx = mirror === 0 ? w - 1 - xPos : xPos;
        const sy = mirror === 0 ? yPos : h - 1 - yPos;
        const s = (sy * w + sx) * 4;
        const d = (yPos * w + xPos) * 4;
        out[d] = data[s];
        out[d + 1] = data[s + 1];
        out[d + 2] = data[s + 2];
        out[d + 3] = data[s + 3];
      }
    }
    data = out;
  }
  return { data, width: w, height: h };
}
// src/container/heif.ts
function readFourCC(buffer, offset) {
  return String.fromCharCode(buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]);
}
function parseISOBMFF(buffer) {
  const boxes = [];
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = view.getUint32(offset);
    const type = readFourCC(buffer, offset + 4);
    let boxSize = size;
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length)
        break;
      const highSize = view.getUint32(offset + 8);
      const lowSize = view.getUint32(offset + 12);
      boxSize = highSize * 4294967296 + lowSize;
      headerSize = 16;
    } else if (size === 0) {
      boxSize = buffer.length - offset;
    }
    if (!Number.isSafeInteger(boxSize) || boxSize < headerSize || offset + boxSize > buffer.length)
      break;
    const data = buffer.subarray(offset + headerSize, offset + boxSize);
    const box = {
      type,
      size: boxSize,
      offset,
      data
    };
    if (isContainerBox(type)) {
      const isFullBoxContainer = type === "meta" || type === "iref";
      const childrenStart = isFullBoxContainer ? 4 : 0;
      box.children = data.length >= childrenStart ? parseISOBMFF(data.subarray(childrenStart)) : [];
    }
    boxes.push(box);
    offset += boxSize;
  }
  return boxes;
}
function isContainerBox(type) {
  const containerTypes = [
    "moov",
    "trak",
    "mdia",
    "minf",
    "stbl",
    "dinf",
    "meta",
    "iprp",
    "ipco",
    "iref",
    "grpl"
  ];
  return containerTypes.includes(type);
}
function findBox(boxes, type) {
  for (const box of boxes) {
    if (box.type === type) {
      return box;
    }
    if (box.children) {
      const found = findBox(box.children, type);
      if (found) {
        return found;
      }
    }
  }
  return;
}
function findAllBoxes(boxes, type) {
  const result = [];
  for (const box of boxes) {
    if (box.type === type) {
      result.push(box);
    }
    if (box.children) {
      result.push(...findAllBoxes(box.children, type));
    }
  }
  return result;
}
function getFtypInfo(buffer) {
  if (buffer.length < 16)
    return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const size = view.getUint32(0);
  if (readFourCC(buffer, 4) !== "ftyp")
    return null;
  let boxSize = size;
  let headerSize = 8;
  if (size === 1) {
    if (buffer.length < 24)
      return null;
    boxSize = view.getUint32(8) * 4294967296 + view.getUint32(12);
    headerSize = 16;
  } else if (size === 0) {
    boxSize = buffer.length;
  }
  const brandDataStart = headerSize;
  const compatibleStart = brandDataStart + 8;
  if (!Number.isSafeInteger(boxSize) || boxSize < compatibleStart || boxSize > buffer.length || (boxSize - compatibleStart) % 4 !== 0) {
    return null;
  }
  const compatibleBrands = [];
  for (let offset = compatibleStart;offset < boxSize; offset += 4)
    compatibleBrands.push(readFourCC(buffer, offset));
  return {
    majorBrand: readFourCC(buffer, brandDataStart),
    compatibleBrands
  };
}
function validateFtyp(buffer) {
  return getFtypInfo(buffer) !== null;
}
function parseIloc(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = data[0];
  const flags = data[1] << 16 | data[2] << 8 | data[3];
  const offsetSize = data[4] >> 4 & 15;
  const lengthSize = data[4] & 15;
  const baseOffsetSize = data[5] >> 4 & 15;
  const indexSize = version === 1 || version === 2 ? data[5] & 15 : 0;
  let offset = 6;
  let itemCount;
  if (version < 2) {
    itemCount = view.getUint16(offset);
    offset += 2;
  } else {
    itemCount = view.getUint32(offset);
    offset += 4;
  }
  const items = [];
  for (let i = 0;i < itemCount; i++) {
    let itemId;
    if (version < 2) {
      itemId = view.getUint16(offset);
      offset += 2;
    } else {
      itemId = view.getUint32(offset);
      offset += 4;
    }
    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = view.getUint16(offset) & 15;
      offset += 2;
    }
    const dataReferenceIndex = view.getUint16(offset);
    offset += 2;
    let baseOffset = 0;
    if (baseOffsetSize === 4) {
      baseOffset = view.getUint32(offset);
      offset += 4;
    } else if (baseOffsetSize === 8) {
      baseOffset = view.getUint32(offset) * 4294967296 + view.getUint32(offset + 4);
      offset += 8;
    }
    const extentCount = view.getUint16(offset);
    offset += 2;
    const extents = [];
    for (let j = 0;j < extentCount; j++) {
      if (indexSize > 0) {
        offset += indexSize;
      }
      let extentOffset = 0;
      if (offsetSize === 4) {
        extentOffset = view.getUint32(offset);
        offset += 4;
      } else if (offsetSize === 8) {
        extentOffset = view.getUint32(offset) * 4294967296 + view.getUint32(offset + 4);
        offset += 8;
      }
      let extentLength = 0;
      if (lengthSize === 4) {
        extentLength = view.getUint32(offset);
        offset += 4;
      } else if (lengthSize === 8) {
        extentLength = view.getUint32(offset) * 4294967296 + view.getUint32(offset + 4);
        offset += 8;
      }
      extents.push({ extentOffset, extentLength });
    }
    items.push({
      itemId,
      constructionMethod,
      dataReferenceIndex,
      baseOffset,
      extents
    });
  }
  return items;
}
function parseIinf(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = data[0];
  let offset = 4;
  let entryCount;
  if (version === 0) {
    entryCount = view.getUint16(offset);
    offset += 2;
  } else {
    entryCount = view.getUint32(offset);
    offset += 4;
  }
  const items = [];
  for (let i = 0;i < entryCount; i++) {
    const entrySize = view.getUint32(offset);
    const entryType = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    if (entryType === "infe") {
      const infeData = data.slice(offset + 8, offset + entrySize);
      const itemInfo = parseInfe(infeData);
      items.push(itemInfo);
    }
    offset += entrySize;
  }
  return items;
}
function parseInfe(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = data[0];
  let offset = 4;
  let itemId;
  let itemProtectionIndex;
  if (version < 2) {
    itemId = view.getUint16(offset);
    offset += 2;
    itemProtectionIndex = view.getUint16(offset);
    offset += 2;
  } else if (version === 2) {
    itemId = view.getUint16(offset);
    offset += 2;
    itemProtectionIndex = view.getUint16(offset);
    offset += 2;
  } else {
    itemId = view.getUint32(offset);
    offset += 4;
    itemProtectionIndex = view.getUint16(offset);
    offset += 2;
  }
  const itemType = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
  offset += 4;
  let itemName = "";
  while (offset < data.length && data[offset] !== 0) {
    itemName += String.fromCharCode(data[offset]);
    offset++;
  }
  return {
    itemId,
    itemProtectionIndex,
    itemType,
    itemName
  };
}
function parseIspe(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(4);
  const height = view.getUint32(8);
  return { width, height };
}
function parsePixi(data) {
  const numChannels = data[4];
  const bitsPerChannel = [];
  for (let i = 0;i < numChannels; i++) {
    bitsPerChannel.push(data[5 + i]);
  }
  return { bitsPerChannel };
}

// src/container/heic.ts
function u16(data, off) {
  return data[off] << 8 | data[off + 1];
}
function u32(data, off) {
  return (data[off] << 24 | data[off + 1] << 16 | data[off + 2] << 8 | data[off + 3]) >>> 0;
}
function parsePitm(data) {
  const version = data[0];
  return version === 0 ? u16(data, 4) : u32(data, 4);
}
function parseIref(box) {
  const version = box.data[0];
  const idSize = version === 0 ? 2 : 4;
  const refs = [];
  for (const child of box.children ?? []) {
    const d = child.data;
    let p = 0;
    const fromItemId = idSize === 2 ? u16(d, p) : u32(d, p);
    p += idSize;
    const count = u16(d, p);
    p += 2;
    const toItemIds = [];
    for (let i = 0;i < count; i++) {
      toItemIds.push(idSize === 2 ? u16(d, p) : u32(d, p));
      p += idSize;
    }
    refs.push({ referenceType: child.type, fromItemId, toItemIds });
  }
  return refs;
}
function parseIpma(data) {
  const version = data[0];
  const flags = data[1] << 16 | data[2] << 8 | data[3];
  let p = 4;
  const entryCount = u32(data, p);
  p += 4;
  const out = [];
  for (let e = 0;e < entryCount; e++) {
    const itemId = version < 1 ? u16(data, p) : u32(data, p);
    p += version < 1 ? 2 : 4;
    const associationCount = data[p++];
    const propertyIndexes = [];
    for (let a = 0;a < associationCount; a++) {
      if (flags & 1) {
        propertyIndexes.push(u16(data, p) & 32767);
        p += 2;
      } else {
        propertyIndexes.push(data[p++] & 127);
      }
    }
    out.push({ itemId, propertyIndexes });
  }
  return out;
}
function parseHvcC(data) {
  const configurationVersion = data[0];
  const generalProfileIdc = data[1] & 31;
  const generalLevelIdc = data[12];
  const chromaFormatIdc = data[16] & 3;
  const bitDepthLumaMinus8 = data[17] & 7;
  const bitDepthChromaMinus8 = data[18] & 7;
  const nalLengthSize = (data[21] & 3) + 1;
  const numArrays = data[22];
  const vps = [];
  const sps = [];
  const pps = [];
  let p = 23;
  for (let i = 0;i < numArrays; i++) {
    const nalType = data[p] & 63;
    p += 1;
    const numNalus = u16(data, p);
    p += 2;
    for (let n = 0;n < numNalus; n++) {
      const len = u16(data, p);
      p += 2;
      const nal = data.subarray(p, p + len);
      p += len;
      if (nalType === 32)
        vps.push(nal);
      else if (nalType === 33)
        sps.push(nal);
      else if (nalType === 34)
        pps.push(nal);
    }
  }
  return {
    configurationVersion,
    generalProfileIdc,
    generalLevelIdc,
    chromaFormatIdc,
    bitDepthLumaMinus8,
    bitDepthChromaMinus8,
    nalLengthSize,
    vps,
    sps,
    pps
  };
}
function parseGridBody(data) {
  const flags = data[1];
  const rows = data[2] + 1;
  const columns = data[3] + 1;
  const fieldSize = flags & 1 ? 4 : 2;
  const outputWidth = fieldSize === 2 ? u16(data, 4) : u32(data, 4);
  const outputHeight = fieldSize === 2 ? u16(data, 4 + fieldSize) : u32(data, 4 + fieldSize);
  return { rows, columns, outputWidth, outputHeight };
}
function getHeicInfo(buffer, boxes) {
  const metaBox = findBox(boxes, "meta");
  if (!metaBox?.children)
    throw new Error("ts-heic: no meta box found");
  const pitmBox = findBox(metaBox.children, "pitm");
  if (!pitmBox)
    throw new Error("ts-heic: no primary item (pitm) box found");
  const primaryItemId = parsePitm(pitmBox.data);
  const iinfBox = findBox(metaBox.children, "iinf");
  const items = iinfBox ? parseIinf(iinfBox.data) : [];
  const primaryItem = items.find((i) => i.itemId === primaryItemId);
  if (!primaryItem)
    throw new Error(`ts-heic: primary item ${primaryItemId} not present in iinf`);
  const iprpBox = findBox(metaBox.children, "iprp");
  const ipcoBox = iprpBox?.children ? findBox(iprpBox.children, "ipco") : undefined;
  const ipmaBox = iprpBox?.children ? findBox(iprpBox.children, "ipma") : undefined;
  if (!ipcoBox?.children || !ipmaBox)
    throw new Error("ts-heic: missing item properties (ipco/ipma)");
  const associations = parseIpma(ipmaBox.data);
  const propsFor = (itemId) => {
    const assoc = associations.find((a) => a.itemId === itemId);
    if (!assoc)
      return [];
    return assoc.propertyIndexes.map((index) => ipcoBox.children[index - 1]).filter(Boolean);
  };
  const primaryProps = propsFor(primaryItemId);
  const ispeBox = primaryProps.find((b) => b.type === "ispe");
  const extent = ispeBox ? parseIspe(ispeBox.data) : { width: 0, height: 0 };
  const pixiBox = primaryProps.find((b) => b.type === "pixi");
  let bitDepth = 8;
  if (pixiBox) {
    const pixi = parsePixi(pixiBox.data);
    if (pixi.bitsPerChannel.length > 0)
      bitDepth = pixi.bitsPerChannel[0];
  }
  const irotBox = primaryProps.find((b) => b.type === "irot");
  const rotation = irotBox ? irotBox.data[0] & 3 : 0;
  const imirBox = primaryProps.find((b) => b.type === "imir");
  const mirror = imirBox ? imirBox.data[0] & 1 : null;
  const irefBox = findBox(metaBox.children, "iref");
  const refs = irefBox ? parseIref(irefBox) : [];
  const hasAlpha = items.some((i) => i.itemType === "auxl");
  let grid = null;
  let hvcC = null;
  if (primaryItem.itemType === "grid") {
    const body = getItemPayload(buffer, boxes, primaryItemId);
    if (!body)
      throw new Error("ts-heic: grid item has no body");
    const gridBody = parseGridBody(body);
    const dimg = refs.find((r) => r.referenceType === "dimg" && r.fromItemId === primaryItemId);
    if (!dimg)
      throw new Error("ts-heic: grid image without dimg tile references");
    const firstTileProps = propsFor(dimg.toItemIds[0]);
    const tileIspe = firstTileProps.find((b) => b.type === "ispe");
    const tileExtent = tileIspe ? parseIspe(tileIspe.data) : { width: 0, height: 0 };
    grid = {
      ...gridBody,
      tileItemIds: dimg.toItemIds,
      tileWidth: tileExtent.width,
      tileHeight: tileExtent.height
    };
    const tileHvcc = firstTileProps.find((b) => b.type === "hvcC");
    if (tileHvcc)
      hvcC = parseHvcC(tileHvcc.data);
  } else {
    const hvccBox = primaryProps.find((b) => b.type === "hvcC");
    if (hvccBox)
      hvcC = parseHvcC(hvccBox.data);
  }
  return {
    primaryItemId,
    primaryItemType: primaryItem.itemType,
    width: extent.width || grid?.outputWidth || 0,
    height: extent.height || grid?.outputHeight || 0,
    bitDepth,
    rotation,
    mirror,
    hasAlpha,
    hvcC,
    grid
  };
}
function getItemPayload(buffer, boxes, itemId) {
  const metaBox = findBox(boxes, "meta");
  if (!metaBox?.children)
    return null;
  const ilocBox = findBox(metaBox.children, "iloc");
  if (!ilocBox)
    return null;
  const location = parseIloc(ilocBox.data).find((loc) => loc.itemId === itemId);
  if (!location)
    return null;
  if (location.constructionMethod === 1) {
    const idatBox = findBox(metaBox.children, "idat");
    if (!idatBox)
      return null;
    const parts = location.extents.map((extent) => {
      const start = location.baseOffset + extent.extentOffset;
      return idatBox.data.subarray(start, start + extent.extentLength);
    });
    return concat(parts);
  }
  const parts = location.extents.map((extent) => {
    const start = location.baseOffset + extent.extentOffset;
    return buffer.subarray(start, start + extent.extentLength);
  });
  return concat(parts);
}
function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
// src/hevc/deblock.ts
var BETA_TABLE = new Int32Array([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  20,
  22,
  24,
  26,
  28,
  30,
  32,
  34,
  36,
  38,
  40,
  42,
  44,
  46,
  48,
  50,
  52,
  54,
  56,
  58,
  60,
  62,
  64
]);
var TC_TABLE = new Int32Array([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  8,
  9,
  10,
  11,
  13,
  14,
  16,
  18,
  20,
  22,
  24
]);
var TAB8_22 = [29, 30, 31, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37, 37];
function table8_22(qPi) {
  if (qPi < 30)
    return qPi;
  if (qPi >= 43)
    return qPi - 6;
  return TAB8_22[qPi - 30];
}
function clip3(lo, hi, v) {
  return v < lo ? lo : v > hi ? hi : v;
}
function deblockPicture(pic, pps, bitDepth = 8) {
  if (pic.sh.deblockingDisabled)
    return;
  const betaOffset = pic.sh.betaOffsetDiv2 * 2;
  const tcOffset = pic.sh.tcOffsetDiv2 * 2;
  const shift = bitDepth - 8;
  const maxVal = (1 << bitDepth) - 1;
  const { y, cb, cr, width, height, tuEdgesY, qpMap } = pic;
  const bwY = width >> 2;
  const qw = width >> 3;
  const clip = (v) => v < 0 ? 0 : v > maxVal ? maxVal : v;
  const qpAt = (px, py) => qpMap[(py >> 3) * qw + (px >> 3)];
  for (let pass = 0;pass < 2; pass++) {
    const vertical = pass === 0;
    const xStart = vertical ? 8 : 0;
    const yStart = vertical ? 0 : 8;
    const xStep = vertical ? 8 : 4;
    const yStep = vertical ? 4 : 8;
    for (let ey = yStart;ey < height; ey += yStep) {
      for (let ex = xStart;ex < width; ex += xStep) {
        const edgeBlock = tuEdgesY[(ey >> 2) * bwY + (ex >> 2)];
        if (vertical ? !(edgeBlock & 1) : !(edgeBlock & 2))
          continue;
        const qpQ = qpAt(ex, ey);
        const qpP = vertical ? qpAt(ex - 1, ey) : qpAt(ex, ey - 1);
        const qpL = qpQ + qpP + 1 >> 1;
        const beta = BETA_TABLE[clip3(0, 51, qpL + betaOffset)] << shift;
        const tc = TC_TABLE[clip3(0, 53, qpL + 2 + tcOffset)] << shift;
        if (beta === 0)
          continue;
        const p = (k, i) => vertical ? y[(ey + k) * width + (ex - 1 - i)] : y[(ey - 1 - i) * width + (ex + k)];
        const q = (k, i) => vertical ? y[(ey + k) * width + (ex + i)] : y[(ey + i) * width + (ex + k)];
        const dp0 = Math.abs(p(0, 2) - 2 * p(0, 1) + p(0, 0));
        const dp3 = Math.abs(p(3, 2) - 2 * p(3, 1) + p(3, 0));
        const dq0 = Math.abs(q(0, 2) - 2 * q(0, 1) + q(0, 0));
        const dq3 = Math.abs(q(3, 2) - 2 * q(3, 1) + q(3, 0));
        const dpq0 = dp0 + dq0;
        const dpq3 = dp3 + dq3;
        const d = dpq0 + dpq3;
        if (d >= beta)
          continue;
        const dp = dp0 + dp3;
        const dq = dq0 + dq3;
        const dSam0 = 2 * dpq0 < beta >> 2 && Math.abs(p(0, 3) - p(0, 0)) + Math.abs(q(0, 0) - q(0, 3)) < beta >> 3 && Math.abs(p(0, 0) - q(0, 0)) < 5 * tc + 1 >> 1;
        const dSam3 = 2 * dpq3 < beta >> 2 && Math.abs(p(3, 3) - p(3, 0)) + Math.abs(q(3, 0) - q(3, 3)) < beta >> 3 && Math.abs(p(3, 0) - q(3, 0)) < 5 * tc + 1 >> 1;
        const dE = dSam0 && dSam3 ? 2 : 1;
        const dEp = dp < beta + (beta >> 1) >> 3 ? 1 : 0;
        const dEq = dq < beta + (beta >> 1) >> 3 ? 1 : 0;
        const setP = (k, i, v) => {
          if (vertical)
            y[(ey + k) * width + (ex - 1 - i)] = v;
          else
            y[(ey - 1 - i) * width + (ex + k)] = v;
        };
        const setQ = (k, i, v) => {
          if (vertical)
            y[(ey + k) * width + (ex + i)] = v;
          else
            y[(ey + i) * width + (ex + k)] = v;
        };
        for (let k = 0;k < 4; k++) {
          const p0 = p(k, 0);
          const p1 = p(k, 1);
          const p2 = p(k, 2);
          const p3 = p(k, 3);
          const q0 = q(k, 0);
          const q1 = q(k, 1);
          const q2 = q(k, 2);
          const q3 = q(k, 3);
          if (dE === 2) {
            setP(k, 0, clip3(p0 - 2 * tc, p0 + 2 * tc, p2 + 2 * p1 + 2 * p0 + 2 * q0 + q1 + 4 >> 3));
            setP(k, 1, clip3(p1 - 2 * tc, p1 + 2 * tc, p2 + p1 + p0 + q0 + 2 >> 2));
            setP(k, 2, clip3(p2 - 2 * tc, p2 + 2 * tc, 2 * p3 + 3 * p2 + p1 + p0 + q0 + 4 >> 3));
            setQ(k, 0, clip3(q0 - 2 * tc, q0 + 2 * tc, p1 + 2 * p0 + 2 * q0 + 2 * q1 + q2 + 4 >> 3));
            setQ(k, 1, clip3(q1 - 2 * tc, q1 + 2 * tc, p0 + q0 + q1 + q2 + 2 >> 2));
            setQ(k, 2, clip3(q2 - 2 * tc, q2 + 2 * tc, p0 + q0 + q1 + 3 * q2 + 2 * q3 + 4 >> 3));
          } else {
            let delta = 9 * (q0 - p0) - 3 * (q1 - p1) + 8 >> 4;
            if (Math.abs(delta) < tc * 10) {
              delta = clip3(-tc, tc, delta);
              setP(k, 0, clip(p0 + delta));
              setQ(k, 0, clip(q0 - delta));
              if (dEp === 1) {
                const dp2 = clip3(-(tc >> 1), tc >> 1, (p2 + p0 + 1 >> 1) - p1 + delta >> 1);
                setP(k, 1, clip(p1 + dp2));
              }
              if (dEq === 1) {
                const dq2 = clip3(-(tc >> 1), tc >> 1, (q2 + q0 + 1 >> 1) - q1 - delta >> 1);
                setQ(k, 1, clip(q1 + dq2));
              }
            }
          }
        }
      }
    }
  }
  const cw = width >> 1;
  const ch = height >> 1;
  const cMax = (1 << bitDepth) - 1;
  const clipC = (v) => v < 0 ? 0 : v > cMax ? cMax : v;
  for (let pass = 0;pass < 2; pass++) {
    const vertical = pass === 0;
    const plane = [cb, cr];
    const offsets = [pps.cbQpOffset, pps.crQpOffset];
    const cxStart = vertical ? 8 : 0;
    const cyStart = vertical ? 0 : 8;
    const cxStep = vertical ? 8 : 4;
    const cyStep = vertical ? 4 : 8;
    for (let cy = cyStart;cy < ch; cy += cyStep) {
      for (let cx = cxStart;cx < cw; cx += cxStep) {
        const lx = cx << 1;
        const ly = cy << 1;
        const edgeBlock = tuEdgesY[(ly >> 2) * bwY + (lx >> 2)];
        if (vertical ? !(edgeBlock & 1) : !(edgeBlock & 2))
          continue;
        const qpQ = qpAt(lx, ly);
        const qpP = vertical ? qpAt(lx - 1, ly) : qpAt(lx, ly - 1);
        const qpAvg = qpQ + qpP + 1 >> 1;
        for (let c = 0;c < 2; c++) {
          const cPlane = plane[c];
          const qpC = table8_22(qpAvg + offsets[c]);
          const tc = TC_TABLE[clip3(0, 53, qpC + 2 + tcOffset)] << shift;
          if (tc === 0)
            continue;
          for (let k = 0;k < 4; k++) {
            const iP0 = vertical ? (cy + k) * cw + (cx - 1) : (cy - 1) * cw + (cx + k);
            const iP1 = vertical ? (cy + k) * cw + (cx - 2) : (cy - 2) * cw + (cx + k);
            const iQ0 = vertical ? (cy + k) * cw + cx : cy * cw + (cx + k);
            const iQ1 = vertical ? (cy + k) * cw + (cx + 1) : (cy + 1) * cw + (cx + k);
            const p0 = cPlane[iP0];
            const p1 = cPlane[iP1];
            const q0 = cPlane[iQ0];
            const q1 = cPlane[iQ1];
            const delta = clip3(-tc, tc, (q0 - p0) * 4 + p1 - q1 + 4 >> 3);
            cPlane[iP0] = clipC(p0 + delta);
            cPlane[iQ0] = clipC(q0 - delta);
          }
        }
      }
    }
  }
}

// src/hevc/nal.ts
var NalType;
((NalType) => {
  NalType[NalType["TRAIL_N"] = 0] = "TRAIL_N";
  NalType[NalType["TRAIL_R"] = 1] = "TRAIL_R";
  NalType[NalType["IDR_W_RADL"] = 19] = "IDR_W_RADL";
  NalType[NalType["IDR_N_LP"] = 20] = "IDR_N_LP";
  NalType[NalType["CRA_NUT"] = 21] = "CRA_NUT";
  NalType[NalType["VPS"] = 32] = "VPS";
  NalType[NalType["SPS"] = 33] = "SPS";
  NalType[NalType["PPS"] = 34] = "PPS";
  NalType[NalType["AUD"] = 35] = "AUD";
  NalType[NalType["PREFIX_SEI"] = 39] = "PREFIX_SEI";
  NalType[NalType["SUFFIX_SEI"] = 40] = "SUFFIX_SEI";
})(NalType ||= {});
function isSliceNal(type) {
  return type >= 0 && type <= 9 || type >= 16 && type <= 21;
}
function splitLengthPrefixed(payload, nalLengthSize) {
  const nals = [];
  let p = 0;
  while (p + nalLengthSize <= payload.length) {
    let len = 0;
    for (let i = 0;i < nalLengthSize; i++)
      len = len << 8 | payload[p + i];
    p += nalLengthSize;
    if (len <= 0 || p + len > payload.length)
      break;
    const data = payload.subarray(p, p + len);
    nals.push({ type: data[0] >> 1 & 63, data });
    p += len;
  }
  return nals;
}
function splitAnnexB(stream) {
  const nals = [];
  const findStartCode = (from) => {
    for (let i = from;i + 2 < stream.length; i++) {
      if (stream[i] !== 0 || stream[i + 1] !== 0)
        continue;
      if (stream[i + 2] === 1)
        return { prefix: i, payload: i + 3 };
      if (stream[i + 2] === 0 && i + 3 < stream.length && stream[i + 3] === 1)
        return { prefix: i, payload: i + 4 };
    }
    return null;
  };
  let current = findStartCode(0);
  while (current) {
    const next = findStartCode(current.payload);
    let end = next?.prefix ?? stream.length;
    while (end > current.payload && stream[end - 1] === 0)
      end--;
    const data = stream.subarray(current.payload, end);
    if (data.length >= 2)
      nals.push({ type: data[0] >> 1 & 63, data });
    current = next;
  }
  return nals;
}
function toRbsp(nal) {
  const out = new Uint8Array(nal.length - 2);
  let o = 0;
  let zeros = 0;
  for (let i = 2;i < nal.length; i++) {
    const b = nal[i];
    if (zeros >= 2 && b === 3) {
      zeros = 0;
      continue;
    }
    out[o++] = b;
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return out.subarray(0, o);
}

class BitReader {
  data;
  pos = 0;
  constructor(data) {
    this.data = data;
  }
  readBit() {
    const byte = this.data[this.pos >> 3];
    const bit = byte >> 7 - (this.pos & 7) & 1;
    this.pos++;
    return bit;
  }
  readBits(n) {
    let v = 0;
    for (let i = 0;i < n; i++)
      v = v << 1 | this.readBit();
    return v >>> 0;
  }
  ue() {
    let zeros = 0;
    while (this.readBit() === 0 && zeros < 32)
      zeros++;
    let v = (1 << zeros) - 1;
    if (zeros > 0)
      v += this.readBits(zeros);
    return v;
  }
  se() {
    const k = this.ue();
    return k & 1 ? k + 1 >> 1 : -(k >> 1);
  }
  get bitPosition() {
    return this.pos;
  }
}

// src/hevc/cabac.ts
var RANGE_TAB_LPS = new Uint8Array([
  128,
  176,
  208,
  240,
  128,
  167,
  197,
  227,
  128,
  158,
  187,
  216,
  123,
  150,
  178,
  205,
  116,
  142,
  169,
  195,
  111,
  135,
  160,
  185,
  105,
  128,
  152,
  175,
  100,
  122,
  144,
  166,
  95,
  116,
  137,
  158,
  90,
  110,
  130,
  150,
  85,
  104,
  123,
  142,
  81,
  99,
  117,
  135,
  77,
  94,
  111,
  128,
  73,
  89,
  105,
  122,
  69,
  85,
  100,
  116,
  66,
  80,
  95,
  110,
  62,
  76,
  90,
  104,
  59,
  72,
  86,
  99,
  56,
  69,
  81,
  94,
  53,
  65,
  77,
  89,
  51,
  62,
  73,
  85,
  48,
  59,
  69,
  80,
  46,
  56,
  66,
  76,
  43,
  53,
  63,
  72,
  41,
  50,
  59,
  69,
  39,
  48,
  56,
  65,
  37,
  45,
  54,
  62,
  35,
  43,
  51,
  59,
  33,
  41,
  48,
  56,
  32,
  39,
  46,
  53,
  30,
  37,
  43,
  50,
  29,
  35,
  41,
  48,
  27,
  33,
  39,
  45,
  26,
  31,
  37,
  43,
  24,
  30,
  35,
  41,
  23,
  28,
  33,
  39,
  22,
  27,
  32,
  37,
  21,
  26,
  30,
  35,
  20,
  24,
  29,
  33,
  19,
  23,
  27,
  31,
  18,
  22,
  26,
  30,
  17,
  21,
  25,
  28,
  16,
  20,
  23,
  27,
  15,
  19,
  22,
  25,
  14,
  18,
  21,
  24,
  14,
  17,
  20,
  23,
  13,
  16,
  19,
  22,
  12,
  15,
  18,
  21,
  12,
  14,
  17,
  20,
  11,
  14,
  16,
  19,
  11,
  13,
  15,
  18,
  10,
  12,
  15,
  17,
  10,
  12,
  14,
  16,
  9,
  11,
  13,
  15,
  9,
  11,
  12,
  14,
  8,
  10,
  12,
  14,
  8,
  9,
  11,
  13,
  7,
  9,
  11,
  12,
  7,
  9,
  10,
  12,
  7,
  8,
  10,
  11,
  6,
  8,
  9,
  11,
  6,
  7,
  9,
  10,
  6,
  7,
  8,
  9,
  2,
  2,
  2,
  2
]);
var TRANS_IDX_LPS = new Uint8Array([
  0,
  0,
  1,
  2,
  2,
  4,
  4,
  5,
  6,
  7,
  8,
  9,
  9,
  11,
  11,
  12,
  13,
  13,
  15,
  15,
  16,
  16,
  18,
  18,
  19,
  19,
  21,
  21,
  22,
  22,
  23,
  24,
  24,
  25,
  26,
  26,
  27,
  27,
  28,
  29,
  29,
  30,
  30,
  30,
  31,
  32,
  32,
  33,
  33,
  33,
  34,
  34,
  35,
  35,
  35,
  36,
  36,
  36,
  37,
  37,
  37,
  38,
  38,
  63
]);
var n = 0;
function section(count) {
  const at = n;
  n += count;
  return at;
}
var CTX = {
  SAO_MERGE: section(1),
  SAO_TYPE_IDX: section(1),
  SPLIT_CU: section(3),
  TQ_BYPASS: section(1),
  PART_MODE: section(1),
  PREV_INTRA_LUMA_PRED: section(1),
  INTRA_CHROMA_PRED_MODE: section(1),
  SPLIT_TRANSFORM: section(3),
  CBF_LUMA: section(2),
  CBF_CHROMA: section(5),
  TRANSFORM_SKIP: section(2),
  CU_QP_DELTA: section(2),
  LAST_SIG_X: section(18),
  LAST_SIG_Y: section(18),
  CODED_SUB_BLOCK: section(4),
  SIG_COEFF: section(42),
  GREATER1: section(24),
  GREATER2: section(6)
};
var NUM_CTX = n;
var INIT_VALUES_I = new Uint8Array([
  153,
  200,
  139,
  141,
  157,
  154,
  184,
  184,
  63,
  153,
  138,
  138,
  111,
  141,
  94,
  138,
  182,
  154,
  154,
  139,
  139,
  154,
  154,
  110,
  110,
  124,
  125,
  140,
  153,
  125,
  127,
  140,
  109,
  111,
  143,
  127,
  111,
  79,
  108,
  123,
  63,
  110,
  110,
  124,
  125,
  140,
  153,
  125,
  127,
  140,
  109,
  111,
  143,
  127,
  111,
  79,
  108,
  123,
  63,
  91,
  171,
  134,
  141,
  111,
  111,
  125,
  110,
  110,
  94,
  124,
  108,
  124,
  107,
  125,
  141,
  179,
  153,
  125,
  107,
  125,
  141,
  179,
  153,
  125,
  107,
  125,
  141,
  179,
  153,
  125,
  140,
  139,
  182,
  182,
  152,
  136,
  152,
  136,
  153,
  136,
  139,
  111,
  136,
  139,
  111,
  140,
  92,
  137,
  138,
  140,
  152,
  138,
  139,
  153,
  74,
  149,
  92,
  139,
  107,
  122,
  152,
  140,
  179,
  166,
  182,
  140,
  227,
  122,
  197,
  138,
  153,
  136,
  167,
  152,
  152
]);

class CabacContexts {
  pState;
  valMps;
  constructor() {
    this.pState = new Uint8Array(NUM_CTX);
    this.valMps = new Uint8Array(NUM_CTX);
  }
  init(sliceQpY) {
    const qp = Math.min(51, Math.max(0, sliceQpY));
    for (let i = 0;i < NUM_CTX; i++) {
      const initValue = INIT_VALUES_I[i];
      const m = (initValue >> 4) * 5 - 45;
      const nOff = ((initValue & 15) << 3) - 16;
      let preCtxState = (m * qp >> 4) + nOff;
      preCtxState = Math.min(126, Math.max(1, preCtxState));
      if (preCtxState <= 63) {
        this.valMps[i] = 0;
        this.pState[i] = 63 - preCtxState;
      } else {
        this.valMps[i] = 1;
        this.pState[i] = preCtxState - 64;
      }
    }
  }
  save() {
    return { pState: this.pState.slice(), valMps: this.valMps.slice() };
  }
  restore(snapshot) {
    this.pState.set(snapshot.pState);
    this.valMps.set(snapshot.valMps);
  }
}

class CabacDecoder {
  ctx;
  data;
  bytePos = 0;
  bitsLeft = 0;
  cache = 0;
  range = 510;
  offset = 0;
  constructor(data, ctx) {
    this.ctx = ctx;
    this.data = data;
    this.offset = this.readBits(9);
  }
  readBit() {
    if (this.bitsLeft === 0) {
      this.cache = this.bytePos < this.data.length ? this.data[this.bytePos++] : 0;
      this.bitsLeft = 8;
    }
    this.bitsLeft--;
    return this.cache >> this.bitsLeft & 1;
  }
  readBits(count) {
    let v = 0;
    for (let i = 0;i < count; i++)
      v = v << 1 | this.readBit();
    return v;
  }
  decodeBin(ctxIdx) {
    const pState = this.ctx.pState[ctxIdx];
    const lpsRange = RANGE_TAB_LPS[pState << 2 | this.range >> 6 & 3];
    this.range -= lpsRange;
    let bin;
    if (this.offset >= this.range) {
      bin = 1 - this.ctx.valMps[ctxIdx];
      this.offset -= this.range;
      this.range = lpsRange;
      if (pState === 0)
        this.ctx.valMps[ctxIdx] = 1 - this.ctx.valMps[ctxIdx];
      this.ctx.pState[ctxIdx] = TRANS_IDX_LPS[pState];
    } else {
      bin = this.ctx.valMps[ctxIdx];
      if (pState < 62)
        this.ctx.pState[ctxIdx] = pState + 1;
    }
    while (this.range < 256) {
      this.range <<= 1;
      this.offset = this.offset << 1 | this.readBit();
    }
    return bin;
  }
  decodeBypass() {
    this.offset = this.offset << 1 | this.readBit();
    if (this.offset >= this.range) {
      this.offset -= this.range;
      return 1;
    }
    return 0;
  }
  decodeBypassBits(count) {
    let v = 0;
    for (let i = 0;i < count; i++)
      v = v << 1 | this.decodeBypass();
    return v;
  }
  decodeTerminate() {
    this.range -= 2;
    if (this.offset >= this.range)
      return 1;
    while (this.range < 256) {
      this.range <<= 1;
      this.offset = this.offset << 1 | this.readBit();
    }
    return 0;
  }
}

// src/hevc/intra.ts
var INTRA_PLANAR = 0;
var INTRA_DC = 1;
var INTRA_ANGULAR_HOR = 10;
var INTRA_ANGULAR_VER = 26;
var PRED_ANGLE = [
  32,
  26,
  21,
  17,
  13,
  9,
  5,
  2,
  0,
  -2,
  -5,
  -9,
  -13,
  -17,
  -21,
  -26,
  -32,
  -26,
  -21,
  -17,
  -13,
  -9,
  -5,
  -2,
  0,
  2,
  5,
  9,
  13,
  17,
  21,
  26,
  32
];
var INV_ANGLE = [
  -4096,
  -1638,
  -910,
  -630,
  -482,
  -390,
  -315,
  -256,
  -315,
  -390,
  -482,
  -630,
  -910,
  -1638,
  -4096
];
function gatherRefs(plane, stride, x0, y0, size, bitDepth, available) {
  const n2 = size * 2;
  const count = n2 * 2 + 1;
  const vals = new Int32Array(count);
  const avail = new Uint8Array(count);
  for (let i = 0;i < n2; i++) {
    const py = y0 + n2 - 1 - i;
    if (available(x0 - 1, py)) {
      vals[i] = plane[py * stride + x0 - 1];
      avail[i] = 1;
    }
  }
  if (available(x0 - 1, y0 - 1)) {
    vals[n2] = plane[(y0 - 1) * stride + x0 - 1];
    avail[n2] = 1;
  }
  for (let j = 0;j < n2; j++) {
    if (available(x0 + j, y0 - 1)) {
      vals[n2 + 1 + j] = plane[(y0 - 1) * stride + x0 + j];
      avail[n2 + 1 + j] = 1;
    }
  }
  if (!avail[0]) {
    let first = -1;
    for (let i = 1;i < count; i++) {
      if (avail[i]) {
        first = i;
        break;
      }
    }
    if (first === -1) {
      vals.fill(1 << bitDepth - 1);
    } else {
      vals[0] = vals[first];
    }
    avail[0] = 1;
  }
  for (let i = 1;i < count; i++) {
    if (!avail[i])
      vals[i] = vals[i - 1];
  }
  const left = new Int32Array(n2);
  const top = new Int32Array(n2);
  for (let y = 0;y < n2; y++)
    left[y] = vals[n2 - 1 - y];
  for (let x = 0;x < n2; x++)
    top[x] = vals[n2 + 1 + x];
  return { left, top, corner: vals[n2] };
}
function filterThreshold(size) {
  return size === 8 ? 7 : size === 16 ? 1 : 0;
}
function filterRefs(refs, size, mode, cIdx, bitDepth, strongSmoothingEnabled) {
  if (cIdx !== 0 || size === 4 || mode === INTRA_DC)
    return;
  const minDist = Math.min(Math.abs(mode - 26), Math.abs(mode - 10));
  if (mode !== INTRA_PLANAR && minDist <= filterThreshold(size))
    return;
  const { left, top, corner } = refs;
  const n2 = size * 2;
  if (strongSmoothingEnabled && size === 32) {
    const threshold = 1 << bitDepth - 5;
    const flatTop = Math.abs(corner + top[n2 - 1] - 2 * top[size - 1]) < threshold;
    const flatLeft = Math.abs(corner + left[n2 - 1] - 2 * left[size - 1]) < threshold;
    if (flatTop && flatLeft) {
      const lastLeft = left[n2 - 1];
      const lastTop = top[n2 - 1];
      for (let y = 0;y < n2 - 1; y++)
        left[y] = (n2 - 1 - y) * corner + (y + 1) * lastLeft + 32 >> 6;
      for (let x = 0;x < n2 - 1; x++)
        top[x] = (n2 - 1 - x) * corner + (x + 1) * lastTop + 32 >> 6;
      return;
    }
  }
  const fCorner = left[0] + 2 * corner + top[0] + 2 >> 2;
  const fLeft = new Int32Array(n2);
  const fTop = new Int32Array(n2);
  for (let y = 0;y < n2 - 1; y++)
    fLeft[y] = (y === 0 ? corner : left[y - 1]) + 2 * left[y] + left[y + 1] + 2 >> 2;
  fLeft[n2 - 1] = left[n2 - 1];
  for (let x = 0;x < n2 - 1; x++)
    fTop[x] = (x === 0 ? corner : top[x - 1]) + 2 * top[x] + top[x + 1] + 2 >> 2;
  fTop[n2 - 1] = top[n2 - 1];
  refs.left.set(fLeft);
  refs.top.set(fTop);
  refs.corner = fCorner;
}
function predictIntra(refs, size, mode, cIdx, bitDepth) {
  const out = new Int32Array(size * size);
  const { left, top, corner } = refs;
  const maxVal = (1 << bitDepth) - 1;
  const clip = (v) => v < 0 ? 0 : v > maxVal ? maxVal : v;
  if (mode === INTRA_PLANAR) {
    const log2 = 31 - Math.clz32(size);
    const tr = top[size];
    const bl = left[size];
    for (let y = 0;y < size; y++) {
      for (let x = 0;x < size; x++) {
        out[y * size + x] = (size - 1 - x) * left[y] + (x + 1) * tr + (size - 1 - y) * top[x] + (y + 1) * bl + size >> log2 + 1;
      }
    }
    return out;
  }
  if (mode === INTRA_DC) {
    const log2 = 31 - Math.clz32(size);
    let sum = size;
    for (let i = 0;i < size; i++)
      sum += top[i] + left[i];
    const dc = sum >> log2 + 1;
    out.fill(dc);
    if (cIdx === 0 && size < 32) {
      out[0] = left[0] + 2 * dc + top[0] + 2 >> 2;
      for (let x = 1;x < size; x++)
        out[x] = top[x] + 3 * dc + 2 >> 2;
      for (let y = 1;y < size; y++)
        out[y * size] = left[y] + 3 * dc + 2 >> 2;
    }
    return out;
  }
  const angle = PRED_ANGLE[mode - 2];
  const vertical = mode >= 18;
  const ref = new Int32Array(3 * size + 1);
  const base = size;
  const main = vertical ? top : left;
  const side = vertical ? left : top;
  ref[base] = corner;
  for (let i = 1;i <= size; i++)
    ref[base + i] = main[i - 1];
  if (angle < 0) {
    const lower = size * angle >> 5;
    if (lower < -1) {
      const invAngle = INV_ANGLE[mode - 11];
      for (let i = -1;i >= lower; i--) {
        const idx = (i * invAngle + 128 >> 8) - 1;
        ref[base + i] = idx < 0 ? corner : side[idx];
      }
    }
  } else {
    for (let i = size + 1;i <= 2 * size; i++)
      ref[base + i] = main[i - 1];
  }
  for (let k = 0;k < size; k++) {
    const pos = (k + 1) * angle;
    const iIdx = pos >> 5;
    const iFact = pos & 31;
    for (let j = 0;j < size; j++) {
      const a = ref[base + j + iIdx + 1];
      const value = iFact === 0 ? a : (32 - iFact) * a + iFact * ref[base + j + iIdx + 2] + 16 >> 5;
      if (vertical)
        out[k * size + j] = value;
      else
        out[j * size + k] = value;
    }
  }
  if (cIdx === 0 && size < 32) {
    if (mode === INTRA_ANGULAR_VER) {
      for (let y = 0;y < size; y++)
        out[y * size] = clip(top[0] + (left[y] - corner >> 1));
    } else if (mode === INTRA_ANGULAR_HOR) {
      for (let x = 0;x < size; x++)
        out[x] = clip(left[0] + (top[x] - corner >> 1));
    }
  }
  return out;
}

// src/hevc/scan.ts
var SCAN_DIAG = 0;
var SCAN_HORIZ = 1;
var SCAN_VERT = 2;
function diagScan(size) {
  const out = new Int32Array(size * size);
  let i = 0;
  let x = 0;
  let y = 0;
  while (i < size * size) {
    while (y >= 0) {
      if (x < size && y < size)
        out[i++] = y * size + x;
      y--;
      x++;
    }
    y = x;
    x = 0;
  }
  return out;
}
function horizScan(size) {
  const out = new Int32Array(size * size);
  for (let p = 0;p < size * size; p++)
    out[p] = p;
  return out;
}
function vertScan(size) {
  const out = new Int32Array(size * size);
  let i = 0;
  for (let x = 0;x < size; x++) {
    for (let y = 0;y < size; y++)
      out[i++] = y * size + x;
  }
  return out;
}
var cache = new Map;
function getScan(scanIdx, size) {
  const key = scanIdx * 64 + size;
  const hit = cache.get(key);
  if (hit)
    return hit;
  const scan = scanIdx === SCAN_HORIZ ? horizScan(size) : scanIdx === SCAN_VERT ? vertScan(size) : diagScan(size);
  cache.set(key, scan);
  return scan;
}

// src/hevc/scaling.ts
var DEFAULT_INTRA_8X8 = new Int32Array([
  16,
  16,
  16,
  16,
  17,
  18,
  21,
  24,
  16,
  16,
  16,
  16,
  17,
  19,
  22,
  25,
  16,
  16,
  17,
  18,
  20,
  22,
  25,
  29,
  16,
  16,
  18,
  21,
  24,
  27,
  31,
  36,
  17,
  17,
  20,
  24,
  30,
  35,
  41,
  47,
  18,
  19,
  22,
  27,
  35,
  44,
  54,
  65,
  21,
  22,
  25,
  31,
  41,
  54,
  70,
  88,
  24,
  25,
  29,
  36,
  47,
  65,
  88,
  115
]);
var DEFAULT_INTER_8X8 = new Int32Array([
  16,
  16,
  16,
  16,
  17,
  18,
  20,
  24,
  16,
  16,
  16,
  17,
  18,
  20,
  24,
  25,
  16,
  16,
  17,
  18,
  20,
  24,
  25,
  28,
  16,
  17,
  18,
  20,
  24,
  25,
  28,
  33,
  17,
  18,
  20,
  24,
  25,
  28,
  33,
  41,
  18,
  20,
  24,
  25,
  28,
  33,
  41,
  54,
  20,
  24,
  25,
  28,
  33,
  41,
  54,
  71,
  24,
  25,
  28,
  33,
  41,
  54,
  71,
  91
]);
function defaultList(sizeId, matrixId) {
  if (sizeId === 0)
    return new Int32Array(16).fill(16);
  return (matrixId < 3 ? DEFAULT_INTRA_8X8 : DEFAULT_INTER_8X8).slice();
}
function parseScalingListData(r) {
  const lists = [];
  const dc = [
    [16, 16, 16, 16, 16, 16],
    [16, 16, 16, 16, 16, 16]
  ];
  for (let sizeId = 0;sizeId < 4; sizeId++) {
    lists[sizeId] = [];
    for (let matrixId = 0;matrixId < 6; matrixId += sizeId === 3 ? 3 : 1) {
      const predMode = r.readBit();
      if (predMode === 0) {
        const delta = r.ue();
        if (delta === 0) {
          lists[sizeId][matrixId] = defaultList(sizeId, matrixId);
        } else {
          const refId = matrixId - delta * (sizeId === 3 ? 3 : 1);
          lists[sizeId][matrixId] = lists[sizeId][refId].slice();
          if (sizeId >= 2)
            dc[sizeId - 2][matrixId] = dc[sizeId - 2][refId];
        }
      } else {
        const coefNum = Math.min(64, 1 << 4 + (sizeId << 1));
        const size = sizeId === 0 ? 4 : 8;
        const scan = getScan(SCAN_DIAG, size);
        let nextCoef = 8;
        if (sizeId > 1) {
          nextCoef = r.se() + 8;
          dc[sizeId - 2][matrixId] = nextCoef;
        }
        const list = new Int32Array(size * size);
        for (let i = 0;i < coefNum; i++) {
          nextCoef = (nextCoef + r.se() + 256) % 256;
          list[scan[i]] = nextCoef;
        }
        lists[sizeId][matrixId] = list;
      }
    }
  }
  return { lists, dc };
}
function defaultScalingListData() {
  const lists = [];
  const dc = [
    [16, 16, 16, 16, 16, 16],
    [16, 16, 16, 16, 16, 16]
  ];
  for (let sizeId = 0;sizeId < 4; sizeId++) {
    lists[sizeId] = [];
    for (let matrixId = 0;matrixId < 6; matrixId += sizeId === 3 ? 3 : 1)
      lists[sizeId][matrixId] = defaultList(sizeId, matrixId);
  }
  return { lists, dc };
}
function buildScalingFactors(data, sizeId, matrixId) {
  const size = 4 << sizeId;
  const out = new Int32Array(size * size);
  const list = data.lists[sizeId][sizeId === 3 ? matrixId >= 3 ? 3 : 0 : matrixId];
  if (sizeId <= 1) {
    out.set(list);
    return out;
  }
  const listSize = 8;
  const shift = sizeId - 1;
  for (let y = 0;y < size; y++) {
    for (let x = 0;x < size; x++)
      out[y * size + x] = list[(y >> shift) * listSize + (x >> shift)];
  }
  out[0] = data.dc[sizeId - 2][sizeId === 3 ? matrixId >= 3 ? 3 : 0 : matrixId];
  return out;
}

// src/hevc/sps.ts
function skipProfileTierLevel(r, maxSubLayersMinus1) {
  r.readBits(2);
  r.readBit();
  r.readBits(5);
  r.readBits(32);
  r.readBits(32);
  r.readBits(16);
  r.readBits(8);
  const subLayerProfilePresent = [];
  const subLayerLevelPresent = [];
  for (let i = 0;i < maxSubLayersMinus1; i++) {
    subLayerProfilePresent.push(r.readBit() === 1);
    subLayerLevelPresent.push(r.readBit() === 1);
  }
  if (maxSubLayersMinus1 > 0) {
    for (let i = maxSubLayersMinus1;i < 8; i++)
      r.readBits(2);
  }
  for (let i = 0;i < maxSubLayersMinus1; i++) {
    if (subLayerProfilePresent[i]) {
      r.readBits(32);
      r.readBits(32);
      r.readBits(24);
    }
    if (subLayerLevelPresent[i])
      r.readBits(8);
  }
}
function skipShortTermRefPicSet(r, idx, numSets, numDeltaPocs) {
  let interRpsPred = false;
  if (idx !== 0)
    interRpsPred = r.readBit() === 1;
  if (interRpsPred) {
    if (idx === numSets)
      r.ue();
    r.readBit();
    r.ue();
    const refDeltaPocs = numDeltaPocs[idx - 1] ?? 0;
    let count = 0;
    for (let j = 0;j <= refDeltaPocs; j++) {
      const usedByCurrPic = r.readBit() === 1;
      let useDelta = true;
      if (!usedByCurrPic)
        useDelta = r.readBit() === 1;
      if (usedByCurrPic || useDelta)
        count++;
    }
    numDeltaPocs[idx] = count;
  } else {
    const numNegative = r.ue();
    const numPositive = r.ue();
    for (let j = 0;j < numNegative; j++) {
      r.ue();
      r.readBit();
    }
    for (let j = 0;j < numPositive; j++) {
      r.ue();
      r.readBit();
    }
    numDeltaPocs[idx] = numNegative + numPositive;
  }
}
function parseSps(nal) {
  const r = new BitReader(toRbsp(nal));
  r.readBits(4);
  const maxSubLayersMinus1 = r.readBits(3);
  r.readBit();
  skipProfileTierLevel(r, maxSubLayersMinus1);
  const spsId = r.ue();
  const chromaFormatIdc = r.ue();
  if (chromaFormatIdc === 3)
    r.readBit();
  const picWidthInLumaSamples = r.ue();
  const picHeightInLumaSamples = r.ue();
  let cropLeft = 0;
  let cropRight = 0;
  let cropTop = 0;
  let cropBottom = 0;
  if (r.readBit() === 1) {
    cropLeft = r.ue();
    cropRight = r.ue();
    cropTop = r.ue();
    cropBottom = r.ue();
  }
  const bitDepthLuma = r.ue() + 8;
  const bitDepthChroma = r.ue() + 8;
  const log2MaxPicOrderCntLsb = r.ue() + 4;
  const subLayerOrderingPresent = r.readBit() === 1;
  const first = subLayerOrderingPresent ? 0 : maxSubLayersMinus1;
  for (let i = first;i <= maxSubLayersMinus1; i++) {
    r.ue();
    r.ue();
    r.ue();
  }
  const log2MinLumaCodingBlockSize = r.ue() + 3;
  const log2CtbSize = log2MinLumaCodingBlockSize + r.ue();
  const log2MinTransformBlockSize = r.ue() + 2;
  const log2MaxTransformBlockSize = log2MinTransformBlockSize + r.ue();
  r.ue();
  const maxTransformHierarchyDepthIntra = r.ue();
  const scalingListEnabled = r.readBit() === 1;
  let scalingListData = null;
  if (scalingListEnabled) {
    scalingListData = r.readBit() === 1 ? parseScalingListData(r) : defaultScalingListData();
  }
  const ampEnabled = r.readBit() === 1;
  const sampleAdaptiveOffsetEnabled = r.readBit() === 1;
  const pcmEnabled = r.readBit() === 1;
  let pcmSampleBitDepthLuma = 0;
  let pcmSampleBitDepthChroma = 0;
  let log2MinPcmLumaCodingBlockSize = 0;
  let log2MaxPcmLumaCodingBlockSize = 0;
  let pcmLoopFilterDisabled = false;
  if (pcmEnabled) {
    pcmSampleBitDepthLuma = r.readBits(4) + 1;
    pcmSampleBitDepthChroma = r.readBits(4) + 1;
    log2MinPcmLumaCodingBlockSize = r.ue() + 3;
    log2MaxPcmLumaCodingBlockSize = log2MinPcmLumaCodingBlockSize + r.ue();
    pcmLoopFilterDisabled = r.readBit() === 1;
  }
  const numShortTermRefPicSets = r.ue();
  const numDeltaPocs = [];
  for (let i = 0;i < numShortTermRefPicSets; i++)
    skipShortTermRefPicSet(r, i, numShortTermRefPicSets, numDeltaPocs);
  if (r.readBit() === 1) {
    const numLongTerm = r.ue();
    for (let i = 0;i < numLongTerm; i++) {
      r.readBits(log2MaxPicOrderCntLsb);
      r.readBit();
    }
  }
  r.readBit();
  const strongIntraSmoothingEnabled = r.readBit() === 1;
  let color = null;
  if (r.readBit() === 1) {
    if (r.readBit() === 1) {
      const aspectRatioIdc = r.readBits(8);
      if (aspectRatioIdc === 255) {
        r.readBits(16);
        r.readBits(16);
      }
    }
    if (r.readBit() === 1)
      r.readBit();
    if (r.readBit() === 1) {
      r.readBits(3);
      const videoFullRange = r.readBit() === 1;
      let colourPrimaries = 2;
      let transferCharacteristics = 2;
      let matrixCoeffs = 2;
      if (r.readBit() === 1) {
        colourPrimaries = r.readBits(8);
        transferCharacteristics = r.readBits(8);
        matrixCoeffs = r.readBits(8);
      }
      color = { videoFullRange, colourPrimaries, transferCharacteristics, matrixCoeffs };
    }
  }
  const subW = chromaFormatIdc === 1 || chromaFormatIdc === 2 ? 2 : 1;
  const subH = chromaFormatIdc === 1 ? 2 : 1;
  const width = picWidthInLumaSamples - subW * (cropLeft + cropRight);
  const height = picHeightInLumaSamples - subH * (cropTop + cropBottom);
  return {
    spsId,
    chromaFormatIdc,
    width,
    height,
    picWidthInLumaSamples,
    picHeightInLumaSamples,
    cropLeft,
    cropRight,
    cropTop,
    cropBottom,
    bitDepthLuma,
    bitDepthChroma,
    log2MaxPicOrderCntLsb,
    log2MinLumaCodingBlockSize,
    log2CtbSize,
    log2MinTransformBlockSize,
    log2MaxTransformBlockSize,
    maxTransformHierarchyDepthIntra,
    scalingListEnabled,
    scalingListData,
    ampEnabled,
    sampleAdaptiveOffsetEnabled,
    pcmEnabled,
    pcmSampleBitDepthLuma,
    pcmSampleBitDepthChroma,
    log2MinPcmLumaCodingBlockSize,
    log2MaxPcmLumaCodingBlockSize,
    pcmLoopFilterDisabled,
    strongIntraSmoothingEnabled,
    numShortTermRefPicSets,
    color
  };
}

// src/hevc/slice-header.ts
var SLICE_TYPE_I = 2;
function toRbspMapped(nal) {
  const data = new Uint8Array(nal.length - 2);
  const rawIndex = new Int32Array(nal.length - 2);
  let o = 0;
  let zeros = 0;
  for (let i = 2;i < nal.length; i++) {
    const b = nal[i];
    if (zeros >= 2 && b === 3) {
      zeros = 0;
      continue;
    }
    rawIndex[o] = i;
    data[o++] = b;
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return { data: data.subarray(0, o), rawIndex: rawIndex.subarray(0, o) };
}
function unescapeRange(nal, start, end) {
  const out = new Uint8Array(end - start);
  let o = 0;
  let zeros = 0;
  for (let i = start;i < end; i++) {
    const b = nal[i];
    if (zeros >= 2 && b === 3) {
      zeros = 0;
      continue;
    }
    out[o++] = b;
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return out.subarray(0, o);
}
function isIrap(nalType) {
  return nalType >= 16 && nalType <= 23;
}
function isIdr(nalType) {
  return nalType === 19 || nalType === 20;
}
function parseSliceHeader(nal, sps, pps) {
  const nalType = nal[0] >> 1 & 63;
  const rbsp = toRbspMapped(nal);
  const r = new BitReader(rbsp.data);
  const firstSliceInPic = r.readBit() === 1;
  if (isIrap(nalType))
    r.readBit();
  r.ue();
  const ctbSize = 1 << sps.log2CtbSize;
  const picWidthInCtbs = Math.ceil(sps.picWidthInLumaSamples / ctbSize);
  const picHeightInCtbs = Math.ceil(sps.picHeightInLumaSamples / ctbSize);
  const picSizeInCtbs = picWidthInCtbs * picHeightInCtbs;
  let dependentSliceSegment = false;
  let segmentAddress = 0;
  if (!firstSliceInPic) {
    if (pps.dependentSliceSegmentsEnabled)
      dependentSliceSegment = r.readBit() === 1;
    segmentAddress = r.readBits(Math.ceil(Math.log2(picSizeInCtbs)));
  }
  let sliceType = SLICE_TYPE_I;
  let sliceQpY = pps.initQp;
  let cbQpOffset = pps.cbQpOffset;
  let crQpOffset = pps.crQpOffset;
  let saoLuma = false;
  let saoChroma = false;
  let deblockingDisabled = pps.deblockingFilterDisabled;
  let betaOffsetDiv2 = pps.betaOffsetDiv2;
  let tcOffsetDiv2 = pps.tcOffsetDiv2;
  let loopFilterAcrossSlices = pps.loopFilterAcrossSlicesEnabled;
  if (!dependentSliceSegment) {
    for (let i = 0;i < pps.numExtraSliceHeaderBits; i++)
      r.readBit();
    sliceType = r.ue();
    if (sliceType !== SLICE_TYPE_I)
      throw new Error(`ts-heic: only intra (I) slices are supported, got slice_type ${sliceType}`);
    if (pps.outputFlagPresent)
      r.readBit();
    if (!isIdr(nalType)) {
      r.readBits(sps.log2MaxPicOrderCntLsb);
      let useSpsSet = false;
      if (sps.numShortTermRefPicSets > 0)
        useSpsSet = r.readBit() === 1;
      if (!useSpsSet) {
        const numDeltaPocs = [];
        skipShortTermRefPicSet(r, sps.numShortTermRefPicSets, sps.numShortTermRefPicSets, numDeltaPocs);
      } else {
        r.readBits(Math.ceil(Math.log2(sps.numShortTermRefPicSets)));
      }
    }
    if (sps.sampleAdaptiveOffsetEnabled) {
      saoLuma = r.readBit() === 1;
      saoChroma = r.readBit() === 1;
    }
    sliceQpY = pps.initQp + r.se();
    if (pps.sliceChromaQpOffsetsPresent) {
      cbQpOffset += r.se();
      crQpOffset += r.se();
    }
    let deblockingOverride = false;
    if (pps.deblockingFilterOverrideEnabled)
      deblockingOverride = r.readBit() === 1;
    if (deblockingOverride) {
      deblockingDisabled = r.readBit() === 1;
      if (!deblockingDisabled) {
        betaOffsetDiv2 = r.se();
        tcOffsetDiv2 = r.se();
      }
    }
    if (pps.loopFilterAcrossSlicesEnabled && (saoLuma || saoChroma || !deblockingDisabled))
      loopFilterAcrossSlices = r.readBit() === 1;
  }
  const entryPointOffsets = [];
  if (pps.tilesEnabled || pps.entropyCodingSyncEnabled) {
    const numEntryPoints = r.ue();
    if (numEntryPoints > 0) {
      const offsetLen = r.ue() + 1;
      for (let i = 0;i < numEntryPoints; i++)
        entryPointOffsets.push(r.readBits(offsetLen) + 1);
    }
  }
  if (pps.sliceSegmentHeaderExtensionPresent) {
    const extLength = r.ue();
    for (let i = 0;i < extLength; i++)
      r.readBits(8);
  }
  if (r.readBit() !== 1)
    throw new Error("ts-heic: slice header byte alignment bit missing");
  while (r.bitPosition % 8 !== 0)
    r.readBit();
  const dataStartRbsp = r.bitPosition >> 3;
  const dataStartRaw = dataStartRbsp < rbsp.data.length ? rbsp.rawIndex[dataStartRbsp] : nal.length;
  const substreams = [];
  let start = dataStartRaw;
  for (const offset of entryPointOffsets) {
    substreams.push(unescapeRange(nal, start, start + offset));
    start += offset;
  }
  substreams.push(unescapeRange(nal, start, nal.length));
  return {
    firstSliceInPic,
    dependentSliceSegment,
    segmentAddress,
    sliceType,
    sliceQpY,
    cbQpOffset,
    crQpOffset,
    saoLuma,
    saoChroma,
    deblockingDisabled,
    betaOffsetDiv2,
    tcOffsetDiv2,
    loopFilterAcrossSlices,
    substreams
  };
}

// src/hevc/transform.ts
var ODD4 = [83, 36];
var ODD8 = [89, 75, 50, 18];
var ODD16 = [90, 87, 80, 70, 57, 43, 25, 9];
var ODD32 = [90, 90, 88, 85, 82, 78, 73, 67, 61, 54, 46, 38, 31, 22, 13, 4];
function buildDctMatrix(size) {
  if (size === 2)
    return new Int32Array([64, 64, 64, -64]);
  const half = buildDctMatrix(size >> 1);
  const odd = size === 4 ? ODD4 : size === 8 ? ODD8 : size === 16 ? ODD16 : ODD32;
  const out = new Int32Array(size * size);
  for (let k = 0;k < size >> 1; k++) {
    for (let n = 0;n < size >> 1; n++) {
      const v = half[k * (size >> 1) + n];
      out[2 * k * size + n] = v;
      out[2 * k * size + (size - 1 - n)] = v;
    }
  }
  for (let k = 0;2 * k + 1 < size; k++) {
    const r = 2 * k + 1;
    for (let n = 0;n < size; n++) {
      let m = r * (2 * n + 1) % (4 * size);
      let sign = 1;
      if (m > 2 * size)
        m = 4 * size - m;
      if (m > size) {
        sign = -1;
        m = 2 * size - m;
      }
      out[r * size + n] = sign * odd[m - 1 >> 1];
    }
  }
  return out;
}
var dctCache = new Map;
function getDctMatrix(size) {
  let m = dctCache.get(size);
  if (!m) {
    m = buildDctMatrix(size);
    dctCache.set(size, m);
  }
  return m;
}
var DST4 = new Int32Array([
  29,
  55,
  74,
  84,
  74,
  74,
  0,
  -74,
  84,
  -29,
  -74,
  55,
  55,
  -84,
  74,
  -29
]);
function clip16(v) {
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v;
}
function inversePass(matrix, input, output, size, shift) {
  const add = 1 << shift - 1;
  for (let j = 0;j < size; j++) {
    for (let n = 0;n < size; n++) {
      let sum = 0;
      for (let k = 0;k < size; k++)
        sum += matrix[k * size + n] * input[k * size + j];
      output[j * size + n] = clip16(sum + add >> shift);
    }
  }
}
function inverseTransform(coeffs, size, bitDepth, useDst) {
  const matrix = useDst ? DST4 : getDctMatrix(size);
  const tmp = new Int32Array(size * size);
  const out = new Int32Array(size * size);
  inversePass(matrix, coeffs, tmp, size, 7);
  inversePass(matrix, tmp, out, size, 20 - bitDepth);
  return out;
}
var LEVEL_SCALE = [40, 45, 51, 57, 64, 72];
function dequantize(levels, size, qp, bitDepth, scalingFactors) {
  const log2Size = 31 - Math.clz32(size);
  const bdShift = bitDepth + log2Size - 5;
  const add = 1 << bdShift - 1;
  const scale = LEVEL_SCALE[qp % 6] * 2 ** Math.floor(qp / 6);
  const out = new Int32Array(size * size);
  const div = 2 ** bdShift;
  for (let i = 0;i < size * size; i++) {
    const level = levels[i];
    if (level === 0)
      continue;
    const m = scalingFactors ? scalingFactors[i] : 16;
    out[i] = clip16(Math.floor((level * m * scale + add) / div));
  }
  return out;
}

// src/hevc/picture.ts
var CTX_IDX_MAP_4X4 = [0, 1, 4, 5, 2, 3, 4, 5, 6, 6, 8, 8, 7, 7, 8, 8];
var CHROMA_QP_TABLE = [29, 30, 31, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37, 37];
function mapChromaQp(qpY, offset) {
  const qPi = Math.min(57, Math.max(0, qpY + offset));
  if (qPi < 30)
    return qPi;
  if (qPi > 43)
    return qPi - 6;
  return CHROMA_QP_TABLE[qPi - 30];
}

class PictureDecoder {
  sps;
  pps;
  bd = 8;
  w;
  h;
  cw;
  ch;
  log2Ctb;
  ctbSize;
  widthInCtbs;
  heightInCtbs;
  y;
  cb;
  cr;
  decodedY;
  decodedC;
  bwY;
  bhY;
  bwC;
  intraModeMap;
  ctDepthMap;
  qpMap;
  tuEdgesY;
  tuEdgesC;
  scalingFactors;
  sao;
  ctxs = new CabacContexts;
  cabac;
  rowSnapshot = null;
  sh;
  ctbX = 0;
  ctbY = 0;
  lastQpY = 0;
  qgPredPending = false;
  isCuQpDeltaCoded = false;
  cuQpDeltaVal = 0;
  qgX = 0;
  qgY = 0;
  qpYPred = 0;
  cuQp = 0;
  cuChromaMode = 0;
  constructor(sps, pps) {
    this.sps = sps;
    this.pps = pps;
    if (sps.chromaFormatIdc !== 1 || sps.bitDepthLuma !== 8 || sps.bitDepthChroma !== 8)
      throw new Error("ts-heic: only 4:2:0 8-bit HEVC is supported");
    if (sps.pcmEnabled)
      throw new Error("ts-heic: PCM coding is not supported");
    this.w = sps.picWidthInLumaSamples;
    this.h = sps.picHeightInLumaSamples;
    this.cw = this.w >> 1;
    this.ch = this.h >> 1;
    this.log2Ctb = sps.log2CtbSize;
    this.ctbSize = 1 << sps.log2CtbSize;
    this.widthInCtbs = Math.ceil(this.w / this.ctbSize);
    this.heightInCtbs = Math.ceil(this.h / this.ctbSize);
    this.y = new Uint8Array(this.w * this.h);
    this.cb = new Uint8Array(this.cw * this.ch);
    this.cr = new Uint8Array(this.cw * this.ch);
    this.bwY = this.w >> 2;
    this.bhY = this.h >> 2;
    this.bwC = this.cw >> 2;
    this.decodedY = new Uint8Array(this.bwY * this.bhY);
    this.decodedC = new Uint8Array(this.bwC * (this.ch >> 2));
    this.intraModeMap = new Uint8Array(this.bwY * this.bhY).fill(1);
    this.ctDepthMap = new Int8Array(this.bwY * this.bhY).fill(-1);
    this.qpMap = new Uint8Array((this.w >> 3) * (this.h >> 3));
    this.tuEdgesY = new Uint8Array(this.bwY * this.bhY);
    this.tuEdgesC = new Uint8Array(this.bwC * (this.ch >> 2));
    const data = pps.scalingListData ?? sps.scalingListData;
    this.scalingFactors = [];
    for (let sizeId = 0;sizeId < 4; sizeId++) {
      this.scalingFactors[sizeId] = [];
      for (let matrixId = 0;matrixId < 3; matrixId++)
        this.scalingFactors[sizeId][matrixId] = data ? buildScalingFactors(data, sizeId, matrixId) : null;
    }
    this.sao = Array.from({ length: this.widthInCtbs * this.heightInCtbs }, () => ({
      typeIdx: new Int32Array(3),
      offsets: new Int32Array(12),
      bandPos: new Int32Array(3),
      eoClass: new Int32Array(3)
    }));
  }
  decode(sliceNals) {
    for (const nal of sliceNals) {
      const sh = parseSliceHeader(nal, this.sps, this.pps);
      if (sh.sliceType !== SLICE_TYPE_I)
        throw new Error("ts-heic: non-intra slice in still image");
      this.decodeSlice(sh);
    }
    return {
      y: this.y,
      cb: this.cb,
      cr: this.cr,
      width: this.w,
      height: this.h,
      sao: this.sao,
      qpMap: this.qpMap,
      tuEdgesY: this.tuEdgesY,
      tuEdgesC: this.tuEdgesC,
      sh: this.sh
    };
  }
  decodeSlice(sh) {
    this.sh = sh;
    const totalCtbs = this.widthInCtbs * this.heightInCtbs;
    let substreamIdx = 0;
    this.ctxs.init(sh.sliceQpY);
    this.cabac = new CabacDecoder(sh.substreams[substreamIdx++], this.ctxs);
    this.lastQpY = sh.sliceQpY;
    this.rowSnapshot = null;
    for (let ctbAddr = sh.segmentAddress;ctbAddr < totalCtbs; ctbAddr++) {
      this.ctbX = ctbAddr % this.widthInCtbs;
      this.ctbY = ctbAddr / this.widthInCtbs | 0;
      if (this.pps.entropyCodingSyncEnabled && this.ctbX === 0 && ctbAddr !== sh.segmentAddress) {
        this.cabac = new CabacDecoder(sh.substreams[substreamIdx++], this.ctxs);
        if (this.rowSnapshot && this.widthInCtbs > 1)
          this.ctxs.restore(this.rowSnapshot);
        else
          this.ctxs.init(sh.sliceQpY);
        this.lastQpY = sh.sliceQpY;
      }
      if (this.sps.sampleAdaptiveOffsetEnabled && (sh.saoLuma || sh.saoChroma))
        this.parseSao();
      this.codingQuadtree(this.ctbX << this.log2Ctb, this.ctbY << this.log2Ctb, this.log2Ctb, 0);
      if (this.pps.entropyCodingSyncEnabled && this.ctbX === 1)
        this.rowSnapshot = this.ctxs.save();
      const end = this.cabac.decodeTerminate();
      if (ctbAddr === totalCtbs - 1) {
        if (end !== 1)
          throw new Error(`ts-heic: CABAC desync \u2014 end_of_slice_segment_flag not set at the last CTU (${this.ctbX},${this.ctbY})`);
      } else if (end === 1) {
        return;
      } else if (this.pps.entropyCodingSyncEnabled && this.ctbX === this.widthInCtbs - 1) {
        if (this.cabac.decodeTerminate() !== 1)
          throw new Error(`ts-heic: CABAC desync \u2014 end_of_subset_one_bit missing at row ${this.ctbY}`);
      }
    }
  }
  parseSao() {
    const idx = this.ctbY * this.widthInCtbs + this.ctbX;
    const params = this.sao[idx];
    const { sh } = this;
    let merged = false;
    if (this.ctbX > 0) {
      const left = this.cabac.decodeBin(CTX.SAO_MERGE);
      if (left === 1) {
        this.copySao(this.sao[idx - 1], params);
        merged = true;
      }
    }
    if (!merged && this.ctbY > 0) {
      const up = this.cabac.decodeBin(CTX.SAO_MERGE);
      if (up === 1) {
        this.copySao(this.sao[idx - this.widthInCtbs], params);
        merged = true;
      }
    }
    if (merged)
      return;
    for (let cIdx = 0;cIdx < 3; cIdx++) {
      if (cIdx === 0 && !sh.saoLuma || cIdx > 0 && !sh.saoChroma)
        continue;
      if (cIdx === 2) {
        params.typeIdx[2] = params.typeIdx[1];
        params.eoClass[2] = params.eoClass[1];
      } else {
        let type = 0;
        if (this.cabac.decodeBin(CTX.SAO_TYPE_IDX) === 1)
          type = this.cabac.decodeBypass() === 1 ? 2 : 1;
        params.typeIdx[cIdx] = type;
      }
      const type = params.typeIdx[cIdx];
      if (type === 0)
        continue;
      const offsets = [0, 0, 0, 0];
      for (let i = 0;i < 4; i++) {
        let v = 0;
        while (v < 7 && this.cabac.decodeBypass() === 1)
          v++;
        offsets[i] = v;
      }
      if (type === 1) {
        for (let i = 0;i < 4; i++) {
          if (offsets[i] !== 0 && this.cabac.decodeBypass() === 1)
            offsets[i] = -offsets[i];
        }
        params.bandPos[cIdx] = this.cabac.decodeBypassBits(5);
      } else {
        offsets[2] = -offsets[2];
        offsets[3] = -offsets[3];
        if (cIdx < 2)
          params.eoClass[cIdx] = this.cabac.decodeBypassBits(2);
      }
      for (let i = 0;i < 4; i++)
        params.offsets[cIdx * 4 + i] = offsets[i];
    }
  }
  copySao(from, to) {
    to.typeIdx.set(from.typeIdx);
    to.offsets.set(from.offsets);
    to.bandPos.set(from.bandPos);
    to.eoClass.set(from.eoClass);
  }
  codingQuadtree(x0, y0, log2CbSize, ctDepth) {
    const size = 1 << log2CbSize;
    const inside = x0 + size <= this.w && y0 + size <= this.h;
    let split;
    if (inside && log2CbSize > this.sps.log2MinLumaCodingBlockSize) {
      const condL = x0 > 0 && this.ctDepthAt(x0 - 1, y0) > ctDepth ? 1 : 0;
      const condA = y0 > 0 && this.ctDepthAt(x0, y0 - 1) > ctDepth ? 1 : 0;
      split = this.cabac.decodeBin(CTX.SPLIT_CU + condL + condA) === 1;
    } else {
      split = log2CbSize > this.sps.log2MinLumaCodingBlockSize;
    }
    if (this.pps.cuQpDeltaEnabled && log2CbSize >= this.log2Ctb - this.pps.diffCuQpDeltaDepth) {
      this.isCuQpDeltaCoded = false;
      this.cuQpDeltaVal = 0;
      this.qgX = x0;
      this.qgY = y0;
      this.qgPredPending = true;
    }
    if (split) {
      const half = size >> 1;
      this.recurseChild(x0, y0, log2CbSize - 1, ctDepth + 1);
      this.recurseChild(x0 + half, y0, log2CbSize - 1, ctDepth + 1);
      this.recurseChild(x0, y0 + half, log2CbSize - 1, ctDepth + 1);
      this.recurseChild(x0 + half, y0 + half, log2CbSize - 1, ctDepth + 1);
    } else {
      this.codingUnit(x0, y0, log2CbSize, ctDepth);
    }
  }
  recurseChild(x, y, log2, depth) {
    if (x < this.w && y < this.h)
      this.codingQuadtree(x, y, log2, depth);
  }
  ctDepthAt(x, y) {
    return this.ctDepthMap[(y >> 2) * this.bwY + (x >> 2)];
  }
  codingUnit(x0, y0, log2CbSize, ctDepth) {
    const size = 1 << log2CbSize;
    if (this.pps.transquantBypassEnabled && this.cabac.decodeBin(CTX.TQ_BYPASS) === 1)
      throw new Error("ts-heic: cu_transquant_bypass is not supported");
    let partNxN = false;
    if (log2CbSize === this.sps.log2MinLumaCodingBlockSize) {
      partNxN = this.cabac.decodeBin(CTX.PART_MODE) === 0;
    }
    if (this.pps.cuQpDeltaEnabled) {
      if (this.qgPredPending) {
        this.qpYPred = this.predictQp();
        this.qgPredPending = false;
      }
      this.cuQp = (this.qpYPred + this.cuQpDeltaVal + 52) % 52;
    } else {
      this.cuQp = this.sh.sliceQpY;
    }
    const nPu = partNxN ? 2 : 1;
    const pbSize = size >> (partNxN ? 1 : 0);
    const prevFlags = [];
    const mpmIdx = [];
    const remMode = [];
    for (let i = 0;i < nPu * nPu; i++) {
      const f = this.cabac.decodeBin(CTX.PREV_INTRA_LUMA_PRED);
      prevFlags.push(f === 1);
    }
    for (let i = 0;i < nPu * nPu; i++) {
      if (prevFlags[i]) {
        let v = 0;
        if (this.cabac.decodeBypass() === 1) {
          v = 1;
          if (this.cabac.decodeBypass() === 1)
            v = 2;
        }
        mpmIdx.push(v);
        remMode.push(0);
      } else {
        mpmIdx.push(-1);
        const rem = this.cabac.decodeBypassBits(5);
        remMode.push(rem);
      }
    }
    const puModes = [];
    for (let i = 0;i < nPu * nPu; i++) {
      const xPb = x0 + i % nPu * pbSize;
      const yPb = y0 + (i / nPu | 0) * pbSize;
      const cand = this.mpmCandidates(xPb, yPb);
      let mode;
      if (prevFlags[i]) {
        mode = cand[mpmIdx[i]];
      } else {
        cand.sort((a, b) => a - b);
        mode = remMode[i];
        for (const c of cand) {
          if (mode >= c)
            mode++;
        }
      }
      puModes.push(mode);
      this.setIntraModes(xPb, yPb, pbSize, mode);
    }
    const lumaMode0 = puModes[0];
    if (this.cabac.decodeBin(CTX.INTRA_CHROMA_PRED_MODE) === 0) {
      this.cuChromaMode = lumaMode0;
    } else {
      const idx = this.cabac.decodeBypassBits(2);
      const list = [0, 26, 10, 1];
      const chosen = list[idx];
      this.cuChromaMode = chosen === lumaMode0 ? 34 : chosen;
    }
    const maxTrafoDepth = this.sps.maxTransformHierarchyDepthIntra + (partNxN ? 1 : 0);
    this.transformTree(x0, y0, x0, y0, log2CbSize, 0, 0, partNxN, maxTrafoDepth, puModes, true, true);
    this.setCtDepth(x0, y0, size, ctDepth);
    const qw = this.w >> 3;
    for (let by = y0 >> 3;by < y0 + size >> 3; by++) {
      for (let bx = x0 >> 3;bx < x0 + size >> 3; bx++)
        this.qpMap[by * qw + bx] = this.cuQp;
    }
    this.lastQpY = this.cuQp;
  }
  predictQp() {
    const qw = this.w >> 3;
    const inCtbX = (x) => x >> this.log2Ctb === this.ctbX;
    const inCtbY = (y) => y >> this.log2Ctb === this.ctbY;
    const availA = this.qgX > 0 && inCtbX(this.qgX - 1) && inCtbY(this.qgY);
    const qpA = availA ? this.qpMap[(this.qgY >> 3) * qw + (this.qgX - 1 >> 3)] : this.lastQpY;
    const availB = this.qgY > 0 && inCtbY(this.qgY - 1) && inCtbX(this.qgX);
    const qpB = availB ? this.qpMap[(this.qgY - 1 >> 3) * qw + (this.qgX >> 3)] : this.lastQpY;
    return qpA + qpB + 1 >> 1;
  }
  mpmCandidates(xPb, yPb) {
    const candA = xPb > 0 ? this.intraModeAt(xPb - 1, yPb) : 1;
    const candB = yPb > 0 && yPb - 1 >> this.log2Ctb === this.ctbY ? this.intraModeAt(xPb, yPb - 1) : 1;
    if (candA === candB) {
      if (candA < 2)
        return [0, 1, 26];
      return [candA, 2 + (candA + 29) % 32, 2 + (candA - 2 + 1) % 32];
    }
    const third = candA !== 0 && candB !== 0 ? 0 : candA !== 1 && candB !== 1 ? 1 : 26;
    return [candA, candB, third];
  }
  intraModeAt(x, y) {
    return this.intraModeMap[(y >> 2) * this.bwY + (x >> 2)];
  }
  setIntraModes(x, y, size, mode) {
    for (let by = y >> 2;by < y + size >> 2; by++)
      this.intraModeMap.fill(mode, by * this.bwY + (x >> 2), by * this.bwY + (x + size >> 2));
  }
  setCtDepth(x, y, size, depth) {
    for (let by = y >> 2;by < y + size >> 2; by++)
      this.ctDepthMap.fill(depth, by * this.bwY + (x >> 2), by * this.bwY + (x + size >> 2));
  }
  transformTree(x0, y0, xBase, yBase, log2Size, trafoDepth, blkIdx, intraSplit, maxTrafoDepth, puModes, parentCbfCb, parentCbfCr) {
    let split;
    const forcedSplit = intraSplit && trafoDepth === 0 || log2Size > this.sps.log2MaxTransformBlockSize;
    if (forcedSplit) {
      split = true;
    } else if (log2Size <= this.sps.log2MaxTransformBlockSize && log2Size > this.sps.log2MinTransformBlockSize && trafoDepth < maxTrafoDepth) {
      split = this.cabac.decodeBin(CTX.SPLIT_TRANSFORM + (5 - log2Size)) === 1;
    } else {
      split = false;
    }
    let cbfCb = parentCbfCb;
    let cbfCr = parentCbfCr;
    if (log2Size > 2) {
      if (trafoDepth === 0 || parentCbfCb) {
        cbfCb = this.cabac.decodeBin(CTX.CBF_CHROMA + trafoDepth) === 1;
      } else {
        cbfCb = false;
      }
      if (trafoDepth === 0 || parentCbfCr) {
        cbfCr = this.cabac.decodeBin(CTX.CBF_CHROMA + trafoDepth) === 1;
      } else {
        cbfCr = false;
      }
    }
    if (split) {
      const half = 1 << log2Size - 1;
      this.transformTree(x0, y0, x0, y0, log2Size - 1, trafoDepth + 1, 0, intraSplit, maxTrafoDepth, puModes, cbfCb, cbfCr);
      this.transformTree(x0 + half, y0, x0, y0, log2Size - 1, trafoDepth + 1, 1, intraSplit, maxTrafoDepth, puModes, cbfCb, cbfCr);
      this.transformTree(x0, y0 + half, x0, y0, log2Size - 1, trafoDepth + 1, 2, intraSplit, maxTrafoDepth, puModes, cbfCb, cbfCr);
      this.transformTree(x0 + half, y0 + half, x0, y0, log2Size - 1, trafoDepth + 1, 3, intraSplit, maxTrafoDepth, puModes, cbfCb, cbfCr);
      return;
    }
    const cbfLuma = this.cabac.decodeBin(CTX.CBF_LUMA + (trafoDepth === 0 ? 1 : 0)) === 1;
    this.transformUnit(x0, y0, xBase, yBase, log2Size, blkIdx, cbfLuma, cbfCb, cbfCr, puModes);
  }
  transformUnit(x0, y0, xBase, yBase, log2Size, blkIdx, cbfLuma, cbfCb, cbfCr, puModes) {
    const chromaHere = log2Size > 2 || blkIdx === 3;
    const cbfChroma = cbfCb || cbfCr;
    if ((cbfLuma || cbfChroma) && this.pps.cuQpDeltaEnabled && !this.isCuQpDeltaCoded) {
      this.decodeCuQpDelta();
      this.cuQp = (this.qpYPred + this.cuQpDeltaVal + 52) % 52;
    }
    const lumaMode = this.intraModeAt(x0, y0);
    let lumaLevels = null;
    if (cbfLuma)
      lumaLevels = this.residualCoding(x0, y0, log2Size, 0, lumaMode);
    this.reconstruct(this.y, this.w, this.decodedY, this.bwY, this.tuEdgesY, x0, y0, 1 << log2Size, lumaMode, 0, lumaLevels, this.cuQp);
    if (!chromaHere)
      return;
    const log2C = Math.max(2, log2Size - 1);
    const xC = (log2Size === 2 ? xBase : x0) >> 1;
    const yC = (log2Size === 2 ? yBase : y0) >> 1;
    const sizeC = 1 << log2C;
    const qpCb = mapChromaQp(this.cuQp, this.sh.cbQpOffset);
    const qpCr = mapChromaQp(this.cuQp, this.sh.crQpOffset);
    let cbLevels = null;
    let crLevels = null;
    if (cbfCb)
      cbLevels = this.residualCoding(xC * 2, yC * 2, log2C, 1, this.cuChromaMode);
    if (cbfCr)
      crLevels = this.residualCoding(xC * 2, yC * 2, log2C, 2, this.cuChromaMode);
    this.reconstruct(this.cb, this.cw, this.decodedC, this.bwC, this.tuEdgesC, xC, yC, sizeC, this.cuChromaMode, 1, cbLevels, qpCb);
    this.reconstruct(this.cr, this.cw, this.decodedC, this.bwC, this.tuEdgesC, xC, yC, sizeC, this.cuChromaMode, 2, crLevels, qpCr);
  }
  decodeCuQpDelta() {
    let prefix = 0;
    if (this.cabac.decodeBin(CTX.CU_QP_DELTA) === 1) {
      prefix = 1;
      while (prefix < 5 && this.cabac.decodeBin(CTX.CU_QP_DELTA + 1) === 1)
        prefix++;
    }
    let abs = prefix;
    if (prefix === 5) {
      let k = 0;
      let value = 0;
      while (this.cabac.decodeBypass() === 1) {
        value += 1 << k;
        k++;
      }
      abs = 5 + value + this.cabac.decodeBypassBits(k);
    }
    if (abs > 0 && this.cabac.decodeBypass() === 1)
      abs = -abs;
    this.cuQpDeltaVal = abs;
    this.isCuQpDeltaCoded = true;
  }
  reconstruct(plane, stride, decodedMap, blockStride, edgeMap, x, y, size, mode, cIdx, levels, qp) {
    const planeH = cIdx === 0 ? this.h : this.ch;
    const available = (px, py) => px >= 0 && py >= 0 && px < stride && py < planeH && decodedMap[(py >> 2) * blockStride + (px >> 2)] === 1;
    const refs = gatherRefs(plane, stride, x, y, size, this.bd, available);
    filterRefs(refs, size, mode, cIdx, this.bd, this.sps.strongIntraSmoothingEnabled);
    const pred = predictIntra(refs, size, mode, cIdx, this.bd);
    let residual = null;
    if (levels) {
      const sizeId = 31 - Math.clz32(size) - 2;
      const factors = this.scalingFactors[sizeId][cIdx];
      const deq = dequantize(levels, size, qp, this.bd, factors);
      residual = inverseTransform(deq, size, this.bd, cIdx === 0 && size === 4);
    }
    for (let dy = 0;dy < size; dy++) {
      const row = (y + dy) * stride + x;
      for (let dx = 0;dx < size; dx++) {
        let v = pred[dy * size + dx];
        if (residual)
          v += residual[dy * size + dx];
        plane[row + dx] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    for (let by = y >> 2;by < y + size >> 2; by++)
      decodedMap.fill(1, by * blockStride + (x >> 2), by * blockStride + (x + size >> 2));
    for (let by = y >> 2;by < y + size >> 2; by++)
      edgeMap[by * blockStride + (x >> 2)] |= 1;
    for (let bx = x >> 2;bx < x + size >> 2; bx++)
      edgeMap[(y >> 2) * blockStride + bx] |= 2;
  }
  residualCoding(x0, y0, log2Size, cIdx, predMode) {
    const size = 1 << log2Size;
    const levels = new Int32Array(size * size);
    const cabac = this.cabac;
    let scanIdx = SCAN_DIAG;
    if (log2Size === 2 || log2Size === 3 && cIdx === 0) {
      if (predMode >= 6 && predMode <= 14)
        scanIdx = 2;
      else if (predMode >= 22 && predMode <= 30)
        scanIdx = 1;
    }
    let lastX = this.decodeLastPrefix(log2Size, cIdx, CTX.LAST_SIG_X);
    let lastY = this.decodeLastPrefix(log2Size, cIdx, CTX.LAST_SIG_Y);
    if (lastX > 3) {
      const bits = (lastX >> 1) - 1;
      lastX = (2 + (lastX & 1) << bits) + cabac.decodeBypassBits(bits);
    }
    if (lastY > 3) {
      const bits = (lastY >> 1) - 1;
      lastY = (2 + (lastY & 1) << bits) + cabac.decodeBypassBits(bits);
    }
    if (scanIdx === 2) {
      const t = lastX;
      lastX = lastY;
      lastY = t;
    }
    const numSb = size >> 2;
    const sbScan = getScan(scanIdx, numSb);
    const posScan = getScan(scanIdx, 4);
    const lastSbRaster = (lastY >> 2) * numSb + (lastX >> 2);
    const lastPosRaster = ((lastY & 3) << 2) + (lastX & 3);
    let lastSbIdx = -1;
    for (let i = 0;i < numSb * numSb; i++) {
      if (sbScan[i] === lastSbRaster) {
        lastSbIdx = i;
        break;
      }
    }
    let lastPosIdx = -1;
    for (let nIdx = 0;nIdx < 16; nIdx++) {
      if (posScan[nIdx] === lastPosRaster) {
        lastPosIdx = nIdx;
        break;
      }
    }
    const csbf = new Uint8Array(numSb * numSb);
    let prevSubsetG1 = false;
    let firstSubset = true;
    for (let i = lastSbIdx;i >= 0; i--) {
      const sbRaster = sbScan[i];
      const xS = sbRaster % numSb;
      const yS = sbRaster / numSb | 0;
      const csbfRight = xS + 1 < numSb ? csbf[sbRaster + 1] : 0;
      const csbfBelow = yS + 1 < numSb ? csbf[sbRaster + numSb] : 0;
      let inferSbDcSig = false;
      if (i < lastSbIdx && i > 0) {
        const ctxInc = Math.min(1, csbfRight + csbfBelow) + (cIdx > 0 ? 2 : 0);
        const csbfBit = cabac.decodeBin(CTX.CODED_SUB_BLOCK + ctxInc);
        if (csbfBit === 0)
          continue;
        csbf[sbRaster] = 1;
        inferSbDcSig = true;
      } else {
        csbf[sbRaster] = 1;
      }
      const sigPos = [];
      if (i === lastSbIdx)
        sigPos.push(lastPosIdx);
      const startN = i === lastSbIdx ? lastPosIdx - 1 : 15;
      for (let pos = startN;pos >= 0; pos--) {
        if (pos > 0 || !inferSbDcSig) {
          const raster = posScan[pos];
          const xP = raster & 3;
          const yP = raster >> 2;
          const ctxInc = this.sigCtxInc(log2Size, cIdx, xS * 4 + xP, yS * 4 + yP, xP, yP, scanIdx, csbfRight, csbfBelow, xS, yS);
          const sigBit = cabac.decodeBin(CTX.SIG_COEFF + ctxInc);
          if (sigBit === 1) {
            sigPos.push(pos);
            inferSbDcSig = false;
          }
        } else {
          sigPos.push(pos);
        }
      }
      if (sigPos.length === 0)
        continue;
      let ctxSet = i === 0 || cIdx > 0 ? 0 : 2;
      if (!firstSubset && prevSubsetG1)
        ctxSet++;
      firstSubset = false;
      let g1Ctx = 1;
      let firstG1 = -1;
      const g1 = [];
      for (let c = 0;c < sigPos.length; c++) {
        if (c < 8) {
          const ctxInc = ctxSet * 4 + Math.min(3, g1Ctx) + (cIdx > 0 ? 16 : 0);
          const flag = cabac.decodeBin(CTX.GREATER1 + ctxInc);
          g1.push(flag);
          if (flag === 1) {
            if (firstG1 < 0)
              firstG1 = c;
            g1Ctx = 0;
          } else if (g1Ctx > 0) {
            g1Ctx++;
          }
        } else {
          g1.push(0);
        }
      }
      prevSubsetG1 = firstG1 >= 0;
      let g2 = 0;
      if (firstG1 >= 0) {
        g2 = cabac.decodeBin(CTX.GREATER2 + ctxSet + (cIdx > 0 ? 4 : 0));
      }
      const lastN = sigPos[0];
      const firstN = sigPos[sigPos.length - 1];
      const signHidden = this.pps.signDataHidingEnabled && lastN - firstN > 3;
      const signs = [];
      for (let c = 0;c < sigPos.length; c++) {
        if (signHidden && sigPos[c] === firstN)
          signs.push(0);
        else
          signs.push(cabac.decodeBypass());
      }
      let cRice = 0;
      let sumAbs = 0;
      const absLevels = [];
      for (let c = 0;c < sigPos.length; c++) {
        const base = 1 + (c < 8 ? g1[c] : 0) + (c === firstG1 ? g2 : 0);
        const threshold = c < 8 ? c === firstG1 ? 3 : 2 : 1;
        let level = base;
        if (base === threshold) {
          const rem = this.decodeRemaining(cRice);
          level += rem;
          if (level > 3 * (1 << cRice))
            cRice = Math.min(cRice + 1, 4);
        }
        sumAbs += level;
        absLevels.push(level);
      }
      for (let c = 0;c < sigPos.length; c++) {
        const pos = sigPos[c];
        const raster = posScan[pos];
        const xC = xS * 4 + (raster & 3);
        const yC = yS * 4 + (raster >> 2);
        let negative = signs[c] === 1;
        if (signHidden && pos === firstN)
          negative = (sumAbs & 1) === 1;
        levels[yC * size + xC] = negative ? -absLevels[c] : absLevels[c];
      }
    }
    return levels;
  }
  decodeLastPrefix(log2Size, cIdx, base) {
    const cMax = (log2Size << 1) - 1;
    const offset = cIdx === 0 ? 3 * (log2Size - 2) + (log2Size - 1 >> 2) : 15;
    const shift = cIdx === 0 ? log2Size + 1 >> 2 : log2Size - 2;
    let i = 0;
    while (i < cMax && this.cabac.decodeBin(base + offset + (i >> shift)) === 1)
      i++;
    return i;
  }
  sigCtxInc(log2Size, cIdx, xC, yC, xP, yP, scanIdx, csbfRight, csbfBelow, xS, yS) {
    const chromaOffset = cIdx > 0 ? 27 : 0;
    if (log2Size === 2)
      return CTX_IDX_MAP_4X4[(yC << 2) + xC] + chromaOffset;
    if (xC + yC === 0)
      return chromaOffset;
    const prevCsbf = csbfRight + 2 * csbfBelow;
    let sigCtx;
    if (prevCsbf === 0)
      sigCtx = xP + yP === 0 ? 2 : xP + yP < 3 ? 1 : 0;
    else if (prevCsbf === 1)
      sigCtx = yP === 0 ? 2 : yP === 1 ? 1 : 0;
    else if (prevCsbf === 2)
      sigCtx = xP === 0 ? 2 : xP === 1 ? 1 : 0;
    else
      sigCtx = 2;
    if (cIdx === 0 && (xS > 0 || yS > 0))
      sigCtx += 3;
    if (log2Size === 3)
      sigCtx += scanIdx === SCAN_DIAG ? 9 : 15;
    else
      sigCtx += cIdx === 0 ? 21 : 12;
    return sigCtx + chromaOffset;
  }
  decodeRemaining(cRice) {
    let prefix = 0;
    while (prefix < 32 && this.cabac.decodeBypass() === 1)
      prefix++;
    if (prefix <= 3)
      return (prefix << cRice) + this.cabac.decodeBypassBits(cRice);
    return ((1 << prefix - 3) + 2 << cRice) + this.cabac.decodeBypassBits(prefix - 3 + cRice);
  }
}

// src/hevc/pps.ts
function parsePps(nal) {
  const r = new BitReader(toRbsp(nal));
  const ppsId = r.ue();
  const spsId = r.ue();
  const dependentSliceSegmentsEnabled = r.readBit() === 1;
  const outputFlagPresent = r.readBit() === 1;
  const numExtraSliceHeaderBits = r.readBits(3);
  const signDataHidingEnabled = r.readBit() === 1;
  const cabacInitPresent = r.readBit() === 1;
  r.ue();
  r.ue();
  const initQp = 26 + r.se();
  const constrainedIntraPred = r.readBit() === 1;
  const transformSkipEnabled = r.readBit() === 1;
  const cuQpDeltaEnabled = r.readBit() === 1;
  const diffCuQpDeltaDepth = cuQpDeltaEnabled ? r.ue() : 0;
  const cbQpOffset = r.se();
  const crQpOffset = r.se();
  const sliceChromaQpOffsetsPresent = r.readBit() === 1;
  r.readBit();
  r.readBit();
  const transquantBypassEnabled = r.readBit() === 1;
  const tilesEnabled = r.readBit() === 1;
  const entropyCodingSyncEnabled = r.readBit() === 1;
  let numTileColumns = 1;
  let numTileRows = 1;
  let uniformSpacing = true;
  const tileColumnWidths = [];
  const tileRowHeights = [];
  let loopFilterAcrossTilesEnabled = true;
  if (tilesEnabled) {
    numTileColumns = r.ue() + 1;
    numTileRows = r.ue() + 1;
    uniformSpacing = r.readBit() === 1;
    if (!uniformSpacing) {
      for (let i = 0;i < numTileColumns - 1; i++)
        tileColumnWidths.push(r.ue() + 1);
      for (let i = 0;i < numTileRows - 1; i++)
        tileRowHeights.push(r.ue() + 1);
    }
    loopFilterAcrossTilesEnabled = r.readBit() === 1;
  }
  const loopFilterAcrossSlicesEnabled = r.readBit() === 1;
  const deblockingFilterControlPresent = r.readBit() === 1;
  let deblockingFilterOverrideEnabled = false;
  let deblockingFilterDisabled = false;
  let betaOffsetDiv2 = 0;
  let tcOffsetDiv2 = 0;
  if (deblockingFilterControlPresent) {
    deblockingFilterOverrideEnabled = r.readBit() === 1;
    deblockingFilterDisabled = r.readBit() === 1;
    if (!deblockingFilterDisabled) {
      betaOffsetDiv2 = r.se();
      tcOffsetDiv2 = r.se();
    }
  }
  const scalingListDataPresent = r.readBit() === 1;
  const scalingListData = scalingListDataPresent ? parseScalingListData(r) : null;
  const listsModificationPresent = r.readBit() === 1;
  const log2ParallelMergeLevel = r.ue() + 2;
  const sliceSegmentHeaderExtensionPresent = r.readBit() === 1;
  return {
    ppsId,
    spsId,
    dependentSliceSegmentsEnabled,
    outputFlagPresent,
    numExtraSliceHeaderBits,
    signDataHidingEnabled,
    cabacInitPresent,
    initQp,
    constrainedIntraPred,
    transformSkipEnabled,
    cuQpDeltaEnabled,
    diffCuQpDeltaDepth,
    cbQpOffset,
    crQpOffset,
    sliceChromaQpOffsetsPresent,
    transquantBypassEnabled,
    tilesEnabled,
    entropyCodingSyncEnabled,
    numTileColumns,
    numTileRows,
    uniformSpacing,
    tileColumnWidths,
    tileRowHeights,
    loopFilterAcrossTilesEnabled,
    loopFilterAcrossSlicesEnabled,
    deblockingFilterControlPresent,
    deblockingFilterOverrideEnabled,
    deblockingFilterDisabled,
    betaOffsetDiv2,
    tcOffsetDiv2,
    scalingListDataPresent,
    scalingListData,
    listsModificationPresent,
    log2ParallelMergeLevel,
    sliceSegmentHeaderExtensionPresent
  };
}

// src/hevc/sao.ts
function sign(v) {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
var EO_CLASS = [
  { h: [-1, 1], v: [0, 0] },
  { h: [0, 0], v: [-1, 1] },
  { h: [-1, 1], v: [-1, 1] },
  { h: [1, -1], v: [-1, 1] }
];
function applyPlane(src, dst, width, height, ctbW, ctbH, widthInCtbs, heightInCtbs, sao, cIdx, bitDepth) {
  const maxVal = (1 << bitDepth) - 1;
  const clip = (v) => v < 0 ? 0 : v > maxVal ? maxVal : v;
  const bandShift = bitDepth - 5;
  for (let cbY = 0;cbY < heightInCtbs; cbY++) {
    for (let cbX = 0;cbX < widthInCtbs; cbX++) {
      const params = sao[cbY * widthInCtbs + cbX];
      const type = params.typeIdx[cIdx];
      if (type === 0)
        continue;
      const xC = cbX * ctbW;
      const yC = cbY * ctbH;
      const w = Math.min(ctbW, width - xC);
      const h = Math.min(ctbH, height - yC);
      const off = params.offsets.subarray(cIdx * 4, cIdx * 4 + 4);
      if (type === 2) {
        const cls = EO_CLASS[params.eoClass[cIdx]];
        const table = [off[0], off[1], 0, off[2], off[3]];
        for (let j = 0;j < h; j++) {
          for (let i = 0;i < w; i++) {
            const x = xC + i;
            const y = yC + j;
            const x0 = x + cls.h[0];
            const y0 = y + cls.v[0];
            const x1 = x + cls.h[1];
            const y1 = y + cls.v[1];
            if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height || x1 < 0 || y1 < 0 || x1 >= width || y1 >= height)
              continue;
            const cur = src[y * width + x];
            const edgeIdx = sign(cur - src[y0 * width + x0]) + sign(cur - src[y1 * width + x1]);
            dst[y * width + x] = clip(cur + table[edgeIdx + 2]);
          }
        }
      } else {
        const leftClass = params.bandPos[cIdx];
        const bandTable = new Int32Array(32);
        for (let k = 0;k < 4; k++)
          bandTable[k + leftClass & 31] = k + 1;
        for (let j = 0;j < h; j++) {
          for (let i = 0;i < w; i++) {
            const idx = (yC + j) * width + (xC + i);
            const bandIdx = bandTable[src[idx] >> bandShift];
            if (bandIdx > 0)
              dst[idx] = clip(src[idx] + off[bandIdx - 1]);
          }
        }
      }
    }
  }
}
function applySao(pic, sps, bitDepth = 8) {
  if (!sps.sampleAdaptiveOffsetEnabled)
    return;
  if (!pic.sh.saoLuma && !pic.sh.saoChroma)
    return;
  const ctbSize = 1 << sps.log2CtbSize;
  const widthInCtbs = Math.ceil(pic.width / ctbSize);
  const heightInCtbs = Math.ceil(pic.height / ctbSize);
  const cw = pic.width >> 1;
  const ch = pic.height >> 1;
  if (pic.sh.saoLuma) {
    const srcY = pic.y.slice();
    applyPlane(srcY, pic.y, pic.width, pic.height, ctbSize, ctbSize, widthInCtbs, heightInCtbs, pic.sao, 0, bitDepth);
  }
  if (pic.sh.saoChroma) {
    const srcCb = pic.cb.slice();
    const srcCr = pic.cr.slice();
    const cSize = ctbSize >> 1;
    applyPlane(srcCb, pic.cb, cw, ch, cSize, cSize, widthInCtbs, heightInCtbs, pic.sao, 1, bitDepth);
    applyPlane(srcCr, pic.cr, cw, ch, cSize, cSize, widthInCtbs, heightInCtbs, pic.sao, 2, bitDepth);
  }
}

// src/decoder.ts
function isHeic(buffer) {
  const ftyp = getFtypInfo(buffer);
  if (!ftyp)
    return false;
  const brands = [ftyp.majorBrand, ...ftyp.compatibleBrands];
  return brands.some((brand) => ["heic", "heix", "hevc", "hevx"].includes(brand));
}
function getHeicMetadata(buffer) {
  if (!isHeic(buffer))
    throw new Error("ts-heic: not a HEIC file (ftyp brand mismatch)");
  const boxes = parseISOBMFF(buffer);
  const info = getHeicInfo(buffer, boxes);
  let sps = null;
  let sliceNalCount = 0;
  if (info.hvcC) {
    if (info.hvcC.sps.length > 0)
      sps = parseSps(info.hvcC.sps[0]);
    const codedItemId = info.grid ? info.grid.tileItemIds[0] : info.primaryItemId;
    const payload = getItemPayload(buffer, boxes, codedItemId);
    if (payload) {
      const nals = splitLengthPrefixed(payload, info.hvcC.nalLengthSize);
      sliceNalCount = nals.filter((n) => isSliceNal(n.type)).length;
    }
  }
  return { ...info, sps, sliceNalCount };
}
function decodeItemPlanes(buffer, boxes, info, itemId) {
  const payload = getItemPayload(buffer, boxes, itemId);
  if (!payload)
    throw new Error(`ts-heic: item ${itemId} has no payload`);
  const nals = splitLengthPrefixed(payload, info.hvcC.nalLengthSize);
  const slices = nals.filter((n) => isSliceNal(n.type)).map((n) => n.data);
  if (slices.length === 0)
    throw new Error(`ts-heic: item ${itemId} carries no coded slices`);
  const sps = parseSps(info.hvcC.sps[0]);
  const pps = parsePps(info.hvcC.pps[0]);
  const pic = new PictureDecoder(sps, pps).decode(slices);
  deblockPicture(pic, pps);
  applySao(pic, sps);
  return { y: pic.y, cb: pic.cb, cr: pic.cr, width: pic.width, height: pic.height };
}
function stitchGrid(buffer, boxes, info, grid) {
  const tileW = grid.tileWidth;
  const tileH = grid.tileHeight;
  const canvasW = grid.columns * tileW;
  const canvasH = grid.rows * tileH;
  const y = new Uint8Array(canvasW * canvasH);
  const cb = new Uint8Array((canvasW >> 1) * (canvasH >> 1));
  const cr = new Uint8Array((canvasW >> 1) * (canvasH >> 1));
  for (let t = 0;t < grid.tileItemIds.length; t++) {
    const tile = decodeItemPlanes(buffer, boxes, info, grid.tileItemIds[t]);
    if (tile.width !== tileW || tile.height !== tileH)
      throw new Error(`ts-heic: tile ${t} is ${tile.width}x${tile.height}, expected ${tileW}x${tileH}`);
    const tx = t % grid.columns * tileW;
    const ty = Math.floor(t / grid.columns) * tileH;
    for (let row = 0;row < tileH; row++)
      y.set(tile.y.subarray(row * tileW, (row + 1) * tileW), (ty + row) * canvasW + tx);
    const cTileW = tileW >> 1;
    const cCanvasW = canvasW >> 1;
    for (let row = 0;row < tileH >> 1; row++) {
      const src = row * cTileW;
      const dst = ((ty >> 1) + row) * cCanvasW + (tx >> 1);
      cb.set(tile.cb.subarray(src, src + cTileW), dst);
      cr.set(tile.cr.subarray(src, src + cTileW), dst);
    }
  }
  return { y, cb, cr, width: canvasW, height: canvasH };
}
function cropPlanes(planes, x0, y0, width, height) {
  if (x0 === 0 && y0 === 0 && width === planes.width && height === planes.height)
    return planes;
  const y = new Uint8Array(width * height);
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const cb = new Uint8Array(cw * ch);
  const cr = new Uint8Array(cw * ch);
  for (let row = 0;row < height; row++) {
    const src = (y0 + row) * planes.width + x0;
    y.set(planes.y.subarray(src, src + width), row * width);
  }
  const srcCw = Math.ceil(planes.width / 2);
  for (let row = 0;row < ch; row++) {
    const src = ((y0 >> 1) + row) * srcCw + (x0 >> 1);
    cb.set(planes.cb.subarray(src, src + cw), row * cw);
    cr.set(planes.cr.subarray(src, src + cw), row * cw);
  }
  return { y, cb, cr, width, height };
}
function decodeHeic(buffer, options = {}) {
  const boxes = parseISOBMFF(buffer);
  const info = getHeicInfo(buffer, boxes);
  if (!info.hvcC)
    throw new Error("ts-heic: primary item has no HEVC configuration (hvcC)");
  const sps = parseSps(info.hvcC.sps[0]);
  let planes;
  if (info.grid) {
    planes = stitchGrid(buffer, boxes, info, info.grid);
    planes = cropPlanes(planes, 0, 0, info.grid.outputWidth, info.grid.outputHeight);
  } else {
    planes = decodeItemPlanes(buffer, boxes, info, info.primaryItemId);
    const subW = sps.chromaFormatIdc === 1 || sps.chromaFormatIdc === 2 ? 2 : 1;
    const subH = sps.chromaFormatIdc === 1 ? 2 : 1;
    planes = cropPlanes(planes, subW * sps.cropLeft, subH * sps.cropTop, sps.width, sps.height);
  }
  const rgba = yuv420ToRgba(planes.y, planes.cb, planes.cr, planes.width, planes.height, {
    matrixCoeffs: sps.color?.matrixCoeffs ?? 6,
    fullRange: sps.color?.videoFullRange ?? true
  });
  let data = rgba;
  let width = planes.width;
  let height = planes.height;
  if (options.applyTransforms !== false && (info.rotation !== 0 || info.mirror !== null)) {
    const oriented = applyOrientation(rgba, width, height, info.rotation, info.mirror);
    data = oriented.data;
    width = oriented.width;
    height = oriented.height;
  }
  return { data, width, height, hasAlpha: false, bitDepth: 8 };
}
export {
  BitReader,
  NalType,
  PictureDecoder,
  applyOrientation,
  decodeHeic,
  findAllBoxes,
  findBox,
  getFtypInfo,
  getHeicInfo,
  getHeicMetadata,
  getItemPayload,
  isHeic,
  isSliceNal,
  parseGridBody,
  parseHvcC,
  parseISOBMFF,
  parseIpma,
  parseIref,
  parsePitm,
  parsePps,
  parseSps,
  splitAnnexB,
  splitLengthPrefixed,
  toRbsp,
  validateFtyp,
  yuv420ToRgba
};
