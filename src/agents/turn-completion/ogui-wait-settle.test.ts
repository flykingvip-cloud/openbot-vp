import { afterEach, describe, expect, it } from "vitest";
import {
  clearOguiWaitRegistryForTests,
  replaceOguiSessionWaits,
} from "../../config/sessions/ogui-decision-wait-registry.js";
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
});
