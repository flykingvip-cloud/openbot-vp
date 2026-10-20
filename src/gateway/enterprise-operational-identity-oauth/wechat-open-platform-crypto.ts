import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function decodeAesKey(key: string): Buffer {
  const normalized = key.trim();
  if (!normalized) {
    throw new Error("WeChat encoding AES key is empty.");
  }
  const decoded = Buffer.from(`${normalized}=`, "base64");
  if (decoded.length !== 32) {
    throw new Error("WeChat encoding AES key must decode to 32 bytes.");
  }
  return decoded;
}

function stripPkcs7(data: Buffer): Buffer {
  const padding = data[data.length - 1] ?? 0;
  if (padding <= 0 || padding > 32) {
    throw new Error("Invalid WeChat PKCS7 padding.");
  }
  return data.subarray(0, data.length - padding);
}

function addPkcs7(data: Buffer): Buffer {
  const blockSize = 32;
  const padding = blockSize - (data.length % blockSize || blockSize);
  return Buffer.concat([data, Buffer.alloc(padding || blockSize, padding || blockSize)]);
}

export function computeWechatOpenPlatformSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  value: string;
}): string {
  const payload = [params.token, params.timestamp, params.nonce, params.value].toSorted().join("");
  return createHash("sha1").update(payload).digest("hex");
}

function signatureMatches(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function verifyWechatOpenPlatformSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  value: string;
  signature: string;
}): boolean {
  const expected = computeWechatOpenPlatformSignature(params);
  return signatureMatches(expected, params.signature.trim());
}

export function decryptWechatOpenPlatformPayload(params: {
  encodingAesKey: string;
  encrypted: string;
  receiveId: string;
}): string {
  const key = decodeAesKey(params.encodingAesKey);
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(params.encrypted, "base64")),
    decipher.final(),
  ]);
  const payload = stripPkcs7(decrypted);
  const xmlLength = payload.readUInt32BE(16);
  const xmlStart = 20;
  const xmlEnd = xmlStart + xmlLength;
  const xml = payload.subarray(xmlStart, xmlEnd).toString("utf8");
  const receiveId = payload.subarray(xmlEnd).toString("utf8");
  if (params.receiveId && receiveId && receiveId !== params.receiveId) {
    throw new Error(`WeChat receiveId mismatch: expected ${params.receiveId}, got ${receiveId}`);
  }
  return xml;
}

export function encryptWechatOpenPlatformPayload(params: {
  encodingAesKey: string;
  plainText: string;
  receiveId: string;
}): string {
  const key = decodeAesKey(params.encodingAesKey);
  const content = Buffer.from(params.plainText, "utf8");
  const randomPrefix = randomBytes(16);
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(content.length, 0);
  const payload = addPkcs7(
    Buffer.concat([randomPrefix, lengthBuffer, content, Buffer.from(params.receiveId, "utf8")]),
  );
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(payload), cipher.final()]).toString("base64");
}

export function readWechatOpenPlatformXmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(
    new RegExp(`<${tag}>(?:<!\\[CDATA\\[(.*?)\\]\\]>|([^<]*))<\\/${tag}>`, "s"),
  );
  const raw = match?.[1] ?? match?.[2] ?? "";
  const value = raw.trim();
  return value || undefined;
}
