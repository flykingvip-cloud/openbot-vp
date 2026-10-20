import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let stateDir = "";

vi.mock("../config/paths.js", () => ({
  resolveStateDir: vi.fn(() => stateDir),
}));

const {
  bindRobotWorkspace,
  createWorkspaceRecord,
  decommissionRobotWorkspace,
  getBoundWorkspaceId,
  getWorkspaceById,
  loadWorkspaceStore,
} = await import("./store.js");

describe("decommissionRobotWorkspace", () => {
  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-workspace-store-"));
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
    stateDir = "";
  });

  it("removes robot binding, workspace record, and returns trash paths", async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-robot-local-"));
    const record = await createWorkspaceRecord({
      name: "bot workspace",
      kind: "local",
      status: "ready",
      runtimePath: "",
      local: {
        path: localPath,
        resolvedPath: localPath,
        readable: true,
        writable: true,
      },
    });
    await bindRobotWorkspace("market-helper", record.id);
    await fs.mkdir(path.join(stateDir, "workspaces", "runtime", record.id), {
      recursive: true,
    });

    const result = await decommissionRobotWorkspace("market-helper");

    expect(result.workspaceId).toBe(record.id);
    expect(result.localPath).toBe(localPath);
    expect(result.runtimePath).toBe(path.join(stateDir, "workspaces", "runtime", record.id));
    expect(await getBoundWorkspaceId("market-helper")).toBeNull();
    expect(await getWorkspaceById(record.id)).toBeNull();
    const store = await loadWorkspaceStore();
    expect(store.robotBindings["market-helper"]).toBeUndefined();
    expect(store.workspaces).toHaveLength(0);

    await fs.rm(localPath, { recursive: true, force: true });
  });

  it("is a no-op when the robot has no workspace binding", async () => {
    const result = await decommissionRobotWorkspace("missing-bot");
    expect(result).toEqual({
      workspaceId: null,
      localPath: null,
      runtimePath: null,
    });
  });
});
