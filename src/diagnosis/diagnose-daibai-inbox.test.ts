import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createDiagnoseConversationInject } from "./diagnose-daibai-inbox-live.js";
import {
  deliverDiagnoseReportToConversation,
  extractSpaceGroupId,
  ownerStewardInboxRecipient,
  resolveDiagnoseConversationTargets,
  stewardConversationTarget,
} from "./diagnose-daibai-inbox.js";
import { executeParsedDiagnoseRequest } from "./diagnose-live-request.js";
import { parseDiagnoseRequest, planDiagnosisDaibaiDelivery } from "./diagnose-policy.js";
import { DIAGNOSIS_DAIBAI_DELIVERY_ENABLED } from "./production-cutover.js";

const TRUSTED = { tenantId: "tenant-inbox-a" };
const PRINCIPAL = {
  schemaVersion: 1 as const,
  principalId: "op-1",
  kind: "user" as const,
  tenantId: TRUSTED.tenantId,
};

describe("diagnose Da Bai conversation (path A)", () => {
  it("keeps the production delivery gate closed and injects via chat.inject", () => {
    const liveSource = readFileSync(
      fileURLToPath(new URL("./diagnose-daibai-inbox-live.ts", import.meta.url)),
      "utf8",
    );
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(liveSource).toContain("chat.inject");
    expect(liveSource).not.toMatch(/["']chat\.send["']/);
    expect(liveSource).not.toContain("user.daibai.ask");
    expect(liveSource).not.toContain("user.daibai.execute");
    expect(liveSource).not.toContain("appendAssistantMessageToSessionTranscript");
    expect(liveSource).not.toContain("diagnose-inbox-store");
    expect(liveSource).not.toContain("appendDiagnoseInboxItem");
    const plan = planDiagnosisDaibaiDelivery({ enterpriseAdmin: true, owners: true });
    expect(plan.delivered).toBe(false);
    expect(plan.reason).toBe("daibai_delivery_gate_closed");
    expect(plan.sessions).toEqual([]);
  });

  it("resolves enterprise admin to their Da Bai conversation, not a mailbox", () => {
    const request = parseDiagnoseRequest({
      deliverTo: { enterpriseAdmin: true, owners: false },
      agentId: "sales",
      sessionKey: "agent:sales:main",
    });
    expect(
      resolveDiagnoseConversationTargets({
        request,
        tenantId: TRUSTED.tenantId,
        requesterUserId: "op-1",
      }),
    ).toEqual([stewardConversationTarget({ userId: "op-1", route: "enterprise" })]);
    expect(stewardConversationTarget({ userId: "op-1", route: "enterprise" }).sessionKey).toBe(
      "agent:main:employee:op-1",
    );
  });

  it("resolves owners to their Da Bai conversation, not the bot main session", () => {
    const request = parseDiagnoseRequest({
      deliverTo: { enterpriseAdmin: false, owners: true },
      targets: [
        { agentId: "sales", sessionKey: "agent:sales:space:g1" },
        { agentId: "main", sessionKey: "agent:main:main" },
      ],
    });
    const targets = resolveDiagnoseConversationTargets({
      request,
      tenantId: TRUSTED.tenantId,
      resolveOwners: ({ locator }) => {
        if (locator.agentId === "sales") {
          return [ownerStewardInboxRecipient({ tenantId: TRUSTED.tenantId, userId: "alice" })];
        }
        return [];
      },
    });
    expect(extractSpaceGroupId("agent:sales:space:g1")).toBe("g1");
    expect(targets).toEqual([
      ownerStewardInboxRecipient({ tenantId: TRUSTED.tenantId, userId: "alice" }),
    ]);
    expect(targets[0]?.sessionKey).toBe("agent:main:employee:alice");
  });

  it("delivers a redacted report into designated conversations when inject is wired", async () => {
    const sent: Array<{ sessionKey: string; userId: string; text: string; route: string }> = [];
    const request = parseDiagnoseRequest({
      deliverTo: { enterpriseAdmin: true, owners: true },
      agentId: "sales",
      sessionKey: "agent:sales:main",
    });
    const plan = await deliverDiagnoseReportToConversation({
      request,
      reportText: "【诊断报告】\n结论：证据不足",
      tenantId: TRUSTED.tenantId,
      requesterUserId: "op-1",
      send: async ({ sessionKey, userId, text, route }) => {
        sent.push({ sessionKey, userId, text, route });
        return "accepted";
      },
      resolveOwners: () => [
        ownerStewardInboxRecipient({ tenantId: TRUSTED.tenantId, userId: "alice" }),
      ],
    });
    expect(plan.delivered).toBe(true);
    expect(plan.reason).toBe("conversation_accepted");
    expect(plan.sessions).toEqual(["agent:main:employee:op-1", "agent:main:employee:alice"]);
    expect(sent).toHaveLength(2);
    expect(sent.every((row) => row.text.startsWith("【诊断报告】"))).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("user.daibai.ask");
    expect(JSON.stringify(sent)).not.toContain("chat.send");
  });

  it("injects via chat.inject with a diagnosis label", async () => {
    const inject = vi.fn().mockResolvedValue({ ok: true });
    const send = createDiagnoseConversationInject({
      inject,
      ensureSession: async () => undefined,
    });
    await expect(
      send({
        sessionKey: "agent:main:employee:op-1",
        userId: "op-1",
        tenantId: TRUSTED.tenantId,
        text: "【诊断报告】\n结论：证据不足",
        route: "enterprise",
      }),
    ).resolves.toBe("accepted");
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "chat.inject",
        params: expect.objectContaining({
          sessionKey: "agent:main:employee:op-1",
          label: "诊断报告",
        }),
      }),
    );
  });

  it("does not conversation-deliver on tick even when the schedule asked for audiences", async () => {
    const sent: string[] = [];
    const payload = await executeParsedDiagnoseRequest({
      request: parseDiagnoseRequest({
        deliverTo: { enterpriseAdmin: true, owners: true },
        agentId: "missing-bot",
        sessionKey: "agent:missing-bot:main",
      }),
      trusted: TRUSTED,
      requestedBy: PRINCIPAL,
      allowConversationDelivery: false,
      conversationSend: async ({ sessionKey }) => {
        sent.push(sessionKey);
        return "accepted";
      },
    });
    expect(sent).toEqual([]);
    expect(payload.delivery.delivered).toBe(false);
    expect(payload.delivery.reason).toBe("tick_suppressed");
  });

  it("keeps gate_closed when checkboxes are on but no conversation inject is wired", async () => {
    const payload = await executeParsedDiagnoseRequest({
      request: parseDiagnoseRequest({
        deliverTo: { enterpriseAdmin: true, owners: true },
        agentId: "missing-bot",
        sessionKey: "agent:missing-bot:main",
      }),
      trusted: TRUSTED,
      requestedBy: PRINCIPAL,
    });
    expect(payload.delivery.delivered).toBe(false);
    expect(payload.delivery.reason).toBe("daibai_delivery_gate_closed");
  });
});

// These historical cutover / functional rehearsals explicitly opt into writes
// against injected local ports. Default-closed behavior is covered separately
// in write-policy.test.ts; this is not production enablement.
vi.mock("./write-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write-policy.js")>();
  return {
    ...actual,
    DIAGNOSIS_WRITE_POLICY: {
      selfEvolutionConfirm: true,
      conversationDelivery: true,
      daibaiDelivery: true,
    },
  };
});
