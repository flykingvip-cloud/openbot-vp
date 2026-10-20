import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import type { CliRunFn } from "../fabric/worker/cli-worker.js";
import { createWorkerFromBackend } from "./cli-backend-worker.js";

const runCli: CliRunFn = async () => ({ ok: true });

function cfgWith(backends: Record<string, unknown>): OpenBotConfig {
  return { agents: { defaults: { cliBackends: backends } } } as unknown as OpenBotConfig;
}

describe("createWorkerFromBackend (cli-backend → Worker, Task 0.4)", () => {
  it("builds a Worker from a backend declaring worker metadata (capability axes)", () => {
    const worker = createWorkerFromBackend({} as OpenBotConfig, "kiro-cli", runCli);
    expect(worker).not.toBeNull();
    expect(worker!.id).toBe("kiro-cli");
    expect(worker!.taskCapabilities).toEqual(["coding", "edit", "terminal", "git", "test"]);
    expect(worker!.control).toEqual(["streaming"]);
  });

  it("builds Workers from builtin codex-cli, devin-cli, and grok-cli defaults", () => {
    const codex = createWorkerFromBackend({} as OpenBotConfig, "codex-cli", runCli);
    expect(codex?.id).toBe("codex-cli");
    expect(codex?.control).toEqual(expect.arrayContaining(["streaming", "cancellable"]));

    const devin = createWorkerFromBackend({} as OpenBotConfig, "devin-cli", runCli);
    expect(devin?.id).toBe("devin-cli");
    expect(devin?.control).toEqual(["streaming"]);

    const grok = createWorkerFromBackend({} as OpenBotConfig, "grok-cli", runCli);
    expect(grok?.id).toBe("grok-cli");
    expect(grok?.control).toEqual(expect.arrayContaining(["streaming", "cancellable"]));

    const legacy = createWorkerFromBackend({} as OpenBotConfig, "windsurf-cli", runCli);
    expect(legacy?.id).toBe("windsurf-cli");
  });

  it("returns null when the backend declares no worker block (model-surface only)", () => {
    const cfg = cfgWith({ "plain-cli": { command: "plain" } });
    expect(createWorkerFromBackend(cfg, "plain-cli", runCli)).toBeNull();
  });

  it("returns null for an unknown backend", () => {
    expect(createWorkerFromBackend(cfgWith({}), "nope-cli", runCli)).toBeNull();
  });

  it("defaults capability axes to empty when omitted in the worker block", () => {
    const cfg = cfgWith({ "x-cli": { command: "x", worker: {} } });
    const worker = createWorkerFromBackend(cfg, "x-cli", runCli);
    expect(worker).not.toBeNull();
    expect(worker!.taskCapabilities).toEqual([]);
    expect(worker!.control).toEqual([]);
  });

  it("builtin claude-cli gains a Worker only when worker metadata is configured", () => {
    // builtin defaults have no worker block → model-surface only
    expect(createWorkerFromBackend(cfgWith({}), "claude-cli", runCli)).toBeNull();
    // override adds worker metadata → drivable as a Worker
    const cfg = cfgWith({ "claude-cli": { command: "claude", worker: { control: [] } } });
    expect(createWorkerFromBackend(cfg, "claude-cli", runCli)?.id).toBe("claude-cli");
  });
});
