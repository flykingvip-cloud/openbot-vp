// @vitest-environment node
/**
 * Supervisor commercial acquire must forward enterpriseId as modelGateInput.enterpriseIdHint
 * so known-enterprise runs without agent/seat mapping hard-deny at the model gate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const tryAcquireEnterpriseAgentRunMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    gateway: {
      platform: {
        models: {
          mode: "native",
          entitlement: { enforce: "missing-allow", scope: "employee-chat" },
        },
      },
    },
    models: { providers: {} },
  })),
}));

vi.mock("../billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun: (...args: unknown[]) => tryAcquireEnterpriseAgentRunMock(...args),
  releaseEnterpriseAgentRun: vi.fn(async () => undefined),
}));

import {
  acquireSupervisorCommercialRun,
  SupervisorCommercialRunDeniedError,
} from "./commercial-run-gate.js";

describe("supervisor commercial gate enterpriseIdHint", () => {
  beforeEach(() => {
    tryAcquireEnterpriseAgentRunMock.mockReset();
  });

  it("forwards enterpriseId as modelGateInput.enterpriseIdHint", async () => {
    tryAcquireEnterpriseAgentRunMock.mockResolvedValue({
      acquired: false,
      skipped: false,
      reason: "MODEL_GATE_DENIED",
      message: "当前席位无可用模型授权，无法执行 AI 任务。",
    });

    await expect(
      acquireSupervisorCommercialRun({
        runId: "run-sup-hint-1",
        enterpriseId: "ent-supervisor-hint-only",
        // no agentId
      }),
    ).rejects.toBeInstanceOf(SupervisorCommercialRunDeniedError);

    expect(tryAcquireEnterpriseAgentRunMock).toHaveBeenCalledTimes(1);
    const arg = tryAcquireEnterpriseAgentRunMock.mock.calls[0]?.[0] as {
      enterpriseId?: string;
      modelGateInput?: { enterpriseIdHint?: string; agentId?: string };
    };
    expect(arg.enterpriseId).toBe("ent-supervisor-hint-only");
    expect(arg.modelGateInput?.enterpriseIdHint).toBe("ent-supervisor-hint-only");
    expect(arg.modelGateInput?.agentId).toBeUndefined();
  });

  it("surfaces MODEL_GATE_DENIED message from commercial acquire", async () => {
    const gateMessage = "当前席位无可用模型授权，无法执行 AI 任务。";
    tryAcquireEnterpriseAgentRunMock.mockResolvedValue({
      acquired: false,
      skipped: false,
      reason: "MODEL_GATE_DENIED",
      message: gateMessage,
    });

    await expect(
      acquireSupervisorCommercialRun({
        runId: "run-sup-hint-2",
        enterpriseId: "ent-supervisor-hint-only",
      }),
    ).rejects.toThrow(gateMessage);
  });
});
