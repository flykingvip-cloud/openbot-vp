// One-off dev seed: register a Feishu connector credential binding for a tenant
// so the enterprise operational identity registration has an eligible credential.
// Usage: node --import tsx scripts/dev/seed-enterprise-feishu-credential.ts [tenantId]
const tenantId = process.argv[2]?.trim() || "001";
const connectorId = "feishu";

const {
  loadEnterpriseSeatAssetsStore,
  saveEnterpriseSeatAssetsStore,
  registerConnectorCredentialBinding,
} = await import("../../src/gateway/enterprise-seat-assets-store.ts");
const { listEligibleOperationalIdentityCredentialBindings } =
  await import("../../src/gateway/enterprise-operational-identity-store.ts");

const store = await loadEnterpriseSeatAssetsStore();
const nowIso = new Date().toISOString();

const binding = registerConnectorCredentialBinding({
  store,
  tenantId,
  connectorId,
  ownerType: "employee",
  ownerId: "seed-admin",
  createdBy: "seed-script",
  nowIso,
});

await saveEnterpriseSeatAssetsStore(undefined, store);

console.log("registered credentialBindingId:", binding.credentialBindingId);
console.log(
  "eligible bindings for tenant",
  tenantId,
  ":",
  JSON.stringify(listEligibleOperationalIdentityCredentialBindings({ store, tenantId }), null, 2),
);
