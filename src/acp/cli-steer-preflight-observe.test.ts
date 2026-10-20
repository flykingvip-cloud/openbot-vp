import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV,
  acpCliSteerObserveNames,
  acpCliSteerObserveTaskId,
  isAcpCliSteerPreflightObserveEnabled,
} from "./cli-steer-preflight-observe.js";

const sessionKey = "agent:codex:acp:test";

describe("ACP CLI and steer preflight observe helpers", () => {
  it("treats only 1/true/yes/on as enabled", () => {
    expect(isAcpCliSteerPreflightObserveEnabled({})).toBe(false);
    for (const value of ["0", "false", "no", "off", ""]) {
      expect(
        isAcpCliSteerPreflightObserveEnabled({
          [ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV]: value,
        }),
      ).toBe(false);
    }
    for (const value of ["1", "true", "yes", "on"]) {
      expect(
        isAcpCliSteerPreflightObserveEnabled({
          [ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV]: value,
        }),
      ).toBe(true);
    }
  });

  it("uses distinct synthetic task ids for CLI turns and steer", () => {
    const cli = acpCliSteerObserveTaskId("cli-turn", sessionKey, "Codex");
    const steer = acpCliSteerObserveTaskId("steer", sessionKey, "Codex");
    expect(cli).toBe(`acp-cli-turn:${sessionKey}:codex`);
    expect(steer).toBe(`acp-steer:${sessionKey}:codex`);
    expect(cli).not.toBe(steer);
  });

  it("labels observe names from the admitted agent list", () => {
    const cfg = {
      acp: { allowedAgents: ["Codex", "Kimi"] },
    } as OpenBotConfig;
    expect(acpCliSteerObserveNames(cfg, "codex")).toEqual(["codex", "kimi"]);
    expect(acpCliSteerObserveNames({} as OpenBotConfig, "Codex")).toEqual(["codex"]);
  });

  it("does not enforce preflight from the helper or the stdio bridge", () => {
    const helper = readFileSync(
      new URL("./cli-steer-preflight-observe.ts", import.meta.url),
      "utf8",
    );
    const bridgeServer = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    const translator = readFileSync(new URL("./translator.ts", import.meta.url), "utf8");

    expect(helper).toContain("buildExecutionPreflight");
    expect(helper).toContain(ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV);
    expect(helper).not.toContain("applyPreflightToTools");
    expect(helper).not.toContain("armCompletionHold");
    expect(helper).not.toContain("allowedTools");
    expect(helper).not.toContain("ORCHESTRATION_LIVE_INVOKE");
    expect(bridgeServer).not.toContain(ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV);
    expect(translator).not.toContain(ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV);
    expect(bridgeServer).not.toContain("observeAcpCliSteerPreflight");
    expect(translator).not.toContain("observeAcpCliSteerPreflight");
  });
});
