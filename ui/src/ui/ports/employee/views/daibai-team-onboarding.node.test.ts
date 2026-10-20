/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetGuidanceUiControlStateForTests } from "../guidance/ui-control-state.ts";
import type { DaibaiTeamMemberDraft } from "./daibai-team-onboarding-model.ts";
import {
  bindDaibaiTeamGuideOwner,
  dispatchDaibaiTeamOnboarding,
  getDaibaiTeamOnboardingEvents,
  getDaibaiTeamOnboardingState,
  reloadDaibaiTeamGuideFromStorageForTests,
  resetDaibaiTeamOnboardingForTests,
} from "./daibai-team-onboarding-session.ts";
import { DAIBAI_GUIDE_PROMPT, renderDaibaiThreadPrelude } from "./workbench-stage-assistant.ts";

afterEach(() => {
  document.body.replaceChildren();
  resetDaibaiTeamOnboardingForTests();
  resetGuidanceUiControlStateForTests();
});

function paint(options?: {
  onAskDaibai?: (message?: string) => Promise<void>;
  onDismissGuide?: () => void;
  onCreateDaibaiTeam?: (members: DaibaiTeamMemberDraft[]) => Promise<{
    created: Array<{ catalogId: string; agentId: string; name: string }>;
    error: string | null;
  }>;
  onOpenAgentCreator?: () => void;
  onOpenMyRobotsSetup?: () => void;
  onApplyCapabilityGap?: (...args: unknown[]) => void;
  onRequestMcpDiscovery?: () => Promise<{
    remoteToolsList: "ok" | "unavailable" | "partial";
    gap: "none" | "remote_tools_list_unavailable" | "no_candidates";
    items: Array<{
      serverName: string;
      toolName: string;
      status: "unmapped" | "mapped_pending_grant" | "authorized";
      capabilityId: string | null;
      capabilityKey: string | null;
      capabilityDisplayName: string | null;
    }>;
  }>;
  onSubmitMcpScanApproval?: (input: {
    mcpServer: string;
    mcpTool: string;
    discoveryStatusSnapshot: string;
    catalogId: string;
    templateId: string;
    clientRequestId: string;
    reason?: string;
  }) => Promise<{ approvalId: string }>;
  onListMyApplications?: () => Promise<unknown>;
  onCancelMyApplication?: (approvalId: string) => Promise<void>;
  onSubmitOiEnrollment?: (input: {
    identityScope: string;
    identityId: string;
    targetAgentId: string;
    catalogId: string;
    templateId: string;
    clientRequestId: string;
    reason?: string;
  }) => Promise<{ approvalId: string }>;
  oiIdentityContext?: {
    personalIdentities?: Array<{ identityId: string; status?: string }> | null;
    personalGrants?: Array<{ identityId: string; agentId: string; status?: string }> | null;
    enterpriseIdentitiesByAgent?: Record<
      string,
      Array<{ identityId: string; status?: string }>
    > | null;
    enterpriseSeatIdentities?: Array<{ identityId: string; status?: string }> | null;
  } | null;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const draw = () => {
    render(
      html`${renderDaibaiThreadPrelude(
        {
          daibaiLoading: false,
          daibaiAskResult: null,
          daibaiExecuteResult: null,
          daibaiActionLoading: false,
          daibaiActionPendingId: null,
          daibaiActionError: null,
          onAskDaibai: options?.onAskDaibai ?? (async () => undefined),
        },
        {
          guideAcknowledged: false,
          onDismissGuide: options?.onDismissGuide,
          onGuidanceControlChange: draw,
          onCreateDaibaiTeam: options?.onCreateDaibaiTeam,
          onOpenAgentCreator: options?.onOpenAgentCreator,
          onOpenMyRobotsSetup: options?.onOpenMyRobotsSetup,
          onApplyCapabilityGap: options?.onApplyCapabilityGap as never,
          onRequestMcpDiscovery: options?.onRequestMcpDiscovery as never,
          onSubmitMcpScanApproval: options?.onSubmitMcpScanApproval as never,
          onSubmitOiEnrollment: options?.onSubmitOiEnrollment as never,
          oiIdentityContext: options?.oiIdentityContext,
          onListMyApplications: options?.onListMyApplications,
          onCancelMyApplication: options?.onCancelMyApplication,
        },
      )}`,
      host,
    );
  };
  draw();
  return host;
}

describe("daibai team onboarding surface", () => {
  it("opens the dual-path team builder from 开始引导 without the old tour prompt", async () => {
    const ask = vi.fn(async () => undefined);
    const host = paint({ onAskDaibai: ask });
    expect(host.textContent).toContain("我是大白管家，我来帮你创建专属你的数字员工团队。");
    expect(host.textContent).not.toMatch(/欢迎入驻\s*openbot/i);
    expect(host.textContent).not.toContain("带你熟悉工作台");
    expect(host.textContent).not.toContain("专属工作助手");

    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    await Promise.resolve();

    expect(ask).not.toHaveBeenCalled();
    expect(host.querySelector("[data-team-step]")?.getAttribute("data-team-step")).toBe("page");
    expect(host.textContent).not.toContain("步骤");
    expect(host.textContent).toContain("从候选名录挑选");
    expect(host.textContent).toContain("结合你的岗位职责和日常工作事务，点击“+”直接定制数字人。");
    const plus = host.querySelector<HTMLButtonElement>(".employee-workbench__team-onboarding-plus");
    expect(plus).toBeTruthy();
    expect(plus?.textContent?.trim()).toBe("+");
    expect(plus?.getAttribute("data-team-open-creator")).toBe("true");
    expect(host.querySelector("button.employee-workbench__team-onboarding-plus-line")).toBeNull();
    expect(host.querySelector(".employee-workbench__team-onboarding-plus-line")?.tagName).toBe("P");
    expect(host.querySelectorAll("[data-team-open-creator]")).toHaveLength(1);
    expect(host.textContent).not.toContain("自己定制");
    expect(host.textContent).not.toContain("说出你的职责");
    expect(host.querySelector("[data-team-path='describe']")).toBeNull();
    expect(host.querySelector("[data-team-path='custom']")).toBeNull();
    expect(host.textContent).toContain("带我了解 OpenBot 的功能");
    expect(host.textContent).toContain("完成配置，让数字人更懂你和熟悉你的工作。");
    expect(host.textContent).not.toContain("完成个人配置");
    expect(host.textContent).not.toContain("稍后处理");
    expect(host.textContent).not.toContain("我知道了");
    expect(host.textContent).not.toContain("每日概览");
    expect(host.querySelector("[data-guidance-primary-cta]")).toBeNull();
    expect(getDaibaiTeamOnboardingEvents().map((event) => event.name)).toContain(
      "onboarding_started",
    );
  });

  it("completes the catalog path by creating through the injected agent pathway", async () => {
    const created: DaibaiTeamMemberDraft[] = [];
    const dismiss = vi.fn();
    const host = paint({
      onDismissGuide: dismiss,
      onCreateDaibaiTeam: async (members) => {
        created.push(...members);
        return {
          created: members.map((member) => ({
            catalogId: member.catalogId,
            agentId: `agent-${member.catalogId}`,
            name: member.name,
          })),
          error: null,
        };
      },
    });

    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-path='catalog']")?.click();
    expect(host.querySelector("[data-team-step]")?.getAttribute("data-team-step")).toBe("page");
    expect(host.querySelector("[data-team-agent='calendar']")?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(host.querySelector("[data-team-agent='email']")?.getAttribute("aria-selected")).toBe(
      "true",
    );
    host.querySelector<HTMLButtonElement>("[data-team-create]")?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(created.map((member) => member.name)).toEqual(["日程秘书", "邮件助理", "文档专员"]);
    expect(host.textContent).toContain("团队已就绪");
    expect(host.textContent).toContain("这份引导会留在大白的对话里");
    expect(host.querySelector("[data-team-retained]")).toBeTruthy();
    expect(host.querySelector("[data-team-enter]")).toBeNull();
    expect(host.textContent).not.toMatch(/欢迎入驻/i);
    expect(host.textContent).toContain("待补齐连接与身份");
    expect(host.querySelector('[data-team-gaps="email"]')).toBeTruthy();
    expect(
      host.querySelector('[data-team-gaps="email"]')?.getAttribute("data-team-gaps-template"),
    ).toBe("personal_mail_assistant");
    expect(host.querySelector('[data-gap-key="personal_email"]')).toBeTruthy();
    expect(host.querySelector('[data-gap-cta="oauth_authorize"]')).toBeTruthy();
    expect(host.querySelector('[data-gap-key="oi_personal_mail"]')).toBeTruthy();
    // calendar / docs are unmapped → no false gap panel rows for them
    expect(host.querySelector('[data-team-gaps="calendar"]')).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
    expect(host.querySelector("[data-daibai-team-onboarding]")).toBeTruthy();
    expect(getDaibaiTeamOnboardingEvents().some((event) => event.name === "team_created")).toBe(
      true,
    );
  });

  it("restores the created guide page after a refresh even when the welcome was acknowledged", () => {
    dispatchDaibaiTeamOnboarding({ type: "start" });
    dispatchDaibaiTeamOnboarding({
      type: "createSuccess",
      created: [{ catalogId: "docs", agentId: "agt-docs", name: "文档专员" }],
    });
    const restored = reloadDaibaiTeamGuideFromStorageForTests();
    expect(restored.step).toBe("page");
    expect(restored.created.map((member) => member.name)).toEqual(["文档专员"]);

    const host = document.createElement("div");
    document.body.append(host);
    render(
      html`${renderDaibaiThreadPrelude(
        {
          daibaiLoading: false,
          daibaiAskResult: null,
          daibaiExecuteResult: null,
          daibaiActionLoading: false,
          daibaiActionPendingId: null,
          daibaiActionError: null,
          onAskDaibai: async () => undefined,
        },
        { guideAcknowledged: true },
      )}`,
      host,
    );
    expect(host.querySelector("[data-daibai-team-onboarding]")).toBeTruthy();
    expect(host.textContent).toContain("文档专员");
    expect(host.textContent).toContain("这份引导会留在大白的对话里");
    expect(getDaibaiTeamOnboardingState().step).toBe("page");
  });

  it("does not show one user's retained guide to another account on the same browser", () => {
    bindDaibaiTeamGuideOwner("sandra");
    dispatchDaibaiTeamOnboarding({ type: "start" });
    dispatchDaibaiTeamOnboarding({
      type: "createSuccess",
      created: [{ catalogId: "email", agentId: "agt-email", name: "邮件助理" }],
    });
    bindDaibaiTeamGuideOwner("other");
    expect(getDaibaiTeamOnboardingState().step).toBe("closed");
    expect(getDaibaiTeamOnboardingState().created).toEqual([]);
    bindDaibaiTeamGuideOwner("sandra");
    expect(getDaibaiTeamOnboardingState().created.map((member) => member.name)).toEqual([
      "邮件助理",
    ]);
  });

  it("sends the familiarization ask from 带我了解 OpenBot 的功能", () => {
    const ask = vi.fn(async () => undefined);
    const dismiss = vi.fn();
    const host = paint({ onAskDaibai: ask, onDismissGuide: dismiss });
    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();

    host.querySelector<HTMLButtonElement>("[data-team-explore]")?.click();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(DAIBAI_GUIDE_PROMPT);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-daibai-team-onboarding]")).toBeTruthy();
    expect(host.textContent).toContain("从候选名录挑选");
    expect(
      getDaibaiTeamOnboardingEvents().some((event) => event.name === "onboarding_skipped"),
    ).toBe(true);
  });

  it("opens 系统设置 → 我的机器人 from the complete-config CTA", () => {
    const openMyRobots = vi.fn();
    const dismiss = vi.fn();
    const host = paint({ onDismissGuide: dismiss, onOpenMyRobotsSetup: openMyRobots });
    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();

    host.querySelector<HTMLButtonElement>("[data-team-my-robots]")?.click();
    expect(openMyRobots).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-daibai-team-onboarding]")).toBeTruthy();
    expect(host.querySelector("[data-team-personal]")).toBeNull();
  });

  it("wires complete-config CTA to system settings robots tab (not personal settings)", () => {
    const appRender = readFileSync("ui/src/ui/app-render.ts", "utf8");
    const start = appRender.indexOf("onOpenMyRobotsSetup:");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = appRender.indexOf("onApplyCapabilityGap:", start);
    const block = appRender.slice(start, end);
    expect(block).toContain('workbenchSettingsView = "system"');
    expect(block).toContain('workbenchSystemSettingsTab = "robots"');
    expect(block).not.toContain('workbenchSettingsView = "personal"');
    expect(block).not.toContain("workbenchPersonalSettingsTab");
    expect(appRender).not.toContain("onCompletePersonalSetup");
  });

  it("keeps surrounding guidance text non-interactive", () => {
    const host = paint();
    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    const line = host.querySelector(".employee-workbench__team-onboarding-plus-line");
    expect(line?.tagName).toBe("P");
    expect(line?.querySelectorAll("button")).toHaveLength(1);
    expect(line?.textContent?.replace(/\s+/g, "")).toContain("点击“+”直接定制数字人");
  });

  it("opens the same AI 助手 plus creator from the guidance + only", () => {
    const openCreator = vi.fn();
    const host = paint({ onOpenAgentCreator: openCreator });
    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    const plus = host.querySelector<HTMLButtonElement>("[data-team-open-creator]");
    expect(plus?.textContent?.trim()).toBe("+");
    plus?.click();
    expect(openCreator).toHaveBeenCalledTimes(1);

    const add = document.createElement("button");
    add.className = "employee-workbench__group-add";
    add.setAttribute("aria-label", "add AI 助手");
    const clicked = vi.fn();
    add.addEventListener("click", clicked);
    document.body.append(add);
    host.querySelector<HTMLButtonElement>("[data-team-open-creator]")?.click();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(openCreator).toHaveBeenCalledTimes(1);
  });

  it("leaves the robot growth prelude file on its own onboarding card", () => {
    const source = readFileSync(
      "ui/src/ui/ports/employee/views/workbench-stage-growth-prelude.ts",
      "utf8",
    );
    expect(source).toContain("上岗培养");
    expect(source).not.toContain("daibai-team-onboarding");
    expect(source).not.toMatch(/欢迎入驻\s*openbot/i);
  });

  it("applies oauth gap CTA through the injected handler after create", async () => {
    const apply = vi.fn();
    const dismiss = vi.fn();
    const host = paint({
      onDismissGuide: dismiss,
      onApplyCapabilityGap: apply,
      onCreateDaibaiTeam: async (members) => ({
        created: members
          .filter((member) => member.catalogId === "email")
          .map((member) => ({
            catalogId: member.catalogId,
            agentId: `agent-${member.catalogId}`,
            name: member.name,
          })),
        error: null,
      }),
    });
    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-path='catalog']")?.click();
    // deselect calendar + docs, keep email
    host.querySelector<HTMLButtonElement>("[data-team-agent='calendar']")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-agent='docs']")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-create]")?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector('[data-team-gaps="email"]')).toBeTruthy();
    host.querySelector<HTMLButtonElement>('[data-team-gap-cta="oauth_authorize"]')?.click();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0]).toBe("oauth_authorize");
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("scans enterprise MCP and submits governance create before optional EDC deeplink (no grant)", async () => {
    const apply = vi.fn();
    const submit = vi.fn(async (input: { mcpServer: string; mcpTool: string }) => {
      expect(input.mcpServer).toBe("hubspot-crm");
      expect(input.mcpTool).toBe("list_leads");
      return { approvalId: "apr-mcp-1" };
    });
    const discovery = vi.fn(async () => ({
      remoteToolsList: "ok" as const,
      gap: "none" as const,
      items: [
        {
          serverName: "hubspot-crm",
          toolName: "list_leads",
          status: "unmapped" as const,
          capabilityId: null,
          capabilityKey: null,
          capabilityDisplayName: null,
        },
        {
          serverName: "linear",
          toolName: "list_issues",
          status: "unmapped" as const,
          capabilityId: null,
          capabilityKey: null,
          capabilityDisplayName: null,
        },
      ],
    }));
    const host = paint({
      onApplyCapabilityGap: apply,
      onRequestMcpDiscovery: discovery,
      onSubmitMcpScanApproval: submit,
      onCreateDaibaiTeam: async (members) => ({
        created: members
          .filter((member) => member.catalogId === "crm")
          .map((member) => ({
            catalogId: member.catalogId,
            agentId: `agent-${member.catalogId}`,
            name: member.name,
          })),
        error: null,
      }),
    });
    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-path='catalog']")?.click();
    // recommended defaults: calendar, email, docs — select crm, deselect others
    for (const id of ["calendar", "email", "docs"]) {
      host.querySelector<HTMLButtonElement>(`[data-team-agent='${id}']`)?.click();
    }
    host.querySelector<HTMLButtonElement>("[data-team-agent='crm']")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-create]")?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector("[data-team-mcp-scan-panel]")).toBeTruthy();
    expect(host.textContent).toContain("扫描并申请企业 MCP");
    expect(host.textContent).toContain("通过后由管理员显式开通（不会自动授权）");
    expect(host.textContent).not.toContain("cn-office 企业审核策略未在本阶段实现");
    host.querySelector<HTMLButtonElement>("[data-team-mcp-scan-run]")?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(discovery).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-scan-server="hubspot-crm"]')).toBeTruthy();
    expect(host.querySelector('[data-scan-server="linear"]')).toBeNull();

    // Primary CTA submits create; does not navigate / upsert / grant.
    host.querySelector<HTMLButtonElement>('[data-team-scan-cta="mcp_scan_apply"]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      mcpServer: "hubspot-crm",
      mcpTool: "list_leads",
      discoveryStatusSnapshot: "unmapped",
      catalogId: "crm",
      templateId: "sales_assistant",
    });
    expect(submit.mock.calls[0]?.[0].clientRequestId).toContain("hubspot-crm");
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelector("[data-scan-submit-success='apr-mcp-1']")?.textContent).toContain(
      "已提交申请 #apr-mcp-1",
    );

    // Secondary EDC deeplink still available (admin Save); still no grant.
    host.querySelector<HTMLButtonElement>("[data-team-scan-edc]")?.click();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0]).toBe("mcp_scan_apply");
    expect(apply.mock.calls[0]?.[3]).toMatchObject({
      mcpServer: "hubspot-crm",
      mcpTool: "list_leads",
      edc: "capabilities",
      approvalId: "apr-mcp-1",
    });
  });

  it("keeps static hints when remote tools are unavailable and hides them on permission failure", async () => {
    const appRender = readFileSync("ui/src/ui/app-render.ts", "utf8");
    const discoveryStart = appRender.indexOf("onRequestMcpDiscovery:");
    const discoveryEnd = appRender.indexOf("onSubmitMcpScanApproval:", discoveryStart);
    const discoveryBlock = appRender.slice(discoveryStart, discoveryEnd);
    expect(discoveryBlock).toContain('"enterprise-data.mcp-discovery.for-seat"');
    expect(discoveryBlock).toContain("catalogId: request.catalogId");
    expect(discoveryBlock).toContain("templateId: request.templateId");
    expect(discoveryBlock).not.toContain('"enterprise-data.mcp-discovery"');
    expect(discoveryBlock).not.toContain("mcp-mapping.upsert");
    expect(discoveryBlock).not.toContain("grants.upsert");

    const remote = vi.fn(async () => ({
      remoteToolsList: "unavailable" as const,
      gap: "remote_tools_list_unavailable" as const,
      items: [],
    }));
    const remoteHost = paint({
      onRequestMcpDiscovery: remote,
      onCreateDaibaiTeam: async (members) => ({
        created: members
          .filter((member) => member.catalogId === "crm")
          .map((member) => ({
            catalogId: member.catalogId,
            agentId: `agent-${member.catalogId}`,
            name: member.name,
          })),
        error: null,
      }),
    });
    remoteHost.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    remoteHost.querySelector<HTMLButtonElement>("[data-team-path='catalog']")?.click();
    for (const id of ["calendar", "email", "docs"]) {
      remoteHost.querySelector<HTMLButtonElement>(`[data-team-agent='${id}']`)?.click();
    }
    remoteHost.querySelector<HTMLButtonElement>("[data-team-agent='crm']")?.click();
    remoteHost.querySelector<HTMLButtonElement>("[data-team-create]")?.click();
    await Promise.resolve();
    await Promise.resolve();
    remoteHost.querySelector<HTMLButtonElement>("[data-team-mcp-scan-run]")?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(remoteHost.querySelector("[data-scan-status='empty']")?.textContent).toContain(
      "远程 tools/list 暂不可用",
    );
    expect(remoteHost.querySelector("[data-scan-group='static-fallback']")).toBeTruthy();
    expect(remoteHost.querySelector("[data-scan-server]")).toBeNull();

    document.body.replaceChildren();
    resetDaibaiTeamOnboardingForTests();
    const denied = vi.fn(async () => {
      throw Object.assign(new Error("当前会话没有可用席位，无法查看 MCP 能力。"), {
        details: { code: "NO_CURRENT_SEAT" },
      });
    });
    const deniedHost = paint({
      onRequestMcpDiscovery: denied,
      onCreateDaibaiTeam: async (members) => ({
        created: members
          .filter((member) => member.catalogId === "crm")
          .map((member) => ({
            catalogId: member.catalogId,
            agentId: `agent-${member.catalogId}`,
            name: member.name,
          })),
        error: null,
      }),
    });
    deniedHost.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    deniedHost.querySelector<HTMLButtonElement>("[data-team-path='catalog']")?.click();
    for (const id of ["calendar", "email", "docs"]) {
      deniedHost.querySelector<HTMLButtonElement>(`[data-team-agent='${id}']`)?.click();
    }
    deniedHost.querySelector<HTMLButtonElement>("[data-team-agent='crm']")?.click();
    deniedHost.querySelector<HTMLButtonElement>("[data-team-create]")?.click();
    await Promise.resolve();
    await Promise.resolve();
    deniedHost.querySelector<HTMLButtonElement>("[data-team-mcp-scan-run]")?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(deniedHost.querySelector("[data-scan-status='error']")?.textContent).toContain(
      "没有可用席位",
    );
    expect(deniedHost.querySelector("[data-scan-group='static-fallback']")).toBeNull();
    expect(deniedHost.querySelector("[data-scan-group='candidates']")).toBeNull();
    expect(deniedHost.querySelector("[data-scan-server]")).toBeNull();
    expect(deniedHost.querySelector("[data-team-scan-cta='mcp_scan_apply']")).toBeNull();
  });

  it("lists 我的申请 on the success page and refreshes after MCP scan submit", async () => {
    const appRender = readFileSync("ui/src/ui/app-render.ts", "utf8");
    const listStart = appRender.indexOf("onListMyApplications");
    const wired = appRender.slice(listStart, listStart + 1400);
    expect([...wired.matchAll(/client\.request\(\s*"([^"]+)"/g)].map((match) => match[1])).toEqual([
      "enterprise-data.governance-approvals.list",
      "enterprise-data.governance-approvals.cancel",
    ]);

    const applicationsView = readFileSync(
      "ui/src/ui/ports/employee/views/daibai-my-applications-view.ts",
      "utf8",
    );
    expect(applicationsView).not.toContain("mcp-mapping.upsert");
    expect(applicationsView).not.toContain("grants.upsert");
    expect(applicationsView).not.toContain("approve_and_provision");

    let releaseRefresh: ((value: unknown) => void) | null = null;
    let listCalls = 0;
    const list = vi.fn(async () => {
      listCalls += 1;
      if (listCalls === 1) {
        return {
          requests: [
            {
              approvalId: "apr-old",
              category: "pack_skill_review",
              displayName: "cn-office:contract",
              status: "rejected",
              requestedAt: "2026-10-16T00:00:00.000Z",
            },
          ],
        };
      }
      return await new Promise((resolve) => {
        releaseRefresh = resolve;
      });
    });
    const cancel = vi.fn(async () => undefined);
    const submit = vi.fn(async () => ({ approvalId: "apr-new" }));
    const apply = vi.fn();
    const discovery = vi.fn(async () => ({
      remoteToolsList: "ok" as const,
      gap: "none" as const,
      items: [
        {
          serverName: "hubspot-crm",
          toolName: "list_leads",
          status: "unmapped" as const,
          capabilityId: null,
          capabilityKey: null,
          capabilityDisplayName: null,
        },
      ],
    }));
    const host = paint({
      onListMyApplications: list,
      onCancelMyApplication: cancel,
      onSubmitMcpScanApproval: submit,
      onApplyCapabilityGap: apply,
      onRequestMcpDiscovery: discovery,
      onCreateDaibaiTeam: async (members) => ({
        created: members
          .filter((member) => member.catalogId === "crm")
          .map((member) => ({
            catalogId: member.catalogId,
            agentId: `agent-${member.catalogId}`,
            name: member.name,
          })),
        error: null,
      }),
    });

    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-path='catalog']")?.click();
    for (const id of ["calendar", "email", "docs"]) {
      host.querySelector<HTMLButtonElement>(`[data-team-agent='${id}']`)?.click();
    }
    host.querySelector<HTMLButtonElement>("[data-team-agent='crm']")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-create]")?.click();
    await flushPaints();

    expect(host.textContent).toContain("我的申请");
    expect(
      host
        .querySelector("[data-team-my-applications]")
        ?.getAttribute("data-team-my-applications-phase"),
    ).toBe("ready");
    expect(
      host
        .querySelector("[data-approval-id='apr-old']")
        ?.getAttribute("data-approval-product-status"),
    ).toBe("rejected");
    expect(host.querySelector("[data-approval-id='apr-old']")?.textContent).toContain("已拒绝");
    expect(host.querySelector("[data-team-my-application-cancel='apr-old']")).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);

    host.querySelector<HTMLButtonElement>("[data-team-mcp-scan-run]")?.click();
    await flushPaints();
    host.querySelector<HTMLButtonElement>('[data-team-scan-cta="mcp_scan_apply"]')?.click();
    await flushPaints();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(2);
    const optimistic = host.querySelector("[data-approval-id='apr-new']");
    expect(optimistic?.getAttribute("data-approval-product-status")).toBe("submitted");
    expect(optimistic?.textContent).toContain("已提交");
    expect(optimistic?.textContent).toContain("hubspot-crm / list_leads");

    releaseRefresh?.({
      requests: [
        {
          approvalId: "apr-new",
          category: "mcp_tool_mapping",
          displayName: "hubspot-crm / list_leads",
          status: "approved",
          fulfillmentStatus: "pending_admin_save",
          subjectPayload: { mcpServer: "hubspot-crm", mcpTool: "list_leads" },
          requestedAt: "2026-10-16T02:00:00.000Z",
        },
        {
          approvalId: "apr-review",
          category: "oi_enrollment",
          displayName: "企业 OI acme",
          status: "pending",
          reviewState: "in_review",
          requestedAt: "2026-10-16T01:00:00.000Z",
        },
        {
          approvalId: "apr-done",
          category: "mcp_tool_mapping",
          displayName: "mail / list",
          status: "approved",
          fulfillmentStatus: "fulfilled",
          requestedAt: "2026-10-16T00:30:00.000Z",
        },
        {
          approvalId: "apr-withdrawn",
          category: "mcp_tool_mapping",
          displayName: "old / tool",
          status: "cancelled",
          requestedAt: "2026-10-16T00:00:00.000Z",
        },
      ],
    });
    await flushPaints();

    expect(
      host
        .querySelector("[data-approval-id='apr-new']")
        ?.getAttribute("data-approval-product-status"),
    ).toBe("approved_pending_save");
    expect(host.querySelector("[data-approval-id='apr-new']")?.textContent).toContain(
      "已批准（待管理员开通）",
    );
    expect(host.querySelector("[data-approval-id='apr-review']")?.textContent).toContain("审批中");
    expect(host.querySelector("[data-approval-id='apr-done']")?.textContent).toContain("已开通");
    expect(host.querySelector("[data-approval-id='apr-withdrawn']")?.textContent).toContain(
      "已撤回",
    );
    expect(host.querySelector("[data-team-my-application-edc='apr-new']")).toBeTruthy();
    expect(host.querySelector("[data-team-my-application-edc='apr-done']")).toBeNull();
    expect(host.querySelector("[data-team-my-application-cancel='apr-review']")).toBeTruthy();

    host
      .querySelector<HTMLButtonElement>("[data-team-my-application-cancel='apr-review']")
      ?.click();
    await flushPaints();
    expect(cancel).toHaveBeenCalledWith("apr-review");

    host.querySelector<HTMLButtonElement>("[data-team-my-application-edc='apr-new']")?.click();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0]).toBe("mcp_scan_apply");
    expect(apply.mock.calls[0]?.[3]).toMatchObject({
      mcpServer: "hubspot-crm",
      mcpTool: "list_leads",
      edc: "capabilities",
      approvalId: "apr-new",
    });
  });

  it("shows an empty 我的申请 state when the current user has no requests", async () => {
    const list = vi.fn(async () => ({ requests: [] }));
    const host = paint({
      onListMyApplications: list,
      onCreateDaibaiTeam: async (members) => ({
        created: members.slice(0, 1).map((member) => ({
          catalogId: member.catalogId,
          agentId: `agent-${member.catalogId}`,
          name: member.name,
        })),
        error: null,
      }),
    });
    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-path='catalog']")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-create]")?.click();
    await flushPaints();
    expect(host.querySelector("[data-team-my-applications-empty]")?.textContent).toContain(
      "暂无申请",
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("submits personal and enterprise OI as oi_enrollment without authorizing", async () => {
    const appRender = readFileSync("ui/src/ui/app-render.ts", "utf8");
    const submitStart = appRender.indexOf("onSubmitOiEnrollment: async");
    const submitEnd = appRender.indexOf("onListMyApplications", submitStart);
    const handler = appRender.slice(submitStart, submitEnd);
    expect(handler).toContain("enterprise-data.governance-approvals.create");
    expect(handler).toContain("buildDaibaiOiEnrollmentCreateParams");
    expect(handler).not.toContain("grants.upsert");
    expect(handler).not.toContain("mcp-mapping.upsert");
    expect(handler).not.toContain("employee.authorize");
    expect(handler).not.toContain("approve_and_provision");

    const oiView = readFileSync(
      "ui/src/ui/ports/employee/views/daibai-oi-enrollment-view.ts",
      "utf8",
    );
    expect(oiView).not.toContain("grants.upsert");
    expect(oiView).not.toContain("mcp-mapping.upsert");
    expect(oiView).not.toContain("employee.authorize");
    expect(oiView).not.toContain("approve_and_provision");

    const submit = vi.fn(async () => ({ approvalId: "apr-oi-1" }));
    const apply = vi.fn();
    const list = vi.fn(async () => ({ requests: [] as unknown[] }));
    const host = paint({
      onSubmitOiEnrollment: submit,
      onApplyCapabilityGap: apply,
      onListMyApplications: list,
      oiIdentityContext: {
        personalIdentities: [{ identityId: "id-mail", status: "active" }],
        enterpriseSeatIdentities: [{ identityId: "ent-crm", status: "active" }],
      },
      onCreateDaibaiTeam: async (members) => ({
        created: members
          .filter((member) => member.catalogId === "email" || member.catalogId === "crm")
          .map((member) => ({
            catalogId: member.catalogId,
            agentId: `agent-${member.catalogId}`,
            name: member.name,
          })),
        error: null,
      }),
    });
    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-path='catalog']")?.click();
    for (const id of ["calendar", "docs"]) {
      host.querySelector<HTMLButtonElement>(`[data-team-agent='${id}']`)?.click();
    }
    host.querySelector<HTMLButtonElement>("[data-team-agent='crm']")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-create]")?.click();
    await flushPaints();

    expect(host.textContent).toContain("提交企业审批");
    expect(host.textContent).toContain("通过后由本人或管理员显式开通，不会自动授权");
    host.querySelector<HTMLButtonElement>('[data-team-oi-submit="apply_personal_oi"]')?.click();
    await flushPaints();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      identityScope: "personal",
      identityId: "id-mail",
      targetAgentId: "agent-email",
      catalogId: "email",
      templateId: "personal_mail_assistant",
    });
    expect(submit.mock.calls[0]?.[0].clientRequestId).toContain("id-mail");
    expect(submit.mock.calls[0]?.[0].clientRequestId).not.toContain("oi_personal_mail");
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelector("[data-oi-submit-success='apr-oi-1']")?.textContent).toContain(
      "已提交申请 #apr-oi-1",
    );
    expect(host.querySelector("[data-approval-id='apr-oi-1']")?.textContent).toContain(
      "运营身份开通",
    );
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);

    host.querySelector<HTMLButtonElement>('[data-team-oi-submit="apply_enterprise_oi"]')?.click();
    await flushPaints();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]?.[0]).toMatchObject({
      identityScope: "enterprise",
      identityId: "ent-crm",
      targetAgentId: "agent-crm",
      catalogId: "crm",
      templateId: "sales_assistant",
    });
    expect(apply).not.toHaveBeenCalled();

    host.querySelector<HTMLButtonElement>('[data-team-oi-open="apply_personal_oi"]')?.click();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0]).toBe("apply_personal_oi");
  });

  it("shows a zh-CN error and does not create when the operational identity id is missing", async () => {
    const submit = vi.fn(async () => ({ approvalId: "apr-should-not" }));
    const apply = vi.fn();
    const host = paint({
      onSubmitOiEnrollment: submit,
      onApplyCapabilityGap: apply,
      onCreateDaibaiTeam: async (members) => ({
        created: members
          .filter((member) => member.catalogId === "email")
          .map((member) => ({
            catalogId: member.catalogId,
            agentId: `agent-${member.catalogId}`,
            name: member.name,
          })),
        error: null,
      }),
    });
    host.querySelector<HTMLButtonElement>("[data-guidance-primary-cta]")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-path='catalog']")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-agent='calendar']")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-agent='docs']")?.click();
    host.querySelector<HTMLButtonElement>("[data-team-create]")?.click();
    await flushPaints();

    host.querySelector<HTMLButtonElement>('[data-team-oi-submit="apply_personal_oi"]')?.click();
    await flushPaints();

    expect(submit).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelector("[data-oi-submit-error]")?.textContent).toContain("缺少运营身份编号");
    expect(host.textContent).toContain("不会自动授权");

    host.querySelector<HTMLButtonElement>('[data-team-oi-open="apply_personal_oi"]')?.click();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0]).toBe("apply_personal_oi");
  });
});

async function flushPaints() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}
