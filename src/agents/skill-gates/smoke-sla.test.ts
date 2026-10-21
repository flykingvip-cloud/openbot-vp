import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SKILL_SMOKE_SLA_MS,
  resolveSkillSmokeSlaMs,
  settleTurnCompletion,
} from "../turn-completion/contract.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("skill smoke SLA", () => {
  it("uses the batch-6 15 minute wall clock and degrades or blocks on timeout", () => {
    expect(DEFAULT_SKILL_SMOKE_SLA_MS).toBe(15 * 60 * 1000);
    expect(resolveSkillSmokeSlaMs({})).toBe(DEFAULT_SKILL_SMOKE_SLA_MS);
    expect(resolveSkillSmokeSlaMs({ OPENBOT_SKILL_SMOKE_SLA_MS: "0" })).toBe(
      DEFAULT_SKILL_SMOKE_SLA_MS,
    );

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-smoke-sla-"));
    tempDirs.push(workspaceDir);
    const degraded = settleTurnCompletion({
      userText: "技能试跑请继续",
      assistantText: "接下来我会换一种问法再确认评审对象。",
      workspaceDir,
      skillSmoke: true,
      smokeStartedAtMs: 0,
      nowMs: DEFAULT_SKILL_SMOKE_SLA_MS,
    });
    expect(degraded.contract?.state).toBe("delivered");
    expect(degraded.contract?.openablePath).toBeTruthy();
    expect(
      fs.statSync(path.join(workspaceDir, degraded.contract?.openablePath ?? "")).isFile(),
    ).toBe(true);

    const blocked = settleTurnCompletion({
      userText: "技能试跑请继续",
      assistantText: "接下来我会换一种问法再确认评审对象。",
      skillSmoke: true,
      smokeStartedAtMs: 0,
      nowMs: DEFAULT_SKILL_SMOKE_SLA_MS,
    });
    expect(blocked.contract?.state).toBe("permanent_block");
    expect(blocked.visibleText).toContain("reason=skill_smoke_sla");
    expect(blocked.visibleText).not.toMatch(/✅|已交付/);
  });
});
