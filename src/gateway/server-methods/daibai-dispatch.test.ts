import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DaibaiActionDescriptor,
  DaibaiActionParamContext,
} from "../../shared/daibai-action-catalog.js";
import {
  __clearStewardServicesForTest,
  assertStewardActionAuthorized,
  clientHasOperatorScope,
  invokeStewardDelegate,
  registerStewardService,
  setStewardInternalDispatcher,
  StewardAuthorizationError,
  StewardDispatchError,
} from "./daibai-dispatch.js";
import type { GatewayClient } from "./types.js";

function clientWithScopes(scopes: string[]): GatewayClient {
  return { connect: { scopes } } as unknown as GatewayClient;
}

function makeAction(overrides: Partial<DaibaiActionDescriptor> = {}): DaibaiActionDescriptor {
  return {
    actionId: "support.case.create",
    title: "升级给平台技术支持",
    kind: "write",
    requiredScope: "operator.write",
    delegateTarget: { mode: "service", ref: "createSupportCase" },
    requiresUserConfirmation: false,
    buildParams: (ctx) => ({ userId: ctx.userId, ...ctx.payload }),
    ...overrides,
  };
}

const baseCtx: DaibaiActionParamContext = { userId: "u1", payload: {} };

afterEach(() => {
  __clearStewardServicesForTest();
  setStewardInternalDispatcher(null);
});

describe("operator scope resolution", () => {
  it("treats ADMIN as a superset", () => {
    expect(clientHasOperatorScope(clientWithScopes(["operator.admin"]), "operator.write")).toBe(
      true,
    );
  });

  it("matches the exact scope", () => {
    expect(clientHasOperatorScope(clientWithScopes(["operator.write"]), "operator.write")).toBe(
      true,
    );
  });

  it("rejects when scope is absent", () => {
    expect(clientHasOperatorScope(clientWithScopes(["operator.read"]), "operator.write")).toBe(
      false,
    );
    expect(clientHasOperatorScope(null, "operator.read")).toBe(false);
  });
});

describe("assertStewardActionAuthorized", () => {
  it("throws StewardAuthorizationError when scope missing", () => {
    expect(() =>
      assertStewardActionAuthorized(makeAction(), clientWithScopes(["operator.read"])),
    ).toThrow(StewardAuthorizationError);
  });

  it("passes when scope present", () => {
    expect(() =>
      assertStewardActionAuthorized(makeAction(), clientWithScopes(["operator.write"])),
    ).not.toThrow();
  });
});

describe("invokeStewardDelegate (E1 service mode)", () => {
  it("calls the registered service with built params", async () => {
    const fn = vi.fn(async (params: Record<string, unknown>) => ({ ok: true, params }));
    registerStewardService("createSupportCase", fn);
    const result = await invokeStewardDelegate({
      action: makeAction(),
      ctx: { userId: "u1", payload: { foo: "bar" } },
      client: clientWithScopes(["operator.write"]),
    });
    expect(fn).toHaveBeenCalledWith({ userId: "u1", foo: "bar" }, { client: expect.anything() });
    expect(result).toEqual({ ok: true, params: { userId: "u1", foo: "bar" } });
  });

  it("blocks unauthorized clients before invoking the service", async () => {
    const fn = vi.fn();
    registerStewardService("createSupportCase", fn);
    await expect(
      invokeStewardDelegate({
        action: makeAction(),
        ctx: baseCtx,
        client: clientWithScopes(["operator.read"]),
      }),
    ).rejects.toBeInstanceOf(StewardAuthorizationError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("throws when the service ref is not registered", async () => {
    await expect(
      invokeStewardDelegate({
        action: makeAction(),
        ctx: baseCtx,
        client: clientWithScopes(["operator.write"]),
      }),
    ).rejects.toBeInstanceOf(StewardDispatchError);
  });
});

describe("invokeStewardDelegate (E2 internal-dispatch)", () => {
  const dispatchAction = makeAction({
    delegateTarget: { mode: "internal-dispatch", ref: "robot-skills.toggle" },
  });

  it("is disabled by default (no double-spend path)", async () => {
    await expect(
      invokeStewardDelegate({
        action: dispatchAction,
        ctx: baseCtx,
        client: clientWithScopes(["operator.write"]),
      }),
    ).rejects.toBeInstanceOf(StewardDispatchError);
  });

  it("delegates via the injected dispatcher when enabled", async () => {
    const dispatcher = vi.fn(async () => ({ dispatched: true }));
    setStewardInternalDispatcher(dispatcher);
    const result = await invokeStewardDelegate({
      action: dispatchAction,
      ctx: { userId: "u1", payload: { agentId: "a1" } },
      client: clientWithScopes(["operator.write"]),
    });
    expect(dispatcher).toHaveBeenCalledWith({
      method: "robot-skills.toggle",
      params: { userId: "u1", agentId: "a1" },
      client: expect.anything(),
    });
    expect(result).toEqual({ dispatched: true });
  });
});

describe("invokeStewardDelegate — client threading (secondary-permission self-check)", () => {
  it("passes the client to the service as the second arg", async () => {
    const fn = vi.fn(async () => ({ ok: true }));
    registerStewardService("createSupportCase", fn);
    const client = clientWithScopes(["operator.write"]);
    await invokeStewardDelegate({
      action: makeAction(),
      ctx: { userId: "u1", payload: {} },
      client,
    });
    expect(fn).toHaveBeenCalledWith({ userId: "u1" }, { client });
  });
});
