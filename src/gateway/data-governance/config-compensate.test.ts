import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compensateAgentCreateFailure } from "./create-compensate.js";
import { writeGovernanceOpMarker } from "./operation-marker.js";
import {
  beginAgentGovernanceRegistration,
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "./runtime-catalog.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("compensateAgentCreateFailure (production)", () => {
  it("halts on config restore failure without quarantine of marked paths", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-comp-halt-"));
    tempDirs.push(stateDir);
    const workspaceLocator = path.join(stateDir, "ws");
    const agentDirLocator = path.join(stateDir, "agent");
    fs.mkdirSync(workspaceLocator, { recursive: true });
    fs.writeFileSync(path.join(workspaceLocator, "KEEP.md"), "x\n");
    const operationId = "op-halt-1";
    writeGovernanceOpMarker({
      targetPath: workspaceLocator,
      operationId,
      kind: "directory",
    });
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-halt",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: null,
      workspaceLocator,
      agentDirLocator,
    });

    const writeConfigFile = vi.fn(async () => {
      throw new Error("config_restore_failed");
    });

    const result = await compensateAgentCreateFailure({
      operationId,
      reason: "registry_failed",
      agentId: "bot-halt",
      stateDir,
      configSnapshot: { agents: { list: [] } } as never,
      configWritten: true,
      writeConfigFile,
      ownershipBound: false,
      seatBound: false,
      registrySaved: false,
      registryAssetId: null,
      tenantId: "t1",
      ownerUserId: "u1",
      ownerUserLabel: "u1",
      ownerPositionId: null,
      governanceIds: ids,
      workspaceLocator,
      agentDirLocator,
      allowedRoots: [workspaceLocator, agentDirLocator],
    });

    expect(result.haltedAtConfigRestore).toBe(true);
    expect(result.recoveryRequired).toBe(true);
    expect(result.stage).toBe("config_restore");
    expect(result.failedStages).toEqual(["config_restore"]);
    expect(fs.existsSync(path.join(workspaceLocator, "KEEP.md"))).toBe(true);
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    expect((await catalog.get(ids.agentResourceId))?.envelope.lifecycleState).toBe(
      "recovery_required",
    );
    const receipt = path.join(
      stateDir,
      "data-governance",
      "recovery",
      "op-halt-1-config_restore.json",
    );
    expect(fs.existsSync(receipt)).toBe(true);
  });

  it("seat unbind failure keeps recoveryRequired even when quarantine succeeds", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-comp-seat-"));
    tempDirs.push(stateDir);
    const workspaceLocator = path.join(stateDir, "ws");
    const agentDirLocator = path.join(stateDir, "agent");
    fs.mkdirSync(workspaceLocator, { recursive: true });
    fs.mkdirSync(agentDirLocator, { recursive: true });
    const operationId = "op-seat-fail";
    writeGovernanceOpMarker({
      targetPath: workspaceLocator,
      operationId,
      kind: "directory",
    });
    writeGovernanceOpMarker({
      targetPath: agentDirLocator,
      operationId,
      kind: "directory",
    });
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-seat",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: "seat-1",
      workspaceLocator,
      agentDirLocator,
    });

    const result = await compensateAgentCreateFailure({
      operationId,
      reason: "tx_failed",
      agentId: "bot-seat",
      stateDir,
      configSnapshot: { agents: { list: [] } } as never,
      configWritten: true,
      writeConfigFile: async () => undefined,
      ownershipBound: false,
      seatBound: true,
      registrySaved: false,
      registryAssetId: null,
      tenantId: "t1",
      ownerUserId: "u1",
      ownerUserLabel: "u1",
      ownerPositionId: "seat-1",
      governanceIds: ids,
      workspaceLocator,
      agentDirLocator,
      allowedRoots: [workspaceLocator, agentDirLocator],
      unbindSeat: async () => {
        throw new Error("seat_unbind_failed");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.recoveryRequired).toBe(true);
    expect(result.failedStages).toContain("seat_unbind");
    expect(
      (await getSharedDataGovernanceCatalog({ stateDir }).get(ids.agentResourceId))?.envelope
        .lifecycleState,
    ).toBe("recovery_required");
  });

  it("registry release failure accumulates recoveryRequired and keeps catalog there", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-comp-reg-"));
    tempDirs.push(stateDir);
    const workspaceLocator = path.join(stateDir, "ws");
    const agentDirLocator = path.join(stateDir, "agent");
    fs.mkdirSync(workspaceLocator, { recursive: true });
    fs.mkdirSync(agentDirLocator, { recursive: true });
    const operationId = "op-reg-fail";
    writeGovernanceOpMarker({
      targetPath: workspaceLocator,
      operationId,
      kind: "directory",
    });
    writeGovernanceOpMarker({
      targetPath: agentDirLocator,
      operationId,
      kind: "directory",
    });
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-reg",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: "seat-1",
      workspaceLocator,
      agentDirLocator,
    });

    const result = await compensateAgentCreateFailure({
      operationId,
      reason: "tx_failed",
      agentId: "bot-reg",
      stateDir,
      configSnapshot: { agents: { list: [] } } as never,
      configWritten: true,
      writeConfigFile: async () => undefined,
      ownershipBound: false,
      seatBound: false,
      registrySaved: true,
      registryAssetId: "asset-1",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerUserLabel: "u1",
      ownerPositionId: "seat-1",
      governanceIds: ids,
      workspaceLocator,
      agentDirLocator,
      allowedRoots: [workspaceLocator, agentDirLocator],
      releaseRegistry: async () => {
        throw new Error("registry_release_failed");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.recoveryRequired).toBe(true);
    expect(result.failedStages).toContain("registry_release");
    expect(
      (await getSharedDataGovernanceCatalog({ stateDir }).get(ids.agentResourceId))?.envelope
        .lifecycleState,
    ).toBe("recovery_required");
  });

  it("restores config then marker-quarantines owned paths and leaves catalog quarantined", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-comp-ok-"));
    tempDirs.push(stateDir);
    const workspaceLocator = path.join(stateDir, "ws");
    const agentDirLocator = path.join(stateDir, "agent");
    fs.mkdirSync(workspaceLocator, { recursive: true });
    fs.mkdirSync(agentDirLocator, { recursive: true });
    const operationId = "op-ok-1";
    writeGovernanceOpMarker({
      targetPath: workspaceLocator,
      operationId,
      kind: "directory",
    });
    writeGovernanceOpMarker({
      targetPath: agentDirLocator,
      operationId,
      kind: "directory",
    });
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-ok",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: null,
      workspaceLocator,
      agentDirLocator,
    });

    const order: string[] = [];
    const writeConfigFile = vi.fn(async () => {
      order.push("config");
    });

    const result = await compensateAgentCreateFailure({
      operationId,
      reason: "activate_failed",
      agentId: "bot-ok",
      stateDir,
      configSnapshot: { agents: { list: [] } } as never,
      configWritten: true,
      writeConfigFile,
      ownershipBound: false,
      seatBound: false,
      registrySaved: false,
      registryAssetId: null,
      tenantId: "t1",
      ownerUserId: "u1",
      ownerUserLabel: "u1",
      ownerPositionId: null,
      governanceIds: ids,
      workspaceLocator,
      agentDirLocator,
      allowedRoots: [workspaceLocator, agentDirLocator],
    });

    expect(order).toEqual(["config"]);
    expect(result.ok).toBe(true);
    expect(result.haltedAtConfigRestore).toBe(false);
    expect(fs.existsSync(workspaceLocator)).toBe(false);
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    expect((await catalog.get(ids.agentResourceId))?.envelope.lifecycleState).toBe("quarantined");
    expect((await catalog.get(ids.workspaceResourceId))?.envelope.lifecycleState).toBe(
      "quarantined",
    );
  });

  it("does not quarantine pre-existing dirs without operation marker", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-comp-pre-"));
    tempDirs.push(stateDir);
    const workspaceLocator = path.join(stateDir, "user-ws");
    const agentDirLocator = path.join(stateDir, "agent-new");
    fs.mkdirSync(workspaceLocator, { recursive: true });
    fs.writeFileSync(path.join(workspaceLocator, "KEEP.md"), "precious\n");
    fs.mkdirSync(agentDirLocator, { recursive: true });
    const operationId = "op-pre-1";
    // Only agentDir is create-owned.
    writeGovernanceOpMarker({
      targetPath: agentDirLocator,
      operationId,
      kind: "directory",
    });
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-pre",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: null,
      workspaceLocator,
      agentDirLocator,
    });

    await compensateAgentCreateFailure({
      operationId,
      reason: "fail",
      agentId: "bot-pre",
      stateDir,
      configSnapshot: { agents: { list: [] } } as never,
      configWritten: false,
      writeConfigFile: async () => undefined,
      ownershipBound: false,
      seatBound: false,
      registrySaved: false,
      registryAssetId: null,
      tenantId: "t1",
      ownerUserId: "u1",
      ownerUserLabel: "u1",
      ownerPositionId: null,
      governanceIds: ids,
      workspaceLocator,
      agentDirLocator,
      allowedRoots: [workspaceLocator, agentDirLocator],
    });

    expect(fs.existsSync(path.join(workspaceLocator, "KEEP.md"))).toBe(true);
    expect(fs.existsSync(agentDirLocator)).toBe(false);
  });

  it("absorbs recovery receipt write failure and still returns recoveryRequired", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-comp-receipt-"));
    tempDirs.push(stateDir);
    const workspaceLocator = path.join(stateDir, "ws");
    const agentDirLocator = path.join(stateDir, "agent");
    fs.mkdirSync(workspaceLocator, { recursive: true });
    fs.mkdirSync(agentDirLocator, { recursive: true });
    const operationId = "op-receipt-fail";
    writeGovernanceOpMarker({
      targetPath: workspaceLocator,
      operationId,
      kind: "directory",
    });
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-receipt",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: "seat-1",
      workspaceLocator,
      agentDirLocator,
    });

    const result = await compensateAgentCreateFailure({
      operationId,
      reason: "tx_failed",
      agentId: "bot-receipt",
      stateDir,
      configSnapshot: { agents: { list: [] } } as never,
      configWritten: true,
      writeConfigFile: async () => undefined,
      ownershipBound: false,
      seatBound: true,
      registrySaved: false,
      registryAssetId: null,
      tenantId: "t1",
      ownerUserId: "u1",
      ownerUserLabel: "u1",
      ownerPositionId: "seat-1",
      governanceIds: ids,
      workspaceLocator,
      agentDirLocator,
      allowedRoots: [workspaceLocator, agentDirLocator],
      unbindSeat: async () => {
        throw new Error("seat_unbind_failed");
      },
      writeReceipt: () => {
        throw new Error("receipt_disk_readonly");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.recoveryRequired).toBe(true);
    expect(result.failedStages).toContain("seat_unbind");
    expect(result.failedStages).toContain("receipt:seat_unbind");
    expect(
      (await getSharedDataGovernanceCatalog({ stateDir }).get(ids.agentResourceId))?.envelope
        .lifecycleState,
    ).toBe("recovery_required");
  });

  it("absorbs catalog markRecovery failure after config restore halt", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-comp-mark-"));
    tempDirs.push(stateDir);
    const workspaceLocator = path.join(stateDir, "ws");
    const agentDirLocator = path.join(stateDir, "agent");
    fs.mkdirSync(workspaceLocator, { recursive: true });
    const operationId = "op-mark-fail";
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-mark",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: null,
      workspaceLocator,
      agentDirLocator,
    });

    const result = await compensateAgentCreateFailure({
      operationId,
      reason: "registry_failed",
      agentId: "bot-mark",
      stateDir,
      configSnapshot: { agents: { list: [] } } as never,
      configWritten: true,
      writeConfigFile: async () => {
        throw new Error("config_restore_failed");
      },
      ownershipBound: false,
      seatBound: false,
      registrySaved: false,
      registryAssetId: null,
      tenantId: "t1",
      ownerUserId: "u1",
      ownerUserLabel: "u1",
      ownerPositionId: null,
      governanceIds: ids,
      workspaceLocator,
      agentDirLocator,
      allowedRoots: [workspaceLocator, agentDirLocator],
      markRecovery: async () => {
        throw new Error("catalog_mark_failed");
      },
    });

    expect(result.haltedAtConfigRestore).toBe(true);
    expect(result.recoveryRequired).toBe(true);
    expect(result.failedStages).toContain("config_restore");
    expect(result.failedStages).toContain("catalog_mark_recovery");
  });

  it("absorbs abort/quarantine throw and still returns without rejecting", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-comp-abort-"));
    tempDirs.push(stateDir);
    const workspaceLocator = path.join(stateDir, "ws");
    const agentDirLocator = path.join(stateDir, "agent");
    fs.mkdirSync(workspaceLocator, { recursive: true });
    fs.mkdirSync(agentDirLocator, { recursive: true });
    const operationId = "op-abort-throw";
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-abort",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: null,
      workspaceLocator,
      agentDirLocator,
    });

    const result = await compensateAgentCreateFailure({
      operationId,
      reason: "activate_failed",
      agentId: "bot-abort",
      stateDir,
      configSnapshot: { agents: { list: [] } } as never,
      configWritten: false,
      writeConfigFile: async () => undefined,
      ownershipBound: false,
      seatBound: false,
      registrySaved: false,
      registryAssetId: null,
      tenantId: "t1",
      ownerUserId: "u1",
      ownerUserLabel: "u1",
      ownerPositionId: null,
      governanceIds: ids,
      workspaceLocator,
      agentDirLocator,
      allowedRoots: [workspaceLocator, agentDirLocator],
      abortRegistration: async () => {
        throw new Error("abort_quarantine_boom");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.recoveryRequired).toBe(true);
    expect(result.failedStages).toContain("abort_quarantine");
    expect(
      (await getSharedDataGovernanceCatalog({ stateDir }).get(ids.agentResourceId))?.envelope
        .lifecycleState,
    ).toBe("recovery_required");
  });
});
