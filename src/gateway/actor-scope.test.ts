import { describe, expect, it, vi } from "vitest";
import {
  filterSessionKeysForEmployeeActor,
  isSessionKeyVisibleToEmployeeActor,
  rejectPersonalWorkbenchGlobalConfigAccess,
  type EmployeeSessionVisibilityContext,
} from "./actor-scope.js";
import { ErrorCodes } from "./protocol/index.js";
import type { GatewayClient } from "./server-methods/types.js";

function buildCtx(
  overrides: Partial<EmployeeSessionVisibilityContext> = {},
): EmployeeSessionVisibilityContext {
  return {
    actor: {
      userId: "user-a",
      userEmail: "a@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["bot-a"],
      seatSpaceIds: ["space-a"],
    },
    visibleAgentIds: new Set(["bot-a"]),
    visibleSpaceIds: new Set(["space-a"]),
    auditableGroupBotSessions: new Set<string>(),
    archivedGroupIds: new Set<string>(),
    ...overrides,
  };
}

describe("actor-scope", () => {
  it("allows owned agent direct sessions", () => {
    const ctx = buildCtx();
    expect(isSessionKeyVisibleToEmployeeActor("agent:bot-a:main", ctx)).toBe(true);
  });

  it("denies foreign agent sessions", () => {
    const ctx = buildCtx();
    expect(isSessionKeyVisibleToEmployeeActor("agent:bot-b:main", ctx)).toBe(false);
  });

  it("filters preview keys to visible sessions only", () => {
    const ctx = buildCtx();
    const filtered = filterSessionKeysForEmployeeActor(
      ["agent:bot-a:main", "agent:bot-b:main"],
      ctx,
    );
    expect(filtered).toEqual(["agent:bot-a:main"]);
  });

  it("rejects personal workbench global config patch", () => {
    const respond = vi.fn();
    const blocked = rejectPersonalWorkbenchGlobalConfigAccess({
      client: {
        connect: {
          minProtocol: 1,
          maxProtocol: 1,
          client: {
            id: "test",
            version: "0",
            platform: "test",
            mode: "webchat",
          },
        },
        sessionDomain: "employee",
        user: "a@example.com",
      } as GatewayClient,
      method: "config.patch",
      respond,
    });
    expect(blocked).toBe(true);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
    );
  });
});
