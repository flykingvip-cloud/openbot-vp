import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-platform-incubation-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { createEnterpriseSubmission } = await import("../capability-install-governance-store.js");
const { summarizeAdoptionEvidence } = await import("../asset-incubation-adoption-store.js");
const { platformCapabilityHandlers } = await import("./platform-capability.js");

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

function cleanStore(): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

async function invoke(method: string, params: Record<string, unknown>): Promise<HandlerResponse> {
  const handler = platformCapabilityHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {
        role: "operator",
        scopes: ["write"],
        client: {
          id: "openbot-control-ui",
          version: "1.0.0",
          platform: "test",
          mode: "test",
        },
        minProtocol: 1,
        maxProtocol: 1,
      },
      user: "employee-a",
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as unknown as import("./types.js").GatewayRequestContext,
  });
  return response ?? { ok: false };
}

describe("platform-capability incubation hooks", () => {
  beforeEach(() => {
    cleanStore();
    createEnterpriseSubmission({
      submissionId: "sub-inc-1",
      capabilityId: "cap-published",
      capabilityName: "企业合同审查模板",
      enterpriseId: "tenant-a",
      enterpriseName: "租户 A",
      sanitized: true,
      sanitizationFindings: 0,
      sourceProvenance: "enterprise-sanitization",
    });
  });

  afterEach(() => {
    cleanStore();
  });

  it("records admin_recommend when publishing enterprise capability", async () => {
    const res = await invoke("platform-capability.publish-enterprise-capability", {
      submissionId: "sub-inc-1",
      reviewerId: "platform-reviewer-1",
    });
    expect(res.ok).toBe(true);

    const summary = summarizeAdoptionEvidence({
      ownerKey: "employee-a",
      capabilityId: "cap-published",
    });
    expect(summary.adminRecommended).toBe(true);
  });

  it("records admin_recommend when approving enterprise-only", async () => {
    const res = await invoke("platform-capability.approve-enterprise-only", {
      submissionId: "sub-inc-1",
      reviewerId: "platform-reviewer-2",
    });
    expect(res.ok).toBe(true);

    const summary = summarizeAdoptionEvidence({
      ownerKey: "employee-a",
      capabilityId: "cap-published",
    });
    expect(summary.adminRecommended).toBe(true);
  });
});
