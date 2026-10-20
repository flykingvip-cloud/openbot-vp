import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OBJECTIVE_SHADOW_FLAG_ENV,
  OBJECTIVE_SHADOW_HMAC_KEY_ENV,
  OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV,
  isObjectiveShadowWritable,
  isTrustedHmacKeyFileStat,
  readObjectiveShadowHmacKey,
} from "./feature.js";

const unixOwner = typeof process.getuid === "function";

function makeStat(overrides: { file?: boolean; symlink?: boolean; mode: number; uid: number }) {
  return {
    isFile: () => overrides.file !== false && overrides.symlink !== true,
    isSymbolicLink: () => overrides.symlink === true,
    mode: overrides.mode,
    uid: overrides.uid,
  };
}

describe("HMAC key file fallback", () => {
  it("prefers the inline env key over the key file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "objective-shadow-hmac-"));
    const filePath = path.join(dir, "hmac");
    writeFileSync(filePath, "file-key\n", { mode: 0o600 });
    expect(
      readObjectiveShadowHmacKey({
        [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: "env-key",
        [OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]: filePath,
      }),
    ).toBe("env-key");
  });

  it.skipIf(!unixOwner)("reads the key file when the inline env key is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "objective-shadow-hmac-"));
    const filePath = path.join(dir, "hmac");
    writeFileSync(filePath, "file-key\n", { mode: 0o600 });
    chmodSync(filePath, 0o600);
    expect(
      readObjectiveShadowHmacKey({
        [OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]: filePath,
      }),
    ).toBe("file-key");
    expect(
      isObjectiveShadowWritable({
        [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
        [OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]: filePath,
      }),
    ).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "fail-closes when the key file is a symlink, directory, or group/other-readable",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "objective-shadow-hmac-"));
      const filePath = path.join(dir, "hmac");
      writeFileSync(filePath, "file-key\n", { mode: 0o600 });
      chmodSync(filePath, 0o600);
      const linkPath = path.join(dir, "hmac-link");
      symlinkSync(filePath, linkPath);
      expect(
        readObjectiveShadowHmacKey({
          [OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]: linkPath,
        }),
      ).toBeNull();

      expect(
        readObjectiveShadowHmacKey({
          [OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]: dir,
        }),
      ).toBeNull();

      chmodSync(filePath, 0o644);
      expect(
        readObjectiveShadowHmacKey({
          [OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]: filePath,
        }),
      ).toBeNull();
      expect(
        isObjectiveShadowWritable({
          [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
          [OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]: filePath,
        }),
      ).toBe(false);
    },
  );

  it("rejects symlink, wide mode, wrong owner, and unknown uid before reading bytes", () => {
    expect(isTrustedHmacKeyFileStat(makeStat({ symlink: true, mode: 0o600, uid: 501 }), 501)).toBe(
      false,
    );
    expect(isTrustedHmacKeyFileStat(makeStat({ file: false, mode: 0o600, uid: 501 }), 501)).toBe(
      false,
    );
    expect(isTrustedHmacKeyFileStat(makeStat({ mode: 0o644, uid: 501 }), 501)).toBe(false);
    expect(isTrustedHmacKeyFileStat(makeStat({ mode: 0o600, uid: 501 }), 502)).toBe(false);
    expect(isTrustedHmacKeyFileStat(makeStat({ mode: 0o600, uid: 501 }), undefined)).toBe(false);
    expect(isTrustedHmacKeyFileStat(makeStat({ mode: 0o600, uid: 501 }), 501)).toBe(true);
    expect(isTrustedHmacKeyFileStat(makeStat({ mode: 0o400, uid: 501 }), 501)).toBe(true);
  });

  it("fail-closes when the key file is missing or empty", () => {
    expect(
      readObjectiveShadowHmacKey({
        [OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]: "/tmp/objective-shadow-hmac-missing",
      }),
    ).toBeNull();
    const dir = mkdtempSync(path.join(tmpdir(), "objective-shadow-hmac-"));
    const filePath = path.join(dir, "empty");
    writeFileSync(filePath, "  \n", { mode: 0o600 });
    expect(
      readObjectiveShadowHmacKey({
        [OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]: filePath,
      }),
    ).toBeNull();
    expect(
      isObjectiveShadowWritable({
        [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
        [OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]: filePath,
      }),
    ).toBe(false);
  });
});
