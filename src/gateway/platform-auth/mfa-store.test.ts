import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-mfa-store-${Date.now()}`);
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const { currentTotp } = await import("./mfa-totp.js");
const {
  activateMfaEnrollment,
  consumeRecoveryCode,
  deleteMfa,
  enrollMfa,
  getMfaEnrollmentState,
  getMfaSecret,
  revokeMfa,
  scanMfaOrphans,
  verifyMfaCode,
} = await import("./mfa-store.js");

describe("mfa-store", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enroll → pending; activate with valid code → enabled", async () => {
    const enrollment = await enrollMfa("user-1", "ops@example.com");
    expect(enrollment.otpAuthUrl).toContain("otpauth://");
    expect(enrollment.recoveryCodes.length).toBeGreaterThan(0);

    let state = await getMfaEnrollmentState("user-1");
    expect(state.enabled).toBe(false);
    expect(state.pending).toBe(true);

    const now = 1_700_000_000_000;
    const code = currentTotp(enrollment.secret, now);
    const activated = await activateMfaEnrollment("user-1", code, now);
    expect(activated).toBe(true);

    state = await getMfaEnrollmentState("user-1");
    expect(state.enabled).toBe(true);
    expect(state.pending).toBe(false);
  });

  it("activate fails with a wrong code", async () => {
    await enrollMfa("user-1", "ops@example.com");
    const ok = await activateMfaEnrollment("user-1", "000000", 1_700_000_000_000);
    expect(ok).toBe(false);
    expect((await getMfaEnrollmentState("user-1")).enabled).toBe(false);
  });

  it("verifyMfaCode only succeeds for active (non-pending) records", async () => {
    const enrollment = await enrollMfa("user-1", "ops@example.com");
    const now = 1_700_000_000_000;
    // pending → verify fails
    expect(await verifyMfaCode("user-1", currentTotp(enrollment.secret, now), now)).toBe(false);
    // activate then verify succeeds
    await activateMfaEnrollment("user-1", currentTotp(enrollment.secret, now), now);
    expect(await verifyMfaCode("user-1", currentTotp(enrollment.secret, now), now)).toBe(true);
  });

  it("recovery code is single-use", async () => {
    const enrollment = await enrollMfa("user-1", "ops@example.com");
    const code = enrollment.recoveryCodes[0];
    expect(await consumeRecoveryCode("user-1", code)).toBe(true);
    // replay rejected
    expect(await consumeRecoveryCode("user-1", code)).toBe(false);
  });

  it("recovery code accepts hyphenless / lowercase input", async () => {
    const enrollment = await enrollMfa("user-1", "ops@example.com");
    const compact = enrollment.recoveryCodes[0].replace("-", "").toLowerCase();
    expect(await consumeRecoveryCode("user-1", compact)).toBe(true);
  });

  it("revoke disables the enrollment", async () => {
    const enrollment = await enrollMfa("user-1", "ops@example.com");
    const now = 1_700_000_000_000;
    await activateMfaEnrollment("user-1", currentTotp(enrollment.secret, now), now);
    await revokeMfa("user-1");
    const state = await getMfaEnrollmentState("user-1");
    expect(state.enabled).toBe(false);
    expect(state.secretRevokedAt).toBeDefined();
    expect(await verifyMfaCode("user-1", currentTotp(enrollment.secret, now), now)).toBe(false);
  });

  it("scanMfaOrphans removes records whose userId is gone", async () => {
    await enrollMfa("user-1", "a@example.com");
    await enrollMfa("user-2", "b@example.com");
    const result = await scanMfaOrphans(new Set(["user-1"]));
    expect(result.removed).toEqual(["user-2"]);
    expect(await getMfaSecret("user-2")).toBeNull();
    expect(await getMfaSecret("user-1")).not.toBeNull();
  });

  it("deleteMfa removes the record", async () => {
    await enrollMfa("user-1", "a@example.com");
    await deleteMfa("user-1");
    expect(await getMfaSecret("user-1")).toBeNull();
  });

  it("never exposes secret material in enrollment state", async () => {
    const enrollment = await enrollMfa("user-1", "a@example.com");
    const state = await getMfaEnrollmentState("user-1");
    expect(JSON.stringify(state)).not.toContain(enrollment.secret);
    expect(JSON.stringify(state)).not.toContain(enrollment.recoveryCodes[0]);
  });
});
