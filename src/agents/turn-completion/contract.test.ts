import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  annotateToolResultText,
  claimsSuccessWithoutArtifact,
  DEFAULT_SKILL_SMOKE_SLA_MS,
  formatLsMode,
  isSilentExecFishingStop,
  isSilentExecWindow,
  probeEffectiveWritability,
  resolveSkillSmokeSlaMs,
  settleTurnCompletion,
  violatesProgressProseBan,
} from "./contract.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-turn-completion-"));
  tempDirs.push(dir);
  return dir;
}

const CONTINUE = "沙箱已经具备 Playwright 和 Node 20 这个条件了，请继续尝试";

describe("turn completion contract", () => {
  it("continues after a cleared env gate into an openable degradation file", () => {
    const workspaceDir = tempWorkspace();
    const assistant =
      "Node 与 Playwright 已具备。memory/task_ledger.json 权限是 -r----------，写操作被拒绝。" +
      "绑定方向是微信运营身份还是邮箱还是知识源？评审对象是哪份材料？";
    const settled = settleTurnCompletion({
      userText: CONTINUE,
      assistantText: assistant,
      workspaceDir,
      envProbes: [
        { reason: "node", passed: true },
        { reason: "playwright", passed: true },
      ],
      nowMs: 1_000,
    });

    expect(isSilentExecWindow(CONTINUE)).toBe(true);
    expect(settled.contract?.state).toBe("delivered");
    expect(settled.contract?.openablePath).toBeTruthy();
    const absolute = path.join(workspaceDir, settled.contract?.openablePath ?? "");
    expect(fs.statSync(absolute).isFile()).toBe(true);
    expect(fs.readFileSync(absolute, "utf8").length).toBeGreaterThan(0);
    expect(settled.visibleText).toContain(settled.contract?.openablePath ?? "");
    expect(settled.visibleText).not.toMatch(/微信|邮箱|知识源/);
    expect(settled.visibleText).toContain("side_path_bypass");
    expect(settled.continueExecution).toBe(false);
  });

  it("still writes the deliverable when the ledger write fails", () => {
    const workspaceDir = tempWorkspace();
    const settled = settleTurnCompletion({
      userText: "请继续，我只要结果",
      assistantText:
        "memory/task_ledger.json 只读（-r----------），写操作被拒绝，所以我不能出稿，到此结束。",
      workspaceDir,
      sidePathLabel: "memory/task_ledger.json",
      sidePathAttempt: () => {
        const err = new Error("EACCES");
        (err as NodeJS.ErrnoException).code = "EACCES";
        throw err;
      },
      deliverable: {
        relativePath: "deliverables/smoke.md",
        body: "# smoke\n\nopenable body\n",
      },
    });

    expect(settled.hardStopPrevented).toBe("side_path_refusal");
    expect(settled.contract?.state).toBe("delivered");
    expect(settled.contract?.openablePath).toBe("deliverables/smoke.md");
    const absolute = path.join(workspaceDir, "deliverables/smoke.md");
    expect(fs.readFileSync(absolute, "utf8")).toContain("openable body");
    expect(settled.contract?.sidePathReceipt).toContain("side_path_bypass");
    expect(settled.contract?.sidePathReceipt).toContain("EACCES");
    expect(settled.visibleText).toContain("side_path_bypass: memory/task_ledger.json EACCES");
    expect(settled.visibleText).not.toContain("不能出稿");
  });

  it("allows one stop for a real two-SKU fork and refuses the sha256 bind misread", () => {
    const fork = settleTurnCompletion({
      userText: "请继续",
      assistantText: "有两种规格，请选规格 A 还是规格 B。",
      forkOptions: ["规格A", "规格B"],
    });
    expect(fork.contract?.state).toBe("true_fork");
    expect(fork.contract?.options).toEqual(["规格A", "规格B"]);
    expect(fork.continueExecution).toBe(false);
    expect(fork.visibleText).toContain("state=true_fork");
    expect(isSilentExecFishingStop(fork.visibleText, "请继续")).toBe(false);

    const workspaceDir = tempWorkspace();
    const misread = settleTurnCompletion({
      userText: `${CONTINUE}。analysis-review 的绑定是 task.json sha256。`,
      assistantText: "绑定方向指哪一侧：微信运营身份、邮箱，还是知识源？",
      workspaceDir,
      envProbes: [
        { reason: "node", passed: true },
        { reason: "playwright", passed: true },
      ],
    });
    expect(misread.contract?.state).not.toBe("true_fork");
    expect(misread.contract?.state).toBe("delivered");
    expect(misread.visibleText).not.toMatch(/微信|邮箱|知识源/);
    expect(
      isSilentExecFishingStop("绑定方向指哪一侧：微信运营身份、邮箱，还是知识源？", CONTINUE),
    ).toBe(true);
  });

  it("forces a degradation or a one-line permanent block at the skill-smoke SLA", () => {
    expect(DEFAULT_SKILL_SMOKE_SLA_MS).toBe(15 * 60 * 1000);
    expect(resolveSkillSmokeSlaMs({ OPENBOT_SKILL_SMOKE_SLA_MS: "1000" })).toBe(1000);
    expect(resolveSkillSmokeSlaMs({})).toBe(DEFAULT_SKILL_SMOKE_SLA_MS);

    const narrative = (
      "接下来我会换一种说法再问你评审对象是哪份材料，以及绑定方向是微信还是邮箱。" +
      "随后我会继续梳理审查记录，下一步我会再确认一次知识源。让我先把口径说清楚再出稿。"
    ).repeat(3);
    expect(narrative.length).toBeGreaterThan(180);

    const workspaceDir = tempWorkspace();
    const degraded = settleTurnCompletion({
      userText: "技能试跑请继续",
      assistantText: narrative,
      workspaceDir,
      skillSmoke: true,
      smokeStartedAtMs: 0,
      nowMs: DEFAULT_SKILL_SMOKE_SLA_MS,
    });
    expect(degraded.contract?.state).toBe("delivered");
    expect(degraded.visibleText).not.toMatch(/评审对象|微信|邮箱/);
    expect(fs.existsSync(path.join(workspaceDir, degraded.contract?.openablePath ?? ""))).toBe(
      true,
    );

    const blocked = settleTurnCompletion({
      userText: "技能试跑请继续",
      assistantText: narrative,
      skillSmoke: true,
      smokeStartedAtMs: 0,
      nowMs: 1_000,
      slaMs: 1_000,
    });
    expect(blocked.contract?.state).toBe("permanent_block");
    expect(blocked.visibleText).toContain("state=permanent_block");
    expect(blocked.visibleText).toContain("reason=skill_smoke_sla");
    expect(blocked.visibleText.split("\n")).toHaveLength(1);
    expect(blocked.visibleText).not.toMatch(/评审对象|微信|接下来我会/);
  });

  it("does not report success when there is no artifact", () => {
    const workspaceDir = tempWorkspace();
    expect(claimsSuccessWithoutArtifact("已交付，任务成功。")).toBe(true);
    const settled = settleTurnCompletion({
      userText: "请继续",
      assistantText: "已交付，任务成功。这一步已经完成。",
      workspaceDir,
    });
    expect(settled.hardStopPrevented).toBe("empty_success");
    expect(settled.contract?.state).toBe("delivered");
    expect(settled.contract?.openablePath).toBeTruthy();
    expect(settled.visibleText).not.toMatch(/已交付|任务成功|✅/);
  });

  it("does not re-stop on an env gate the probe cleared this turn", () => {
    const workspaceDir = tempWorkspace();
    const settled = settleTurnCompletion({
      userText: CONTINUE,
      assistantText: "沙箱还是 Node v18.20.4，Playwright 要求 Node 20，所以还不能给你 PDF。",
      workspaceDir,
      envProbes: [
        { reason: "node", passed: true },
        { reason: "playwright", passed: true },
      ],
    });
    expect(settled.contract?.state).toBe("delivered");
    expect(settled.visibleText).not.toContain("v18");
    expect(fs.existsSync(path.join(workspaceDir, settled.contract?.openablePath ?? ""))).toBe(true);
  });

  it("rejects an ls-only mode string as a hard stop and records a writability probe", () => {
    const workspaceDir = tempWorkspace();
    const target = path.join(workspaceDir, "memory", "task_ledger.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "{}\n", "utf8");
    fs.chmodSync(target, 0o400);
    const probe = probeEffectiveWritability(target);
    expect(probe.lsMode).toBe(formatLsMode(fs.statSync(target).mode));
    expect(probe.path).toBe(target);
    expect(["ok", "eacces", "eperm"]).toContain(probe.writeAttempt);
    if (probe.writeAttempt !== "ok") {
      expect(probe.sandboxPolicyCode).toBeTruthy();
    }
    expect(probe.hardStop).toBe(false);
    expect(probe.blockerGrade).toBe("side_path");

    const annotated = annotateToolResultText(
      `ls memory/task_ledger.json\n-r---------- 1 sandbox sandbox 2 memory/task_ledger.json`,
    );
    expect(annotated).toContain("path=memory/task_ledger.json");
    expect(annotated).toContain("lsMode=-r----------");
    expect(annotated).toContain("writeAttempt=not_attempted");
    expect(annotated).toContain("sandboxPolicyCode=ls_narrative_only");
    expect(annotated).toContain("hardStop=false");

    const writable = path.join(workspaceDir, "notes.txt");
    fs.writeFileSync(writable, "ok\n", "utf8");
    const openProbe = probeEffectiveWritability(writable);
    expect(openProbe.writeAttempt).toBe("ok");
    expect(openProbe.lsMode.startsWith("-rw")).toBe(true);
    expect(openProbe.hardStop).toBe(false);
  });

  it("bans a long progress-only final that has no path and no permanent block", () => {
    const progress =
      "下一步我会先核对口径。接下来我会补一页摘要。随后我会再整理一版说法。让我先把结构排出来。".repeat(
        5,
      );
    expect(progress.length).toBeGreaterThan(180);
    expect(violatesProgressProseBan(progress)).toBe(true);
    const workspaceDir = tempWorkspace();
    const settled = settleTurnCompletion({
      userText: "写一份说明",
      assistantText: progress,
      workspaceDir,
    });
    expect(settled.contract?.state).toBe("delivered");
    expect(settled.contract?.openablePath).toBeTruthy();
    expect(settled.visibleText).not.toContain("下一步我会");
    expect(settled.visibleText.length).toBeLessThan(progress.length);
  });
});
