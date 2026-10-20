import { describe, expect, it } from "vitest";
import { FailoverError } from "../../agents/failover-error.js";
import { SUPERVISOR_ENABLED_ENV } from "./feature.js";
import {
  assertFreeChatCliRunAllowed,
  assertFreeChatExecCommandAllowed,
  assertFreeChatSessionsSpawnAllowed,
  detectUnsupervisedIdeCliShellCommand,
  isSupervisorGovernedCliBackend,
} from "./free-chat-cli-guard.js";

describe("free-chat-cli-guard", () => {
  it("detects IDE CLI shell invocations", () => {
    expect(detectUnsupervisedIdeCliShellCommand("codex exec --json fix ui")).toBe(true);
    expect(detectUnsupervisedIdeCliShellCommand("echo hi && codex exec foo")).toBe(true);
    expect(detectUnsupervisedIdeCliShellCommand("grok -p refactor auth")).toBe(true);
    expect(detectUnsupervisedIdeCliShellCommand("pnpm test")).toBe(false);
  });

  it("treats grok-cli as supervisor-governed backend", () => {
    expect(isSupervisorGovernedCliBackend("grok-cli", {})).toBe(true);
  });

  it("treats codex-cli as supervisor-governed backend", () => {
    expect(isSupervisorGovernedCliBackend("codex-cli", {})).toBe(true);
  });

  it("blocks free chat CLI when supervisor enabled", () => {
    const prev = process.env[SUPERVISOR_ENABLED_ENV];
    process.env[SUPERVISOR_ENABLED_ENV] = "1";
    try {
      expect(() => assertFreeChatCliRunAllowed({ backendId: "codex-cli", config: {} })).toThrow(
        FailoverError,
      );
      expect(() =>
        assertFreeChatExecCommandAllowed({ command: "codex exec refactor tab" }),
      ).toThrow(/开发监督已启用/);
    } finally {
      if (prev === undefined) {
        delete process.env[SUPERVISOR_ENABLED_ENV];
      } else {
        process.env[SUPERVISOR_ENABLED_ENV] = prev;
      }
    }
  });

  it("blocks sessions_spawn for explicit IDE requests when supervisor enabled", () => {
    const prev = process.env[SUPERVISOR_ENABLED_ENV];
    process.env[SUPERVISOR_ENABLED_ENV] = "1";
    try {
      expect(() =>
        assertFreeChatSessionsSpawnAllowed({
          task: "用 codex 重新优化开发监督 Tab 的 UI",
          runtime: "subagent",
        }),
      ).toThrow(/开发监督已启用/);
      expect(() =>
        assertFreeChatSessionsSpawnAllowed({
          task: "summarize yesterday's notes",
          runtime: "acp",
        }),
      ).toThrow(/开发监督已启用/);
      expect(() =>
        assertFreeChatSessionsSpawnAllowed({
          task: "summarize yesterday's notes",
          runtime: "subagent",
          model: "codex-cli",
        }),
      ).toThrow(/开发监督已启用/);
    } finally {
      if (prev === undefined) {
        delete process.env[SUPERVISOR_ENABLED_ENV];
      } else {
        process.env[SUPERVISOR_ENABLED_ENV] = prev;
      }
    }
  });

  it("allows generic dev sessions_spawn without explicit IDE (Mode A)", () => {
    const prev = process.env[SUPERVISOR_ENABLED_ENV];
    process.env[SUPERVISOR_ENABLED_ENV] = "1";
    try {
      expect(() =>
        assertFreeChatSessionsSpawnAllowed({
          task: "帮我改下这个 UI 布局",
          runtime: "subagent",
        }),
      ).not.toThrow();
    } finally {
      if (prev === undefined) {
        delete process.env[SUPERVISOR_ENABLED_ENV];
      } else {
        process.env[SUPERVISOR_ENABLED_ENV] = prev;
      }
    }
  });

  it("allows benign sessions_spawn when supervisor enabled", () => {
    const prev = process.env[SUPERVISOR_ENABLED_ENV];
    process.env[SUPERVISOR_ENABLED_ENV] = "1";
    try {
      expect(() =>
        assertFreeChatSessionsSpawnAllowed({
          task: "summarize yesterday's meeting notes",
          runtime: "subagent",
        }),
      ).not.toThrow();
    } finally {
      if (prev === undefined) {
        delete process.env[SUPERVISOR_ENABLED_ENV];
      } else {
        process.env[SUPERVISOR_ENABLED_ENV] = prev;
      }
    }
  });

  it("allows supervised runs and when feature is off", () => {
    const prev = process.env[SUPERVISOR_ENABLED_ENV];
    delete process.env[SUPERVISOR_ENABLED_ENV];
    try {
      expect(() =>
        assertFreeChatCliRunAllowed({ backendId: "codex-cli", config: {}, supervisedRun: true }),
      ).not.toThrow();
      expect(() =>
        assertFreeChatCliRunAllowed({ backendId: "codex-cli", config: {} }),
      ).not.toThrow();
    } finally {
      if (prev !== undefined) {
        process.env[SUPERVISOR_ENABLED_ENV] = prev;
      }
    }
  });
});
