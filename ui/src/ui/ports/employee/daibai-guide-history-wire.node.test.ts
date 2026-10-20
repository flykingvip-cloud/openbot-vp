/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { planDaibaiGuideAppend } from "../../../../../src/shared/daibai-guide-card.ts";
import {
  flushDaibaiGuideHistoryNow,
  noteDaibaiGuideHistory,
  resetDaibaiGuideHistoryWireForTests,
} from "./daibai-guide-history-wire.ts";
import {
  dispatchDaibaiTeamOnboarding,
  getDaibaiTeamOnboardingState,
  reloadDaibaiTeamGuideFromStorageForTests,
  resetDaibaiTeamOnboardingForTests,
} from "./views/daibai-team-onboarding-session.ts";

const teamState = {
  step: "page" as const,
  path: "catalog" as const,
  category: "all" as const,
  selectedIds: ["docs"],
  selectedLabels: ["文档专员"],
  role: null,
  taskText: "整理方案",
  proposedIds: [],
  customNames: [],
  created: [{ catalogId: "docs", agentId: "agt-docs", name: "文档专员" }],
};

afterEach(() => {
  resetDaibaiGuideHistoryWireForTests();
  resetDaibaiTeamOnboardingForTests();
});

describe("daibai guide history wire", () => {
  it("restores the guide page from chat history when local storage is empty", () => {
    resetDaibaiTeamOnboardingForTests();
    const plan = planDaibaiGuideAppend({ slot: "team", now: 20, state: teamState });
    const requestUpdate = vi.fn();
    noteDaibaiGuideHistory({
      client: { request: vi.fn(async () => ({ ok: true })) },
      connected: true,
      sessionKey: "agent:main:main",
      tab: "me",
      workbenchPrimaryModule: "assistant",
      hello: { type: "hello-ok", protocol: 3 },
      chatMessages: [
        {
          role: "assistant",
          timestamp: 20,
          content: [{ type: "text", text: plan?.text }],
          openclawDaibaiGuide: plan?.card,
        },
      ],
      settings: { daibaiGuideAcknowledged: true },
      requestUpdate,
    });

    expect(getDaibaiTeamOnboardingState().step).toBe("page");
    expect(getDaibaiTeamOnboardingState().created.map((member) => member.name)).toEqual([
      "文档专员",
    ]);
    expect(requestUpdate).toHaveBeenCalled();

    const restored = reloadDaibaiTeamGuideFromStorageForTests();
    expect(restored.created.map((member) => member.name)).toEqual(["文档专员"]);
    expect(restored.taskText).toBe("整理方案");
  });

  it("appends the sanitized guide card through chat.guide.append", async () => {
    const request = vi.fn(async () => ({ ok: true }));
    noteDaibaiGuideHistory({
      client: { request },
      connected: true,
      sessionKey: "agent:main:main",
      tab: "me",
      workbenchPrimaryModule: "assistant",
      hello: { type: "hello-ok", protocol: 3 },
      chatMessages: [],
      settings: {},
    });
    dispatchDaibaiTeamOnboarding({ type: "start" });
    dispatchDaibaiTeamOnboarding({
      type: "createSuccess",
      created: [{ catalogId: "email", agentId: "agt-email", name: "邮件助理" }],
    });
    await flushDaibaiGuideHistoryNow();

    const calls = request.mock.calls.map((call) => call[0]);
    expect(calls).toContain("chat.guide.append");
    const payloads = request.mock.calls.map((call) => call[1]) as Array<Record<string, unknown>>;
    const team = payloads.find((payload) => payload.slot === "team");
    expect(team?.sessionKey).toBe("agent:main:main");
    const encoded = JSON.stringify(team);
    expect(encoded).toContain("邮件助理");
    expect(encoded).not.toMatch(/oauth|token|secret|mcpServer|approval/i);
  });
});
