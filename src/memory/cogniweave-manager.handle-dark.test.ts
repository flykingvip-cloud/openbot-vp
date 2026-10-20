import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { emitSessionTranscriptUpdate } from "../sessions/transcript-events.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { CogniWeaveMemoryManager, resolveCogniWeaveSearchScope } from "./cogniweave-manager.js";
import { createMemoryWorkspaceHandle, isMemoryWorkspaceHandle } from "./memory-workspace-handle.js";
import { getMemorySearchManager, getMemorySearchManagerFromHandle } from "./search-manager.js";

const tempDirs: string[] = [];
const ORIGINAL_STATE_DIR = process.env.OPENBOT_STATE_DIR;

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cogniweave-handle-"));
  tempDirs.push(dir);
  return dir;
}

function createConfig(
  workspace: string,
  cloudTenant?: string,
  extras?: { writeSync?: "disabled" | "sync"; cloudEnabled?: boolean },
): OpenBotConfig {
  return {
    data: { root: path.join(workspace, "data-root"), mode: "local", schemaVersion: 1 },
    memory: {
      backend: "cogniweave",
      cogniweave: {
        mode: "embedded",
        writeSync: extras?.writeSync ?? "disabled",
        ...(cloudTenant
          ? {
              cloudSync: {
                enabled: extras?.cloudEnabled === true,
                tenantId: cloudTenant,
              },
            }
          : extras?.cloudEnabled
            ? { cloudSync: { enabled: true, tenantId: "tenant-a" } }
            : {}),
      },
    },
    agents: {
      list: [{ id: "main", default: true, workspace }],
    },
  };
}

function issueHandle(
  resourceId = "ws:tenant-a:user:elle:asset:unique-1",
  extras?: {
    lifecycle?: "active" | "retired" | "purged";
    search?: boolean;
  },
) {
  const result = createMemoryWorkspaceHandle({
    resourceId,
    memoryAssetResourceId: "memory:tenant-a:source:cw-1",
    tenantId: "tenant-a",
    agentAssetId: "unique-1",
    bindingId: "binding-1",
    canonicalObjectKey: "memory:tenant-a:source:cw-1",
    governanceVersion: 2,
    fencingToken: "9",
    lifecycle: extras?.lifecycle ?? "active",
    permissions: {
      search: extras?.search ?? true,
      ingest: false,
      distill: false,
      prune: false,
      reset: false,
      export: true,
    },
  });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.handle;
}

afterEach(async () => {
  if (ORIGINAL_STATE_DIR === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = ORIGINAL_STATE_DIR;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("U1 dark CogniWeave Handle consumer", () => {
  it("scopes new entry to Handle.resourceId and keeps legacy stableId entry", async () => {
    const workspace = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = workspace;
    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }
    const handle = issueHandle();
    const legacy = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });
    const dark = await CogniWeaveMemoryManager.createFromHandle({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
      handle,
    });
    expect(dark.ok).toBe(true);
    if (!dark.ok) {
      return;
    }
    expect(legacy.inspectDarkWorkspaceIdentity().fromHandle).toBe(false);
    expect(legacy.inspectDarkWorkspaceIdentity().resourceId).toBeNull();
    expect(dark.manager.inspectDarkWorkspaceIdentity()).toMatchObject({
      workspaceId: handle.resourceId,
      fromHandle: true,
      resourceId: handle.resourceId,
      defaultScopeWorkspaceId: handle.resourceId,
    });
    expect(dark.manager.inspectDarkWorkspaceIdentity().defaultScopeWorkspaceId).toBe(
      handle.resourceId,
    );
    expect(legacy.inspectDarkWorkspaceIdentity().workspaceId).not.toBe(handle.resourceId);
    expect(legacy.inspectDarkWorkspaceIdentity().defaultScopeWorkspaceId).toBe(
      legacy.inspectDarkWorkspaceIdentity().workspaceId,
    );
  });

  it("denies unbranded handles and cloud tenant mismatch", async () => {
    const workspace = await makeWorkspace();
    const cfg = createConfig(workspace, "cloud-other");
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }
    const forged = {
      resourceId: "ws-forged",
      memoryAssetResourceId: "mem",
      tenantId: "tenant-a",
      bindingId: "b",
      canonicalObjectKey: "k",
      governanceVersion: 1,
      fencingToken: "1",
      lifecycle: "active",
      permissions: {
        search: true,
        ingest: false,
        distill: false,
        prune: false,
        reset: false,
        export: true,
      },
    };
    expect(isMemoryWorkspaceHandle(forged)).toBe(false);
    const unbranded = await CogniWeaveMemoryManager.createFromHandle({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
      handle: forged as never,
    });
    expect(unbranded).toMatchObject({ ok: false, reasonCode: "handle_not_branded" });

    const mismatch = await CogniWeaveMemoryManager.createFromHandle({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
      handle: issueHandle(),
    });
    expect(mismatch).toMatchObject({ ok: false, reasonCode: "tenant_mismatch" });
  });

  it("does not change production getMemorySearchManager", async () => {
    const workspace = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = workspace;
    const cfg = createConfig(workspace);
    const production = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(production.manager).toBeTruthy();
    const dark = await getMemorySearchManagerFromHandle({
      cfg,
      agentId: "main",
      handle: issueHandle(),
    });
    expect(dark.manager).toBeTruthy();
    expect(dark.error).toBeUndefined();
  });

  it("keeps resourceId stable when stateDir changes", async () => {
    const first = await makeWorkspace();
    const second = await makeWorkspace();
    const handle = issueHandle();
    const cfgA = createConfig(first);
    const cfgB = createConfig(second);
    const resolvedA = resolveMemoryBackendConfig({ cfg: cfgA, agentId: "main" });
    const resolvedB = resolveMemoryBackendConfig({ cfg: cfgB, agentId: "main" });
    if (!resolvedA.cogniweave || !resolvedB.cogniweave) {
      throw new Error("missing cogniweave config");
    }
    const a = await CogniWeaveMemoryManager.createFromHandle({
      cfg: cfgA,
      agentId: "main",
      resolved: resolvedA.cogniweave,
      handle,
      governance: undefined,
    });
    const b = await CogniWeaveMemoryManager.createFromHandle({
      cfg: cfgB,
      agentId: "main",
      resolved: resolvedB.cogniweave,
      handle,
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.manager.inspectDarkWorkspaceIdentity().workspaceId).toBe(handle.resourceId);
      expect(b.manager.inspectDarkWorkspaceIdentity().workspaceId).toBe(handle.resourceId);
      expect(a.manager.inspectDarkWorkspaceIdentity().defaultScopeKey).toBe(
        b.manager.inspectDarkWorkspaceIdentity().defaultScopeKey,
      );
      expect(a.manager.inspectDarkWorkspaceIdentity().defaultScopeWorkspaceId).toBe(
        handle.resourceId,
      );
    }
  });

  it("builds defaultScope from Handle.resourceId and keeps scope keys when stateDir changes", async () => {
    const first = await makeWorkspace();
    const second = await makeWorkspace();
    const handle = issueHandle();
    const expectedScope = resolveCogniWeaveSearchScope({
      agentId: "main",
      workspaceId: handle.resourceId,
    });
    const resolvedA = resolveMemoryBackendConfig({ cfg: createConfig(first), agentId: "main" });
    const resolvedB = resolveMemoryBackendConfig({ cfg: createConfig(second), agentId: "main" });
    if (!resolvedA.cogniweave || !resolvedB.cogniweave) {
      throw new Error("missing cogniweave config");
    }
    const a = await CogniWeaveMemoryManager.createFromHandle({
      cfg: createConfig(first),
      agentId: "main",
      resolved: resolvedA.cogniweave,
      handle,
    });
    const b = await CogniWeaveMemoryManager.createFromHandle({
      cfg: createConfig(second),
      agentId: "main",
      resolved: resolvedB.cogniweave,
      handle,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(a.manager.inspectDarkWorkspaceIdentity().defaultScopeWorkspaceId).toBe(
      expectedScope.workspaceId,
    );
    expect(a.manager.inspectDarkWorkspaceIdentity().defaultScopeKey).toBe(
      b.manager.inspectDarkWorkspaceIdentity().defaultScopeKey,
    );
  });

  it("keeps dark Handle sync, session updates, and cloud loop at zero writes", async () => {
    const workspace = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = workspace;
    const cfg = createConfig(workspace, "tenant-a", { writeSync: "sync", cloudEnabled: true });
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }
    const dark = await CogniWeaveMemoryManager.createFromHandle({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
      handle: issueHandle(),
    });
    expect(dark.ok).toBe(true);
    if (!dark.ok) {
      return;
    }
    await dark.manager.sync({ reason: "manual" });
    emitSessionTranscriptUpdate(path.join(workspace, "sessions", "main.jsonl"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const identity = dark.manager.inspectDarkWorkspaceIdentity();
    expect(identity.writeBackCount).toBe(0);
    expect(identity.sessionWatcherArmed).toBe(false);
    expect(identity.cloudSyncStarted).toBe(false);
  });

  it("refuses ingest/distill/prune/reset for retired and purged Handles", async () => {
    const workspace = await makeWorkspace();
    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }
    for (const lifecycle of ["retired", "purged"] as const) {
      const created = await CogniWeaveMemoryManager.createFromHandle({
        cfg,
        agentId: "main",
        resolved: resolved.cogniweave,
        handle: issueHandle(`ws:tenant-a:user:elle:asset:${lifecycle}`, { lifecycle }),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) {
        continue;
      }
      const transcript = await created.manager.applyTranscriptSourceLifecycle?.({
        mode: "forget",
        sourceLocator: "memory.md",
        operationId: `op-${lifecycle}`,
      });
      expect(transcript).toMatchObject({
        ok: false,
        error: "memory_workspace_permission_denied:prune",
      });
      const artifact = await created.manager.applyMemoryArtifactLifecycle?.({
        memoryKey: "memory.md",
        operationId: `art-${lifecycle}`,
      });
      expect(artifact).toMatchObject({
        ok: false,
        error: "memory_workspace_permission_denied:prune",
      });
      expect(created.manager.inspectDarkWorkspaceIdentity().writeBackCount).toBe(0);
    }
  });

  it("keeps legacy create() on stableId(stateDir) and still starts production sync paths", async () => {
    const workspace = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = workspace;
    const cfg = createConfig(workspace, undefined, { writeSync: "sync" });
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }
    const legacy = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });
    const identity = legacy.inspectDarkWorkspaceIdentity();
    expect(identity.fromHandle).toBe(false);
    expect(identity.defaultScopeWorkspaceId).toBe(identity.workspaceId);
    expect(identity.workspaceId).not.toBe("ws:tenant-a:user:elle:asset:unique-1");
    expect(identity.sessionWatcherArmed).toBe(true);
  });
});
