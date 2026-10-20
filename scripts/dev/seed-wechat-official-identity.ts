/**
 * Dev seed: register a REAL WeChat Official Account (公众号) enterprise operational
 * identity for tenant 001 (upbeyond), bound to the CEO seat + 市场助手 (bot-2), and
 * grant a usage policy so the employee can enroll it from the robot authorizer.
 *
 * Secrets are read from env (never hardcoded / printed):
 *   OPENBOT_WX_APPID     — public-ish AppID (e.g. wx...)
 *   OPENBOT_WX_APPSECRET — AppSecret (kept out of logs)
 *
 * Run:
 *   OPENBOT_WX_APPID=... OPENBOT_WX_APPSECRET=... node --import tsx scripts/dev/seed-wechat-official-identity.ts
 *
 * The credential binding itself does not persist secret material (status-only);
 * the AppSecret is recorded into ~/.openbot/.env for the connector runtime to use
 * when actual publishing is wired. The AppID is stored as the identity's
 * externalAccountId for traceability.
 */
import {
  registerEnterpriseIdentity,
  upsertIdentityUsagePolicy,
} from "../../src/gateway/enterprise-operational-identity-store.js";
import {
  loadEnterpriseSeatAssetsStore,
  registerConnectorCredentialBinding,
  saveEnterpriseSeatAssetsStore,
} from "../../src/gateway/enterprise-seat-assets-store.js";
import {
  buildWechatOfficialAppSecretEnvKey,
  persistWechatOfficialAppSecretToEnv,
} from "../../src/gateway/wechat-official/index.js";

const TENANT_ID = "001";
const SEAT_ID = "1b25d120-013f-4ad5-b64a-bb0f9e1cd490"; // CEO seat (daniel)
const AGENT_ID = "bot-2"; // 市场助手
const CONNECTOR_ID = "wechat-official";
const ACTIONS = ["publish_draft", "publish_article", "broadcast_article"];

async function main() {
  const appId = process.env.OPENBOT_WX_APPID?.trim();
  const appSecret = process.env.OPENBOT_WX_APPSECRET?.trim();
  if (!appId || !appSecret) {
    throw new Error("OPENBOT_WX_APPID and OPENBOT_WX_APPSECRET env vars are required.");
  }
  const nowIso = new Date().toISOString();
  const store = await loadEnterpriseSeatAssetsStore();

  const seat = store.seats[SEAT_ID];
  if (!seat || seat.tenantId !== TENANT_ID) {
    throw new Error(`Seat ${SEAT_ID} not found for tenant ${TENANT_ID}.`);
  }
  if (!seat.defaultAgentAssetIds.includes(AGENT_ID)) {
    throw new Error(`Agent ${AGENT_ID} is not on seat ${SEAT_ID}.`);
  }

  // 1) Credential binding (status-only; real secret persisted to env below).
  const credential = registerConnectorCredentialBinding({
    store,
    tenantId: TENANT_ID,
    connectorId: CONNECTOR_ID,
    ownerType: "seat",
    ownerId: SEAT_ID,
    nowIso,
    createdBy: seat.currentEmployeeId,
  });

  // 2) Register the enterprise identity (real AppID as externalAccountId).
  const identity = registerEnterpriseIdentity({
    store,
    tenantId: TENANT_ID,
    displayName: "市场助手公众号",
    credentialBindingId: credential.credentialBindingId,
    externalAccountId: appId,
    nowIso,
    actorEmployeeId: seat.currentEmployeeId,
  });
  if (!identity.ok) {
    throw new Error(`registerEnterpriseIdentity failed: ${identity.code} ${identity.error}`);
  }

  // 3) Usage policy: grant this identity to the CEO seat + 市场助手 with publish actions.
  const policy = upsertIdentityUsagePolicy({
    store,
    tenantId: TENANT_ID,
    identityId: identity.identity.identityId,
    seatIds: [SEAT_ID],
    allowedAgentIds: [AGENT_ID],
    allowedActions: ACTIONS,
    enabled: true,
    nowIso,
    actorEmployeeId: seat.currentEmployeeId,
  });
  if (!policy.ok) {
    throw new Error(`upsertIdentityUsagePolicy failed: ${policy.code} ${policy.error}`);
  }

  await saveEnterpriseSeatAssetsStore(undefined, store);

  // Persist AppSecret with the shared enterprise-aligned helper (same key personal bind uses).
  const envWrite = persistWechatOfficialAppSecretToEnv({ appId, appSecret });
  if (!envWrite.ok) {
    throw new Error(`persistWechatOfficialAppSecretToEnv failed: ${envWrite.error}`);
  }

  console.log("✓ seeded wechat-official enterprise identity");
  console.log("  tenant:", TENANT_ID, "seat:", SEAT_ID, "agent:", AGENT_ID);
  console.log("  credentialBindingId:", credential.credentialBindingId);
  console.log("  identityId:", identity.identity.identityId);
  console.log("  policyId:", policy.policy.policyId);
  console.log("  externalAccountId(appId):", appId);
  console.log(
    "  appsecret -> env key:",
    buildWechatOfficialAppSecretEnvKey(appId),
    "(value not printed)",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
