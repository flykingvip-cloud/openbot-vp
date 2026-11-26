import fs from "node:fs";
import { expect, it } from "vitest";
import { KnowledgeSdkClient } from "./client.js";
it.skipIf(process.env.OPENBOT_KNOWLEDGE_SDK_V2_REVOKED_FIXTURE !== "true")(
  "A05 denies the previously authorized profile after authoritative revocation",
  async () => {
    const target = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_URL;
    const file = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_KEY_FILE;
    if (!target || !file || new URL(target).hostname !== "127.0.0.1") {
      throw new Error("Explicit owned loopback fixture required");
    }
    const client = new KnowledgeSdkClient({
      enabled: true,
      environment: "test",
      allowedTenantIds: ["fixture-tenant-a"],
      baseUrl: target,
      timeoutMs: 5000,
      secret: fs.readFileSync(file, "utf8").trim(),
    });
    await expect(
      client.request("/v2/spaces", "GET", {
        issuer: "https://sandbox.example.invalid",
        subjectId: "sandbox-owner",
        tenantId: "fixture-tenant-a",
        policyGeneration: 1,
        actorType: "human",
        agentId: "fixture-agent-private",
        requestId: "revoked-profile",
        roles: ["member"],
        departmentIds: ["fixture-department"],
        orgRoles: ["admin", "metrics_admin"],
        clearanceLevel: "internal",
        sessionId: "sandbox-session-sandbox-owner",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code:
        process.env.OPENBOT_KNOWLEDGE_SDK_PRINCIPAL_STALE === "true"
          ? "POLICY_GENERATION_STALE"
          : "PERMISSION_DENIED",
    });
  },
);
