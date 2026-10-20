// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetVaultKeyMaterialCacheForTest } from "./connector-credential-vault-key.js";
import {
  deleteCredentialSecret,
  loadCredentialSecret,
  saveCredentialSecret,
} from "./connector-credential-vault.js";
import type { DataConnectorCredentialSecret } from "./types.js";

const INLINE_ENV = "OPENBOT_ENTERPRISE_DATA_VAULT_KEY";
const createdPaths: string[] = [];
const savedInline = process.env[INLINE_ENV];

function tempVaultPath(): string {
  const vaultPath = path.join(os.tmpdir(), `openbot-vault-test-${randomUUID()}.json`);
  createdPaths.push(vaultPath, `${vaultPath}.key`);
  return vaultPath;
}

const secret: DataConnectorCredentialSecret = {
  apiKey: "sk-test-123",
  instanceUrl: "https://example.test",
};

beforeEach(() => {
  delete process.env[INLINE_ENV];
  resetVaultKeyMaterialCacheForTest();
});

afterEach(() => {
  if (savedInline === undefined) {
    delete process.env[INLINE_ENV];
  } else {
    process.env[INLINE_ENV] = savedInline;
  }
  resetVaultKeyMaterialCacheForTest();
  for (const target of createdPaths.splice(0)) {
    fs.rmSync(target, { force: true });
  }
});

describe("connector credential vault (AES-256-GCM round-trip)", () => {
  it("encrypts on disk and decrypts with an inline env KEK", async () => {
    process.env[INLINE_ENV] = "inline-test-kek";
    const vaultPath = tempVaultPath();
    await saveCredentialSecret("cred-1", secret, vaultPath);
    // The stored envelope must not leak the plaintext api key.
    expect(fs.readFileSync(vaultPath, "utf8")).not.toContain("sk-test-123");
    expect(await loadCredentialSecret("cred-1", vaultPath)).toEqual(secret);
  });

  it("round-trips via the local key file when no env key is set", async () => {
    const vaultPath = tempVaultPath();
    await saveCredentialSecret("cred-2", secret, vaultPath);
    expect(fs.existsSync(`${vaultPath}.key`)).toBe(true);
    expect(await loadCredentialSecret("cred-2", vaultPath)).toEqual(secret);
  });

  it("deletes a stored secret", async () => {
    process.env[INLINE_ENV] = "inline-test-kek";
    const vaultPath = tempVaultPath();
    await saveCredentialSecret("cred-3", secret, vaultPath);
    await deleteCredentialSecret("cred-3", vaultPath);
    expect(await loadCredentialSecret("cred-3", vaultPath)).toBeNull();
  });
});
