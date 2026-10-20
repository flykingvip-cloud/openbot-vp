import { crc32, inflateSync } from "node:zlib";
import { DeviceDhError } from "./errors.js";

export type InspectedImage = {
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ADAM7: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 8, 0, 8],
  [0, 8, 4, 8],
  [4, 8, 0, 4],
  [0, 4, 2, 4],
  [2, 4, 0, 2],
  [0, 2, 1, 2],
  [1, 2, 0, 1],
];

function invalidImage(): DeviceDhError {
  return new DeviceDhError("MEDIA_INVALID", "Image could not be decoded");
}

function assertDimensions(width: number, height: number, maxPixels: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8000 ||
    height > 8000 ||
    width * height > maxPixels
  ) {
    throw new DeviceDhError("MEDIA_INVALID", "Image dimensions are not allowed");
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  if (upDistance <= upLeftDistance) {
    return up;
  }
  return upLeft;
}

function unfilter(inflated: Buffer, height: number, rowBytes: number, bytesPerPixel: number): void {
  const stride = rowBytes + 1;
  if (height < 1 || rowBytes < 1 || inflated.length !== height * stride) {
    throw invalidImage();
  }
  const prior = Buffer.alloc(rowBytes);
  const current = Buffer.alloc(rowBytes);
  for (let row = 0; row < height; row += 1) {
    const start = row * stride;
    const filter = inflated[start] ?? 0xff;
    if (filter > 4) {
      throw invalidImage();
    }
    for (let column = 0; column < rowBytes; column += 1) {
      const left = column >= bytesPerPixel ? (current[column - bytesPerPixel] ?? 0) : 0;
      const up = prior[column] ?? 0;
      const upLeft = column >= bytesPerPixel ? (prior[column - bytesPerPixel] ?? 0) : 0;
      const raw = inflated[start + 1 + column] ?? 0;
      let decoded = raw;
      if (filter === 1) {
        decoded = raw + left;
      } else if (filter === 2) {
        decoded = raw + up;
      } else if (filter === 3) {
        decoded = raw + ((left + up) >> 1);
      } else if (filter === 4) {
        decoded = raw + paeth(left, up, upLeft);
      }
      current[column] = decoded & 0xff;
    }
    current.copy(prior);
  }
}

function samplesFor(colorType: number): number | undefined {
  if (colorType === 0 || colorType === 3) {
    return 1;
  }
  if (colorType === 2) {
    return 3;
  }
  if (colorType === 4) {
    return 2;
  }
  if (colorType === 6) {
    return 4;
  }
  return undefined;
}

function depthAllowed(colorType: number, bitDepth: number): boolean {
  if (colorType === 0) {
    return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16;
  }
  if (colorType === 3) {
    return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8;
  }
  if (colorType === 2 || colorType === 4 || colorType === 6) {
    return bitDepth === 8 || bitDepth === 16;
  }
  return false;
}

function rowBytesFor(width: number, bitDepth: number, samples: number): number {
  return Math.ceil((width * bitDepth * samples) / 8);
}

function passDimensions(
  width: number,
  height: number,
  pass: readonly [number, number, number, number],
): { width: number; height: number } | undefined {
  const [rowStart, rowStep, columnStart, columnStep] = pass;
  if (width <= columnStart || height <= rowStart) {
    return undefined;
  }
  const passWidth = Math.ceil((width - columnStart) / columnStep);
  const passHeight = Math.ceil((height - rowStart) / rowStep);
  if (passWidth < 1 || passHeight < 1) {
    return undefined;
  }
  return { width: passWidth, height: passHeight };
}

function inflatedSize(
  width: number,
  height: number,
  bitDepth: number,
  samples: number,
  interlace: number,
): number {
  if (interlace === 0) {
    return height * (1 + rowBytesFor(width, bitDepth, samples));
  }
  let total = 0;
  for (const pass of ADAM7) {
    const dimensions = passDimensions(width, height, pass);
    if (!dimensions) {
      continue;
    }
    total += dimensions.height * (1 + rowBytesFor(dimensions.width, bitDepth, samples));
  }
  return total;
}

function decodePngPixels(
  inflated: Buffer,
  width: number,
  height: number,
  bitDepth: number,
  samples: number,
  interlace: number,
): void {
  const bytesPerPixel = Math.max(1, Math.floor((samples * bitDepth) / 8));
  if (interlace === 0) {
    unfilter(inflated, height, rowBytesFor(width, bitDepth, samples), bytesPerPixel);
    return;
  }
  let offset = 0;
  for (const pass of ADAM7) {
    const dimensions = passDimensions(width, height, pass);
    if (!dimensions) {
      continue;
    }
    const rowBytes = rowBytesFor(dimensions.width, bitDepth, samples);
    const bytes = dimensions.height * (rowBytes + 1);
    unfilter(inflated.subarray(offset, offset + bytes), dimensions.height, rowBytes, bytesPerPixel);
    offset += bytes;
  }
  if (offset !== inflated.length) {
    throw invalidImage();
  }
}

/**
 * Bounded PNG decode: chunk CRC, inflate with a hard output cap, then unfilter.
 * Magic bytes plus an IHDR size are not enough.
 */
function inspectPng(bytes: Buffer, maxPixels: number): InspectedImage {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    throw invalidImage();
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let sawHeader = false;
  let sawPalette = false;
  let idatOpen = false;
  let idatClosed = false;
  const idat: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) {
      throw invalidImage();
    }
    const type = bytes.subarray(offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const declaredCrc = bytes.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(Buffer.concat([type, data])) >>> 0;
    if (declaredCrc !== actualCrc) {
      throw invalidImage();
    }
    const name = type.toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(name)) {
      throw invalidImage();
    }
    const critical = name.charCodeAt(0) >= 65 && name.charCodeAt(0) <= 90;
    if (!sawHeader && name !== "IHDR") {
      throw invalidImage();
    }
    if (name === "IHDR") {
      if (sawHeader || length !== 13) {
        throw invalidImage();
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? -1;
      const compression = data[10] ?? 1;
      const filter = data[11] ?? 1;
      interlace = data[12] ?? 1;
      if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) {
        throw invalidImage();
      }
      if (!depthAllowed(colorType, bitDepth) || samplesFor(colorType) === undefined) {
        throw invalidImage();
      }
      assertDimensions(width, height, maxPixels);
      sawHeader = true;
    } else if (name === "PLTE") {
      if (!sawHeader || idatOpen || sawPalette || length === 0 || length % 3 !== 0) {
        throw invalidImage();
      }
      if (colorType === 0 || colorType === 4) {
        throw invalidImage();
      }
      sawPalette = true;
    } else if (name === "IDAT") {
      if (!sawHeader || idatClosed) {
        throw invalidImage();
      }
      if (colorType === 3 && !sawPalette) {
        throw invalidImage();
      }
      idat.push(Buffer.from(data));
      idatOpen = true;
    } else if (name === "IEND") {
      if (!sawHeader || length !== 0 || !idatOpen) {
        throw invalidImage();
      }
      offset += 12;
      if (offset !== bytes.length) {
        throw invalidImage();
      }
      const samples = samplesFor(colorType);
      if (samples === undefined) {
        throw invalidImage();
      }
      const expected = inflatedSize(width, height, bitDepth, samples, interlace);
      if (expected < 1 || expected > maxPixels * 8 + height * 8) {
        throw new DeviceDhError("MEDIA_INVALID", "Image dimensions are not allowed");
      }
      let inflated: Buffer;
      try {
        inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
      } catch {
        throw invalidImage();
      }
      if (inflated.length !== expected) {
        throw invalidImage();
      }
      decodePngPixels(inflated, width, height, bitDepth, samples, interlace);
      return { contentType: "image/png", width, height };
    } else if (critical) {
      throw invalidImage();
    } else if (idatOpen) {
      idatClosed = true;
    }
    offset += 12 + length;
  }
  throw invalidImage();
}

/**
 * JPEG structure check through EOI. A SOF marker without a non-empty scan is rejected.
 * This is not a Huffman decoder; a scan that reaches EOI can still be visually corrupt.
 */
function inspectJpeg(bytes: Buffer, maxPixels: number): InspectedImage {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw invalidImage();
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawFrame = false;
  let sawScan = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw invalidImage();
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) {
      throw invalidImage();
    }
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd9) {
      if (!sawFrame || !sawScan) {
        throw invalidImage();
      }
      assertDimensions(width, height, maxPixels);
      return { contentType: "image/jpeg", width, height };
    }
    if (marker === 0x00 || marker === 0xd8) {
      throw invalidImage();
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      throw invalidImage();
    }
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) {
      throw invalidImage();
    }
    const startOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame) {
      if (length < 8) {
        throw invalidImage();
      }
      const precision = bytes[offset + 2] ?? 0;
      height = bytes.readUInt16BE(offset + 3);
      width = bytes.readUInt16BE(offset + 5);
      if (precision !== 8 && precision !== 12) {
        throw invalidImage();
      }
      assertDimensions(width, height, maxPixels);
      sawFrame = true;
    }
    offset += length;
    if (marker !== 0xda) {
      continue;
    }
    if (!sawFrame) {
      throw invalidImage();
    }
    let entropy = 0;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        entropy += 1;
        offset += 1;
        continue;
      }
      let markerAt = offset + 1;
      while (markerAt < bytes.length && bytes[markerAt] === 0xff) {
        markerAt += 1;
      }
      if (markerAt >= bytes.length) {
        throw invalidImage();
      }
      const scanMarker = bytes[markerAt] ?? 0;
      if (scanMarker === 0x00) {
        entropy += 1;
        offset = markerAt + 1;
        continue;
      }
      if (scanMarker >= 0xd0 && scanMarker <= 0xd7) {
        offset = markerAt + 1;
        continue;
      }
      if (entropy < 1) {
        throw invalidImage();
      }
      sawScan = true;
      offset = markerAt;
      while (offset > 0 && bytes[offset - 1] === 0xff) {
        offset -= 1;
      }
      break;
    }
  }
  throw invalidImage();
}

/**
 * Resource-limited image check. PNG is inflated and unfiltered. JPEG must contain
 * a complete scan through EOI. Header magic alone is not accepted.
 */
export function inspectImage(bytes: Buffer, maxBytes: number, maxPixels: number): InspectedImage {
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new DeviceDhError("MEDIA_INVALID", "Image exceeds size limit");
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    return inspectPng(bytes, maxPixels);
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return inspectJpeg(bytes, maxPixels);
  }
  throw new DeviceDhError("MEDIA_INVALID", "Only JPEG and PNG images are accepted");
}
