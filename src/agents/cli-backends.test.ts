import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { resolveCliBackendConfig } from "./cli-backends.js";

describe("resolveCliBackendConfig kiro-cli + cursor-cli + codex-cli + devin-cli + grok-cli defaults", () => {
  it("kiro-cli uses headless kiro-cli chat with supervisor worker metadata", () => {
    const resolved = resolveCliBackendConfig("kiro-cli");
    expect(resolved?.config.command).toBe("kiro-cli");
    expect(resolved?.config.args).toEqual(["chat", "--no-interactive", "--trust-all-tools"]);
    expect(resolved?.config.worker?.taskCapabilities).toContain("coding");
    expect(resolved?.config.worker?.control).toEqual(["streaming"]);
  });

  it("cursor-cli uses cursor-agent stream-json with cancellable worker metadata", () => {
    const resolved = resolveCliBackendConfig("cursor-cli");
    expect(resolved?.config.command).toBe("cursor-agent");
    expect(resolved?.config.args).toContain("--print");
    expect(resolved?.config.output).toBe("jsonl");
    expect(resolved?.config.worker?.control).toEqual(
      expect.arrayContaining(["streaming", "cancellable"]),
    );
  });

  it("codex-cli uses exec --json with cancellable supervisor worker metadata", () => {
    const resolved = resolveCliBackendConfig("codex-cli");
    expect(resolved?.config.command).toBe("codex");
    expect(resolved?.config.output).toBe("jsonl");
    expect(resolved?.config.worker?.control).toEqual(
      expect.arrayContaining(["streaming", "cancellable"]),
    );
    expect(resolved?.config.worker?.statusParser).toBe("jsonl");
    expect(resolved?.config.modelCatalog?.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["gpt-5.4", "gpt-5.3-codex"]),
    );
  });

  it("devin-cli uses devin -p with supervisor worker metadata", () => {
    const resolved = resolveCliBackendConfig("devin-cli");
    expect(resolved?.id).toBe("devin-cli");
    expect(resolved?.config.command).toBe("devin");
    expect(resolved?.config.args).toEqual(["--sandbox", "--permission-mode", "dangerous", "-p"]);
    expect(resolved?.config.output).toBe("text");
    expect(resolved?.config.worker?.control).toEqual(["streaming"]);
    expect(resolved?.config.worker?.statusParser).toBe("text");
    expect(resolved?.config.modelCatalog?.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["swe-1.6", "gpt-5.5", "opus-4.7"]),
    );
  });

  it("grok-cli uses grok headless streaming-json with supervisor worker metadata", () => {
    const resolved = resolveCliBackendConfig("grok-cli");
    expect(resolved?.id).toBe("grok-cli");
    expect(resolved?.config.command).toBe("grok");
    expect(resolved?.config.args).toEqual([
      "--no-auto-update",
      "--always-approve",
      "--output-format",
      "streaming-json",
      "-p",
    ]);
    expect(resolved?.config.resumeArgs).toEqual([
      "--no-auto-update",
      "--always-approve",
      "--output-format",
      "streaming-json",
      "-r",
      "{sessionId}",
      "-p",
    ]);
    expect(resolved?.config.output).toBe("jsonl");
    expect(resolved?.config.clearEnv).toEqual(["XAI_API_KEY"]);
    expect(resolved?.config.worker?.control).toEqual(
      expect.arrayContaining(["streaming", "cancellable"]),
    );
    expect(resolved?.config.worker?.statusParser).toBe("jsonl");
    expect(resolved?.config.modelCatalog?.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["grok-4.5", "grok-build-0.1"]),
    );
  });

  it("windsurf-cli remains a legacy alias for devin-cli defaults", () => {
    const resolved = resolveCliBackendConfig("windsurf-cli");
    expect(resolved?.id).toBe("windsurf-cli");
    expect(resolved?.config.command).toBe("devin");
    expect(resolved?.config.args).toEqual(resolveCliBackendConfig("devin-cli")?.config.args);
  });
});

describe("resolveCliBackendConfig reliability merge", () => {
  it("defaults codex-cli to workspace-write for fresh and resume runs", () => {
    const resolved = resolveCliBackendConfig("codex-cli");

    expect(resolved).not.toBeNull();
    expect(resolved?.config.worker?.taskCapabilities).toContain("coding");
    expect(resolved?.config.args).toEqual([
      "exec",
      "--json",
      "--color",
      "never",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
    ]);
    expect(resolved?.config.resumeArgs).toEqual([
      "exec",
      "resume",
      "{sessionId}",
      "--color",
      "never",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
    ]);
  });

  it("deep-merges reliability watchdog overrides for codex", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: {
            "codex-cli": {
              command: "codex",
              reliability: {
                watchdog: {
                  resume: {
                    noOutputTimeoutMs: 42_000,
                  },
                },
              },
            },
          },
        },
      },
    } satisfies OpenBotConfig;

    const resolved = resolveCliBackendConfig("codex-cli", cfg);

    expect(resolved).not.toBeNull();
    expect(resolved?.config.reliability?.watchdog?.resume?.noOutputTimeoutMs).toBe(42_000);
    // Ensure defaults are retained when only one field is overridden.
    expect(resolved?.config.reliability?.watchdog?.resume?.noOutputTimeoutRatio).toBe(0.3);
    expect(resolved?.config.reliability?.watchdog?.resume?.minMs).toBe(60_000);
    expect(resolved?.config.reliability?.watchdog?.resume?.maxMs).toBe(180_000);
    expect(resolved?.config.reliability?.watchdog?.fresh?.noOutputTimeoutRatio).toBe(0.8);
  });
});

describe("resolveCliBackendConfig claude-cli defaults", () => {
  it("uses non-interactive permission-mode defaults for fresh and resume args", () => {
    const resolved = resolveCliBackendConfig("claude-cli");

    expect(resolved).not.toBeNull();
    expect(resolved?.config.args).toContain("--permission-mode");
    expect(resolved?.config.args).toContain("bypassPermissions");
    expect(resolved?.config.args).not.toContain("--dangerously-skip-permissions");
    expect(resolved?.config.resumeArgs).toContain("--permission-mode");
    expect(resolved?.config.resumeArgs).toContain("bypassPermissions");
    expect(resolved?.config.resumeArgs).not.toContain("--dangerously-skip-permissions");
  });

  it("retains default claude safety args when only command is overridden", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: {
            "claude-cli": {
              command: "/usr/local/bin/claude",
            },
          },
        },
      },
    } satisfies OpenBotConfig;

    const resolved = resolveCliBackendConfig("claude-cli", cfg);

    expect(resolved).not.toBeNull();
    expect(resolved?.config.command).toBe("/usr/local/bin/claude");
    expect(resolved?.config.args).toContain("--permission-mode");
    expect(resolved?.config.args).toContain("bypassPermissions");
    expect(resolved?.config.resumeArgs).toContain("--permission-mode");
    expect(resolved?.config.resumeArgs).toContain("bypassPermissions");
  });

  it("normalizes legacy skip-permissions overrides to permission-mode bypassPermissions", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: {
            "claude-cli": {
              command: "claude",
              args: ["-p", "--dangerously-skip-permissions", "--output-format", "json"],
              resumeArgs: [
                "-p",
                "--dangerously-skip-permissions",
                "--output-format",
                "json",
                "--resume",
                "{sessionId}",
              ],
            },
          },
        },
      },
    } satisfies OpenBotConfig;

    const resolved = resolveCliBackendConfig("claude-cli", cfg);

    expect(resolved).not.toBeNull();
    expect(resolved?.config.args).not.toContain("--dangerously-skip-permissions");
    expect(resolved?.config.args).toContain("--permission-mode");
    expect(resolved?.config.args).toContain("bypassPermissions");
    expect(resolved?.config.resumeArgs).not.toContain("--dangerously-skip-permissions");
    expect(resolved?.config.resumeArgs).toContain("--permission-mode");
    expect(resolved?.config.resumeArgs).toContain("bypassPermissions");
  });

  it("keeps explicit permission-mode overrides while removing legacy skip flag", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: {
            "claude-cli": {
              command: "claude",
              args: ["-p", "--dangerously-skip-permissions", "--permission-mode", "acceptEdits"],
              resumeArgs: [
                "-p",
                "--dangerously-skip-permissions",
                "--permission-mode=acceptEdits",
                "--resume",
                "{sessionId}",
              ],
            },
          },
        },
      },
    } satisfies OpenBotConfig;

    const resolved = resolveCliBackendConfig("claude-cli", cfg);

    expect(resolved).not.toBeNull();
    expect(resolved?.config.args).not.toContain("--dangerously-skip-permissions");
    expect(resolved?.config.args).toEqual(["-p", "--permission-mode", "acceptEdits"]);
    expect(resolved?.config.resumeArgs).not.toContain("--dangerously-skip-permissions");
    expect(resolved?.config.resumeArgs).toEqual([
      "-p",
      "--permission-mode=acceptEdits",
      "--resume",
      "{sessionId}",
    ]);
    expect(resolved?.config.args).not.toContain("bypassPermissions");
    expect(resolved?.config.resumeArgs).not.toContain("bypassPermissions");
  });
});
