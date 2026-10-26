import { describe, expect, it, vi } from "vitest";
import {
  createMemoryDiagnosisApprovalLedger,
  type DiagnosisApprovalPorts,
} from "../../diagnosis/approval-decide.js";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
import { getRequiredDomain } from "../platform-auth/session-domain.js";
import { listGatewayMethods } from "../server-methods-list.js";
import { handleGatewayRequest } from "../server-methods.js";
import {
  PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD,
  authorizePlatformDiagnosisApprovalCaller,
  createPlatformDiagnosisApprovalHandlers,
} from "./diagnosis-approval.js";
import type { GatewayClient, GatewayRequestHandlerOptions } from "./types.js";

const METHOD = PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD;

function client(input: {
  domain?: GatewayClient["sessionDomain"];
  kind?: GatewayClient["sessionKind"];
  scopes?: string[];
}): GatewayClient {
  return {
    connect: {
      role: "operator",
      scopes: input.scopes ?? ["operator.approvals"],
      client: { id: "openbot-control-ui", version: "1.0.0", platform: "test", mode: "ui" },
      minProtocol: 1,
      maxProtocol: 1,
    },
    sessionDomain: input.domain,
    sessionKind: input.kind,
  } as GatewayClient;
}

async function dispatch(caller: GatewayClient) {
  const handler = vi.fn(async (opts: { respond: (ok: boolean) => void }) => {
    opts.respond(true);
  });
  const respond = vi.fn();
  await handleGatewayRequest({
    req: { type: "req", id: "req-1", method: METHOD },
    respond,
    client: caller,
    isWebchatConnect: () => false,
    context: { logGateway: { warn: vi.fn(), info: vi.fn() } } as never,
    extraHandlers: { [METHOD]: handler as never },
  });
  return { respond, handler };
}

describe("platform.diagnosis.approval.decide registration", () => {
  it("registers the platform method on operator.approvals and the platform domain", () => {
    expect(listGatewayMethods()).toContain(METHOD);
    expect(listGatewayMethods()).toContain("enterprise.diagnosis.approval.decide");
    expect(getRequiredDomain(METHOD)).toBe("platform");
    expect(authorizeOperatorScopesForMethod(METHOD, ["operator.approvals"]).allowed).toBe(true);
    expect(authorizeOperatorScopesForMethod(METHOD, ["operator.admin"])).toEqual({
      allowed: false,
      missingScope: "operator.approvals",
    });
    expect(authorizeOperatorScopesForMethod(METHOD, ["operator.read"]).allowed).toBe(false);
  });

  it("rejects an employee token as UNAUTHORIZED", async () => {
    const { respond, handler } = await dispatch(
      client({ domain: "employee", kind: "member", scopes: ["operator.approvals"] }),
    );
    expect(handler).not.toHaveBeenCalled();
    const [ok, , error] = respond.mock.calls[0] as [boolean, unknown, { code?: string }];
    expect(ok).toBe(false);
    expect(error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an enterprise session", async () => {
    const { respond, handler } = await dispatch(
      client({ domain: "enterprise", kind: "enterprise-admin", scopes: ["operator.approvals"] }),
    );
    expect(handler).not.toHaveBeenCalled();
    const [ok, , error] = respond.mock.calls[0] as [boolean, unknown, { message?: string }];
    expect(ok).toBe(false);
    expect(error.message).toContain("domain_mismatch");
  });

  it("rejects operator.admin without operator.approvals", async () => {
    const caller = client({
      domain: "platform",
      kind: "platform-admin",
      scopes: ["operator.admin"],
    });
    expect(authorizePlatformDiagnosisApprovalCaller(caller)?.code).toBe("UNAUTHORIZED");
    const { respond, handler } = await dispatch(caller);
    expect(handler).not.toHaveBeenCalled();
    const [ok, , error] = respond.mock.calls[0] as [boolean, unknown, { code?: string }];
    expect(ok).toBe(false);
    expect(error.code).toBe("UNAUTHORIZED");
  });

  it("accepts platform-admin and platform-super-admin when operator.approvals is present", () => {
    expect(
      authorizePlatformDiagnosisApprovalCaller(
        client({ domain: "platform", kind: "platform-admin" }),
      ),
    ).toBeNull();
    expect(
      authorizePlatformDiagnosisApprovalCaller(
        client({
          domain: "platform",
          kind: "platform-super-admin",
          scopes: ["operator.approvals", "operator.admin"],
        }),
      ),
    ).toBeNull();
  });

  it("records a grant decision through the registered handler", async () => {
    const ledger = createMemoryDiagnosisApprovalLedger();
    const grants = new Map([
      [
        "grant-1",
        {
          grantId: "grant-1",
          status: "REQUESTED" as "REQUESTED" | "APPROVED" | "DENIED",
          approverRole: "platform" as const,
          targetTenant: "tenant-a",
        },
      ],
    ]);
    const ports: DiagnosisApprovalPorts = {
      now: () => "2026-10-12T00:00:00.000Z",
      newId: () => "appr-handler",
      ledger,
      grants: {
        async get(id) {
          return grants.get(id);
        },
        async applyStatus(id, status) {
          const current = grants.get(id);
          if (!current) {
            throw new Error("missing");
          }
          grants.set(id, { ...current, status });
        },
      },
      conversations: {
        async find() {
          return false;
        },
        async openSession() {
          return "";
        },
      },
      reports: {
        async load() {
          return null;
        },
        serialize() {
          return "";
        },
      },
    };
    const respond = vi.fn();
    const handlers = createPlatformDiagnosisApprovalHandlers({ ports });
    await handlers[METHOD]({
      req: { type: "req", id: "1", method: METHOD },
      params: {
        schemaVersion: 1,
        idempotencyKey: "handler-key",
        decision: "approve",
        reason: null,
        subject: { kind: "authorization", grantId: "grant-1" },
      },
      client: client({ domain: "platform", kind: "platform-super-admin" }),
      isWebchatConnect: () => false,
      respond,
      context: {} as GatewayRequestHandlerOptions["context"],
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "recorded",
        effect: { type: "grant", grantId: "grant-1", grantStatus: "APPROVED" },
      }),
    );
    expect(grants.get("grant-1")?.status).toBe("APPROVED");
    expect(ledger.finishedCount()).toBe(1);
  });
});
