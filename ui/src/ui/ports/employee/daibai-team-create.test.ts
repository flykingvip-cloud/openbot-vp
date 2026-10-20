import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../../app-view-state.ts";
import { createDaibaiTeamMembers } from "./daibai-team-create.ts";

describe("createDaibaiTeamMembers", () => {
  it("creates each selected employee through workspaces.create and agents.create", async () => {
    const calls: string[] = [];
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push(method);
      if (method === "workspaces.local.validate") {
        return { ok: true, resolvedPath: "/tmp/openbot-workspace" };
      }
      if (method === "workspaces.create") {
        const local = params.local as { path?: string };
        return { workspaceId: `ws-${calls.length}`, runtimePath: local.path };
      }
      if (method === "agents.create") {
        return { agentId: params.agentId, name: params.name };
      }
      return { ok: true };
    });
    const requestUpdate = vi.fn();
    const result = await createDaibaiTeamMembers(
      {
        client: { request },
        connected: true,
        hello: {
          auth: { provider: "trusted-proxy", user: "alice", displayName: "Alice" },
        },
        platformAuthState: null,
        bootstrapAuthSession: null,
        configForm: { agents: { defaults: { workspace: "/tmp/openbot-workspace" } } },
        configSnapshot: null,
        agentsList: { agents: [] },
        requestUpdate,
      } as unknown as AppViewState,
      [
        { catalogId: "calendar", name: "日程秘书", emoji: "📅", specialty: "会议、日程、提醒" },
        { catalogId: "email", name: "邮件助理", emoji: "✉️", specialty: "收件摘要、草稿回复" },
        {
          catalogId: "crm",
          name: "客户跟进助手",
          emoji: "🤝",
          specialty: "CRM 跟进提醒与话术草稿",
        },
        {
          catalogId: "contract",
          name: "合同审查员",
          emoji: "📄",
          specialty: "合同条款风险识别与要点摘要",
        },
      ],
    );

    expect(result.error).toBeNull();
    expect(result.created.map((member) => member.name)).toEqual([
      "日程秘书",
      "邮件助理",
      "客户跟进助手",
      "合同审查员",
    ]);
    expect(calls.filter((method) => method === "agents.create")).toHaveLength(4);
    expect(calls).toContain("workspaces.create");
    expect(calls).toContain("robots.bind-workspace");
    const createParams = request.mock.calls
      .filter((call) => call[0] === "agents.create")
      .map((call) => call[1] as { name: string; templateId?: string; workspace: string });
    expect(createParams.map((params) => params.name)).toEqual([
      "日程秘书",
      "邮件助理",
      "客户跟进助手",
      "合同审查员",
    ]);
    expect(createParams.map((params) => params.templateId)).toEqual([
      "generic_worker",
      "personal_mail_assistant",
      "sales_assistant",
      "contract_reviewer",
    ]);
    expect(createParams[0]?.workspace).toContain("/tmp/openbot-workspace/agents/");
    expect(requestUpdate).toHaveBeenCalled();
  });

  it("passes generic_worker for unmapped catalog ids", async () => {
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "workspaces.local.validate") {
        return { ok: true, resolvedPath: "/tmp/openbot-workspace" };
      }
      if (method === "workspaces.create") {
        const local = params.local as { path?: string };
        return { workspaceId: "ws-1", runtimePath: local.path };
      }
      if (method === "agents.create") {
        return { agentId: params.agentId, name: params.name };
      }
      return { ok: true };
    });
    const result = await createDaibaiTeamMembers(
      {
        client: { request },
        connected: true,
        hello: {
          auth: { provider: "trusted-proxy", user: "alice", displayName: "Alice" },
        },
        platformAuthState: null,
        bootstrapAuthSession: null,
        configForm: { agents: { defaults: { workspace: "/tmp/openbot-workspace" } } },
        configSnapshot: null,
        agentsList: { agents: [] },
        requestUpdate: vi.fn(),
      } as unknown as AppViewState,
      [{ catalogId: "unknown-role", name: "定制助手", emoji: "✨", specialty: "自定义" }],
    );
    expect(result.error).toBeNull();
    const createParams = request.mock.calls
      .filter((call) => call[0] === "agents.create")
      .map((call) => call[1] as { templateId?: string });
    expect(createParams[0]?.templateId).toBe("generic_worker");
  });

  it("stops when the workspace root is missing instead of inventing a path", async () => {
    const request = vi.fn();
    const result = await createDaibaiTeamMembers(
      {
        client: { request },
        connected: true,
        hello: null,
        platformAuthState: null,
        bootstrapAuthSession: null,
        configForm: null,
        configSnapshot: null,
        agentsList: { agents: [] },
        requestUpdate: vi.fn(),
      } as unknown as AppViewState,
      [{ catalogId: "docs", name: "文档专员", emoji: "📄", specialty: "写稿" }],
    );
    expect(result.created).toEqual([]);
    expect(result.error).toContain("工作空间");
    expect(request).not.toHaveBeenCalled();
  });
});
