import { describe, expect, it } from "vitest";
import { createEnterpriseSubmission } from "../capability-install-governance-store.js";
import { platformCapabilityHandlers } from "./platform-capability.js";

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

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
      user: "test-user",
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as unknown as import("./types.js").GatewayRequestContext,
  });
  return response ?? { ok: false };
}

function seedSharedSubmissions() {
  createEnterpriseSubmission({
    submissionId: "sub-001",
    capabilityId: "cap-ent-001",
    capabilityName: "企业合同审查模板",
    enterpriseId: "tenant-a",
    enterpriseName: "租户 A",
    sanitized: true,
    sanitizationFindings: 0,
    sourceProvenance: "enterprise-sanitization",
  });
  createEnterpriseSubmission({
    submissionId: "sub-002",
    capabilityId: "cap-ent-002",
    capabilityName: "财务报表自动解析",
    enterpriseId: "tenant-b",
    enterpriseName: "租户 B",
    sanitized: true,
    sanitizationFindings: 2,
    sourceProvenance: "enterprise-sanitization",
  });
  createEnterpriseSubmission({
    submissionId: "sub-003",
    capabilityId: "cap-ent-003",
    capabilityName: "客户服务话术生成",
    enterpriseId: "tenant-c",
    enterpriseName: "租户 C",
    sanitized: false,
    sanitizationFindings: 5,
    sourceProvenance: "enterprise-sanitization",
  });
}

describe("platform-capability handlers", () => {
  it("enterprise-submissions returns submissions from shared store", async () => {
    seedSharedSubmissions();
    const res = await invoke("platform-capability.enterprise-submissions", {});
    expect(res.ok).toBe(true);
    const payload = res.payload as {
      submissions?: unknown[];
      total?: number;
      pendingCount?: number;
    };
    expect(payload?.submissions).toBeInstanceOf(Array);
    expect(payload?.total).toBeGreaterThan(0);
    expect(payload?.pendingCount).toBeGreaterThanOrEqual(0);
  });

  it("enterprise-submissions filters by status", async () => {
    seedSharedSubmissions();
    const res = await invoke("platform-capability.enterprise-submissions", { status: "published" });
    expect(res.ok).toBe(true);
    const payload = res.payload as { submissions?: unknown[]; total?: number };
    expect(payload?.submissions?.length).toBe(0);
  });

  it("review-enterprise-submission returns submission detail", async () => {
    seedSharedSubmissions();
    const res = await invoke("platform-capability.review-enterprise-submission", {
      submissionId: "sub-001",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { submissionId?: string; status?: string };
    expect(payload?.submissionId).toBe("sub-001");
    expect(payload?.status).toBe("pending-review");
  });

  it("review-enterprise-submission returns error for unknown submission", async () => {
    const res = await invoke("platform-capability.review-enterprise-submission", {
      submissionId: "sub-unknown",
    });
    expect(res.ok).toBe(false);
  });

  it("publish-enterprise-capability publishes sanitized submission", async () => {
    seedSharedSubmissions();
    const res = await invoke("platform-capability.publish-enterprise-capability", {
      submissionId: "sub-001",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { status?: string; publishedAt?: number };
    expect(payload?.status).toBe("published");
    expect(payload?.publishedAt).toBeGreaterThan(0);
  });

  it("publish-enterprise-capability rejects unsanitized submission", async () => {
    seedSharedSubmissions();
    const res = await invoke("platform-capability.publish-enterprise-capability", {
      submissionId: "sub-003",
    });
    expect(res.ok).toBe(false);
  });

  it("reject-enterprise-capability rejects submission", async () => {
    seedSharedSubmissions();
    const res = await invoke("platform-capability.reject-enterprise-capability", {
      submissionId: "sub-002",
      rejectionReason: "不符合平台规范",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { status?: string; rejectionReason?: string };
    expect(payload?.status).toBe("rejected");
    expect(payload?.rejectionReason).toBe("不符合平台规范");
  });

  it("return-for-modification returns submission to enterprise", async () => {
    seedSharedSubmissions();
    const res = await invoke("platform-capability.return-for-modification", {
      submissionId: "sub-002",
      returnNotes: "敏感信息未完全脱敏",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { status?: string; returnNotes?: string };
    expect(payload?.status).toBe("returned-for-modification");
    expect(payload?.returnNotes).toBe("敏感信息未完全脱敏");
  });

  it("approve-enterprise-only approves for internal use only", async () => {
    seedSharedSubmissions();
    const res = await invoke("platform-capability.approve-enterprise-only", {
      submissionId: "sub-001",
    });
    expect(res.ok).toBe(true);
    const payload = res.payload as { status?: string; approvedAt?: number };
    expect(payload?.status).toBe("enterprise-only");
    expect(payload?.approvedAt).toBeGreaterThan(0);
  });
});
