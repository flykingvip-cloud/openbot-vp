import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SecretRef } from "../config/types.secrets.js";
import {
  bindingAllows,
  listCliBackendCredentials,
  removeCliBackendCredential,
  selectCredentialForRun,
  setCliBackendCredentialBinding,
  upsertCliBackendCredential,
  validateCredentialEnvVars,
  type CliBackendCredential,
  type CredentialBinding,
} from "./cli-backend-credential-store.js";

const ENV_REF: SecretRef = { source: "env", provider: "default", id: "ANTHROPIC_API_KEY" };
const VAULT_REF: SecretRef = { source: "exec", provider: "vault", id: "anthropic/api-key" };

describe("validateCredentialEnvVars (SecretRef-First — no plaintext)", () => {
  it("accepts SecretRef values", () => {
    expect(validateCredentialEnvVars({ ANTHROPIC_API_KEY: ENV_REF })).toEqual({
      ANTHROPIC_API_KEY: ENV_REF,
    });
  });

  it("rejects plaintext string values", () => {
    expect(() => validateCredentialEnvVars({ ANTHROPIC_API_KEY: "sk-plain" })).toThrow(/SecretRef/);
  });

  it("rejects non-objects", () => {
    expect(() => validateCredentialEnvVars("nope")).toThrow();
  });
});

describe("bindingAllows (Task 12 governance)", () => {
  it("no binding ⇒ allowed", () => {
    expect(bindingAllows(undefined, { backendId: "claude-cli" })).toBe(true);
  });

  it("backend allow-list filters", () => {
    const b: CredentialBinding = { credentialId: "c", allowedBackends: ["claude-cli"] };
    expect(bindingAllows(b, { backendId: "claude-cli" })).toBe(true);
    expect(bindingAllows(b, { backendId: "kiro-cli" })).toBe(false);
  });

  it("model allow-list matches <backend>/<model> or bare model", () => {
    const b: CredentialBinding = { credentialId: "c", allowedModels: ["claude-cli/claude-sonnet"] };
    expect(bindingAllows(b, { backendId: "claude-cli", model: "claude-sonnet" })).toBe(true);
    expect(bindingAllows(b, { backendId: "claude-cli", model: "claude-opus" })).toBe(false);
  });

  it("role allow-list requires a matching role", () => {
    const b: CredentialBinding = { credentialId: "c", allowedRoles: ["developer"] };
    expect(bindingAllows(b, { backendId: "x", role: "developer" })).toBe(true);
    expect(bindingAllows(b, { backendId: "x", role: "viewer" })).toBe(false);
    expect(bindingAllows(b, { backendId: "x" })).toBe(false);
  });
});

describe("selectCredentialForRun (priority: personal → enterprise)", () => {
  const ent: CliBackendCredential = {
    credentialId: "corp",
    tenantId: "t1",
    scope: "enterprise",
    backendId: "claude-cli",
    envVars: { ANTHROPIC_API_KEY: VAULT_REF },
    updatedAt: "now",
  };
  const personal: CliBackendCredential = {
    credentialId: "mine",
    tenantId: "t1",
    scope: "personal",
    subjectId: "seat-9",
    backendId: "claude-cli",
    envVars: { ANTHROPIC_API_KEY: ENV_REF },
    updatedAt: "now",
  };

  it("prefers personal (matching subject) over enterprise", () => {
    const picked = selectCredentialForRun({
      credentials: [ent, personal],
      bindings: {},
      tenantId: "t1",
      backendId: "claude-cli",
      subjectId: "seat-9",
    });
    expect(picked?.credentialId).toBe("mine");
  });

  it("falls back to enterprise when no matching personal", () => {
    const picked = selectCredentialForRun({
      credentials: [ent, personal],
      bindings: {},
      tenantId: "t1",
      backendId: "claude-cli",
      subjectId: "other-seat",
    });
    expect(picked?.credentialId).toBe("corp");
  });

  it("excludes credentials whose binding rejects the context", () => {
    const picked = selectCredentialForRun({
      credentials: [ent],
      bindings: { corp: { credentialId: "corp", allowedBackends: ["kiro-cli"] } },
      tenantId: "t1",
      backendId: "claude-cli",
    });
    expect(picked).toBeNull();
  });

  it("isolates by tenant + backend", () => {
    expect(
      selectCredentialForRun({
        credentials: [ent],
        bindings: {},
        tenantId: "t2",
        backendId: "claude-cli",
      }),
    ).toBeNull();
    expect(
      selectCredentialForRun({
        credentials: [ent],
        bindings: {},
        tenantId: "t1",
        backendId: "kiro-cli",
      }),
    ).toBeNull();
  });
});

describe("store IO (temp path, no real config)", () => {
  let dir: string;
  let storePath: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cli-cred-"));
    storePath = path.join(dir, "creds.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("upsert → list → remove round-trip; bindings cleared on remove", async () => {
    await upsertCliBackendCredential(
      {
        credentialId: "corp",
        tenantId: "t1",
        scope: "enterprise",
        backendId: "claude-cli",
        envVars: { ANTHROPIC_API_KEY: VAULT_REF },
      },
      storePath,
    );
    await setCliBackendCredentialBinding(
      { credentialId: "corp", allowedBackends: ["claude-cli"] },
      storePath,
    );
    expect(await listCliBackendCredentials("t1", storePath)).toHaveLength(1);
    expect((await getBindings(storePath)).corp?.allowedBackends).toEqual(["claude-cli"]);

    expect(await removeCliBackendCredential("corp", storePath)).toBe(true);
    expect(await listCliBackendCredentials("t1", storePath)).toHaveLength(0);
    expect((await getBindings(storePath)).corp).toBeUndefined();
  });

  it("personal credential requires subjectId", async () => {
    await expect(
      upsertCliBackendCredential(
        {
          credentialId: "mine",
          tenantId: "t1",
          scope: "personal",
          backendId: "claude-cli",
          envVars: { ANTHROPIC_API_KEY: ENV_REF },
        },
        storePath,
      ),
    ).rejects.toThrow(/subjectId/);
  });

  it("rejects plaintext envVars at upsert", async () => {
    await expect(
      upsertCliBackendCredential(
        {
          credentialId: "bad",
          tenantId: "t1",
          scope: "enterprise",
          backendId: "claude-cli",
          envVars: { ANTHROPIC_API_KEY: "sk-plain" as unknown as SecretRef },
        },
        storePath,
      ),
    ).rejects.toThrow(/SecretRef/);
  });
});

async function getBindings(storePath: string) {
  const { getCliBackendCredentialBindings } = await import("./cli-backend-credential-store.js");
  return getCliBackendCredentialBindings(storePath);
}
