import fs from "node:fs";
import { expect, it } from "vitest";
import { KnowledgeSdkClient } from "./client.js";
const phase = process.env.OPENBOT_KNOWLEDGE_SDK_PROFILE_PHASE;
it.skipIf(!phase)(
  "A05 current Profile grant is checked after authoritative deactivation",
  async () => {
    const target = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_URL;
    const key = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_KEY_FILE;
    if (!target || !key || new URL(target).hostname !== "127.0.0.1") {
      throw new Error("Explicit owned fixture required");
    }
    const client = new KnowledgeSdkClient({
      enabled: true,
      environment: "test",
      allowedTenantIds: ["fixture-tenant-a"],
      baseUrl: target,
      timeoutMs: 5000,
      secret: fs.readFileSync(key, "utf8").trim(),
    });
    const request = client.request("/v2/assets/fixture-tenant-a-private-doc", "GET", {
      issuer: "https://sandbox.example.invalid",
      subjectId: "sandbox-owner",
      tenantId: "fixture-tenant-a",
      policyGeneration: 1,
      actorType: "human",
      agentId: "m2b-profile-agent",
      requestId: "profile-revoke",
      roles: ["member"],
      departmentIds: ["fixture-department"],
      orgRoles: ["admin", "metrics_admin"],
      clearanceLevel: "internal",
      sessionId: "sandbox-session-sandbox-owner",
    });
    if (phase === "before") {
      await expect(request).resolves.toMatchObject({ doc_id: "fixture-tenant-a-private-doc" });
    } else if (phase === "after") {
      await expect(request).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
    } else {
      throw new Error("Unknown test phase");
    }
  },
);
