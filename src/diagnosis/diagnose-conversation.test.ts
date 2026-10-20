import { describe, expect, it } from "vitest";
import {
  authorizeConversationDiagnoseRequest,
  classifyDiagnoseConversationCaller,
  extractEmployeeStewardUserId,
} from "./diagnose-conversation.js";

describe("diagnose conversation access (path B)", () => {
  it("lets the enterprise admin steward use roster/all", () => {
    expect(
      classifyDiagnoseConversationCaller({
        sessionKey: "agent:main:main",
        agentId: "main",
        sessionDomain: "enterprise",
        senderIsOwner: true,
      }),
    ).toBe("admin_steward");
    const authorized = authorizeConversationDiagnoseRequest({
      caller: { sessionKey: "agent:main:main", agentId: "main", senderIsOwner: true },
      params: {
        scope: "all",
        targets: [
          { agentId: "sales", sessionKey: "agent:sales:main" },
          { agentId: "ops", sessionKey: "agent:ops:main" },
        ],
      },
    });
    expect(authorized.ok).toBe(true);
    if (authorized.ok) {
      expect(authorized.request.scope).toBe("all");
      expect(authorized.request.locators).toHaveLength(2);
    }
  });

  it("blocks user steward from scope=all and requires a named target", () => {
    expect(
      classifyDiagnoseConversationCaller({
        sessionKey: "agent:main:employee:alice",
        agentId: "main",
        sessionDomain: "employee",
      }),
    ).toBe("user_steward");
    expect(
      authorizeConversationDiagnoseRequest({
        caller: { sessionKey: "agent:main:employee:alice", agentId: "main" },
        params: { scope: "all" },
      }),
    ).toEqual({ ok: false, reason: "scope_all_forbidden" });
    const self = authorizeConversationDiagnoseRequest({
      caller: { sessionKey: "agent:main:employee:alice", agentId: "main" },
      params: { window: "24h" },
    });
    expect(self.ok).toBe(true);
    if (self.ok) {
      expect(self.request.locators).toEqual([
        { agentId: "main", sessionKey: "agent:main:employee:alice" },
      ]);
    }
    expect(
      authorizeConversationDiagnoseRequest({
        caller: { sessionKey: "agent:main:employee:alice", agentId: "main" },
        params: { agentId: "sales", sessionKey: "agent:sales:main" },
      }),
    ).toEqual({ ok: false, reason: "target_required" });
    const named = authorizeConversationDiagnoseRequest({
      caller: {
        sessionKey: "agent:main:employee:alice",
        agentId: "main",
        allowedAgentIds: ["sales"],
      },
      params: { agentId: "sales", sessionKey: "agent:sales:main" },
    });
    expect(named.ok).toBe(true);
    if (named.ok) {
      expect(named.request.deliverTo).toEqual({ enterpriseAdmin: false, owners: false });
      expect(named.request.locators).toEqual([
        { agentId: "sales", sessionKey: "agent:sales:main", runId: null },
      ]);
    }
  });

  it("reads the employee id from the steward session key", () => {
    expect(
      extractEmployeeStewardUserId("agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa"),
    ).toBe("90fed19a-1c8b-4420-87e0-bcc6165e32fa");
    expect(extractEmployeeStewardUserId("agent:main:main")).toBeNull();
  });

  it("does not treat a bare main session as admin without enterprise elevation", () => {
    expect(
      classifyDiagnoseConversationCaller({
        sessionKey: "agent:main:main",
        agentId: "main",
      }),
    ).toBe("user_steward");
  });

  it("lets a user steward diagnose an owned collaboration group", () => {
    const named = authorizeConversationDiagnoseRequest({
      caller: {
        sessionKey: "agent:main:employee:alice",
        agentId: "main",
        allowedGroupIds: ["g1"],
      },
      params: { groupId: "g1", agentId: "sales" },
    });
    expect(named.ok).toBe(true);
    if (named.ok) {
      expect(named.request.locators).toEqual([
        { agentId: "sales", sessionKey: "agent:sales:space:g1", runId: null },
      ]);
    }
  });

  it("pins an ordinary agent conversation to itself", () => {
    const authorized = authorizeConversationDiagnoseRequest({
      caller: { sessionKey: "agent:sales:main", agentId: "sales" },
      params: { scope: "all", agentId: "other", sessionKey: "agent:other:main" },
    });
    expect(authorized).toEqual({
      ok: true,
      request: expect.objectContaining({
        locators: [{ agentId: "sales", sessionKey: "agent:sales:main" }],
      }),
    });
  });
});
