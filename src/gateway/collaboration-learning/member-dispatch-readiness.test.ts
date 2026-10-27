import { describe, expect, it, vi } from "vitest";
import { checkMemberDispatchReadiness } from "./member-dispatch-readiness.js";

describe("checkMemberDispatchReadiness", () => {
  it("never dispatches not_registered members", async () => {
    const result = await checkMemberDispatchReadiness({
      members: [
        {
          memberId: "ghost",
          agentId: "ghost-bot",
          registration: "not_registered",
        },
      ],
      sessionExists: () => true,
      autoEnsureSession: true,
      ensureSession: async () => undefined,
    });
    expect(result.allDispatchable).toBe(false);
    expect(result.members[0]?.code).toBe("not_registered");
    expect(result.members[0]?.dispatchable).toBe(false);
  });

  it("marks registered_no_session when ensure is disabled", async () => {
    const result = await checkMemberDispatchReadiness({
      members: [
        {
          memberId: "bot-2",
          agentId: "bot-2",
          registration: "registered",
        },
      ],
      sessionExists: () => false,
      autoEnsureSession: false,
    });
    expect(result.members[0]?.code).toBe("registered_no_session");
    expect(result.gaps).toHaveLength(1);
  });

  it("controlled-ensures session for registered_no_session", async () => {
    const sessions = new Set<string>();
    const ensure = vi.fn(async (agentId: string, sessionKey: string) => {
      sessions.add(`${agentId}:${sessionKey}`);
    });
    const result = await checkMemberDispatchReadiness({
      members: [
        {
          memberId: "bot-2",
          agentId: "bot-2",
          registration: "registered",
        },
      ],
      sessionExists: (agentId, sessionKey) => sessions.has(`${agentId}:${sessionKey}`),
      autoEnsureSession: true,
      ensureSession: ensure,
    });
    expect(ensure).toHaveBeenCalledOnce();
    expect(result.members[0]?.code).toBe("ready");
    expect(result.members[0]?.sessionEnsured).toBe(true);
    expect(result.allDispatchable).toBe(true);
  });

  it("records ensure failure instead of claiming delivered", async () => {
    const result = await checkMemberDispatchReadiness({
      members: [
        {
          memberId: "bot-2",
          agentId: "bot-2",
          registration: "registered",
        },
      ],
      sessionExists: () => false,
      autoEnsureSession: true,
      ensureSession: async () => {
        throw new Error("store locked");
      },
    });
    expect(result.members[0]?.code).toBe("session_ensure_failed");
    expect(result.members[0]?.dispatchable).toBe(false);
  });
});
