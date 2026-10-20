import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const managerInstantiate = vi.fn();

vi.mock("./manager.js", () => ({
  MemoryIndexManager: class MemoryIndexManager {
    constructor(...args: unknown[]) {
      managerInstantiate(...args);
    }
  },
  getMemorySearchManager: vi.fn(() => {
    throw new Error("getMemorySearchManager must not be called from health probe path");
  }),
}));

describe("health-probe DI/spy guard", () => {
  const dirs: string[] = [];

  afterEach(() => {
    managerInstantiate.mockClear();
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not instantiate MemoryIndexManager when probing via factory", async () => {
    const { createMemoryHealthProbe } = await import("./health-probe.factory.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hp-di-"));
    dirs.push(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "memory", "a.md"), "# note\n");
    const indexPath = path.join(root, "memory", "agent.sqlite");
    const probe = createMemoryHealthProbe();
    await probe.runIntegrityCheck([workspace, indexPath], () => {
      probe.probeAgent({ agentId: "agent", workspaceRoot: workspace, indexPath });
    });
    expect(managerInstantiate).toHaveBeenCalledTimes(0);
  });
});
