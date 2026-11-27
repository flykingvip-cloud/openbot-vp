import fs from "node:fs";
import { expect, it } from "vitest";
import { KnowledgeSdkClient } from "./client.js";
const phase = process.env.OPENBOT_KNOWLEDGE_SDK_MEMBER_PHASE;
it.skipIf(!phase)("A05 current member grant is checked after authoritative revoke", async () => {
  const target = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_URL;
  const key = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_KEY_FILE;
  if (!target || !key || new URL(target).hostname !== "127.0.0.1") {
    throw new Error("Explicit owned fixture required");
  }
  const c = new KnowledgeSdkClient({
    enabled: true,
    environment: "test",
    allowedTenantIds: ["fixture-tenant-a"],
    baseUrl: target,
    timeoutMs: 5000,
    secret: fs.readFileSync(key, "utf8").trim(),
  });
  const request = c.request("/v2/assets/m2b-member-doc", "GET", {
    issuer: "https://sandbox.example.invalid",
    subjectId: "sandbox-reader",
    tenantId: "fixture-tenant-a",
    policyGeneration: 1,
    actorType: "human",
    agentId: "m2b-member-agent",
    requestId: "member-revoke",
    roles: ["member"],
    departmentIds: ["fixture-department"],
    orgRoles: [],
    clearanceLevel: "internal",
    sessionId: "sandbox-session-sandbox-reader",
  });
  if (phase === "before") {
    await expect(request).resolves.toMatchObject({ doc_id: "m2b-member-doc" });
  } else if (phase === "after") {
    await expect(request).rejects.toMatchObject({ status: 403 });
  } else {
    throw new Error("Unknown test phase");
  }
});
