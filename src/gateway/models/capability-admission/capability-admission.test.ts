import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewRoutingDecision } from "./routing-decision.js";
import {
  __resetCapabilityAdmissionStoreForTest,
  __setCapabilityAdmissionStorePathForTest,
  getModelAdmission,
} from "./store.js";
import { createGatewayVerificationService } from "./verification-service.js";

describe("gateway capability admission", () => {
  let storePath = "";

  beforeEach(async () => {
    storePath = path.join(
      os.tmpdir(),
      `openbot-admission-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    __setCapabilityAdmissionStorePathForTest(storePath);
    await __resetCapabilityAdmissionStoreForTest(storePath);
  });

  afterEach(() => {
    __setCapabilityAdmissionStorePathForTest(undefined);
    try {
      fs.unlinkSync(storePath);
    } catch {
      // ignore
    }
  });

  it("creates formal verification without inventing tool_use failure", async () => {
    const service = createGatewayVerificationService({
      storePath,
      resolveConnectionOk: () => true,
    });
    const { task, authority } = await service.createVerificationTask({
      modelRef: "openai/gpt-test",
      capabilityIds: ["text_chat", "tool_use"],
      connectionOk: true,
    });
    expect(authority).toBe("formal");
    expect(task.status).toBe("partial");
    const text = task.results?.find((r) => r.id === "text_chat");
    const tools = task.results?.find((r) => r.id === "tool_use");
    expect(text?.status).toBe("passed");
    expect(tools?.status).toBe("checker_unavailable");
    const admission = await getModelAdmission("openai/gpt-test", storePath);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "text_chat" && e.status === "passed"),
    ).toBe(true);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "tool_use" && e.status === "failed"),
    ).toBe(false);
  });

  it("applies routing eligibility as platform-effective", async () => {
    const service = createGatewayVerificationService({ storePath });
    const result = await service.setRoutingEligibility({
      modelRef: "openai/gpt-test",
      autoRouting: "eligible",
      tenantSelectable: true,
      reason: "test",
    });
    expect(result.status).toBe("applied");
    expect(result.admission.platformEffective).toBe(true);
    expect(result.admission.autoRouting).toBe("eligible");
    expect(result.admission.tenantSelectable).toBe(true);
  });

  it("previewRoutingDecision uses backend admissions and stays dry-run", async () => {
    const service = createGatewayVerificationService({
      storePath,
      resolveConnectionOk: () => true,
    });
    await service.createVerificationTask({
      modelRef: "private/c",
      capabilityIds: ["coding", "text_chat"],
      connectionOk: true,
    });
    // Force coding passed for routing (default runner marks coding untested)
    await service.setRoutingEligibility({
      modelRef: "private/c",
      autoRouting: "eligible",
      reason: "test",
    });
    // Inject formal coding evidence via another verification with injected runner
    const injected = createGatewayVerificationService({
      storePath,
      runner: {
        check(ctx) {
          return ctx.capabilityIds.map((id) =>
            id === "coding"
              ? {
                  capabilityId: id,
                  status: "passed" as const,
                  testVersion: "gateway-protocol-v1",
                  verifiedAt: Date.now(),
                }
              : {
                  capabilityId: id,
                  status: "untested" as const,
                  testVersion: "gateway-protocol-v1",
                },
          );
        },
      },
    });
    await injected.createVerificationTask({
      modelRef: "private/c",
      capabilityIds: ["coding"],
    });

    const preview = await previewRoutingDecision({
      storePath,
      request: {
        taskText: "refactor this module",
        outputType: "text",
        requiredCapabilities: ["code"],
      },
      candidates: [
        { modelId: "private/c", health: "healthy", costTier: "low", contextWindow: 200_000 },
        { modelId: "private/other", health: "healthy", costTier: "low", contextWindow: 200_000 },
      ],
    });
    expect(preview.backendStatus).toBe("wired");
    expect(preview.uiDemo).toBe(false);
    expect(preview.dryRun).toBe(true);
    expect(preview.primary).toEqual(["private/c"]);
    expect(preview.excluded.some((e) => e.modelId === "private/other")).toBe(true);
  });
});
