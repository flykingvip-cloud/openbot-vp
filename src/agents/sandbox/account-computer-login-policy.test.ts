import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readLoginPolicy,
  rememberObservedLoginMethod,
  setAccountComputerLoginPolicyPathForTests,
  writeLoginPolicy,
} from "./account-computer-login-policy-store.js";
import {
  rememberPasswordFillForSave,
  resetAccountComputerLoginVaultForTests,
  saveSiteLoginSecret,
  setAccountComputerLoginVaultPathForTests,
  vaultFileContainsPlaintext,
} from "./account-computer-login-vault.js";

const envKeys = [
  "OPENBOT_ENTERPRISE_DATA_VAULT_KEY",
  "OPENCLAW_ENTERPRISE_DATA_VAULT_KEY",
  "OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF",
  "OPENCLAW_ENTERPRISE_DATA_VAULT_KEY_REF",
  "OPENBOT_SECURITY_PROFILE",
  "OPENCLAW_SECURITY_PROFILE",
] as const;

describe("account computer login policy and vault", () => {
  const prior = new Map<string, string | undefined>();
  let dir = "";

  beforeEach(async () => {
    for (const key of envKeys) {
      prior.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.OPENBOT_ENTERPRISE_DATA_VAULT_KEY = "test-vault-key";
    process.env.OPENBOT_SECURITY_PROFILE = "personal_local";
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ac-login-"));
    setAccountComputerLoginPolicyPathForTests(path.join(dir, "policy.json"));
    setAccountComputerLoginVaultPathForTests(path.join(dir, "vault.json"));
  });

  afterEach(async () => {
    resetAccountComputerLoginVaultForTests();
    setAccountComputerLoginPolicyPathForTests(null);
    for (const key of envKeys) {
      const value = prior.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("remembers one method per host and does not overwrite a recorded choice", async () => {
    await rememberObservedLoginMethod({
      tenantId: "tenant-a",
      userId: "user-a",
      host: "https://www.example.com/login",
      method: "password",
    });
    const first = await readLoginPolicy({
      tenantId: "tenant-a",
      userId: "user-a",
      host: "example.com",
    });
    expect(first).toMatchObject({
      preferredMethod: "password",
      firstChoiceRecorded: true,
    });
    expect(first?.rememberedCredentialId).toBeUndefined();

    await writeLoginPolicy({
      tenantId: "tenant-a",
      userId: "user-a",
      host: "example.com",
      preferredMethod: "qr",
      firstChoiceRecorded: true,
    });
    const kept = await rememberObservedLoginMethod({
      tenantId: "tenant-a",
      userId: "user-a",
      host: "example.com",
      method: "password",
    });
    expect(kept?.preferredMethod).toBe("qr");
  });

  it("stores a site password as ciphertext", async () => {
    const secret = { username: "ada", password: "correct-horse" };
    await saveSiteLoginSecret("cred-1", secret);
    secret.password = "";
    expect(await vaultFileContainsPlaintext("correct-horse")).toBe(false);
    expect(await vaultFileContainsPlaintext("ada")).toBe(false);
  });

  it("refuses a local key file on a managed profile without the vault KEK", async () => {
    delete process.env.OPENBOT_ENTERPRISE_DATA_VAULT_KEY;
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    await rememberPasswordFillForSave({
      tenantId: "tenant-a",
      userId: "user-a",
      host: "example.com",
      formId: "form-1",
      sessionKey: "session-1",
      fields: [
        { fieldId: "user", kind: "username" },
        { fieldId: "pass", kind: "password" },
      ],
      values: { user: "ada", pass: "correct-horse" },
    });
    await expect(fs.stat(path.join(dir, "vault.json.key"))).rejects.toThrow();
    expect(await vaultFileContainsPlaintext("correct-horse")).toBe(false);
  });
});
