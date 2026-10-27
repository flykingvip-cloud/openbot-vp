import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetModelAdmissionStoreForTest, getModelAdmission } from "../model-admission-store.ts";
import { createRpcCapabilityVerificationService } from "./rpc-adapter.ts";
import {
  __resetCapabilityVerificationServiceForTest,
  bindCapabilityAdmissionGateway,
  isCapabilityAdmissionRpcActive,
} from "./verification-service.ts";

describe("rpc capability verification adapter", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
    __resetCapabilityVerificationServiceForTest();
  });

  it("mirrors formal task + admission from gateway and reports applied routing", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "models.admission.createVerificationTask") {
        return {
          authority: "formal",
          task: {
            taskId: "gcvt_1",
            modelRef: String(params?.modelRef),
            capabilityIds: params?.capabilityIds,
            status: "succeeded",
            createdAt: 1,
            updatedAt: 2,
            results: [
              {
                id: "text_chat",
                label: "文本对话",
                source: "protocol_probe",
                status: "passed",
                testVersion: "gateway-protocol-v1",
                verifiedAt: 2,
              },
            ],
          },
        };
      }
      if (method === "models.admission.getModelAdmission") {
        return {
          admission: {
            modelRef: String(params?.modelRef),
            tenantSelectable: false,
            autoRouting: "disabled",
            autoRoutingTaskCategories: [],
            capabilityEvidence: [
              {
                id: "text_chat",
                label: "文本对话",
                source: "protocol_probe",
                status: "passed",
                testVersion: "gateway-protocol-v1",
                verifiedAt: 2,
              },
            ],
            updatedAt: 2,
            platformEffective: true,
          },
        };
      }
      if (method === "models.admission.setRoutingEligibility") {
        return {
          status: "applied",
          modelRef: String(params?.modelRef),
          autoRouting: params?.autoRouting,
          admission: {
            modelRef: String(params?.modelRef),
            tenantSelectable: true,
            autoRouting: params?.autoRouting,
            autoRoutingTaskCategories: [],
            capabilityEvidence: [],
            updatedAt: 3,
            platformEffective: true,
          },
        };
      }
      if (method === "models.admission.listModelAdmissions") {
        return { admissions: [] };
      }
      throw new Error(`unexpected method ${method}`);
    });

    await bindCapabilityAdmissionGateway(request);
    expect(isCapabilityAdmissionRpcActive()).toBe(true);

    const service = createRpcCapabilityVerificationService(request);
    const created = await service.createVerificationTask({
      modelRef: "openai/gpt",
      capabilityIds: ["text_chat"],
    });
    expect(created.authority).toBe("formal");
    expect(created.task.taskId).toBe("gcvt_1");
    const admission = getModelAdmission("openai/gpt");
    expect(admission.platformEffective).toBe(true);
    expect(admission.capabilityEvidence[0]?.status).toBe("passed");

    const route = await service.setRoutingEligibility({
      modelRef: "openai/gpt",
      autoRouting: "eligible",
      tenantSelectable: true,
    });
    expect(route.status).toBe("applied");
    if (route.status === "applied") {
      expect(route.autoRouting).toBe("eligible");
    }
    expect(getModelAdmission("openai/gpt").autoRouting).toBe("eligible");
    expect(getModelAdmission("openai/gpt").tenantSelectable).toBe(true);
  });
});
