import fs from "node:fs";
import { expect, it } from "vitest";
import { KnowledgeSdkClient } from "./client.js";
it.skipIf(!process.env.OPENBOT_KNOWLEDGE_SDK_EVIDENCE_FIXTURE)(
  "A07/A08 real citation verification and missing version fail closed",
  async () => {
    const target = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_URL;
    const key = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_KEY_FILE;
    const file = process.env.OPENBOT_KNOWLEDGE_SDK_EVIDENCE_FIXTURE;
    if (!target || !key || !file || new URL(target).hostname !== "127.0.0.1") {
      throw new Error("Explicit owned fixture required");
    }
    const evidence: Record<string, unknown> = JSON.parse(fs.readFileSync(file, "utf8"));
    const c = new KnowledgeSdkClient({
      enabled: true,
      environment: "test",
      allowedTenantIds: ["fixture-tenant-a"],
      baseUrl: target,
      timeoutMs: 5000,
      secret: fs.readFileSync(key, "utf8").trim(),
    });
    const actor = {
      issuer: "https://sandbox.example.invalid",
      subjectId: "sandbox-owner",
      tenantId: "fixture-tenant-a",
      policyGeneration: 1,
      actorType: "human" as const,
      agentId: "fixture-agent-private",
      requestId: "citation",
      roles: ["member"],
      departmentIds: ["fixture-department"],
      orgRoles: ["admin", "metrics_admin"],
      clearanceLevel: "internal",
      sessionId: "sandbox-session-sandbox-owner",
    };
    await expect(c.request("/v2/citations:verify", "POST", actor, evidence)).resolves.toMatchObject(
      { verification_status: "verified", version_id: evidence.version_id },
    );
    await expect(
      c.request("/v2/citations:verify", "POST", actor, {
        ...evidence,
        excerpt: "tampered",
        excerpt_hash: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "TAMPERED_EXCERPT" });
    await expect(
      c.request("/v2/citations:verify", "POST", actor, {
        ...evidence,
        version_id: "missing-history",
      }),
    ).rejects.toMatchObject({ status: 404, code: "ANCHOR_UNRESOLVABLE" });
  },
);
