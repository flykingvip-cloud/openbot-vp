import fs from "node:fs";

/** Unicode to glyph id map read from a TrueType cmap (format 4 or 12). */
export type ParsedTtf = {
  bytes: Buffer;
  unicodeToGid: Map<number, number>;
};

const CANDIDATE_FONTS = [
  "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf",
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
];

export function resolveCjkFontPath(explicit?: string): string | null {
  const candidates = [explicit, process.env.OPENBOT_OFFICE_CJK_FONT, ...CANDIDATE_FONTS];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.toLowerCase().endsWith(".ttc")) {
      continue;
    }
    try {
      const stat = fs.statSync(trimmed);
      if (stat.isFile() && stat.size > 0 && stat.size < 32 * 1024 * 1024) {
        return trimmed;
      }
    } catch {
      // try the next installed font
    }
  }
  return null;
}

export function loadTtf(filePath: string): ParsedTtf {
  const bytes = fs.readFileSync(filePath);
  return { bytes, unicodeToGid: parseCmap(bytes) };
}

export function parseCmap(bytes: Buffer): Map<number, number> {
  if (bytes.length < 12) {
    throw new Error("font is too small");
  }
  const numTables = bytes.readUInt16BE(4);
  let cmapOffset = -1;
  let cmapLength = 0;
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    const tag = bytes.toString("latin1", record, record + 4);
    if (tag === "cmap") {
      cmapOffset = bytes.readUInt32BE(record + 8);
      cmapLength = bytes.readUInt32BE(record + 12);
      break;
    }
  }
  if (cmapOffset < 0) {
    throw new Error("font has no cmap");
  }
  const numEncodings = bytes.readUInt16BE(cmapOffset + 2);
  let chosen = -1;
  let chosenScore = -1;
  for (let i = 0; i < numEncodings; i += 1) {
    const rec = cmapOffset + 4 + i * 8;
    const platform = bytes.readUInt16BE(rec);
    const encoding = bytes.readUInt16BE(rec + 2);
    const offset = bytes.readUInt32BE(rec + 4);
    const format = bytes.readUInt16BE(cmapOffset + offset);
    const score = scoreEncoding(platform, encoding, format);
    if (score > chosenScore) {
      chosenScore = score;
      chosen = cmapOffset + offset;
    }
  }
  if (chosen < 0 || chosenScore < 0) {
    throw new Error("font cmap has no supported Unicode encoding");
  }
  const format = bytes.readUInt16BE(chosen);
  const map = new Map<number, number>();
  if (format === 4) {
    readFormat4(bytes, chosen, map);
  } else if (format === 12) {
    readFormat12(bytes, chosen, map);
  } else {
    throw new Error(`unsupported cmap format ${format}`);
  }
  if (map.size === 0 || chosen + 4 > cmapOffset + cmapLength) {
    throw new Error("font cmap was empty");
  }
  return map;
}

function scoreEncoding(platform: number, encoding: number, format: number): number {
  if (format !== 4 && format !== 12) {
    return -1;
  }
  if (platform === 0) {
    return 3;
  }
  if (platform === 3 && (encoding === 1 || encoding === 10)) {
    return 2;
  }
  return -1;
}

function readFormat4(bytes: Buffer, offset: number, map: Map<number, number>): void {
  const segCount = bytes.readUInt16BE(offset + 6) / 2;
  let cursor = offset + 14;
  const endCount: number[] = [];
  for (let i = 0; i < segCount; i += 1) {
    endCount.push(bytes.readUInt16BE(cursor));
    cursor += 2;
  }
  cursor += 2;
  const startCount: number[] = [];
  for (let i = 0; i < segCount; i += 1) {
    startCount.push(bytes.readUInt16BE(cursor));
    cursor += 2;
  }
  const idDelta: number[] = [];
  for (let i = 0; i < segCount; i += 1) {
    idDelta.push(bytes.readInt16BE(cursor));
    cursor += 2;
  }
  const idRangeOffsetPos = cursor;
  const idRangeOffset: number[] = [];
  for (let i = 0; i < segCount; i += 1) {
    idRangeOffset.push(bytes.readUInt16BE(cursor));
    cursor += 2;
  }
  for (let i = 0; i < segCount; i += 1) {
    const start = startCount[i] ?? 0;
    const end = endCount[i] ?? 0;
    if (start === 0xffff) {
      continue;
    }
    for (let code = start; code <= end; code += 1) {
      let gid: number;
      const rangeOffset = idRangeOffset[i] ?? 0;
      if (rangeOffset === 0) {
        gid = (code + (idDelta[i] ?? 0)) & 0xffff;
      } else {
        const glyphPos = idRangeOffsetPos + i * 2 + rangeOffset + (code - start) * 2;
        gid = bytes.readUInt16BE(glyphPos);
        if (gid !== 0) {
          gid = (gid + (idDelta[i] ?? 0)) & 0xffff;
        }
      }
      if (gid !== 0) {
        map.set(code, gid);
      }
    }
  }
}

function readFormat12(bytes: Buffer, offset: number, map: Map<number, number>): void {
  const numGroups = bytes.readUInt32BE(offset + 12);
  let cursor = offset + 16;
  for (let i = 0; i < numGroups; i += 1) {
    const start = bytes.readUInt32BE(cursor);
    const end = bytes.readUInt32BE(cursor + 4);
    const glyph = bytes.readUInt32BE(cursor + 8);
    cursor += 12;
    const count = end - start + 1;
    if (count > 200_000) {
      continue;
    }
    for (let n = 0; n < count; n += 1) {
      map.set(start + n, glyph + n);
    }
  }
}
