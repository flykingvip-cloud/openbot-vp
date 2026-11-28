/**
 * Space / Favorites Schema-v7 sandbox adapter (W6B-1). Default-off pure
 * in-memory functions.
 *
 * Implements, on an isolated in-memory fixture only:
 *   - Tenant -> Space -> KB (1 Space : N KB)
 *   - SPACE-C03 phase one: 1 organization_team = 1 Team Space
 *   - Reject department auto-mapping
 *   - Zero-copy Favorites pointers (userId + assetId only)
 *   - resolveAuthorizedFavorites batch real-time authorization hydration
 *     with Fail-Closed anti-side-channel filtering (revoke, delete,
 *     cross-tenant, enterprise-admin reading an employee personal space)
 *
 * Default is disabled. Do not turn on product default flags.
 * Do not hook this into production routes or default Gateway paths.
 * No database, network, or disk writes. No production Schema v7 migration.
 * formal_t01_t27_accepted remains false; this module is not a formal
 * T-01–T-27 acceptance.
 */
export const SPACE_FAVORITES_V7_ADAPTER_ENABLED_DEFAULT = false;

/** Official process-env name. Default is unset / not "true" (stays off). */
export const SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV = "SPACE_FAVORITES_V7_ADAPTER_ENABLED";

export function isSpaceFavoritesV7AdapterEnvEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return env[SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV] === "true";
}
export const FORMAL_T01_T27_ACCEPTED = false;
export const SCHEMA_V7_PROD_MIGRATION_AUTHORIZED = false;

export const SPACE_FAVORITES_V7_ADAPTER_IO = {
  database: false,
  network: false,
  diskWrites: false,
} as const;

/** SPACE-C03 phase one: one organization_team binds exactly one Team Space. */
export const SPACE_C03_PHASE_ONE_ORG_TEAM_TO_TEAM_SPACE = 1;

export const FORBIDDEN_FAVORITE_POINTER_KEYS = [
  "body",
  "content",
  "html",
  "attachment",
  "chunks",
  "chunk",
  "embedding",
  "embeddings",
  "evidence",
  "evidence_anchors",
  "excerpt",
  "title",
  "summary",
  "spaceName",
] as const;

export type AdapterOptions = {
  /** Must be passed true to enforce / mutate the in-memory sandbox. Default is off. */
  enabled?: boolean;
};

export type DecisionCode =
  | "ADAPTER_DISABLED"
  | "OK"
  | "PERMISSION_DENIED"
  | "RESOURCE_UNAVAILABLE"
  | "POLICY_GENERATION_STALE"
  | "DEPARTMENT_AUTO_MAPPING_REJECTED"
  | "ORG_TEAM_SPACE_ALREADY_BOUND"
  | "PARENT_SPACE_FORBIDDEN_PHASE_ONE"
  | "CROSS_TENANT_FORBIDDEN"
  | "SPACE_ORG_KB_ORG_MISMATCH"
  | "FORBIDDEN_POINTER_FIELD"
  | "WRITE_NOT_DOWNGRADED_TO_PERSONAL"
  | "IDEMPOTENT_REPLAY"
  | "DATA_CAPABILITY_NOT_STATIC_INDEX";

export type ActorKind = "employee" | "enterprise_admin" | "indie";

export type Actor = {
  userId: string;
  tenantId: string;
  kind: ActorKind;
  orgRoles?: string[];
  publicKbAdmin?: boolean;
  agentId?: string;
};

export type SpaceKind = "enterprise" | "team" | "personal" | "collaboration_group";

export type TeamSourceKind = "organization_team" | "collaboration_group" | "department";

export type SpaceRecord = {
  spaceId: string;
  tenantId: string;
  kind: SpaceKind;
  ownerUserId?: string;
  organizationTeamId?: string;
  collaborationGroupId?: string;
  archived?: boolean;
  parentSpaceId?: string;
  memberUserIds: string[];
  revokedUserIds?: string[];
  policyGeneration?: number;
};

export type KnowledgeBaseRecord = {
  kbId: string;
  spaceId: string;
  tenantId: string;
  archived?: boolean;
};

export type AssetSupplyKind =
  | "uploaded_document"
  | "agent_deliverable"
  | "enterprise_materialized_ref"
  | "data_capability";

export type AssetPublicationState =
  | "published"
  | "partial"
  | "captured_metadata_only"
  | "file_written"
  | "indexed";

export type AssetRecord = {
  assetId: string;
  kbId: string;
  spaceId: string;
  tenantId: string;
  targetType: "kb" | "asset";
  supplyKind?: AssetSupplyKind;
  publicationState?: AssetPublicationState;
  ingestCommitted?: boolean;
  freshness?: "fresh" | "stale";
  maskedFields?: string[];
  traceRefs?: string[];
  externalId?: string;
  archived?: boolean;
  deleted?: boolean;
  denyUserIds?: string[];
  allowUserIds?: string[];
  /** Catalog-only; MUST never be copied into a Favorite pointer. */
  title?: string;
  body?: string;
  chunks?: unknown;
  embedding?: unknown;
  evidence?: unknown;
  sourceSeatRevoked?: boolean;
  credentials?: unknown;
};

export type FavoritePointer = {
  userId: string;
  assetId: string;
};

export type AgentBinding = {
  agentId: string;
  allowedSpaceIds: string[];
  allowedKbIds: string[];
};

export type AuthorizedFavoriteView = {
  status: "authorized";
  userId: string;
  assetId: string;
  targetType: "kb" | "asset";
  spaceId: string;
  kbId: string;
  publicationState?: AssetPublicationState;
  freshness?: "fresh" | "stale";
  maskedFields?: string[];
  traceRefs?: string[];
  supplyKind?: AssetSupplyKind;
};

export type UnavailableFavoriteView = {
  status: "unavailable";
};

export type FavoriteView = AuthorizedFavoriteView | UnavailableFavoriteView;

export type SpaceFavoritesWorld = {
  tenants: Set<string>;
  spaces: Map<string, SpaceRecord>;
  kbs: Map<string, KnowledgeBaseRecord>;
  assets: Map<string, AssetRecord>;
  favorites: FavoritePointer[];
  agents: Map<string, AgentBinding>;
  orgTeamBindings: Map<string, string>;
  idempotencyKeys: Map<string, string>;
  snapshots: Array<{
    snapshotId: string;
    userId: string;
    spaceId: string;
    policyGeneration: number;
  }>;
};

export function createEmptyWorld(): SpaceFavoritesWorld {
  return {
    tenants: new Set(),
    spaces: new Map(),
    kbs: new Map(),
    assets: new Map(),
    favorites: [],
    agents: new Map(),
    orgTeamBindings: new Map(),
    idempotencyKeys: new Map(),
    snapshots: [],
  };
}

export type MutationResult<T = undefined> = {
  enabled: boolean;
  ok: boolean;
  code: DecisionCode;
  value?: T;
};

function disabled<T = undefined>(): MutationResult<T> {
  return { enabled: false, ok: false, code: "ADAPTER_DISABLED" };
}

function isEnabled(options: AdapterOptions | undefined): boolean {
  return options?.enabled === true;
}

function deny<T = undefined>(code: DecisionCode = "PERMISSION_DENIED"): MutationResult<T> {
  return { enabled: true, ok: false, code };
}

function ok<T>(value?: T, code: DecisionCode = "OK"): MutationResult<T> {
  return { enabled: true, ok: true, code, value };
}

export function pointerHasForbiddenFields(pointer: object): boolean {
  return FORBIDDEN_FAVORITE_POINTER_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(pointer, key),
  );
}

export function assertFavoritePointerShape(pointer: FavoritePointer): pointer is FavoritePointer {
  const keys = Object.keys(pointer);
  if (keys.length !== 2 || !keys.includes("userId") || !keys.includes("assetId")) {
    return false;
  }
  return (
    typeof pointer.userId === "string" &&
    pointer.userId.startsWith("syn_") &&
    typeof pointer.assetId === "string" &&
    pointer.assetId.startsWith("syn_")
  );
}

export function bindTeamSource(
  world: SpaceFavoritesWorld,
  input: {
    sourceKind: TeamSourceKind;
    sourceId: string;
    tenantId: string;
    spaceId: string;
    parentSpaceId?: string;
  },
  options: AdapterOptions = {},
): MutationResult<SpaceRecord> {
  if (!isEnabled(options)) {
    return disabled();
  }
  if (input.sourceKind === "department") {
    return deny("DEPARTMENT_AUTO_MAPPING_REJECTED");
  }
  if (input.parentSpaceId) {
    return deny("PARENT_SPACE_FORBIDDEN_PHASE_ONE");
  }
  if (input.sourceKind === "organization_team") {
    const existing = world.orgTeamBindings.get(input.sourceId);
    if (existing && existing !== input.spaceId) {
      return deny("ORG_TEAM_SPACE_ALREADY_BOUND");
    }
    if (existing === input.spaceId) {
      const space = world.spaces.get(input.spaceId);
      return space ? ok(space, "IDEMPOTENT_REPLAY") : deny("RESOURCE_UNAVAILABLE");
    }
    world.orgTeamBindings.set(input.sourceId, input.spaceId);
  }
  world.tenants.add(input.tenantId);
  const kind: SpaceKind =
    input.sourceKind === "collaboration_group" ? "collaboration_group" : "team";
  const space: SpaceRecord = {
    spaceId: input.spaceId,
    tenantId: input.tenantId,
    kind,
    organizationTeamId: input.sourceKind === "organization_team" ? input.sourceId : undefined,
    collaborationGroupId: input.sourceKind === "collaboration_group" ? input.sourceId : undefined,
    memberUserIds: [],
    revokedUserIds: [],
    policyGeneration: 1,
  };
  world.spaces.set(space.spaceId, space);
  return ok(space);
}

export function putSpace(
  world: SpaceFavoritesWorld,
  space: SpaceRecord,
  options: AdapterOptions = {},
): MutationResult<SpaceRecord> {
  if (!isEnabled(options)) {
    return disabled();
  }
  if (space.parentSpaceId) {
    return deny("PARENT_SPACE_FORBIDDEN_PHASE_ONE");
  }
  world.tenants.add(space.tenantId);
  if (!space.memberUserIds) {
    space.memberUserIds = [];
  }
  if (space.policyGeneration === undefined) {
    space.policyGeneration = 1;
  }
  world.spaces.set(space.spaceId, space);
  if (space.kind === "team" && space.organizationTeamId) {
    const existing = world.orgTeamBindings.get(space.organizationTeamId);
    if (existing && existing !== space.spaceId) {
      world.spaces.delete(space.spaceId);
      return deny("ORG_TEAM_SPACE_ALREADY_BOUND");
    }
    world.orgTeamBindings.set(space.organizationTeamId, space.spaceId);
  }
  return ok(space);
}

export function attachKnowledgeBase(
  world: SpaceFavoritesWorld,
  kb: KnowledgeBaseRecord,
  options: AdapterOptions = {},
): MutationResult<KnowledgeBaseRecord> {
  if (!isEnabled(options)) {
    return disabled();
  }
  const space = world.spaces.get(kb.spaceId);
  if (!space) {
    return deny("RESOURCE_UNAVAILABLE");
  }
  if (space.tenantId !== kb.tenantId) {
    return deny("SPACE_ORG_KB_ORG_MISMATCH");
  }
  world.kbs.set(kb.kbId, kb);
  return ok(kb);
}

export function putAsset(
  world: SpaceFavoritesWorld,
  asset: AssetRecord,
  options: AdapterOptions = {},
): MutationResult<AssetRecord> {
  if (!isEnabled(options)) {
    return disabled();
  }
  const space = world.spaces.get(asset.spaceId);
  const kb = world.kbs.get(asset.kbId);
  if (!space || !kb) {
    return deny("RESOURCE_UNAVAILABLE");
  }
  if (space.tenantId !== asset.tenantId || kb.tenantId !== asset.tenantId) {
    return deny("CROSS_TENANT_FORBIDDEN");
  }
  if (kb.spaceId !== asset.spaceId) {
    return deny("SPACE_ORG_KB_ORG_MISMATCH");
  }
  world.assets.set(asset.assetId, asset);
  return ok(asset);
}

export function putAgent(
  world: SpaceFavoritesWorld,
  agent: AgentBinding,
  options: AdapterOptions = {},
): MutationResult<AgentBinding> {
  if (!isEnabled(options)) {
    return disabled();
  }
  world.agents.set(agent.agentId, agent);
  return ok(agent);
}

export function addSpaceMember(
  world: SpaceFavoritesWorld,
  spaceId: string,
  userId: string,
  options: AdapterOptions = {},
): MutationResult {
  if (!isEnabled(options)) {
    return disabled();
  }
  const space = world.spaces.get(spaceId);
  if (!space) {
    return deny("RESOURCE_UNAVAILABLE");
  }
  if (space.kind === "personal") {
    return deny("PERMISSION_DENIED");
  }
  if (!space.memberUserIds.includes(userId)) {
    space.memberUserIds.push(userId);
  }
  space.revokedUserIds = (space.revokedUserIds ?? []).filter((id) => id !== userId);
  return ok();
}

export function revokeSpaceMember(
  world: SpaceFavoritesWorld,
  spaceId: string,
  userId: string,
  options: AdapterOptions = {},
): MutationResult {
  if (!isEnabled(options)) {
    return disabled();
  }
  const space = world.spaces.get(spaceId);
  if (!space) {
    return deny("RESOURCE_UNAVAILABLE");
  }
  space.memberUserIds = space.memberUserIds.filter((id) => id !== userId);
  const revoked = new Set(space.revokedUserIds ?? []);
  revoked.add(userId);
  space.revokedUserIds = [...revoked];
  space.policyGeneration = (space.policyGeneration ?? 1) + 1;
  return ok();
}

function spaceAllowsUserIgnoringArchive(space: SpaceRecord, actor: Actor): boolean {
  if (space.tenantId !== actor.tenantId) {
    return false;
  }
  if (space.kind === "personal") {
    // T-05 / SPACE-C07: enterprise admin does not implicitly inherit personal space.
    return space.ownerUserId === actor.userId;
  }
  if ((space.revokedUserIds ?? []).includes(actor.userId)) {
    return false;
  }
  if (space.kind === "enterprise") {
    return space.memberUserIds.includes(actor.userId) || actor.kind === "enterprise_admin";
  }
  return space.memberUserIds.includes(actor.userId);
}

function spaceAllowsUser(space: SpaceRecord, actor: Actor): boolean {
  if (space.archived) {
    return false;
  }
  return spaceAllowsUserIgnoringArchive(space, actor);
}

function agentAllows(world: SpaceFavoritesWorld, actor: Actor, asset: AssetRecord): boolean {
  if (!actor.agentId) {
    return true;
  }
  const agent = world.agents.get(actor.agentId);
  if (!agent) {
    return false;
  }
  const spaceOk = agent.allowedSpaceIds.includes(asset.spaceId);
  const kbOk = agent.allowedKbIds.includes(asset.kbId);
  return spaceOk && kbOk;
}

export function authorizeAsset(
  world: SpaceFavoritesWorld,
  actor: Actor,
  assetId: string,
  options: AdapterOptions = {},
): MutationResult<AssetRecord> {
  if (!isEnabled(options)) {
    return disabled();
  }
  const asset = world.assets.get(assetId);
  // Fail-closed: missing, cross-tenant, and not-a-member all share
  // PERMISSION_DENIED so a caller cannot distinguish existence
  // (anti side-channel). Availability (archived / deleted / seat
  // revoke) is only returned after the actor is a legitimate subject.
  if (!asset) {
    return deny("PERMISSION_DENIED");
  }
  if (asset.tenantId !== actor.tenantId) {
    return deny("PERMISSION_DENIED");
  }
  const space = world.spaces.get(asset.spaceId);
  const kb = world.kbs.get(asset.kbId);
  if (!space || !kb) {
    return deny("PERMISSION_DENIED");
  }
  if (!spaceAllowsUserIgnoringArchive(space, actor)) {
    return deny("PERMISSION_DENIED");
  }
  if (asset.deleted || asset.archived || asset.sourceSeatRevoked || kb.archived || space.archived) {
    return deny("RESOURCE_UNAVAILABLE");
  }
  if ((asset.denyUserIds ?? []).includes(actor.userId)) {
    return deny("PERMISSION_DENIED");
  }
  // T-02: DocumentACL.allow_users is intentionally not consulted as a grant.
  // Space membership already failed closed above; allow_users cannot pierce it.
  if (!agentAllows(world, actor, asset)) {
    return deny("PERMISSION_DENIED");
  }
  if (asset.supplyKind === "data_capability") {
    return deny("DATA_CAPABILITY_NOT_STATIC_INDEX");
  }
  return ok(asset);
}

export function addFavorite(
  world: SpaceFavoritesWorld,
  actor: Actor,
  pointer: FavoritePointer,
  options: AdapterOptions = {},
): MutationResult<FavoritePointer> {
  if (!isEnabled(options)) {
    return disabled();
  }
  if (pointerHasForbiddenFields(pointer) || !assertFavoritePointerShape(pointer)) {
    return deny("FORBIDDEN_POINTER_FIELD");
  }
  if (pointer.userId !== actor.userId) {
    return deny("PERMISSION_DENIED");
  }
  const auth = authorizeAsset(world, actor, pointer.assetId, { enabled: true });
  if (!auth.ok) {
    return deny(auth.code);
  }
  const existing = world.favorites.find(
    (fav) => fav.userId === pointer.userId && fav.assetId === pointer.assetId,
  );
  if (existing) {
    return ok({ userId: existing.userId, assetId: existing.assetId }, "IDEMPOTENT_REPLAY");
  }
  const stored: FavoritePointer = { userId: pointer.userId, assetId: pointer.assetId };
  world.favorites.push(stored);
  return ok(stored);
}

export function deleteFavorite(
  world: SpaceFavoritesWorld,
  actor: Actor,
  assetId: string,
  options: AdapterOptions = {},
): MutationResult {
  if (!isEnabled(options)) {
    return disabled();
  }
  const before = world.favorites.length;
  world.favorites = world.favorites.filter(
    (fav) => !(fav.userId === actor.userId && fav.assetId === assetId),
  );
  if (world.favorites.length === before) {
    // Still ok: user may clean a stale pointer; do not leak whether it existed
    // as a readable asset.
    return ok();
  }
  return ok();
}

export type ResolveFavoritesOptions = AdapterOptions & {
  /**
   * When true, unauthorized / deleted pointers that belong to the actor are
   * returned as a uniform { status: "unavailable" } placeholder with no
   * title, body, space name, or other metadata. Default is silent filter.
   */
  includeUnavailable?: boolean;
};

function toAuthorizedView(pointer: FavoritePointer, asset: AssetRecord): AuthorizedFavoriteView {
  return {
    status: "authorized",
    userId: pointer.userId,
    assetId: pointer.assetId,
    targetType: asset.targetType,
    spaceId: asset.spaceId,
    kbId: asset.kbId,
    publicationState: asset.publicationState,
    freshness: asset.freshness,
    maskedFields: asset.maskedFields ? [...asset.maskedFields] : undefined,
    traceRefs: asset.traceRefs ? [...asset.traceRefs] : undefined,
    supplyKind: asset.supplyKind,
  };
}

const UNAVAILABLE: UnavailableFavoriteView = { status: "unavailable" };

export function resolveAuthorizedFavorites(
  world: SpaceFavoritesWorld,
  actor: Actor,
  options: ResolveFavoritesOptions = {},
): MutationResult<FavoriteView[]> {
  if (!isEnabled(options)) {
    return disabled();
  }
  const views: FavoriteView[] = [];
  for (const pointer of world.favorites) {
    if (pointer.userId !== actor.userId) {
      continue;
    }
    if (pointerHasForbiddenFields(pointer) || !assertFavoritePointerShape(pointer)) {
      if (options.includeUnavailable) {
        views.push({ ...UNAVAILABLE });
      }
      continue;
    }
    const auth = authorizeAsset(world, actor, pointer.assetId, { enabled: true });
    if (auth.ok && auth.value) {
      const view = toAuthorizedView(pointer, auth.value);
      // Never copy body / chunk / embedding / evidence into the view.
      views.push(view);
      continue;
    }
    if (options.includeUnavailable) {
      views.push({ ...UNAVAILABLE });
    }
  }
  return ok(views);
}

export function listVisibleSpaces(
  world: SpaceFavoritesWorld,
  actor: Actor,
  options: AdapterOptions = {},
): MutationResult<string[]> {
  if (!isEnabled(options)) {
    return disabled();
  }
  const ids: string[] = [];
  for (const space of world.spaces.values()) {
    if (spaceAllowsUser(space, actor)) {
      ids.push(space.spaceId);
    }
  }
  return ok(ids);
}

export function searchVisibleAssets(
  world: SpaceFavoritesWorld,
  actor: Actor,
  needle: string,
  options: AdapterOptions = {},
): MutationResult<string[]> {
  if (!isEnabled(options)) {
    return disabled();
  }
  const hits: string[] = [];
  for (const asset of world.assets.values()) {
    const auth = authorizeAsset(world, actor, asset.assetId, { enabled: true });
    if (!auth.ok || !auth.value) {
      continue;
    }
    if (
      auth.value.publicationState === "captured_metadata_only" ||
      auth.value.ingestCommitted === false
    ) {
      continue;
    }
    if (auth.value.supplyKind === "data_capability") {
      continue;
    }
    const haystack = `${auth.value.title ?? ""} ${auth.value.body ?? ""}`;
    if (needle && haystack.includes(needle)) {
      hits.push(auth.value.assetId);
    }
  }
  return ok(hits);
}

export function saveAgentDeliverable(
  world: SpaceFavoritesWorld,
  actor: Actor,
  input: {
    assetId: string;
    spaceId: string;
    kbId: string;
    tenantId: string;
    idempotencyKey: string;
    title?: string;
  },
  options: AdapterOptions = {},
): MutationResult<AssetRecord> {
  if (!isEnabled(options)) {
    return disabled();
  }
  const space = world.spaces.get(input.spaceId);
  if (!space || space.tenantId !== actor.tenantId) {
    return deny("PERMISSION_DENIED");
  }
  if (!spaceAllowsUser(space, actor)) {
    // T-21: never silently fall back to the actor's personal space.
    return deny("WRITE_NOT_DOWNGRADED_TO_PERSONAL");
  }
  const replay = world.idempotencyKeys.get(`${actor.userId}:${input.idempotencyKey}`);
  if (replay) {
    const existing = world.assets.get(replay);
    return existing ? ok(existing, "IDEMPOTENT_REPLAY") : deny("RESOURCE_UNAVAILABLE");
  }
  const asset: AssetRecord = {
    assetId: input.assetId,
    kbId: input.kbId,
    spaceId: input.spaceId,
    tenantId: input.tenantId,
    targetType: "asset",
    supplyKind: "agent_deliverable",
    publicationState: "published",
    ingestCommitted: true,
    title: input.title,
  };
  const put = putAsset(world, asset, { enabled: true });
  if (!put.ok) {
    return put;
  }
  world.idempotencyKeys.set(`${actor.userId}:${input.idempotencyKey}`, input.assetId);
  return ok(asset);
}

export function refreshEnterpriseRef(
  world: SpaceFavoritesWorld,
  externalId: string,
  patch: Partial<
    Pick<AssetRecord, "freshness" | "publicationState" | "maskedFields" | "traceRefs" | "title">
  >,
  options: AdapterOptions = {},
): MutationResult<AssetRecord> {
  if (!isEnabled(options)) {
    return disabled();
  }
  const matches = [...world.assets.values()].filter((asset) => asset.externalId === externalId);
  if (matches.length !== 1) {
    return deny("RESOURCE_UNAVAILABLE");
  }
  const asset = matches[0];
  Object.assign(asset, patch);
  return ok(asset);
}

export function detachAssetFromSpace(
  world: SpaceFavoritesWorld,
  assetId: string,
  options: AdapterOptions = {},
): MutationResult<AssetRecord> {
  if (!isEnabled(options)) {
    return disabled();
  }
  const asset = world.assets.get(assetId);
  if (!asset) {
    return deny("RESOURCE_UNAVAILABLE");
  }
  // T-26 / SPACE-C04: detach must not implicitly archive the shared asset.
  asset.archived = false;
  return ok(asset);
}

export function recordSnapshot(
  world: SpaceFavoritesWorld,
  input: { snapshotId: string; userId: string; spaceId: string },
  options: AdapterOptions = {},
): MutationResult {
  if (!isEnabled(options)) {
    return disabled();
  }
  const space = world.spaces.get(input.spaceId);
  if (!space) {
    return deny("RESOURCE_UNAVAILABLE");
  }
  world.snapshots.push({
    snapshotId: input.snapshotId,
    userId: input.userId,
    spaceId: input.spaceId,
    policyGeneration: space.policyGeneration ?? 1,
  });
  return ok();
}

export function authorizeSnapshot(
  world: SpaceFavoritesWorld,
  actor: Actor,
  snapshotId: string,
  options: AdapterOptions = {},
): MutationResult {
  if (!isEnabled(options)) {
    return disabled();
  }
  const snap = world.snapshots.find((item) => item.snapshotId === snapshotId);
  if (!snap || snap.userId !== actor.userId) {
    return deny("PERMISSION_DENIED");
  }
  const space = world.spaces.get(snap.spaceId);
  if (!space || !spaceAllowsUser(space, actor)) {
    return deny("POLICY_GENERATION_STALE");
  }
  if ((space.policyGeneration ?? 1) !== snap.policyGeneration) {
    return deny("POLICY_GENERATION_STALE");
  }
  return ok();
}

export function importBrowserFavorites(
  world: SpaceFavoritesWorld,
  actor: Actor,
  records: Array<{ tenantId: string; userId: string; assetId: string }>,
  options: AdapterOptions = {},
): MutationResult<number> {
  if (!isEnabled(options)) {
    return disabled();
  }
  let imported = 0;
  for (const record of records) {
    // T-23: unscoped or cross-account browser records must not be attributed
    // to the current actor.
    if (record.tenantId !== actor.tenantId || record.userId !== actor.userId) {
      continue;
    }
    const added = addFavorite(
      world,
      actor,
      { userId: actor.userId, assetId: record.assetId },
      { enabled: true },
    );
    if (added.ok) {
      imported += 1;
    }
  }
  return ok(imported);
}

export function viewLeaksSensitiveCatalog(view: FavoriteView, sentinels: string[]): boolean {
  const encoded = JSON.stringify(view);
  return sentinels.some((token) => token.length > 0 && encoded.includes(token));
}
