import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
const cwd = process.cwd(),
  { Client } = createRequire(cwd + "/package.json")("pg");
if (
  process.env.OPENBOT_RUNTIME_ACCEPTANCE_ISOLATED !== "1" ||
  !process.env.OPENBOT_STATE_DIR ||
  !process.env.OPENBOT_TENANTS_ROOT ||
  !process.env.OPENBOT_CONFIG_PATH
) {
  throw new Error(
    "Requires explicit isolated acceptance roots and OPENBOT_RUNTIME_ACCEPTANCE_ISOLATED=1",
  );
}
const url = new URL(process.env.OPENBOT_RUNTIME_DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
  throw new Error("Acceptance database must be loopback");
}

const schema = `runtime_audit_${randomUUID().replaceAll("-", "")}`;
const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const port = reservation.address().port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
const controlUrl = new URL(url);
controlUrl.searchParams.delete("options");
const db = new Client({ connectionString: controlUrl.href });
await db.connect();
let server;
let created = false;
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  created = true;
  await db.query(`SET search_path TO ${schema}`);
  url.searchParams.set("options", `-csearch_path=${schema}`);
  process.env.OPENBOT_RUNTIME_DATABASE_URL = url.href;
  await db.query(
    await fs.readFile(cwd + "/src/agent-runtime/state/postgres/execution.sql", "utf8"),
  );
  await db.query(
    "INSERT INTO runtime_growth_service_grants VALUES ('tenant','principal','user','enterprise',ARRAY['allowed'],true,clock_timestamp()+interval '1 hour')",
  );
  const store = await import(cwd + "/src/gateway/skill-lifecycle-store.ts");
  const skill = store.saveSkillAsset({
    sourceAgentId: "source",
    lifecycle: "private",
    profile: {
      name: "Audit test",
      summary: "test",
      assetType: "capability",
      tags: [],
      category: "test",
      visibility: "private",
    },
  });
  for (const agentId of ["allowed", "denied"]) {
    store.installSkillToRobotAsset({
      agentId,
      skillId: skill.skillId,
      tenantId: "tenant",
      ownerUserId: "user",
    });
    store.commitRobotSkillInvocation({
      agentId,
      skillId: skill.skillId,
      invocationId: "audit-" + agentId,
      atMs: 10,
      scope: { tenantId: "tenant", userId: "user" },
      audit: {
        type: "skill_invocation_completed",
        invocationId: "audit-" + agentId,
        agentId,
        skillId: skill.skillId,
        tenantId: "tenant",
        userId: "user",
        completedAt: 10,
      },
    });
  }
  const { startGatewayServer } = await import(cwd + "/src/gateway/server.ts");
  server = await startGatewayServer(port, { controlUiEnabled: false });
  const { resolveTenantRuntimeStateRootForContext } = await import(
    cwd + "/src/gateway/tenant-store-paths.ts"
  );
  const file = path.join(
    resolveTenantRuntimeStateRootForContext({
      tenantId: "tenant",
      userId: "user",
      domain: "enterprise",
    }),
    "skill-invocation-events/events.jsonl",
  );
  let content = "";
  for (let i = 0; i < 150; i++) {
    try {
      content = await fs.readFile(file, "utf8");
      if (content.includes("audit-allowed")) {
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!content.includes("audit-allowed") || content.includes("audit-denied")) {
    throw new Error("audit scope failed");
  }
  await db.query("UPDATE runtime_growth_service_grants SET enabled=false");
  store.commitRobotSkillInvocation({
    agentId: "allowed",
    skillId: skill.skillId,
    invocationId: "after-revoke",
    atMs: 11,
    scope: { tenantId: "tenant", userId: "user" },
    audit: {
      type: "skill_invocation_completed",
      invocationId: "after-revoke",
      agentId: "allowed",
      skillId: skill.skillId,
      tenantId: "tenant",
      userId: "user",
      completedAt: 11,
    },
  });
  await new Promise((r) => setTimeout(r, 31000));
  if ((await fs.readFile(file, "utf8")).includes("after-revoke")) {
    throw new Error("revocation ignored");
  }
  await server.close({ reason: "isolated audit acceptance" });
  server = undefined;
  console.log("FULL_GATEWAY_AUDIT_SCOPE_REVOCATION_CLOSE_PASSED");
} finally {
  if (server) {
    await server.close({ reason: "cleanup" });
  }
  if (created) {
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
  }
  await db.end();
}
