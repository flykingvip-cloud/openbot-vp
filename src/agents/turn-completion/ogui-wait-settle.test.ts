import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { issueOguiDecisionFromText } from "../../config/sessions/ogui-decision-engine.js";
import type { OguiDecisionRunBinding } from "../../config/sessions/ogui-decision-engine.js";
import {
  clearOguiWaitRegistryForTests,
  replaceOguiSessionWaits,
} from "../../config/sessions/ogui-decision-wait-registry.js";
import { loadSessionStore, updateSessionStore } from "../../config/sessions/store.js";
import { settleTurnCompletion } from "./contract.js";

const narrative = (
  "接下来我会换一种说法再问你评审对象是哪份材料，以及绑定方向是微信还是邮箱。" +
  "随后我会继续梳理审查记录，下一步我会再确认一次知识源。让我先把口径说清楚再出稿。" +
  "现有成果见 reports/out.md。"
).repeat(3);

const slaInput = {
  userText: "技能试跑请继续",
  assistantText: narrative,
  skillSmoke: true as const,
  smokeStartedAtMs: 0,
  nowMs: 5_000,
  slaMs: 1_000,
  openablePaths: ["reports/out.md"],
  sessionKey: "agent:main:decision",
};

afterEach(() => {
  clearOguiWaitRegistryForTests();
});

describe("settleTurnCompletion OGUI WAIT (Ev7)", () => {
  it("does not rewrite a valid WAIT into delivered or permanent_block", () => {
    const rewritten = settleTurnCompletion(slaInput);
    expect(
      rewritten.contract?.state === "delivered" || rewritten.contract?.state === "permanent_block",
    ).toBe(true);

    const held = settleTurnCompletion({ ...slaInput, oguiWaitActive: true });
    expect(held.contract).toBeNull();
    expect(held.visibleText).toBe(slaInput.assistantText);
    expect(held.visibleText).toContain("reports/out.md");
  });

  it("protects a session that already has a waiting decision even without the flag argument", () => {
    replaceOguiSessionWaits(slaInput.sessionKey, ["ogd_waiting"]);
    const held = settleTurnCompletion(slaInput);
    expect(held.contract).toBeNull();
    expect(held.visibleText).toBe(slaInput.assistantText);
  });

  it("does not rewrite a waiting decision when SLA, a deliverable write, or an existing path would settle (Ev7)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ogui-settle-"));
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:main:waiting-decision";
    await updateSessionStore(storePath, (store) => {
      store[sessionKey] = { sessionId: "sid-settle", updatedAt: 1 };
    });
    const binding: OguiDecisionRunBinding = {
      lifecycleEnabled: true,
      cfg: { collaboration: { task: { oguiDecisionLifecycle: true } } },
      storePath,
      sessionKey,
      userId: "user-1",
      originRunId: "run-origin",
      ingress: "chat",
      allowIssue: true,
    };
    const issued = await issueOguiDecisionFromText({
      text: [
        "```ogui-form",
        JSON.stringify({
          schema_version: "ogui/v1",
          component_id: "cmp-settle",
          title: "选口径",
          fields: [
            {
              id: "choice",
              label: "口径",
              type: "single_select",
              options: [
                { value: "a", label: "甲" },
                { value: "b", label: "乙" },
              ],
            },
          ],
        }),
        "```",
      ].join("\n"),
      binding,
      env: { OPENBOT_OGUI_DECISION_LIFECYCLE: "1" },
    });
    const before = structuredClone(
      loadSessionStore(storePath, { skipCache: true })[sessionKey]?.oguiDecisions,
    );
    expect(before?.[issued.decisionId ?? ""]?.decisionStatus).toBe("waiting");

    const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogui-settle-base-"));
    const baseline = settleTurnCompletion({
      ...slaInput,
      sessionKey: "agent:main:no-wait",
      workspaceDir: baselineDir,
      deliverable: { relativePath: "deliverables/smoke.md", body: "# smoke\n" },
    });
    expect(baseline.contract?.state).toBe("delivered");
    expect(fs.existsSync(path.join(baselineDir, "deliverables/smoke.md"))).toBe(true);

    const heldDir = fs.mkdtempSync(path.join(os.tmpdir(), "ogui-settle-held-"));
    const held = settleTurnCompletion({
      ...slaInput,
      sessionKey,
      workspaceDir: heldDir,
      deliverable: { relativePath: "deliverables/smoke.md", body: "# smoke\n" },
    });
    expect(held.contract).toBeNull();
    expect(held.visibleText).toBe(slaInput.assistantText);
    expect(fs.existsSync(path.join(heldDir, "deliverables/smoke.md"))).toBe(false);

    const existingNarrative = (
      "接下来我会换一种说法再确认口径。" +
      "随后我会继续梳理审查记录，下一步我会再确认一次记录。让我先把口径说清楚再出稿。"
    ).repeat(3);
    const existing = settleTurnCompletion({
      userText: "请继续",
      assistantText: existingNarrative,
      openablePaths: ["reports/out.md"],
      sessionKey: "agent:main:no-wait",
    });
    expect(existing.contract?.state).toBe("delivered");
    expect(existing.contract?.openablePath).toBe("reports/out.md");
    const heldExisting = settleTurnCompletion({
      userText: "请继续",
      assistantText: existingNarrative,
      openablePaths: ["reports/out.md"],
      sessionKey,
    });
    expect(heldExisting.contract).toBeNull();
    expect(heldExisting.visibleText).toBe(existingNarrative);

    expect(loadSessionStore(storePath, { skipCache: true })[sessionKey]?.oguiDecisions).toEqual(
      before,
    );
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(baselineDir, { recursive: true, force: true });
    fs.rmSync(heldDir, { recursive: true, force: true });
  });
});
