import { describe, expect, it } from "vitest";
import { collaborationTaskActivationPack } from "./collaboration-task-activation.pack.js";
import { validateGatewayMethodPacks } from "./pack-merge.js";
import { PACK_OWNED_METHOD_NAMES } from "./packs/manifest.js";
import { GATEWAY_METHOD_PACKS } from "./packs/registry.js";

describe("collaboration-task-activation pack", () => {
  it("defines expected F1–F3 methods", () => {
    expect(collaborationTaskActivationPack.id).toBe("collaboration-task-activation");
    expect(collaborationTaskActivationPack.methods).toEqual(
      expect.arrayContaining([
        "collaboration.task.activate",
        "collaboration.task.confirmPlanFromChat",
        "collaboration.task.submitTeamDeliverable",
        "collaboration.task.readTeamDeliverable",
        "collaboration.task.checkDispatchReadiness",
        "collaboration.task.ensureMemberSession",
      ]),
    );
  });

  it("is registered in GATEWAY_METHOD_PACKS without validation errors", () => {
    expect(GATEWAY_METHOD_PACKS.some((p) => p.id === "collaboration-task-activation")).toBe(true);
    expect(validateGatewayMethodPacks(GATEWAY_METHOD_PACKS)).toEqual([]);
    for (const method of collaborationTaskActivationPack.methods) {
      expect(PACK_OWNED_METHOD_NAMES.has(method)).toBe(true);
    }
  });

  it("exposes handler functions for each method", () => {
    for (const method of collaborationTaskActivationPack.methods) {
      expect(typeof collaborationTaskActivationPack.handlers[method]).toBe("function");
    }
  });
});
