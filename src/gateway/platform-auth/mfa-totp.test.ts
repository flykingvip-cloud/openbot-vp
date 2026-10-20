import { describe, expect, it } from "vitest";
import {
  buildOtpAuthUrl,
  currentTotp,
  generateRecoveryCodes,
  generateTotpSecret,
  recoveryCodeKey,
  verifyTotp,
} from "./mfa-totp.js";

const PERIOD_MS = 30_000;

describe("mfa-totp", () => {
  it("generates a base32 secret", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it("verifies the current code (positive round-trip)", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = currentTotp(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
  });

  it("accepts ±1 period skew but rejects ±2 periods", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = currentTotp(secret, now);
    expect(verifyTotp(secret, code, now - PERIOD_MS)).toBe(true);
    expect(verifyTotp(secret, code, now + PERIOD_MS)).toBe(true);
    expect(verifyTotp(secret, code, now + 2 * PERIOD_MS)).toBe(false);
    expect(verifyTotp(secret, code, now - 2 * PERIOD_MS)).toBe(false);
  });

  it("rejects malformed / empty input", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, "abc", now)).toBe(false);
    expect(verifyTotp(secret, "", now)).toBe(false);
    expect(verifyTotp("", "123456", now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false); // wrong length
  });

  it("verification is deterministic for the same inputs", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_030_000;
    expect(verifyTotp(secret, "111111", now)).toBe(verifyTotp(secret, "111111", now));
  });

  it("builds an otpauth url containing issuer, secret and algorithm", () => {
    const url = buildOtpAuthUrl("ABC234", "ops@example.com", "OpenBot");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("secret=ABC234");
    expect(url).toContain("issuer=OpenBot");
    expect(url).toContain("algorithm=SHA1");
  });

  it("generates unique formatted recovery codes", () => {
    const codes = generateRecoveryCodes(8);
    expect(codes).toHaveLength(8);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
    expect(new Set(codes).size).toBe(8);
  });

  it("normalizes recovery-code punctuation and case to the same 8-char key", () => {
    expect(recoveryCodeKey("ab2d-efg3")).toBe("AB2DEFG3");
    expect(recoveryCodeKey("AB2DEFG3")).toBe("AB2DEFG3");
    expect(recoveryCodeKey(" ab2d efg3 ")).toBe("AB2DEFG3");
    expect(verifyTotp(generateTotpSecret(), "8992777", 1_700_000_000_000)).toBe(false);
  });
});
