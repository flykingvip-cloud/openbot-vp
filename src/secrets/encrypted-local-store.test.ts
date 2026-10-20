import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  buildEncryptedLocalSecretRef,
  deleteEncryptedLocalSecret,
  getEncryptedLocalSecret,
  hasEncryptedLocalSecret,
  putEncryptedLocalSecret,
  resolveEncryptedLocalMasterKeyRef,
} from "./encrypted-local-store.js";

describe("encrypted-local-store", () => {
  let storePath: string;
  const masterKey = "test-master-key-0123456789abcdef";

  beforeEach(() => {
    storePath = path.join(mkdtempSync(path.join(os.tmpdir(), "enc-local-")), "secrets.json");
  });

  it("round-trips an encrypted value with the correct master key", async () => {
    await putEncryptedLocalSecret({ id: "cred-1", value: "sk-secret-abc", masterKey, storePath });
    await expect(getEncryptedLocalSecret({ id: "cred-1", masterKey, storePath })).resolves.toBe(
      "sk-secret-abc",
    );
  });

  it("never writes plaintext to disk", async () => {
    await putEncryptedLocalSecret({
      id: "cred-plain",
      value: "sk-super-secret-value",
      masterKey,
      storePath,
    });
    const onDisk = readFileSync(storePath, "utf8");
    expect(onDisk).not.toContain("sk-super-secret-value");
    // The store holds iv/ciphertext/authTag, not the value.
    expect(onDisk).toContain("ciphertext");
    expect(onDisk).toContain("authTag");
  });

  it("fails to decrypt with a wrong master key (no detail leak)", async () => {
    await putEncryptedLocalSecret({ id: "cred-2", value: "sk-x", masterKey, storePath });
    await expect(
      getEncryptedLocalSecret({ id: "cred-2", masterKey: "wrong-master-key", storePath }),
    ).rejects.toThrow(/could not be decrypted/);
  });

  it("throws when the secret id is missing", async () => {
    await expect(getEncryptedLocalSecret({ id: "nope", masterKey, storePath })).rejects.toThrow(
      /not found/,
    );
  });

  it("overwrites an existing value on re-put", async () => {
    await putEncryptedLocalSecret({ id: "cred-3", value: "first", masterKey, storePath });
    await putEncryptedLocalSecret({ id: "cred-3", value: "second", masterKey, storePath });
    await expect(getEncryptedLocalSecret({ id: "cred-3", masterKey, storePath })).resolves.toBe(
      "second",
    );
  });

  it("uses a unique IV per value (no ciphertext reuse for equal plaintext)", async () => {
    await putEncryptedLocalSecret({ id: "a", value: "same", masterKey, storePath });
    await putEncryptedLocalSecret({ id: "b", value: "same", masterKey, storePath });
    const store = JSON.parse(readFileSync(storePath, "utf8")) as {
      secrets: Record<string, { iv: string; ciphertext: string }>;
    };
    expect(store.secrets.a.iv).not.toEqual(store.secrets.b.iv);
    expect(store.secrets.a.ciphertext).not.toEqual(store.secrets.b.ciphertext);
  });

  it("has + delete behave correctly", async () => {
    await putEncryptedLocalSecret({ id: "cred-4", value: "v", masterKey, storePath });
    await expect(hasEncryptedLocalSecret("cred-4", storePath)).resolves.toBe(true);
    await expect(deleteEncryptedLocalSecret("cred-4", storePath)).resolves.toBe(true);
    await expect(hasEncryptedLocalSecret("cred-4", storePath)).resolves.toBe(false);
    await expect(deleteEncryptedLocalSecret("cred-4", storePath)).resolves.toBe(false);
  });

  it("rejects empty value / missing master key on write", async () => {
    await expect(
      putEncryptedLocalSecret({ id: "x", value: "", masterKey, storePath }),
    ).rejects.toThrow(/value is required/);
    await expect(
      putEncryptedLocalSecret({ id: "x", value: "v", masterKey: "", storePath }),
    ).rejects.toThrow(/master key is unavailable/);
  });

  describe("resolveEncryptedLocalMasterKeyRef", () => {
    it("defaults to the OPENBOT_SECRET_MASTER_KEY env ref", () => {
      const ref = resolveEncryptedLocalMasterKeyRef({} as OpenBotConfig);
      expect(ref).toEqual({ source: "env", provider: "default", id: "OPENBOT_SECRET_MASTER_KEY" });
    });

    it("uses a configured env/file/exec master key ref", () => {
      const cfg = {
        secrets: {
          encryptedLocal: { masterKeyRef: { source: "exec", provider: "vault", id: "m/k" } },
        },
      } as unknown as OpenBotConfig;
      expect(resolveEncryptedLocalMasterKeyRef(cfg)).toEqual({
        source: "exec",
        provider: "vault",
        id: "m/k",
      });
    });

    it("rejects an encrypted-local master key ref (anti-recursion)", () => {
      const cfg = {
        secrets: {
          encryptedLocal: {
            masterKeyRef: { source: "encrypted-local", provider: "default", id: "x" },
          },
        },
      } as unknown as OpenBotConfig;
      expect(resolveEncryptedLocalMasterKeyRef(cfg)).toBeNull();
    });
  });

  it("builds an encrypted-local SecretRef", () => {
    expect(buildEncryptedLocalSecretRef("cred-9")).toEqual({
      source: "encrypted-local",
      provider: "default",
      id: "cred-9",
    });
  });
});
