import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeGovernanceOpMarker } from "./operation-marker.js";
import {
  abortAgentGovernanceRegistration,
  abortConversationArchiveGovernanceRegistration,
  activateAgentGovernanceRegistration,
  activateConversationArchiveGovernanceRegistration,
  assertConversationArchiveContentWritable,
  beginAgentGovernanceRegistration,
  beginConversationArchiveGovernanceRegistration,
  getSharedDataGovernanceCatalog,
  quarantinePath,
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

describe("governance create state machine", () => {
  it("agent pending → activate → active", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-agent-"));
    tempDirs.push(stateDir);
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-a",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: null,
      workspaceLocator: path.join(stateDir, "ws"),
      agentDirLocator: path.join(stateDir, "agent"),
    });
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    expect((await catalog.get(ids.agentResourceId))?.envelope.lifecycleState).toBe("pending");
    await activateAgentGovernanceRegistration({ ...ids, stateDir });
    expect((await catalog.get(ids.agentResourceId))?.envelope.lifecycleState).toBe("active");
  });

  it("agent abort marks recovery_required then quarantined without hard-delete", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-agent-abort-"));
    tempDirs.push(stateDir);
    const workspaceLocator = path.join(stateDir, "ws");
    const agentDirLocator = path.join(stateDir, "agent");
    const operationId = "op-abort-1";
    fs.mkdirSync(workspaceLocator, { recursive: true });
    fs.writeFileSync(path.join(workspaceLocator, "BOOTSTRAP.md"), "x\n");
    fs.mkdirSync(agentDirLocator, { recursive: true });
    writeGovernanceOpMarker({ targetPath: workspaceLocator, operationId, kind: "directory" });
    writeGovernanceOpMarker({ targetPath: agentDirLocator, operationId, kind: "directory" });
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-b",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: null,
      workspaceLocator,
      agentDirLocator,
    });
    const result = await abortAgentGovernanceRegistration({
      ...ids,
      workspaceLocator,
      agentDirLocator,
      reason: "test_abort",
      stateDir,
      operationId,
      allowedRoots: [workspaceLocator, agentDirLocator],
    });
    expect(result.recoveryRequired).toBe(false);
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    expect((await catalog.get(ids.agentResourceId))?.envelope.lifecycleState).toBe("quarantined");
    expect(fs.existsSync(workspaceLocator)).toBe(false);
  });

  it("abort refuses to quarantine paths without matching marker", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-preexist-"));
    tempDirs.push(stateDir);
    const workspaceLocator = path.join(stateDir, "user-ws");
    const agentDirLocator = path.join(stateDir, "agent-new");
    fs.mkdirSync(workspaceLocator, { recursive: true });
    fs.writeFileSync(path.join(workspaceLocator, "KEEP.md"), "precious\n");
    const keepMarker = path.join(workspaceLocator, "KEEP.md");
    const operationId = "op-pre-2";
    fs.mkdirSync(agentDirLocator, { recursive: true });
    writeGovernanceOpMarker({ targetPath: agentDirLocator, operationId, kind: "directory" });
    const ids = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-pre",
      tenantId: "t1",
      ownerUserId: "u1",
      ownerPositionId: null,
      workspaceLocator,
      agentDirLocator,
    });
    await abortAgentGovernanceRegistration({
      ...ids,
      workspaceLocator,
      agentDirLocator,
      reason: "registry_failed",
      stateDir,
      operationId,
      allowedRoots: [workspaceLocator, agentDirLocator],
    });
    expect(fs.existsSync(keepMarker)).toBe(true);
    expect(fs.readFileSync(keepMarker, "utf8")).toBe("precious\n");
    expect(fs.existsSync(agentDirLocator)).toBe(false);
  });

  it("quarantinePath skips when marker missing", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-q-"));
    tempDirs.push(stateDir);
    const target = path.join(stateDir, "existing");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "a.txt"), "1\n");
    const result = await quarantinePath({
      targetPath: target,
      reason: "should_not_move",
      stateDir,
      operationId: "op-x",
      kind: "directory",
      allowedRoots: [target],
    });
    expect(result.status).toBe("skipped");
    expect(fs.existsSync(path.join(target, "a.txt"))).toBe(true);
  });

  it("beginAgentGovernanceRegistration compensates when workspace put fails", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-dual-"));
    tempDirs.push(stateDir);
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    let calls = 0;
    const realPut = catalog.put.bind(catalog);
    vi.spyOn(catalog, "put").mockImplementation(async (record) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("simulated_workspace_put_failure");
      }
      return realPut(record);
    });

    await expect(
      beginAgentGovernanceRegistration({
        stateDir,
        agentId: "bot-dual",
        tenantId: "t1",
        ownerUserId: "u1",
        ownerPositionId: null,
        workspaceLocator: path.join(stateDir, "ws"),
        agentDirLocator: path.join(stateDir, "agent"),
      }),
    ).rejects.toThrow(/simulated_workspace_put_failure/);

    expect(await catalog.get("agent:t1:bot-dual")).toBeNull();
  });

  it("conversation abort quarantines marked file and keeps catalog row", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-arch-"));
    tempDirs.push(stateDir);
    const transcriptPath = path.join(stateDir, "s1.jsonl");
    const operationId = "op-arch-1";
    const resourceId = await beginConversationArchiveGovernanceRegistration({
      stateDir,
      transcriptPath,
      sessionId: "s1",
      tenantId: "t1",
      ownerUserId: "u1",
      requireIdentity: true,
    });
    fs.writeFileSync(transcriptPath, "{}\n", "utf8");
    writeGovernanceOpMarker({ targetPath: transcriptPath, operationId, kind: "file" });
    const result = await abortConversationArchiveGovernanceRegistration({
      resourceId,
      transcriptPath,
      reason: "test_abort",
      stateDir,
      operationId,
      allowedRoots: [path.dirname(transcriptPath), transcriptPath],
    });
    expect(result.recoveryRequired).toBe(false);
    expect(fs.existsSync(transcriptPath)).toBe(false);
    expect(
      (await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId))?.envelope.lifecycleState,
    ).toBe("quarantined");
  });

  it("conversation activate after successful create", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-arch-ok-"));
    tempDirs.push(stateDir);
    const transcriptPath = path.join(stateDir, "s2.jsonl");
    const resourceId = await beginConversationArchiveGovernanceRegistration({
      stateDir,
      transcriptPath,
      sessionId: "s2",
      tenantId: "t1",
      ownerUserId: "u1",
    });
    fs.writeFileSync(transcriptPath, "{}\n", "utf8");
    await activateConversationArchiveGovernanceRegistration({ resourceId, stateDir });
    const got = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(got?.envelope.lifecycleState).toBe("active");
    expect(got?.envelope.tenantId).toBe("t1");
    expect(got?.envelope.owner).toEqual({ kind: "user", userId: "u1" });
  });

  it("content write gate rejects pending conversation archive", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-arch-pending-write-"));
    tempDirs.push(stateDir);
    const transcriptPath = path.join(stateDir, "pending.jsonl");
    await beginConversationArchiveGovernanceRegistration({
      stateDir,
      transcriptPath,
      sessionId: "pending-s",
      tenantId: "t1",
      ownerUserId: "u1",
      requireIdentity: true,
    });
    await expect(
      assertConversationArchiveContentWritable({
        stateDir,
        transcriptPath,
        sessionId: "pending-s",
        tenantId: "t1",
      }),
    ).rejects.toThrow(/governance_envelope_not_writable:pending/);
  });

  it("content write gate allows active conversation archive", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-arch-active-write-"));
    tempDirs.push(stateDir);
    const transcriptPath = path.join(stateDir, "active.jsonl");
    const resourceId = await beginConversationArchiveGovernanceRegistration({
      stateDir,
      transcriptPath,
      sessionId: "active-s",
      tenantId: "t1",
      ownerUserId: "u1",
      requireIdentity: true,
    });
    await activateConversationArchiveGovernanceRegistration({ resourceId, stateDir });
    await expect(
      assertConversationArchiveContentWritable({
        stateDir,
        transcriptPath,
        sessionId: "active-s",
        tenantId: "t1",
      }),
    ).resolves.toBeUndefined();
  });
});
