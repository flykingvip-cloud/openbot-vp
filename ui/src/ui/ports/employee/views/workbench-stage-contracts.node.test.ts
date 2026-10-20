// @vitest-environment jsdom
import { html, render } from "lit";
import { describe, expect, it } from "vitest";
import type { ProgressView } from "../../../../../../src/progress-ledger/types.ts";
import {
  buildWorkbenchStageConversationContract,
  buildWorkbenchStageModuleContract,
} from "./workbench-stage-contracts.ts";

describe("buildWorkbenchStageModuleContract", () => {
  it("forwards supervisorProps into settings contract", () => {
    const request = async () => ({});
    const supervisorProps = {
      client: { request, connected: true } as never,
      tenantId: "t1",
      userId: "u1",
      seatId: "seat-1",
      canCreateTasks: true,
      defaultRepoRoot: "/workspace/repo",
    };
    const contract = buildWorkbenchStageModuleContract(
      {
        authPanel: null,
        chatContent: html`
          <div>chat</div>
        `,
        chatComposer: null,
        activeSessionKey: "agent:main:main",
        supervisorProps,
      },
      {},
    );
    expect(contract.settings?.supervisorProps).toEqual(supervisorProps);
  });

  it("forwards assignedTasksProps into settings contract", () => {
    const assignedTasksProps = {
      client: { request: async () => ({}), connected: true } as never,
    };
    const contract = buildWorkbenchStageModuleContract(
      {
        authPanel: null,
        chatContent: html`
          <div>chat</div>
        `,
        chatComposer: null,
        activeSessionKey: "agent:main:main",
        assignedTasksProps,
      },
      {},
    );
    expect(contract.settings?.assignedTasksProps).toEqual(assignedTasksProps);
  });

  it("forwards gateway client into settings contract for model access", () => {
    const client = { request: async () => ({}), connected: true } as never;
    const contract = buildWorkbenchStageModuleContract(
      {
        authPanel: null,
        chatContent: html`
          <div>chat</div>
        `,
        chatComposer: null,
        activeSessionKey: "agent:main:main",
        client,
      },
      {},
    );
    expect(contract.settings?.client).toBe(client);
  });
});

function progressView(overrides: Partial<ProgressView> = {}): ProgressView {
  return {
    projectionKind: "canonical",
    taskId: "ct-1",
    goal: "网页调研",
    headline: "调研进行中",
    focus: "网页调研",
    acceptanceProgress: { met: 0, total: 1 },
    executionProgress: { completed: 0, total: 1, inProgress: 1, remaining: 0 },
    mode: "deliver",
    stale: false,
    lastMeaningfulChangeAtMs: 1,
    lastUpdatedAtMs: 1,
    emitToChat: true,
    emitNotification: false,
    nodes: [],
    taskCompleted: false,
    planVersion: 1,
    replans: [],
    ...overrides,
  };
}

describe("buildWorkbenchStageConversationContract progress strip (P11)", () => {
  it("does not project unbound cron ledger onto the main conversation", () => {
    const contract = buildWorkbenchStageConversationContract({
      authPanel: null,
      chatContent: html`
        <div>chat</div>
      `,
      chatComposer: null,
      activeSessionKey: "agent:market:main",
      cronProps: {
        jobs: [
          {
            id: "job-1",
            name: "竞品价格检查",
            enabled: true,
            createdAtMs: 1,
            updatedAtMs: 1,
            schedule: { kind: "cron", expr: "0 9 * * *" },
            sessionTarget: "main",
            wakeMode: "now",
            payload: { kind: "agentTurn", message: "run" },
            sessionKey: "agent:market:main",
            progress: progressView({
              taskId: "job-1",
              goal: "今日竞品价格检查",
              headline: "今日竞品价格检查",
              focus: "今日竞品价格检查",
            }),
          },
        ],
      } as never,
    });
    const el = document.createElement("div");
    render(html`${contract.progressStrip}`, el);
    expect(el.textContent?.trim()).toBe("");
  });

  it("does not occupy conversation chat when a ConversationTask projection is present", () => {
    const contract = buildWorkbenchStageConversationContract({
      authPanel: null,
      chatContent: html`
        <div>chat</div>
      `,
      chatComposer: null,
      activeSessionKey: "agent:market:main",
      conversationTaskProgress: progressView(),
    });
    const el = document.createElement("div");
    render(html`${contract.progressStrip}`, el);
    expect(el.textContent?.trim()).toBe("");
  });
});
