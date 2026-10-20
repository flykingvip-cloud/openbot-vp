import { describe, expect, it } from "vitest";
import {
  containsBannedDabaiWelcome,
  createDaibaiTeamOnboardingState,
  DAIBAI_TEAM_COPY,
  DAIBAI_TEAM_MAX,
  findDaibaiTeamAgent,
  planDaibaiTeam,
  recommendedDaibaiTeamIds,
  reduceDaibaiTeamOnboarding,
} from "./daibai-team-onboarding-model.ts";

describe("daibai team onboarding model", () => {
  it("does not use the retired welcome slogan", () => {
    const copy = Object.values(DAIBAI_TEAM_COPY).join("\n");
    expect(containsBannedDabaiWelcome(copy)).toBe(false);
    expect(copy).not.toMatch(/欢迎入驻/i);
    expect(DAIBAI_TEAM_COPY.welcome).toContain("数字员工团队");
    expect(DAIBAI_TEAM_COPY.exploreCapabilities).toBe("带我了解 OpenBot 的功能");
    expect(DAIBAI_TEAM_COPY.plusGuidance).toBe(
      "结合你的岗位职责和日常工作事务，点击“+”直接定制数字人。",
    );
    expect(DAIBAI_TEAM_COPY.completePersonalSetup).toBe("完成配置，让数字人更懂你和熟悉你的工作。");
    expect(copy).not.toContain("稍后处理");
    expect(copy).not.toContain("我知道了");
    expect(copy).not.toContain("完成个人配置");
  });

  it("preselects the three recommended office roles", () => {
    expect(recommendedDaibaiTeamIds()).toEqual(["calendar", "email", "docs"]);
    expect(createDaibaiTeamOnboardingState().selectedIds).toEqual(["calendar", "email", "docs"]);
  });

  it("plans a role team inside the nav create cap and keeps keyword additions", () => {
    expect(planDaibaiTeam("产品经理", "")).toEqual(["calendar", "docs", "minutes", "project"]);
    expect(planDaibaiTeam("产品经理", "").length).toBeLessThanOrEqual(DAIBAI_TEAM_MAX);
    expect(planDaibaiTeam("销售", "还要看数据报表")).toEqual([
      "crm",
      "leads",
      "email",
      "dashboard",
    ]);
  });

  it("walks catalog path to confirm and records events", () => {
    let state = createDaibaiTeamOnboardingState();
    const started = reduceDaibaiTeamOnboarding(state, { type: "start" });
    state = started.state;
    expect(started.events[0]).toEqual({ name: "onboarding_started", from: "welcome" });
    expect(state.step).toBe("page");
    expect(state.path).toBeNull();

    const chosen = reduceDaibaiTeamOnboarding(state, { type: "choosePath", path: "catalog" });
    state = chosen.state;
    expect(chosen.events[0]).toMatchObject({ name: "path_chosen", path: "catalog" });
    expect(state.step).toBe("page");
    expect(state.path).toBe("catalog");

    const blocked = reduceDaibaiTeamOnboarding(state, { type: "toggle", id: "code" });
    state = reduceDaibaiTeamOnboarding(blocked.state, { type: "toggle", id: "project" }).state;
    const overCap = reduceDaibaiTeamOnboarding(state, { type: "toggle", id: "minutes" });
    expect(overCap.state.error).toContain(String(DAIBAI_TEAM_MAX));
    expect(overCap.state.selectedIds).toHaveLength(DAIBAI_TEAM_MAX);

    expect(overCap.state.step).toBe("page");
    const startedCreate = reduceDaibaiTeamOnboarding(overCap.state, { type: "createStart" });
    expect(startedCreate.events[0]?.name).toBe("agents_selected");
  });

  it("switches paths without locking the user into one route", () => {
    let state = reduceDaibaiTeamOnboarding(createDaibaiTeamOnboardingState(), {
      type: "choosePath",
      path: "catalog",
    }).state;
    const switched = reduceDaibaiTeamOnboarding(state, { type: "choosePath", path: "describe" });
    expect(switched.state.step).toBe("page");
    expect(switched.state.path).toBe("describe");
    expect(switched.events[0]).toMatchObject({ path: "describe", switched: true });
  });

  it("keeps the guide page after enter and after skip once it is open", () => {
    const open = reduceDaibaiTeamOnboarding(createDaibaiTeamOnboardingState(), {
      type: "start",
    }).state;
    const created = reduceDaibaiTeamOnboarding(open, {
      type: "createSuccess",
      created: [{ catalogId: "email", agentId: "agt-email", name: "邮件助理" }],
    });
    expect(created.state.step).toBe("page");
    const entered = reduceDaibaiTeamOnboarding(created.state, { type: "enterWorkbench" });
    expect(entered.state.step).toBe("page");
    expect(entered.state.created).toEqual(created.state.created);
    expect(entered.events[0]?.name).toBe("enter_workbench");
    const skipped = reduceDaibaiTeamOnboarding(open, { type: "skip" });
    expect(skipped.state.step).toBe("page");
    expect(skipped.state.selectedIds).toEqual(open.selectedIds);
    expect(DAIBAI_TEAM_COPY.retainedNote).toContain("留在大白的对话里");
  });

  it("includes the contract reviewer catalog pilot aligned with design semantics", () => {
    const agent = findDaibaiTeamAgent("contract");
    expect(agent?.name).toBe("合同审查员");
    expect(agent?.emoji).toBe("📄");
    expect(agent?.category).toBe("ops");
    expect(agent?.caps).toEqual(["风险条款", "要点摘要", "PDF 解析"]);
  });
});
