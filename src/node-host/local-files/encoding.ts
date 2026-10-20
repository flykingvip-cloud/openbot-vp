/**
 * Text detection for read results (design 4.10).
 *
 * `fs.read` does not push raw bytes into the model context. It reports whether
 * the content is text, and only then includes the decoded body; binary content
 * returns metadata only and is left to a purpose-built parser.
 */

export type EncodingDetection = {
  isText: boolean;
  /** Best-effort label. `null` when the content is not text. */
  encoding: string | null;
  hasBom: boolean;
};

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

/**
 * Treat content as text when it decodes as UTF-8 without replacement characters
 * and carries no NUL bytes. A NUL is the cheapest reliable binary signal, and a
 * round-trip check catches invalid UTF-8 without pulling in a charset library.
 */
export function detectFileEncoding(buffer: Buffer): EncodingDetection {
  if (buffer.byteLength === 0) {
    return { isText: true, encoding: "utf-8", hasBom: false };
  }
  if (buffer.subarray(0, 3).equals(UTF8_BOM)) {
    return { isText: true, encoding: "utf-8", hasBom: true };
  }
  if (buffer.subarray(0, 2).equals(UTF16LE_BOM)) {
    return { isText: true, encoding: "utf-16le", hasBom: true };
  }
  if (buffer.subarray(0, 2).equals(UTF16BE_BOM)) {
    return { isText: true, encoding: "utf-16be", hasBom: true };
  }
  if (buffer.includes(0)) {
    return { isText: false, encoding: null, hasBom: false };
  }

  const decoded = buffer.toString("utf8");
  if (decoded.includes("\uFFFD")) {
    return { isText: false, encoding: null, hasBom: false };
  }
  return { isText: true, encoding: "utf-8", hasBom: false };
}
