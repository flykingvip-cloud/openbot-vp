import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildPlainConversationInstruction,
  canDispatchDiagnoseAction,
  dispatchDiagnoseConversationAction,
  planDiagnoseActionHandoff,
} from "./diagnose-action-dispatch.js";

const dispatchSource = readFileSync(
  fileURLToPath(new URL("./diagnose-action-dispatch.ts", import.meta.url)),
  "utf8",
);

const base = {
  title: "练未观察技能",
  agentPrompt: "请用已安装技能 data-analysis 做一次练习。",
  targetAgentId: "bot-skill",
  targetSessionKey: "agent:bot-skill:main",
  requesterUserId: "user-1",
  tenantAdmin: true,
  sessionExists: () => true,
};

describe("diagnose action 1:1 dispatch", () => {
  it("plans a diagnosed-agent session handoff and rejects group keys", () => {
    const planned = planDiagnoseActionHandoff(base);
    expect(planned).toMatchObject({
      ok: true,
      channel: "diagnosed_agent_session",
      targetSessionKey: "agent:bot-skill:main",
      requesterSessionKey: "agent:main:employee:user-1",
    });
    expect(
      planDiagnoseActionHandoff({
        ...base,
        targetSessionKey: "agent:main:space:aegis",
      }).ok,
    ).toBe(false);
    expect(
      planDiagnoseActionHandoff({
        ...base,
        sessionExists: () => false,
      }),
    ).toEqual({ ok: false, reason: "session_missing" });
  });

  it("wakes the target session but declines the default-disabled diagnosis receipt", async () => {
    const send = vi.fn(async () => ({ runId: "run-1" }));
    const injectReceipt = vi.fn(async () => undefined);
    const result = await dispatchDiagnoseConversationAction({
      ...base,
      tenantId: "001",
      send,
      injectReceipt,
    });
    expect(result).toMatchObject({
      ok: true,
      reason: "accepted",
      runId: "run-1",
      targetSessionKey: "agent:bot-skill:main",
    });
    expect(send).toHaveBeenCalledWith({
      sessionKey: "agent:bot-skill:main",
      message: base.agentPrompt,
      requesterSessionKey: "agent:main:employee:user-1",
      sessionOwnerPlatformUserId: "user-1",
    });
    expect(injectReceipt).not.toHaveBeenCalled();
    expect(result.receipt).toEqual({
      delivered: false,
      reason: "conversation_delivery_gate_closed",
    });
    expect(JSON.stringify(result)).not.toContain("user.daibai.ask");
  });

  it("allows a robot requester session for 1:1, not a group key", () => {
    const planned = planDiagnoseActionHandoff({
      ...base,
      requesterSessionKey: "agent:bot-2:main",
    });
    expect(planned).toMatchObject({
      ok: true,
      requesterSessionKey: "agent:bot-2:main",
      targetSessionKey: "agent:bot-skill:main",
    });
    expect(
      planDiagnoseActionHandoff({
        ...base,
        requesterSessionKey: "agent:bot-2:main:space:aegis",
      }),
    ).toEqual({ ok: false, reason: "group_not_1to1" });
  });

  it("tells the receiver to send the answer back, not write it in this session", () => {
    const text = buildPlainConversationInstruction("高级秘书");
    expect(text).toContain("对方看不到本会话");
    expect(text).toContain("必须用 conversation_send 发给「高级秘书」");
    expect(text).toContain("不要写思考过程");
    expect(text).toContain("已回复高级秘书");
    expect(text).toContain("不要请主人把这句话转达回去");
    expect(text).not.toContain("像平常说话一样回复");
    expect(text).not.toContain("确认");
  });

  it("does not ping-pong the target reply back as a steward user turn", () => {
    expect(dispatchSource).not.toContain("runSessionsSendA2AFlow");
    expect(dispatchSource).not.toContain("maxPingPongTurns");
    expect(dispatchSource).toContain("chat.inject");
  });

  it("does not treat tenantAdmin as enough when the caller id is empty", () => {
    expect(
      canDispatchDiagnoseAction({
        targetAgentId: "bot-skill",
        requesterUserId: "",
        tenantId: "001",
        tenantAdmin: true,
      }),
    ).toBe(false);
  });

  it("does not dispatch a cross-rank steward call before confirmation", async () => {
    const send = vi.fn(async () => ({ runId: "should-not-run" }));
    const result = await dispatchDiagnoseConversationAction({
      title: "找企业管理员的大白",
      agentPrompt: "请看一下这个安排",
      targetAgentId: "main",
      targetSessionKey: "agent:main:employee:ent-admin",
      requesterUserId: "platform-admin",
      tenantId: null,
      tenantAdmin: true,
      sessionExists: () => true,
      send,
      stewardCaller: { rank: "platform_admin" },
    });
    expect(send).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("pending_authorization");
    expect(result.prompt).toBe("平台管理员需要与你发起对话，是否同意？");
    expect(result.actions).toEqual(["同意", "不同意"]);
    expect(result.roleLabel).toBe("平台管理员");
  });

  it("refuses a non-admin steward target instead of sending", async () => {
    const send = vi.fn(async () => ({ runId: "should-not-run" }));
    const result = await dispatchDiagnoseConversationAction({
      title: "打开别人的大白",
      agentPrompt: "你好",
      targetAgentId: "main",
      targetSessionKey: "agent:main:employee:other-user",
      requesterUserId: "user-elle",
      tenantId: "acme",
      tenantAdmin: true,
      sessionExists: () => true,
      send,
      stewardCaller: {
        rank: "member",
        tenantId: "acme",
        targetTenantIds: ["acme"],
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("sends a steward call only after the target agrees", async () => {
    const send = vi.fn(async () => ({ runId: "run-agreed" }));
    const result = await dispatchDiagnoseConversationAction({
      title: "企业内大白对话",
      agentPrompt: "需要和你确认一件事",
      targetAgentId: "main",
      targetSessionKey: "agent:main:employee:employee-1",
      requesterUserId: "ent-admin",
      tenantId: "acme",
      tenantAdmin: true,
      sessionExists: () => true,
      send,
      omitReceipt: true,
      stewardCaller: {
        rank: "enterprise_admin",
        tenantId: "acme",
        targetTenantIds: ["acme"],
      },
      stewardAuthorizationAgreed: true,
    });
    expect(result).toMatchObject({
      ok: true,
      reason: "accepted",
      channel: "steward",
      targetSessionKey: "agent:main:employee:employee-1",
      runId: "run-agreed",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
