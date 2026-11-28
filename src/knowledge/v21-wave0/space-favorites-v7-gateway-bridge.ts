/**
 * Wave-V21-7 W7B-1 Space/Favorites V7 Gateway bridge.
 * Default-off. Requires BOTH process flags
 * `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED` and `SPACE_FAVORITES_V7_ADAPTER_ENABLED`
 * to be the literal "true". Not registered on production default Gateway routes.
 * Bridges the W6B-1 in-memory adapter and the PRE-04 leaver guard; does not
 * fork their Fail-Closed semantics.
 */
import {
  AI_EXECUTION_TRACE_HEADER_KEYS,
  type AiExecutionTraceHeaders,
} from "./ai-execution-trace-header-propagator.js";
import {
  evaluatePre04LeaverPolicy,
  type Pre04LeaverDecision,
  type Pre04LeaverEvent,
} from "./pre04-leaver-policy-guard.js";
import {
  SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV,
  addFavorite,
  attachKnowledgeBase,
  bindTeamSource,
  deleteFavorite,
  isSpaceFavoritesV7AdapterEnvEnabled,
  listVisibleSpaces,
  putSpace,
  resolveAuthorizedFavorites,
  type Actor,
  type FavoritePointer,
  type FavoriteView,
  type DecisionCode,
  type KnowledgeBaseRecord,
  type MutationResult,
  type SpaceFavoritesWorld,
  type SpaceRecord,
  type TeamSourceKind,
} from "./space-favorites-v7-adapter.js";
import {
  X_V21_HEADER_NAMES,
  parseXv21RequestHeaders,
  projectXv21Headers,
} from "./w2-interop-harness.js";

export const OPENBOT_KNOWLEDGE_SDK_V2_ENABLED_ENV = "OPENBOT_KNOWLEDGE_SDK_V2_ENABLED";

export const SPACE_FAVORITES_V7_GATEWAY_BRIDGE_ENABLED_DEFAULT = false;

/** Official 7-key X-V21-* names in TRACE_KEYS / AI_EXECUTION_TRACE_HEADER_KEYS order. */
export const OFFICIAL_X_V21_TRACE_HEADER_NAMES = AI_EXECUTION_TRACE_HEADER_KEYS.map(
  (key) => X_V21_HEADER_NAMES[key],
) as readonly [
  "X-V21-Tenant-Id",
  "X-V21-User-Id",
  "X-V21-Agent-Id",
  "X-V21-Trace-Id",
  "X-V21-Run-Id",
  "X-V21-Plan-Id",
  "X-V21-Policy-Generation",
];

export type SpaceFavoritesV7Action =
  | "spaces.list"
  | "spaces.get"
  | "spaces.create"
  | "spaces.members.list"
  | "spaces.kbs.bind"
  | "favorites.add"
  | "favorites.remove"
  | "favorites.list";

export const SPACE_FAVORITES_V7_ACTIONS: readonly SpaceFavoritesV7Action[] = [
  "spaces.list",
  "spaces.get",
  "spaces.create",
  "spaces.members.list",
  "spaces.kbs.bind",
  "favorites.add",
  "favorites.remove",
  "favorites.list",
];

export type BridgeIoCounters = {
  adapterReads: number;
  storeAccess: number;
  hydration: number;
};

export const BRIDGE_ZERO_IO: BridgeIoCounters = {
  adapterReads: 0,
  storeAccess: 0,
  hydration: 0,
};

export type BridgeDecisionCode =
  | "OK"
  | "SWITCHES_DISABLED"
  | "MISSING_OR_INVALID_HEADER"
  | "HEADER_ACTOR_MISMATCH"
  | "UNKNOWN_ACTION"
  | "WORLD_REQUIRED"
  | "PRE04_POLICY_VIOLATION"
  | "PERMISSION_DENIED"
  | "RESOURCE_UNAVAILABLE"
  | "ADAPTER_DISABLED"
  | "INVALID_POINTER"
  | DecisionCode;

export type TeamSourceBindInput = {
  sourceKind: TeamSourceKind;
  sourceId: string;
  tenantId: string;
  spaceId: string;
  parentSpaceId?: string;
};

export type BridgePayload = {
  spaceId?: string;
  space?: SpaceRecord;
  teamSource?: TeamSourceBindInput;
  kb?: KnowledgeBaseRecord;
  pointer?: FavoritePointer;
  includeUnavailable?: boolean;
  leaverEvent?: Pre04LeaverEvent;
};

export type DispatchSpaceFavoritesV7Input = {
  action: string;
  headers: Record<string, string>;
  actor: Actor;
  world?: SpaceFavoritesWorld;
  payload?: BridgePayload;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

export type BridgeValue =
  | { kind: "spaces"; spaces: SpaceRecord[] }
  | { kind: "space"; space: SpaceRecord }
  | { kind: "members"; memberUserIds: string[] }
  | { kind: "kb"; kb: KnowledgeBaseRecord }
  | { kind: "favoriteAdded" }
  | { kind: "favoriteRemoved" }
  | { kind: "favorites"; views: FavoriteView[] };

export type DispatchSpaceFavoritesV7Result = {
  ok: boolean;
  enabled: boolean;
  code: BridgeDecisionCode;
  io: BridgeIoCounters;
  outgoingHeaders?: Record<string, string>;
  missingHeaders?: string[];
  pre04?: Pre04LeaverDecision;
  value?: BridgeValue;
};

export function isKnowledgeSdkV2EnvEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return env[OPENBOT_KNOWLEDGE_SDK_V2_ENABLED_ENV] === "true";
}

export function readDualSpaceFavoritesV7Switches(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): {
  knowledgeSdkV2: boolean;
  spaceFavoritesV7: boolean;
  both: boolean;
} {
  const knowledgeSdkV2 = isKnowledgeSdkV2EnvEnabled(env);
  const spaceFavoritesV7 = isSpaceFavoritesV7AdapterEnvEnabled(env);
  return { knowledgeSdkV2, spaceFavoritesV7, both: knowledgeSdkV2 && spaceFavoritesV7 };
}

export function isSpaceFavoritesV7GatewayBridgeEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return readDualSpaceFavoritesV7Switches(env).both;
}

export function requireOfficialXv21Headers(
  headers: Record<string, string>,
):
  | { ok: true; parsed: AiExecutionTraceHeaders; outgoing: Record<string, string> }
  | { ok: false; missing: string[] } {
  const parsed = parseXv21RequestHeaders(headers);
  const missing: string[] = [];
  for (const key of AI_EXECUTION_TRACE_HEADER_KEYS) {
    if (key === "policy_generation") {
      if (typeof parsed.policy_generation !== "number") {
        missing.push(X_V21_HEADER_NAMES[key]);
      }
    } else if (typeof parsed[key] !== "string" || !parsed[key].trim()) {
      missing.push(X_V21_HEADER_NAMES[key]);
    }
  }
  if (missing.length) {
    return { ok: false, missing };
  }
  const complete = parsed as AiExecutionTraceHeaders;
  return { ok: true, parsed: complete, outgoing: projectXv21Headers(complete) };
}

function headersMatchActor(parsed: AiExecutionTraceHeaders, actor: Actor): boolean {
  if (parsed.tenant_id !== actor.tenantId) {
    return false;
  }
  if (parsed.user_id !== actor.userId) {
    return false;
  }
  if (actor.agentId && parsed.agent_id !== actor.agentId) {
    return false;
  }
  return true;
}

function zeroResult(code: BridgeDecisionCode): DispatchSpaceFavoritesV7Result {
  return {
    ok: false,
    enabled: false,
    code,
    io: { ...BRIDGE_ZERO_IO },
  };
}

function agentAllowsSpace(world: SpaceFavoritesWorld, actor: Actor, spaceId: string): boolean {
  if (!actor.agentId) {
    return true;
  }
  const agent = world.agents.get(actor.agentId);
  if (!agent) {
    return false;
  }
  return agent.allowedSpaceIds.includes(spaceId);
}

function visibleSpacesForActor(world: SpaceFavoritesWorld, actor: Actor): SpaceRecord[] {
  const listed = listVisibleSpaces(world, actor, { enabled: true });
  if (!listed.ok || !listed.value) {
    return [];
  }
  const records: SpaceRecord[] = [];
  for (const spaceId of listed.value) {
    if (!agentAllowsSpace(world, actor, spaceId)) {
      continue;
    }
    const space = world.spaces.get(spaceId);
    if (space) {
      records.push(space);
    }
  }
  return records;
}

function mapAdapterCode(code: MutationResult["code"]): BridgeDecisionCode {
  return code as BridgeDecisionCode;
}

function increment(io: BridgeIoCounters, field: keyof BridgeIoCounters): void {
  io[field] += 1;
}

/**
 * Dispatch one of the eight official Space/Favorites actions.
 * Either switch unset/false => immediate Fail-Closed and zero I/O.
 */
export function dispatchSpaceFavoritesV7Action(
  input: DispatchSpaceFavoritesV7Input,
): DispatchSpaceFavoritesV7Result {
  const env = input.env ?? process.env;
  const switches = readDualSpaceFavoritesV7Switches(env);
  if (!switches.both) {
    return zeroResult("SWITCHES_DISABLED");
  }

  const headerCheck = requireOfficialXv21Headers(input.headers);
  if (!headerCheck.ok) {
    return {
      ok: false,
      enabled: true,
      code: "MISSING_OR_INVALID_HEADER",
      io: { ...BRIDGE_ZERO_IO },
      missingHeaders: headerCheck.missing,
    };
  }
  if (!headersMatchActor(headerCheck.parsed, input.actor)) {
    return {
      ok: false,
      enabled: true,
      code: "HEADER_ACTOR_MISMATCH",
      io: { ...BRIDGE_ZERO_IO },
      outgoingHeaders: headerCheck.outgoing,
    };
  }

  if (!(SPACE_FAVORITES_V7_ACTIONS as readonly string[]).includes(input.action)) {
    return {
      ok: false,
      enabled: true,
      code: "UNKNOWN_ACTION",
      io: { ...BRIDGE_ZERO_IO },
      outgoingHeaders: headerCheck.outgoing,
    };
  }

  const payload = input.payload ?? {};
  if (payload.leaverEvent) {
    const pre04 = evaluatePre04LeaverPolicy(payload.leaverEvent, { enabled: true });
    if (!pre04.ok) {
      return {
        ok: false,
        enabled: true,
        code: "PRE04_POLICY_VIOLATION",
        io: { ...BRIDGE_ZERO_IO },
        outgoingHeaders: headerCheck.outgoing,
        pre04,
      };
    }
  }

  if (!input.world) {
    return {
      ok: false,
      enabled: true,
      code: "WORLD_REQUIRED",
      io: { ...BRIDGE_ZERO_IO },
      outgoingHeaders: headerCheck.outgoing,
    };
  }

  const world = input.world;
  const actor = input.actor;
  const io: BridgeIoCounters = { ...BRIDGE_ZERO_IO };
  const action = input.action as SpaceFavoritesV7Action;
  const on = { enabled: true } as const;
  const base = {
    enabled: true as const,
    outgoingHeaders: headerCheck.outgoing,
  };

  if (action === "spaces.list") {
    increment(io, "adapterReads");
    increment(io, "storeAccess");
    const spaces = visibleSpacesForActor(world, actor);
    return { ...base, ok: true, code: "OK", io, value: { kind: "spaces", spaces } };
  }

  if (action === "spaces.get") {
    const spaceId = payload.spaceId;
    if (!spaceId) {
      return { ...base, ok: false, code: "PERMISSION_DENIED", io };
    }
    increment(io, "adapterReads");
    increment(io, "storeAccess");
    const visible = visibleSpacesForActor(world, actor).some((space) => space.spaceId === spaceId);
    const space = world.spaces.get(spaceId);
    if (!visible || !space) {
      return { ...base, ok: false, code: "PERMISSION_DENIED", io };
    }
    return { ...base, ok: true, code: "OK", io, value: { kind: "space", space } };
  }

  if (action === "spaces.create") {
    increment(io, "storeAccess");
    if (payload.teamSource) {
      const result = bindTeamSource(world, payload.teamSource, on);
      return {
        ...base,
        ok: result.ok,
        code: mapAdapterCode(result.code),
        io,
        value: result.ok && result.value ? { kind: "space", space: result.value } : undefined,
      };
    }
    if (!payload.space) {
      return { ...base, ok: false, code: "PERMISSION_DENIED", io };
    }
    const result = putSpace(world, payload.space, on);
    return {
      ...base,
      ok: result.ok,
      code: mapAdapterCode(result.code),
      io,
      value: result.ok && result.value ? { kind: "space", space: result.value } : undefined,
    };
  }

  if (action === "spaces.members.list") {
    const spaceId = payload.spaceId;
    if (!spaceId) {
      return { ...base, ok: false, code: "PERMISSION_DENIED", io };
    }
    increment(io, "adapterReads");
    increment(io, "storeAccess");
    const visible = visibleSpacesForActor(world, actor).some((space) => space.spaceId === spaceId);
    const space = world.spaces.get(spaceId);
    if (!visible || !space) {
      return { ...base, ok: false, code: "PERMISSION_DENIED", io };
    }
    return {
      ...base,
      ok: true,
      code: "OK",
      io,
      value: { kind: "members", memberUserIds: [...space.memberUserIds] },
    };
  }

  if (action === "spaces.kbs.bind") {
    if (!payload.kb) {
      return { ...base, ok: false, code: "PERMISSION_DENIED", io };
    }
    increment(io, "adapterReads");
    increment(io, "storeAccess");
    const visible = visibleSpacesForActor(world, actor).some(
      (space) => space.spaceId === payload.kb!.spaceId,
    );
    if (!visible) {
      return { ...base, ok: false, code: "PERMISSION_DENIED", io };
    }
    const result = attachKnowledgeBase(world, payload.kb, on);
    return {
      ...base,
      ok: result.ok,
      code: mapAdapterCode(result.code),
      io,
      value: result.ok && result.value ? { kind: "kb", kb: result.value } : undefined,
    };
  }

  if (action === "favorites.add") {
    if (!payload.pointer) {
      return { ...base, ok: false, code: "INVALID_POINTER", io };
    }
    increment(io, "storeAccess");
    const result = addFavorite(world, actor, payload.pointer, on);
    return {
      ...base,
      ok: result.ok,
      code: mapAdapterCode(result.code),
      io,
      value: result.ok ? { kind: "favoriteAdded" } : undefined,
    };
  }

  if (action === "favorites.remove") {
    if (!payload.pointer) {
      return { ...base, ok: false, code: "INVALID_POINTER", io };
    }
    increment(io, "storeAccess");
    const result = deleteFavorite(world, actor, payload.pointer.assetId, on);
    return {
      ...base,
      ok: result.ok,
      code: mapAdapterCode(result.code),
      io,
      value: result.ok ? { kind: "favoriteRemoved" } : undefined,
    };
  }

  increment(io, "adapterReads");
  increment(io, "storeAccess");
  increment(io, "hydration");
  const result = resolveAuthorizedFavorites(world, actor, {
    enabled: true,
    includeUnavailable: payload.includeUnavailable,
  });
  return {
    ...base,
    ok: result.ok,
    code: mapAdapterCode(result.code),
    io,
    value: result.ok && result.value ? { kind: "favorites", views: result.value } : undefined,
  };
}

export { SPACE_FAVORITES_V7_ADAPTER_ENABLED_ENV };
