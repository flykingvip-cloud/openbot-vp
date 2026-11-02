import { describe, expect, it } from "vitest";
import { listUnusableEnterpriseModelWarnings } from "./unusable-models.js";

describe("listUnusableEnterpriseModelWarnings", () => {
  it("warns on a failed self-supplied connection and a grant whose asset is gone", () => {
    const warnings = listUnusableEnterpriseModelWarnings({
      connections: [
        {
          connectionId: "conn-live",
          displayName: "网域星辰",
          status: "active",
          healthStatus: "healthy",
        },
        {
          connectionId: "conn-dead",
          displayName: "内网推理",
          status: "invalid_credential",
          healthStatus: "unhealthy",
          lastVerificationResult: {
            code: "ENTERPRISE_MODEL_INVALID_CREDENTIAL",
            message: "凭证无效",
          },
        },
        {
          connectionId: "conn-draft",
          displayName: "尚未验证",
          status: "credential_saved",
          healthStatus: "unchecked",
        },
      ],
      assets: [
        {
          runtimeModelId: "ent/1b45c754c9/coder390-27b-int8",
          displayName: "Coder390",
          upstreamModelId: "coder390-27b-int8",
          connectionId: "conn-live",
          enabled: true,
          healthStatus: "healthy",
        },
        {
          runtimeModelId: "ent/cea43bf898/deepseek-v4-flash",
          upstreamModelId: "deepseek-v4-flash",
          connectionId: "conn-dead",
          enabled: true,
          healthStatus: "unhealthy",
        },
      ],
      grantedModelIds: ["ent/1b45c754c9/coder390-27b-int8", "ent/cc41dd5419/mimo-v2.6-flash"],
    });

    expect(warnings.map((warning) => warning.kind)).toEqual(["connection", "grant"]);
    expect(warnings[0]).toMatchObject({
      title: "内网推理",
      connectionId: "conn-dead",
    });
    expect(warnings[0]?.detail).toContain("凭证无效");
    expect(warnings[0]?.detail).toContain("deepseek-v4-flash");
    expect(warnings[1]).toMatchObject({
      modelId: "ent/cc41dd5419/mimo-v2.6-flash",
    });
  });

  it("does not warn for a disabled connection or a healthy asset", () => {
    expect(
      listUnusableEnterpriseModelWarnings({
        connections: [
          {
            connectionId: "off",
            displayName: "停用",
            status: "disabled",
            healthStatus: "unhealthy",
          },
        ],
        assets: [
          {
            runtimeModelId: "ent/abc/m",
            connectionId: "off",
            enabled: true,
            healthStatus: "healthy",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("warns when an enabled asset is unhealthy on a connection that still looks fine", () => {
    const warnings = listUnusableEnterpriseModelWarnings({
      connections: [
        {
          connectionId: "conn",
          displayName: "自建",
          status: "active",
          healthStatus: "healthy",
        },
      ],
      assets: [
        {
          runtimeModelId: "ent/abc/qwen",
          displayName: "通义",
          connectionId: "conn",
          enabled: true,
          healthStatus: "degraded",
        },
      ],
    });
    expect(warnings).toEqual([
      expect.objectContaining({
        kind: "asset",
        modelId: "ent/abc/qwen",
        title: "通义",
      }),
    ]);
  });
});
