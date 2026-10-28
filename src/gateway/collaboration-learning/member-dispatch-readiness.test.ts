import { describe, expect, it, vi } from "vitest";
import { precheckDispatchReadiness } from "./dispatch-readiness-precheck.js";
import {
  checkMemberDispatchReadiness,
  collaborationDispatchIdsMatch,
} from "./member-dispatch-readiness.js";

describe("collaborationDispatchIdsMatch", () => {
  it("treats bare gateway agent ids and bot: prefixes as the same bot", () => {
    expect(collaborationDispatchIdsMatch("bot", "bot:bot")).toBe(true);
    expect(collaborationDispatchIdsMatch("agent:bot-2", "bot-2")).toBe(true);
    expect(collaborationDispatchIdsMatch("bot", "bot-2")).toBe(false);
  });
});

describe("checkMemberDispatchReadiness", () => {
  it("never dispatches not_registered members", async () => {
    const result = await checkMemberDispatchReadiness({
      members: [{ memberId: "ghost" }],
      resolveMember: async () => ({
        memberId: "ghost",
        agentId: "ghost-bot",
        displayName: null,
        registration: "not_registered",
        sessionKey: null,
      }),
      sessionExists: () => true,
      autoEnsureSession: true,
      ensureSession: async () => undefined,
    });
    expect(result.allDispatchable).toBe(false);
    expect(result.members[0]?.code).toBe("not_registered");
    expect(result.members[0]?.dispatchable).toBe(false);
  });

  it("defaults autoEnsureSession to false (read check does not write)", async () => {
    const ensure = vi.fn(async () => undefined);
    const result = await checkMemberDispatchReadiness({
      members: [{ memberId: "bot-2" }],
      resolveMember: async () => ({
        memberId: "bot-2",
        agentId: "bot-2",
        displayName: null,
        registration: "registered",
        sessionKey: "agent:bot-2:main",
      }),
      sessionExists: () => false,
      ensureSession: ensure,
    });
    expect(ensure).not.toHaveBeenCalled();
    expect(result.members[0]?.code).toBe("registered_no_session");
  });

  it("ignores request-declared registration when resolveMember is provided", async () => {
    const result = await checkMemberDispatchReadiness({
      members: [
        {
          memberId: "bot-2",
          registration: "registered",
          agentId: "spoofed",
        },
      ],
      resolveMember: async () => ({
        memberId: "bot-2",
        agentId: null,
        displayName: null,
        registration: "not_registered",
        sessionKey: null,
      }),
      sessionExists: () => true,
      autoEnsureSession: true,
      ensureSession: async () => undefined,
    });
    expect(result.members[0]?.code).toBe("not_registered");
    expect(result.members[0]?.dispatchable).toBe(false);
  });

  it("controlled-ensures session only when autoEnsureSession explicitly true", async () => {
    const sessions = new Set<string>();
    const ensure = vi.fn(async (agentId: string, sessionKey: string) => {
      sessions.add(`${agentId}:${sessionKey}`);
    });
    const result = await checkMemberDispatchReadiness({
      members: [{ memberId: "bot-2" }],
      resolveMember: async () => ({
        memberId: "bot-2",
        agentId: "bot-2",
        displayName: null,
        registration: "registered",
        sessionKey: "agent:bot-2:main",
      }),
      sessionExists: (agentId, sessionKey) => sessions.has(`${agentId}:${sessionKey}`),
      autoEnsureSession: true,
      ensureSession: ensure,
    });
    expect(ensure).toHaveBeenCalledOnce();
    expect(result.members[0]?.code).toBe("ready");
    expect(result.members[0]?.sessionEnsured).toBe(true);
  });

  it("records ensure failure instead of claiming delivered", async () => {
    const result = await checkMemberDispatchReadiness({
      members: [{ memberId: "bot-2" }],
      resolveMember: async () => ({
        memberId: "bot-2",
        agentId: "bot-2",
        displayName: null,
        registration: "registered",
        sessionKey: "agent:bot-2:main",
      }),
      sessionExists: () => false,
      autoEnsureSession: true,
      ensureSession: async () => {
        throw new Error("store locked");
      },
    });
    expect(result.members[0]?.code).toBe("session_ensure_failed");
    expect(result.members[0]?.dispatchable).toBe(false);
  });

  it("surfaces resolver detail on not_registered gaps", async () => {
    const result = await checkMemberDispatchReadiness({
      members: [{ memberId: "bot" }],
      resolveMember: async () => ({
        memberId: "bot",
        agentId: null,
        displayName: null,
        registration: "not_registered",
        sessionKey: null,
        detail: "not_in_gateway_agents_list",
      }),
      sessionExists: () => true,
    });
    expect(result.allDispatchable).toBe(false);
    expect(result.gaps[0]?.code).toBe("not_registered");
    expect(result.gaps[0]?.detail).toBe("not_in_gateway_agents_list");
  });
});

describe("precheckDispatchReadiness", () => {
  it("is read-only and surfaces gaps", async () => {
    const result = await precheckDispatchReadiness({
      memberIds: ["bot-2", "ghost"],
      resolveMember: async (id) =>
        id === "bot-2"
          ? {
              memberId: "bot-2",
              agentId: "bot-2",
              displayName: null,
              registration: "registered",
              sessionKey: "agent:bot-2:main",
            }
          : {
              memberId: id,
              agentId: null,
              displayName: null,
              registration: "not_registered",
              sessionKey: null,
            },
    });
    expect(result.allDispatchable).toBe(false);
    expect(result.gaps.some((g) => g.memberId === "ghost")).toBe(true);
  });
});
