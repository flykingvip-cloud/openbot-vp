import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../config/config.js";

let stateDir = "";

const listAgentEntriesMock = vi.fn(() => [{ id: "market-helper" }]);

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../../commands/agents.config.js", () => ({
  listAgentEntries: () => listAgentEntriesMock(),
  findAgentEntryIndex: (list: Array<{ id: string }>, agentId: string) =>
    list.findIndex((entry) => entry.id === agentId),
}));

vi.mock("../../config/paths.js", () => ({
  resolveStateDir: vi.fn(() => stateDir),
}));

const { workspaceHandlers } = await import("./workspaces.js");

function makeCall(method: keyof typeof workspaceHandlers, params: Record<string, unknown>) {
  const respond = vi.fn();
  const promise = workspaceHandlers[method]({
    req: { type: "req" as const, id: "1", method },
    params,
    respond,
    client: null,
    isWebchatConnect: () => false,
    context: {} as never,
  });
  return { respond, promise };
}

describe("workspace gateway handlers", () => {
  let localWorkspaceDir = "";

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-workspaces-state-"));
    localWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-local-workspace-"));
    await fs.mkdir(path.join(localWorkspaceDir, "docs"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(localWorkspaceDir, { recursive: true, force: true });
    stateDir = "";
    localWorkspaceDir = "";
    listAgentEntriesMock.mockClear();
    // Restore the default local-mode config for subsequent tests.
    vi.mocked(loadConfig).mockReturnValue({} as never);
  });

  it("hard-rejects local workspace RPCs in managed (SaaS) mode with LOCAL_ONLY", async () => {
    vi.mocked(loadConfig).mockReturnValue({ data: { mode: "managed" } } as never);
    const methods = [
      "workspaces.local.validate",
      "workspaces.local.browse",
      "workspaces.local.choose",
    ] as const;
    for (const method of methods) {
      const { respond, promise } = makeCall(method, { path: localWorkspaceDir });
      await promise;
      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({ code: "LOCAL_ONLY" }),
      );
    }
  });

  it("validates a readable writable local workspace path", async () => {
    const { respond, promise } = makeCall("workspaces.local.validate", {
      path: localWorkspaceDir,
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        resolvedPath: localWorkspaceDir,
        isDirectory: true,
        readable: true,
        writable: true,
      }),
      undefined,
    );
  });

  it("browses child directories for the local workspace chooser", async () => {
    const resolvedWorkspaceDir = await fs
      .realpath(localWorkspaceDir)
      .catch(() => localWorkspaceDir);
    const { respond, promise } = makeCall("workspaces.local.browse", {
      path: localWorkspaceDir,
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        currentPath: resolvedWorkspaceDir,
        entries: expect.arrayContaining([
          expect.objectContaining({
            name: "docs",
            path: path.join(resolvedWorkspaceDir, "docs"),
          }),
        ]),
      }),
      undefined,
    );
  });

  it("creates a local workspace record and binds it to a robot", async () => {
    const createCall = makeCall("workspaces.create", {
      name: "市场助手 Workspace",
      kind: "local",
      local: {
        path: localWorkspaceDir,
      },
    });
    await createCall.promise;

    const [, createPayload] = createCall.respond.mock.calls[0] ?? [];
    expect(createPayload).toMatchObject({
      ok: true,
      runtimePath: localWorkspaceDir,
      workspace: expect.objectContaining({
        kind: "local",
        status: "ready",
        runtimePath: localWorkspaceDir,
      }),
    });

    const workspaceId = (createPayload as { workspaceId: string }).workspaceId;
    const bindCall = makeCall("robots.bind-workspace", {
      agentId: "market-helper",
      workspaceId,
    });
    await bindCall.promise;

    expect(bindCall.respond).toHaveBeenCalledWith(
      true,
      {
        ok: true,
        agentId: "market-helper",
        workspaceId,
      },
      undefined,
    );

    const storePath = path.join(stateDir, "workspaces", "store.json");
    const persisted = JSON.parse(await fs.readFile(storePath, "utf8")) as {
      robotBindings: Record<string, string>;
      workspaces: Array<{ id: string }>;
    };
    expect(persisted.robotBindings["market-helper"]).toBe(workspaceId);
    expect(persisted.workspaces.some((entry) => entry.id === workspaceId)).toBe(true);
  });

  it("creates a nested local workspace directory when only the default root exists", async () => {
    const allocatedPath = path.join(localWorkspaceDir, "agents", "market-helper");
    const createCall = makeCall("workspaces.create", {
      name: "市场助手 Workspace",
      kind: "local",
      local: {
        path: allocatedPath,
      },
    });
    await createCall.promise;

    const [, createPayload] = createCall.respond.mock.calls[0] ?? [];
    expect(createPayload).toMatchObject({
      ok: true,
      runtimePath: allocatedPath,
      workspace: expect.objectContaining({
        kind: "local",
        status: "ready",
        runtimePath: allocatedPath,
      }),
    });
    const allocatedStat = await fs.stat(allocatedPath);
    expect(allocatedStat.isDirectory()).toBe(true);
  });

  it("generates cloud config through the provider adapter instead of UI string拼接", async () => {
    const { respond, promise } = makeCall("workspaces.cloud.generate-config", {
      provider: "aliyun-oss",
      region: "cn-hangzhou",
      bucket: "robot-workspaces",
      rootPrefix: "marketing-bot/",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        provider: "aliyun-oss",
        region: "cn-hangzhou",
        endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
        bucket: "robot-workspaces",
        rootPrefix: "marketing-bot/",
      },
      undefined,
    );
  });

  it("generates Huawei OBS config through the adapter", async () => {
    const { respond, promise } = makeCall("workspaces.cloud.generate-config", {
      provider: "huawei-obs",
      region: "ap-southeast-1",
      bucket: "robot-workspaces",
      rootPrefix: "design-team/",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        provider: "huawei-obs",
        region: "ap-southeast-1",
        endpoint: "https://obs.ap-southeast-1.myhuaweicloud.com",
        bucket: "robot-workspaces",
        rootPrefix: "design-team/",
      },
      undefined,
    );
  });

  it("generates Azure Blob config through the adapter", async () => {
    const { respond, promise } = makeCall("workspaces.cloud.generate-config", {
      provider: "azure-blob",
      accountName: "openbotworkspace",
      bucket: "robot-workspaces",
      rootPrefix: "marketing-bot/",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        provider: "azure-blob",
        accountName: "openbotworkspace",
        endpoint: "https://openbotworkspace.blob.core.windows.net",
        bucket: "robot-workspaces",
        rootPrefix: "marketing-bot/",
      },
      undefined,
    );
  });
});
