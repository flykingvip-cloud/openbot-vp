// @vitest-environment node
// Feature: model-entitlement-chain P2 (task 12 — employee read-only summary)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-employee-model-access-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

// 默认提供一个受信 seat 上下文；个别用例可临时改写。
const seatCtx = {
  tenantId: "ent-test",
  seatId: "seat-1",
  employeeId: "user-1",
};
let resolveCtxImpl: () => Promise<typeof seatCtx> = async () => seatCtx;

vi.mock("../enterprise-data/enterprise-data-seat-context.js", () => ({
  resolveTrustedEnterpriseDataExecutionContext: () => resolveCtxImpl(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    models: {
      providers: {
        "api-proxy-deepseek": { models: [{ id: "deepseek-chat" }, { id: "deepseek-coder" }] },
      },
    },
    gateway: { platform: { models: { entitlement: { enforce: "missing-allow" } } } },
  }),
}));

const { employeeModelAccessHandlers } = await import("./employee-model-access.js");
const { upsertEnterpriseModelEntitlement } =
  await import("../model-entitlement/enterprise-model-entitlement-store.js");
const { grantSeatModels } = await import("../model-entitlement/seat-model-grant-store.js");

type HandlerError = { code?: string; message?: string };

async function invoke<P = Record<string, unknown>>(): Promise<{
  ok: boolean;
  payload: P;
  error: HandlerError;
}> {
  const handler = employeeModelAccessHandlers["employee-model-access.summary"];
  let response: { ok: boolean; payload: P; error: HandlerError } | null = null;
  await handler({
    req: { type: "req", id: "t", method: "employee-model-access.summary", params: {} },
    params: {},
    client: { connect: {} as never, user: "user-1@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload: payload as P, error: (error ?? {}) as HandlerError };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error("handler did not respond");
  }
  return response;
}

type Summary = {
  summary: { modelIds: string[]; state: "missing" | "resolved"; reason: string; seatId?: string };
};

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  resolveCtxImpl = async () => seatCtx;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("employee-model-access.summary", () => {
  it("无 seat 上下文 → state=missing 且不报错", async () => {
    resolveCtxImpl = async () => {
      throw new Error("NO_SEAT_CONTEXT");
    };
    const res = await invoke<Summary>();
    expect(res.ok).toBe(true);
    expect(res.payload.summary.state).toBe("missing");
    expect(res.payload.summary.modelIds).toEqual([]);
  });

  it("有授权 → 返回员工可用模型与 seatId", async () => {
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat", "api-proxy-deepseek/deepseek-coder"],
    });
    await grantSeatModels({
      tenantId: "ent-test",
      seatId: "seat-1",
      grantedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const res = await invoke<Summary>();
    expect(res.ok).toBe(true);
    expect(res.payload.summary.state).toBe("resolved");
    expect(res.payload.summary.modelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
    expect(res.payload.summary.seatId).toBe("seat-1");
  });

  it("entitlement 解析为空 → resolved 且空集（被拒语义）", async () => {
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: [],
    });
    const res = await invoke<Summary>();
    expect(res.ok).toBe(true);
    expect(res.payload.summary.state).toBe("resolved");
    expect(res.payload.summary.modelIds).toEqual([]);
  });
});
