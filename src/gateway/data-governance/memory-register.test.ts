import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateMemoryGovernanceRegistration,
  assertMemoryCanonicalAllowed,
  beginMemoryGovernanceRegistration,
  buildCogniWeaveMemorySourceId,
  buildMemoryResourceId,
  prepareMemoryContentWriteSession,
  finalizeMemoryContentWriteSession,
} from "./memory-register.js";
import { ownershipProofFromSeat, ownershipProofFromTenantUser } from "./ownership-proof.js";
import {
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "./runtime-catalog.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("memory governance registration (P1-2-b)", () => {
  it("builds memory resource ids for atom and source grains", () => {
    expect(buildMemoryResourceId({ tenantId: "t1", atomId: "atom-9", sourceId: "unused" })).toBe(
      "memory:t1:atom:atom-9",
    );
    expect(buildMemoryResourceId({ tenantId: null, sourceId: "ws-main-memory" })).toBe(
      "memory:local:source:ws-main-memory",
    );
  });

  it("fail-closes managed enterprise when canonical is not CogniWeave", () => {
    expect(() =>
      assertMemoryCanonicalAllowed({
        profile: "managed_enterprise",
        canonicalKind: "markdown_root",
      }),
    ).toThrow(/managed_requires_cogniweave/);
  });

  it("fail-closes managed memory registration without tenantId", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mem-tenant-"));
    tempDirs.push(stateDir);
    await expect(
      beginMemoryGovernanceRegistration({
        stateDir,
        tenantId: null,
        owner: { kind: "user", userId: "u1" },
        scope: { kind: "tenant", tenantId: "t1" },
        profile: "managed_enterprise",
        canonicalKind: "cogniweave",
        sourceId: "cw-1",
        canonicalLocator: path.join(stateDir, "cw.sqlite"),
      }),
    ).rejects.toThrow(/managed_requires_tenant/);
  });

  it("registers managed CogniWeave canonical with derived builtin index and no atom body", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mem-"));
    tempDirs.push(stateDir);
    const cogniweave = path.join(stateDir, "cogniweave", "canonical.sqlite");
    const builtin = path.join(stateDir, "memory", "agent.sqlite");
    fs.mkdirSync(path.dirname(cogniweave), { recursive: true });
    fs.writeFileSync(cogniweave, "");
    fs.mkdirSync(path.dirname(builtin), { recursive: true });
    fs.writeFileSync(builtin, "");

    const { resourceId } = await beginMemoryGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      profile: "managed_enterprise",
      canonicalKind: "cogniweave",
      sourceId: "cw-scope-1",
      atomId: "atom-1",
      memoryTier: "working",
      sourceWorkspaceResourceId: "ws-abc",
      canonicalLocator: cogniweave,
      derivedLocators: [{ role: "derived", locator: builtin, storageKind: "sqlite" }],
    });

    await expect(
      beginMemoryGovernanceRegistration({
        stateDir,
        tenantId: "t1",
        owner: { kind: "user", userId: "u1" },
        scope: { kind: "tenant", tenantId: "t1" },
        profile: "managed_enterprise",
        canonicalKind: "markdown_root",
        sourceId: "md-denied",
        canonicalLocator: path.join(stateDir, "MEMORY.md"),
      }),
    ).rejects.toThrow(/managed_requires_cogniweave/);

    const pending = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(pending?.envelope.resourceType).toBe("memory");
    expect(pending?.envelope.lifecycleState).toBe("pending");
    expect(pending?.envelope.projection?.canonicalKind).toBe("cogniweave");
    expect(pending?.bindings.filter((b) => b.role === "canonical")).toHaveLength(1);
    expect(pending?.bindings.some((b) => b.role === "derived")).toBe(true);

    await activateMemoryGovernanceRegistration({ resourceId, stateDir });
    const active = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(active?.envelope.lifecycleState).toBe("active");

    const serialized = JSON.stringify(active);
    expect(serialized).not.toMatch(/embedding|vector|claimBody|atom body/i);
    expect(active?.envelope.projection?.atomId).toBe("atom-1");
  });

  it("allows personal_local markdown_root canonical when CogniWeave absent", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mem-md-"));
    tempDirs.push(stateDir);
    const memoryRoot = path.join(stateDir, "workspace", "memory");
    fs.mkdirSync(memoryRoot, { recursive: true });
    fs.writeFileSync(path.join(memoryRoot, "MEMORY.md"), "# private notes\n");

    const { resourceId } = await beginMemoryGovernanceRegistration({
      stateDir,
      tenantId: null,
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "user", userId: "u1" },
      profile: "personal_local",
      canonicalKind: "markdown_root",
      sourceId: "personal-md",
      canonicalLocator: memoryRoot,
    });
    await activateMemoryGovernanceRegistration({ resourceId, stateDir });

    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(record?.envelope.projection?.canonicalKind).toBe("markdown_root");
    expect(JSON.stringify(record)).not.toContain("private notes");
  });

  it("builds per-scope CogniWeave source ids (not tenant-wide canonical)", () => {
    const a = buildCogniWeaveMemorySourceId({
      visibility: "private",
      workspaceId: "ws-1",
      agentId: "agent-a",
    });
    const b = buildCogniWeaveMemorySourceId({
      visibility: "private",
      workspaceId: "ws-1",
      agentId: "agent-b",
    });
    expect(a).not.toBe(b);
    expect(a).toContain("agent-a");
    expect(b).toContain("agent-b");
    expect(buildMemoryResourceId({ tenantId: "t1", sourceId: a })).not.toBe(
      buildMemoryResourceId({ tenantId: "t1", sourceId: b }),
    );
  });

  it("managed memory prepare creates pending then finalize activates (seat owner proof)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mem-create-"));
    tempDirs.push(stateDir);
    const storePath = path.join(stateDir, "cw.sqlite");
    fs.writeFileSync(storePath, "");
    const sourceId = buildCogniWeaveMemorySourceId({
      visibility: "private",
      workspaceId: "ws1",
      agentId: "agent-main",
    });
    const proof = ownershipProofFromSeat({ tenantId: "t1", seatId: "seat-1" });
    const session = await prepareMemoryContentWriteSession({
      tenantId: "t1",
      sourceId,
      canonicalLocator: storePath,
      canonicalKind: "cogniweave",
      ownershipProof: proof,
      stateDir,
    });
    expect(session.mode).toBe("create_pending");
    await finalizeMemoryContentWriteSession({
      session,
      ok: true,
      stateDir,
      allowedRoots: [stateDir],
    });
    const resourceId = buildMemoryResourceId({ tenantId: "t1", sourceId });
    const row = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(row?.envelope.lifecycleState).toBe("active");
    expect(row?.envelope.owner).toEqual({ kind: "position", seatId: "seat-1" });
    // Distinct from user-owner proof grain
    void ownershipProofFromTenantUser;
  });
});
