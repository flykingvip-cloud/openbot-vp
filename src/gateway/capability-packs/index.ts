export {
  ALL_CAPABILITY_PACKS,
  DEFAULT_NEW_TENANT_PACK_IDS,
  PACK_CHANNELS,
  PACK_CN_OFFICE,
  PACK_LOCAL_DEV,
  PACK_PLATFORM_OPS,
  PACK_STARTER,
  buildOfficialManifestId,
  buildPackManifest,
  findPackIdsForSkillKey,
  getPackById,
  legacyManifestId,
  normalizeCapabilityPackIds,
  resolveAutoEntitlePackIds,
  resolvePackInstallSkillKeys,
  skillKeysForPackIds,
  type CapabilityPackDef,
  type CapabilityPackId,
  type PackRecipeDef,
  type PackSkillDef,
} from "./starter-packs.js";

export {
  entitleTenantForPlan,
  entitleTenantFromPlanVersion,
  getTenantPackEntitlement,
  grantTenantPacks,
  isSkillKeyEntitledForTenant,
  listTenantPackEntitlements,
  resolveEntitledSkillKeys,
  type TenantPackEntitlementRecord,
} from "./tenant-pack-entitlements.js";

export {
  seedOfficialCapabilityPacks,
  seedTenantPackEntitlements,
  type SeedPacksResult,
} from "./seed-registry.js";

export {
  TEMPLATE_AUTO_SKILL_KEYS,
  autoInstallCapabilitiesOnAgentCreate,
  installRegistrySkillOntoRobot,
  installSkillKeysOntoRobot,
  listActiveRegistryEntriesForPack,
  resolveAutoInstallSkillKeys,
  skillKeysForPacks,
  type InstallSkillResult,
} from "./install-pack-to-robot.js";
