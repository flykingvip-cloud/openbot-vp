import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** Browser stand-in for `randomUUID()` when Vite aliases `node:crypto`. */
export function randomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Web Crypto is required for randomUUID()");
  }
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Browser stand-in for the `createHash("sha256")` slice used by policy-compiler. */
export function createHash(algorithm: string) {
  if (algorithm !== "sha256") {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }
  const parts: Uint8Array[] = [];
  return {
    update(data: string | Uint8Array) {
      parts.push(typeof data === "string" ? utf8ToBytes(data) : data);
      return this;
    },
    digest(encoding?: "hex") {
      const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        joined.set(part, offset);
        offset += part.byteLength;
      }
      const hash = sha256(joined);
      return encoding === "hex" ? bytesToHex(hash) : hash;
    },
  };
}
