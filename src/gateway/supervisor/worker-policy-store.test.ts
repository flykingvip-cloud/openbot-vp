import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getWorkerExecutionProfile,
  listWorkerExecutionPolicies,
  removeWorkerExecutionPolicy,
  upsertWorkerExecutionPolicy,
  validateWorkerExecutionPolicy,
} from "./worker-policy-store.js";

describe("worker-policy-store", () => {
  let storePath: string;

  beforeEach(() => {
    storePath = path.join(mkdtempSync(path.join(tmpdir(), "worker-policy-")), "policies.json");
  });

  afterEach(() => {
    rmSync(path.dirname(storePath), { recursive: true, force: true });
  });

  it("falls back to builtin defaults when no tenant policy exists", async () => {
    await expect(
      getWorkerExecutionProfile({ tenantId: "t1", workerId: "codex-cli", storePath }),
    ).resolves.toEqual({
      credentialPolicy: "enterprise_shared",
      executionPlacement: "gateway",
    });
    await expect(
      getWorkerExecutionProfile({ tenantId: "t1", workerId: "cursor-cli", storePath }),
    ).resolves.toEqual({
      credentialPolicy: "local_ide_login",
      executionPlacement: "node_agent",
    });
  });

  it("upserts and lists tenant-scoped overrides", async () => {
    await upsertWorkerExecutionPolicy(
      {
        tenantId: "t1",
        workerId: "cursor-cli",
        credentialPolicy: "enterprise_shared",
        executionPlacement: "gateway",
        actor: "enterprise-admin",
      },
      storePath,
    );
    const policies = await listWorkerExecutionPolicies("t1", storePath);
    expect(policies).toHaveLength(1);
    expect(policies[0]?.workerId).toBe("cursor-cli");
    await expect(
      getWorkerExecutionProfile({ tenantId: "t1", workerId: "cursor-cli", storePath }),
    ).resolves.toEqual({
      credentialPolicy: "enterprise_shared",
      executionPlacement: "gateway",
    });
  });

  it("remove clears override and reverts to defaults", async () => {
    await upsertWorkerExecutionPolicy(
      {
        tenantId: "t1",
        workerId: "codex-cli",
        credentialPolicy: "local_ide_login",
        executionPlacement: "node_agent",
        actor: "enterprise-admin",
      },
      storePath,
    );
    expect(
      await removeWorkerExecutionPolicy("t1", "codex-cli", "enterprise-admin", storePath),
    ).toBe(true);
    await expect(
      getWorkerExecutionProfile({ tenantId: "t1", workerId: "codex-cli", storePath }),
    ).resolves.toEqual({
      credentialPolicy: "enterprise_shared",
      executionPlacement: "gateway",
    });
  });

  it("rejects employee and session writes without changing stored bytes", async () => {
    await upsertWorkerExecutionPolicy(
      {
        tenantId: "t1",
        workerId: "codex-cli",
        credentialPolicy: "enterprise_shared",
        executionPlacement: "gateway",
        actor: "enterprise-admin",
      },
      storePath,
    );
    const before = readFileSync(storePath);
    await expect(
      upsertWorkerExecutionPolicy(
        {
          tenantId: "t1",
          workerId: "codex-cli",
          credentialPolicy: "local_ide_login",
          executionPlacement: "node_agent",
          actor: "employee",
        },
        storePath,
      ),
    ).rejects.toThrow(/enterprise-admin only/);
    await expect(
      upsertWorkerExecutionPolicy(
        {
          tenantId: "t1",
          workerId: "codex-cli",
          credentialPolicy: "local_ide_login",
          executionPlacement: "node_agent",
          actor: "session",
        },
        storePath,
      ),
    ).rejects.toThrow(/enterprise-admin only/);
    await expect(
      removeWorkerExecutionPolicy("t1", "codex-cli", "employee", storePath),
    ).rejects.toThrow(/enterprise-admin only/);
    expect(readFileSync(storePath).equals(before)).toBe(true);
    await expect(
      getWorkerExecutionProfile({ tenantId: "t1", workerId: "codex-cli", storePath }),
    ).resolves.toEqual({
      credentialPolicy: "enterprise_shared",
      executionPlacement: "gateway",
    });
  });

  it("rejects seat_personal policy", () => {
    expect(() =>
      validateWorkerExecutionPolicy({
        credentialPolicy: "seat_personal",
        executionPlacement: "gateway",
      }),
    ).toThrow(/seat_personal/);
  });
});
