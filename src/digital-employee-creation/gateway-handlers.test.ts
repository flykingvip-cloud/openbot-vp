import { describe, expect, it } from "vitest";
import { createDigitalEmployeeHandlers } from "./gateway-handlers.js";
import { DesignSessionStore } from "./gateway-store.js";

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
};

function requirePayload(result: InvokeResult): Record<string, unknown> {
  expect(result.payload).toBeTruthy();
  return result.payload as Record<string, unknown>;
}

function sessionOf(result: InvokeResult): { id: string; status: string } {
  const session = requirePayload(result).session as { id: string; status: string } | undefined;
  expect(session).toBeTruthy();
  return session as { id: string; status: string };
}

function invoke(
  handlers: ReturnType<typeof createDigitalEmployeeHandlers>,
  method: string,
  params: Record<string, unknown>,
): Promise<InvokeResult> {
  return new Promise((resolve) => {
    const handler = handlers[method];
    if (!handler) {
      resolve({ ok: false, error: { message: `missing ${method}` } });
      return;
    }
    void handler({
      params,
      respond: (ok: boolean, payload?: unknown, error?: { message?: string }) => {
        resolve({
          ok,
          payload: payload as Record<string, unknown> | undefined,
          error: error as { message?: string } | undefined,
        });
      },
      client: { platformUserId: "user-1" },
    } as never);
  });
}

describe("digitalEmployee.design RPCs", () => {
  it("compiles, confirms without creating, then instantiates skills only", async () => {
    const store = new DesignSessionStore();
    const installed: string[] = [];
    const handlers = createDigitalEmployeeHandlers({
      store,
      installSkills: async ({ skillKeys }) => {
        installed.push(...skillKeys);
        return {
          installed: skillKeys.map((skillKey) => ({ skillKey, ok: true })),
          failed: [],
        };
      },
    });

    const compiled = await invoke(handlers, "digitalEmployee.design.compile", {
      rawRequest: "创建销售助理，跟进 CRM，出销售周报",
    });
    expect(compiled.ok).toBe(true);
    const session = sessionOf(compiled).id;
    expect(sessionOf(compiled).status).toBe("READY_FOR_CONFIRMATION");
    expect(requirePayload(compiled).createRequest).toBeNull();
    expect(JSON.stringify(compiled.payload)).not.toMatch(/我猜|chain of thought/i);

    const confirmed = await invoke(handlers, "digitalEmployee.design.confirm", {
      sessionId: session,
    });
    expect(confirmed.ok).toBe(true);
    expect(sessionOf(confirmed).status).toBe("CONFIRMED");
    const createRequest = requirePayload(confirmed).createRequest as { skillKeys: string[] };
    expect(createRequest.skillKeys).toContain("sales-coach");

    const blocked = await invoke(handlers, "digitalEmployee.design.instantiate", {
      sessionId: session,
      agentId: "agt-new",
    });
    // confirm already happened; instantiate is allowed
    expect(blocked.ok).toBe(true);
    expect(sessionOf(blocked).status).toBe("INSTANTIATED");
    expect(installed).toContain("sales-coach");
    expect((requirePayload(blocked).receipt as { agentId: string }).agentId).toBe("agt-new");

    const replay = await invoke(handlers, "digitalEmployee.design.instantiate", {
      sessionId: session,
      agentId: "agt-other",
    });
    expect(replay.ok).toBe(true);
    expect(requirePayload(replay).reusedExistingAgent).toBe(true);
    expect((requirePayload(replay).receipt as { agentId: string }).agentId).toBe("agt-new");
  });

  it("rejects instantiate before confirm", async () => {
    const handlers = createDigitalEmployeeHandlers({ store: new DesignSessionStore() });
    const compiled = await invoke(handlers, "digitalEmployee.design.compile", {
      rawRequest: "创建销售助理",
    });
    const sessionId = sessionOf(compiled).id;
    const result = await invoke(handlers, "digitalEmployee.design.instantiate", {
      sessionId,
      agentId: "agt-early",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/CONFIRMED/);
  });

  it("keeps revision on the same session", async () => {
    const handlers = createDigitalEmployeeHandlers({ store: new DesignSessionStore() });
    const compiled = await invoke(handlers, "digitalEmployee.design.compile", {
      rawRequest: "创建销售助理",
    });
    const sessionId = sessionOf(compiled).id;
    const revised = await invoke(handlers, "digitalEmployee.design.revise", {
      sessionId,
      rawRevision: "CRM 只读，不能改",
    });
    expect(revised.ok).toBe(true);
    expect(sessionOf(revised).id).toBe(sessionId);
    const draft = requirePayload(revised).draft as {
      policyRecommendations: Array<{ id: string; effect: string }>;
    };
    expect(draft.policyRecommendations.find((entry) => entry.id === "crm.write")?.effect).toBe(
      "disabled",
    );
  });
});
