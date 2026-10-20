/**
 * Local TOTP (RFC 6238) implementation for platform-admin MFA.
 *
 * No third-party dependency: uses node:crypto HMAC-SHA1. Base32 (RFC 4648)
 * secret encoding. Verification allows ±1 period skew.
 *
 * Spec: platform-admin-login-isolation Task 2.1 (Requirement 3.3).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_PERIOD_SECONDS = 30;
const DEFAULT_DIGITS = 6;

/** Encodes raw bytes as RFC 4648 base32 (no padding). */
function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Decodes an RFC 4648 base32 string (padding/whitespace tolerant) into bytes. */
function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/u, "").replace(/\s+/gu, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      continue;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generates a new base32-encoded TOTP secret (20 random bytes = 160 bits). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Builds an otpauth:// provisioning URI for QR rendering. */
export function buildOtpAuthUrl(secret: string, email: string, issuer = "OpenBot"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Computes the TOTP code for a given counter (RFC 6238 / RFC 4226). */
function computeTotp(secret: string, counter: number, digits = DEFAULT_DIGITS): string {
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  // Write the counter as a big-endian 64-bit integer.
  counterBuf.writeBigUInt64BE(BigInt(Math.floor(counter)));
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

/** Returns the current valid TOTP code for a secret at `now` (ms). Used for tests + auto-retry. */
export function currentTotp(secret: string, now: number = Date.now()): string {
  const counter = Math.floor(now / 1000 / DEFAULT_PERIOD_SECONDS);
  return computeTotp(secret, counter);
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a TOTP code against the secret, allowing ±1 period skew.
 * `now` defaults to Date.now() (ms); injectable for tests.
 */
export function verifyTotp(secret: string, code: string, now: number = Date.now()): boolean {
  const normalized = code.replace(/\s+/gu, "");
  if (!/^\d{6}$/u.test(normalized) || !secret) {
    return false;
  }
  const counter = Math.floor(now / 1000 / DEFAULT_PERIOD_SECONDS);
  for (const window of [-1, 0, 1]) {
    if (constantTimeEqual(normalized, computeTotp(secret, counter + window))) {
      return true;
    }
  }
  return false;
}

/** Compact recovery-code key: hyphen/space/case insensitive, 8 alnum chars. */
export function recoveryCodeKey(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/gu, "").toUpperCase();
}

/** Generates single-use recovery codes (format: XXXX-XXXX, uppercase alnum). */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}
