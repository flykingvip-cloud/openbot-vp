import { describe, expect, it } from "vitest";
import { listSupervisorWorkers } from "./workers.js";

describe("listSupervisorWorkers", () => {
  it("returns only backends with worker metadata", () => {
    const workers = listSupervisorWorkers({
      agents: {
        defaults: {
          cliBackends: {
            "with-worker": {
              command: "echo",
              worker: { taskCapabilities: ["coding"], control: ["streaming"] },
            },
            "model-only": {
              command: "echo",
            },
          },
        },
      },
    });
    const custom = workers.filter((worker) => worker.backendId === "with-worker");
    expect(custom).toHaveLength(1);
    expect(custom[0]?.taskCapabilities).toContain("coding");
    expect(workers.some((worker) => worker.backendId === "model-only")).toBe(false);
  });

  it("includes builtin codex-cli, kiro-cli, cursor-cli, devin-cli, and grok-cli worker surfaces", () => {
    const workers = listSupervisorWorkers(undefined);
    const ids = workers.map((worker) => worker.backendId);
    expect(ids).toEqual(
      expect.arrayContaining(["codex-cli", "kiro-cli", "cursor-cli", "devin-cli", "grok-cli"]),
    );
    const codex = workers.find((worker) => worker.backendId === "codex-cli");
    expect(codex?.control).toEqual(expect.arrayContaining(["streaming", "cancellable"]));
    const kiro = workers.find((worker) => worker.backendId === "kiro-cli");
    expect(kiro?.control).toContain("streaming");
    const cursor = workers.find((worker) => worker.backendId === "cursor-cli");
    expect(cursor?.control).toEqual(expect.arrayContaining(["streaming", "cancellable"]));
    const devin = workers.find((worker) => worker.backendId === "devin-cli");
    expect(devin?.control).toContain("streaming");
  });

  it("maps modelCatalog ids into models", () => {
    const workers = listSupervisorWorkers(undefined);
    const codex = workers.find((worker) => worker.backendId === "codex-cli");
    expect(codex?.models.length).toBeGreaterThan(0);
    expect(codex?.models).toContain("gpt-5.4");
  });
});
