import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import type { SecretRef } from "../config/types.secrets.js";
import {
  resolveCliBackendCredentialEnv,
  resolveCredentialEnvForRun,
  resolveCredentialForRun,
  verifyCliBackendCredential,
} from "./cli-backend-credential-resolve.js";
import {
  setCliBackendCredentialBinding,
  upsertCliBackendCredential,
  type CliBackendCredential,
} from "./cli-backend-credential-store.js";

// SecretRef-First: secrets live in their source. We use an `env` source here so
// resolution is hermetic (reads from the injected `env`, no external provider).
const ENV_REF: SecretRef = { source: "env", provider: "default", id: "ANTHROPIC_API_KEY" };
const MISSING_REF: SecretRef = { source: "env", provider: "default", id: "DOES_NOT_EXIST" };

const CONFIG = {} as OpenBotConfig;
const CRED: CliBackendCredential = {
  credentialId: "corp",
  tenantId: "t1",
  scope: "enterprise",
  backendId: "claude-cli",
  envVars: { ANTHROPIC_API_KEY: ENV_REF },
  updatedAt: "now",
};

describe("resolveCliBackendCredentialEnv (all-or-nothing)", () => {
  it("resolves every SecretRef to its env value", async () => {
    const resolved = await resolveCliBackendCredentialEnv(CRED, {
      config: CONFIG,
      env: { ANTHROPIC_API_KEY: "sk-live" } as NodeJS.ProcessEnv,
    });
    expect(resolved).toEqual({ ok: true, env: { ANTHROPIC_API_KEY: "sk-live" } });
  });

  it("fails as a whole when any ref is unresolvable (no partial env)", async () => {
    const cred = { ...CRED, envVars: { ANTHROPIC_API_KEY: ENV_REF, EXTRA: MISSING_REF } };
    const resolved = await resolveCliBackendCredentialEnv(cred, {
      config: CONFIG,
      env: { ANTHROPIC_API_KEY: "sk-live" } as NodeJS.ProcessEnv,
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.env).toBeUndefined();
    expect(resolved.failedKeys).toEqual(["EXTRA"]);
  });
});

describe("verifyCliBackendCredential (no value exposure)", () => {
  it("reports valid with resolved key names only", async () => {
    const res = await verifyCliBackendCredential(CRED, {
      config: CONFIG,
      env: { ANTHROPIC_API_KEY: "sk-live" } as NodeJS.ProcessEnv,
    });
    expect(res).toEqual({ valid: true, resolvedKeys: ["ANTHROPIC_API_KEY"], failedKeys: [] });
  });

  it("reports invalid + which keys failed", async () => {
    const res = await verifyCliBackendCredential(CRED, {
      config: CONFIG,
      env: {} as NodeJS.ProcessEnv,
    });
    expect(res.valid).toBe(false);
    expect(res.failedKeys).toEqual(["ANTHROPIC_API_KEY"]);
  });
});

describe("resolveCredentialEnvForRun (store selection + resolution)", () => {
  let dir: string;
  let storePath: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cli-cred-resolve-"));
    storePath = path.join(dir, "creds.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns undefined when there is no scope (host default fallback)", async () => {
    const env = await resolveCredentialEnvForRun({
      backendId: "claude-cli",
      scope: null,
      config: CONFIG,
      storePath,
    });
    expect(env).toBeUndefined();
  });

  it("selects an enterprise credential and resolves its env", async () => {
    await upsertCliBackendCredential(
      {
        credentialId: "corp",
        tenantId: "t1",
        scope: "enterprise",
        backendId: "claude-cli",
        envVars: { ANTHROPIC_API_KEY: ENV_REF },
      },
      storePath,
    );
    const env = await resolveCredentialEnvForRun({
      backendId: "claude-cli",
      model: "claude-sonnet",
      scope: { tenantId: "t1" },
      config: CONFIG,
      env: { ANTHROPIC_API_KEY: "sk-corp" } as NodeJS.ProcessEnv,
      storePath,
    });
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-corp" });
  });

  it("prefers a personal credential when subjectId matches", async () => {
    await upsertCliBackendCredential(
      {
        credentialId: "corp",
        tenantId: "t1",
        scope: "enterprise",
        backendId: "claude-cli",
        envVars: { ANTHROPIC_API_KEY: ENV_REF },
      },
      storePath,
    );
    await upsertCliBackendCredential(
      {
        credentialId: "mine",
        tenantId: "t1",
        scope: "personal",
        subjectId: "seat-9",
        backendId: "claude-cli",
        envVars: { ANTHROPIC_API_KEY: { source: "env", provider: "default", id: "MY_KEY" } },
      },
      storePath,
    );
    const env = await resolveCredentialEnvForRun({
      backendId: "claude-cli",
      scope: { tenantId: "t1", subjectId: "seat-9" },
      config: CONFIG,
      env: { ANTHROPIC_API_KEY: "sk-corp", MY_KEY: "sk-personal" } as NodeJS.ProcessEnv,
      storePath,
    });
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-personal" });
  });

  it("returns undefined when a binding rejects the backend (governed fallback)", async () => {
    await upsertCliBackendCredential(
      {
        credentialId: "corp",
        tenantId: "t1",
        scope: "enterprise",
        backendId: "claude-cli",
        envVars: { ANTHROPIC_API_KEY: ENV_REF },
      },
      storePath,
    );
    await setCliBackendCredentialBinding(
      { credentialId: "corp", allowedBackends: ["kiro-cli"] },
      storePath,
    );
    const env = await resolveCredentialEnvForRun({
      backendId: "claude-cli",
      scope: { tenantId: "t1" },
      config: CONFIG,
      env: { ANTHROPIC_API_KEY: "sk-corp" } as NodeJS.ProcessEnv,
      storePath,
    });
    expect(env).toBeUndefined();
  });

  it("returns undefined when the selected credential cannot resolve (fail-safe)", async () => {
    await upsertCliBackendCredential(
      {
        credentialId: "corp",
        tenantId: "t1",
        scope: "enterprise",
        backendId: "claude-cli",
        envVars: { ANTHROPIC_API_KEY: ENV_REF },
      },
      storePath,
    );
    const env = await resolveCredentialEnvForRun({
      backendId: "claude-cli",
      scope: { tenantId: "t1" },
      config: CONFIG,
      env: {} as NodeJS.ProcessEnv,
      storePath,
    });
    expect(env).toBeUndefined();
  });

  it("resolveCredentialForRun returns env + the selected credentialId (for attribution)", async () => {
    await upsertCliBackendCredential(
      {
        credentialId: "corp",
        tenantId: "t1",
        scope: "enterprise",
        backendId: "claude-cli",
        envVars: { ANTHROPIC_API_KEY: ENV_REF },
      },
      storePath,
    );
    const resolved = await resolveCredentialForRun({
      backendId: "claude-cli",
      model: "claude-sonnet",
      scope: { tenantId: "t1" },
      config: CONFIG,
      env: { ANTHROPIC_API_KEY: "sk-corp" } as NodeJS.ProcessEnv,
      storePath,
    });
    expect(resolved).toEqual({ env: { ANTHROPIC_API_KEY: "sk-corp" }, credentialId: "corp" });
  });
});
