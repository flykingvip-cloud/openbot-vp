import fs from "node:fs";
import { expect, it } from "vitest";
import { KnowledgeSdkClient } from "./client.js";
it.skipIf(process.env.OPENBOT_KNOWLEDGE_SDK_STOPPED_FIXTURE !== "true")(
  "A06 actual stopped service fails closed",
  async () => {
    const url = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_URL;
    const file = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_KEY_FILE;
    if (!url || !file || new URL(url).hostname !== "127.0.0.1") {
      throw new Error("Owned loopback fixture required");
    }
    const client = new KnowledgeSdkClient({
      enabled: true,
      environment: "test",
      allowedTenantIds: ["fixture-tenant-a"],
      baseUrl: url,
      timeoutMs: 500,
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
        requestId: "outage",
      }),
    ).rejects.toMatchObject({ code: "SDK_UNAVAILABLE" });
  },
);
