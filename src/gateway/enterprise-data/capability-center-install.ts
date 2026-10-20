/**
 * Capability-center view of a SAR-linked skill.
 *
 * Install, account authorization, maturity, and verification stay separate.
 * The execution gate uses the validation record and the pinned version/digest.
 * Writes are not projected. In-flight P4 side effects are not reported as withdrawn.
 */

import type { SiteRunResult } from "../../site-capability/result.js";
import {
  validationBlocksVerifiedCallable,
  type ValidationRecord,
} from "../../site-capability/validation-record.js";
import type { SarWriteEffect } from "../../site-capability/write-effect.js";
import { priorWriteMayBeReplayed } from "../../site-capability/write-recheck-store.js";
import { EXECUTABLE_LIFECYCLES } from "../skill-execution-binding/types.js";
import type { SkillExecutionBindingRecord } from "../skill-execution-binding/types.js";
import type { SkillLifecycleState, SkillVisibility } from "../skill-lifecycle-store.js";
import { findDataSource } from "./data-source-store.js";
import { listSarExecutionBridges } from "./sar-governance-bridge.js";
import type { AccountBinding, EnterpriseDataStore, EnterpriseSarExecutionBridge } from "./types.js";

export type CapabilityCenterAccountRequirement = "待配置" | "已绑定";

export type CapabilityCenterVerification = "unverified" | "passed" | "failed" | "stale" | "unknown";

export type CapabilityCenterInstallFacts = {
  skillId: string;
  websites: Array<{
    sourceId: string;
    displayName: string;
    capabilityId: string;
    version: string;
    effect: "read" | SarWriteEffect;
  }>;
  accountRequirement: CapabilityCenterAccountRequirement;
  /** Set only when this caller owns the binding. Other users' ids are omitted. */
  bindingId: string | null;
  /** Version the next run would use. Null until a SAR pin exists. */
  executionVersion: string | null;
  executionDigest: string | null;
  /** Catalog head. Display only. Never copied onto the pin. */
  catalogVersion: string | null;
  /** ValidationRecord.reviewedAt for the pinned artifact. Never invented. */
  reviewedAt: string | null;
  /** From the validation record. Unknown when no record matches the pin. */
  verification: CapabilityCenterVerification;
  /** Bridge flag. Display only. It does not satisfy the execution gate. */
  bridgeVerification: EnterpriseSarExecutionBridge["verification"] | "unknown";
  maturityLabel: string | null;
  effects: Array<"read" | SarWriteEffect>;
  dependencies: string[];
  executable: boolean;
  denialCode: string | null;
  denialMessage: string | null;
  inFlightSideEffectsWithdrawn: false;
  entersKnowledgeProjection: false;
  inFlight: {
    runId: string;
    status: SiteRunResult["status"];
    priorWriteMayBeReplayed: boolean;
    sideEffectsWithdrawn: false;
  } | null;
};

export type CapabilityCenterInstallInput = {
  store: EnterpriseDataStore;
  tenantId: string;
  callerUserId: string | null;
  skill: {
    skillId: string;
    lifecycle: SkillLifecycleState;
    visibility: SkillVisibility;
    dependencies: readonly string[];
    maturityLabel?: string | null;
  };
  pin: Pick<
    SkillExecutionBindingRecord,
    "skillId" | "installedVersion" | "enabled" | "artifactDigest"
  > | null;
  /** Explicit skill grant. Install alone is not this flag. Revoke sets it false. */
  skillAuthorized: boolean;
  validationRecords: readonly ValidationRecord[];
  catalog?: { version: string; artifactDigest?: string } | null;
  linkedWriteEffects?: ReadonlyArray<{
    capabilityId: string;
    version: string;
    effect: SarWriteEffect;
  }>;
  inFlightRun?: SiteRunResult | null;
};

const WRITE_EFFECTS = new Set<SarWriteEffect>(["create", "update"]);

function skillBridges(
  store: EnterpriseDataStore,
  tenantId: string,
  skillId: string,
): EnterpriseSarExecutionBridge[] {
  const normalized = skillId.trim();
  if (!normalized) {
    return [];
  }
  return listSarExecutionBridges({ store, tenantId }).filter(
    (bridge) => bridge.skillId === normalized && bridge.tenantId === tenantId,
  );
}

function ownedBinding(
  store: EnterpriseDataStore,
  tenantId: string,
  userId: string | null,
  bindingId: string,
): AccountBinding | null {
  const caller = userId?.trim() ?? "";
  if (!caller || !bindingId.trim()) {
    return null;
  }
  const binding = store.accountBindings?.[bindingId];
  if (!binding) {
    return null;
  }
  if (
    binding.bindingId !== bindingId ||
    binding.tenantId !== tenantId ||
    binding.userId !== caller
  ) {
    return null;
  }
  return { bindingId: binding.bindingId, tenantId: binding.tenantId, userId: binding.userId };
}

function matchingRecord(
  records: readonly ValidationRecord[],
  capabilityId: string,
  version: string,
  artifactDigest: string,
): ValidationRecord | null {
  return (
    records.find(
      (record) =>
        record.capabilityId === capabilityId &&
        record.version === version &&
        record.artifactDigest === artifactDigest,
    ) ?? null
  );
}

function verificationFromRecord(record: ValidationRecord | null): CapabilityCenterVerification {
  if (!record) {
    return "unknown";
  }
  if (validationBlocksVerifiedCallable(record)) {
    return record.verdict === "failed" ? "failed" : "unverified";
  }
  return record.verdict === "passed" ? "passed" : "failed";
}

/**
 * Registry drafts are not the enterprise public catalog.
 * Review-queue items stay on their own list.
 */
export function hideRegistryDraftFromPublicCatalog(lifecycle: string): boolean {
  return lifecycle === "submitted" || lifecycle === "draft";
}

export function projectCapabilityCenterInstall(
  input: CapabilityCenterInstallInput,
): CapabilityCenterInstallFacts {
  const skillId = input.skill.skillId.trim();
  const bridges = skillBridges(input.store, input.tenantId, skillId);
  const pinDigest = input.pin?.artifactDigest?.trim() ?? "";
  const pinVersion = input.pin?.installedVersion?.trim() ?? "";
  const pinReady = Boolean(input.pin && input.pin.skillId === skillId && pinDigest && pinVersion);
  const caller = input.callerUserId?.trim() || null;
  const owned = bridges
    .map((bridge) => ({
      bridge,
      binding: ownedBinding(input.store, input.tenantId, caller, bridge.bindingId),
    }))
    .filter((entry) => entry.binding);
  const pinnedBridge = pinReady
    ? (bridges.find(
        (bridge) => bridge.version === pinVersion && bridge.artifactDigest === pinDigest,
      ) ?? null)
    : null;
  const accountBridge = pinnedBridge ?? bridges[0] ?? null;
  const accountOwned = accountBridge
    ? ownedBinding(input.store, input.tenantId, caller, accountBridge.bindingId)
    : null;
  const privateBridge =
    accountBridge !== null &&
    caller !== null &&
    accountBridge.userId.trim() !== "" &&
    accountBridge.userId !== caller;
  const record =
    pinReady && accountBridge
      ? matchingRecord(
          input.validationRecords,
          (pinnedBridge ?? accountBridge).capabilityId,
          pinVersion,
          pinDigest,
        )
      : null;
  const dependencyIds = new Set(
    input.skill.dependencies.map((entry) => entry.trim()).filter(Boolean),
  );
  const writeEffects = (input.linkedWriteEffects ?? []).filter(
    (effect) => WRITE_EFFECTS.has(effect.effect) && dependencyIds.has(effect.capabilityId),
  );
  const effects = new Set<"read" | SarWriteEffect>();
  if (bridges.some((bridge) => bridge.effect === "read")) {
    effects.add("read");
  }
  for (const effect of writeEffects) {
    effects.add(effect.effect);
  }
  const websites = bridges.map((bridge) => {
    const source = findDataSource(input.store, input.tenantId, bridge.sourceId);
    return {
      sourceId: bridge.sourceId,
      displayName: source?.displayName?.trim() || bridge.sourceId,
      capabilityId: bridge.capabilityId,
      version: bridge.version,
      effect: bridge.effect,
    };
  });
  const inFlight = input.inFlightRun
    ? {
        runId: input.inFlightRun.runId,
        status: input.inFlightRun.status,
        priorWriteMayBeReplayed: priorWriteMayBeReplayed(input.inFlightRun),
        sideEffectsWithdrawn: false as const,
      }
    : null;

  const facts: CapabilityCenterInstallFacts = {
    skillId,
    websites,
    accountRequirement: accountOwned ? "已绑定" : "待配置",
    bindingId: accountOwned?.bindingId ?? null,
    executionVersion: pinReady ? pinVersion : null,
    executionDigest: pinReady ? pinDigest : null,
    catalogVersion: input.catalog?.version?.trim() || null,
    reviewedAt: record?.reviewedAt ?? null,
    verification: verificationFromRecord(record),
    bridgeVerification: accountBridge?.verification ?? "unknown",
    maturityLabel: input.skill.maturityLabel?.trim() || null,
    effects: [...effects],
    dependencies: [...dependencyIds],
    executable: false,
    denialCode: null,
    denialMessage: null,
    inFlightSideEffectsWithdrawn: false,
    entersKnowledgeProjection: false,
    inFlight,
  };

  const skillReady =
    pinReady &&
    input.pin?.enabled === true &&
    input.skillAuthorized &&
    EXECUTABLE_LIFECYCLES.has(input.skill.lifecycle) &&
    input.skill.lifecycle !== "draft";

  if (!skillReady) {
    facts.denialCode = "POLICY_DENIED";
    if (pinReady && input.pin?.enabled === false) {
      facts.denialMessage = "技能已停用，新的执行被阻止。在途副作用没有撤回。";
    } else if (
      !input.skillAuthorized ||
      input.skill.lifecycle === "rejected" ||
      input.skill.lifecycle === "retired"
    ) {
      facts.denialMessage = "技能授权不存在或已撤销，新的执行被阻止。在途副作用没有撤回。";
    } else {
      facts.denialMessage = "技能未授权，不能执行。";
    }
    return facts;
  }
  if (!accountBridge) {
    facts.denialCode = "SAR_BINDING_MISSING";
    facts.denialMessage = "账户待配置，安装并没有完成账户授权。";
    return facts;
  }
  if (privateBridge && !accountOwned) {
    facts.denialCode = "SAR_BINDING_PRIVATE";
    facts.denialMessage = "私人账户不因企业管理员身份共享。";
    facts.bindingId = null;
    facts.accountRequirement = "待配置";
    return facts;
  }
  if (!accountOwned) {
    facts.denialCode = "SAR_BINDING_MISSING";
    facts.denialMessage = "账户待配置，安装并没有完成账户授权。";
    return facts;
  }
  if (owned.length > 1 && !pinnedBridge) {
    facts.denialCode = "SOURCE_ACCOUNT_AMBIGUOUS";
    facts.denialMessage = "多个账户绑定同时匹配，不能选其中一条执行。";
    return facts;
  }
  const bridge = pinnedBridge ?? accountBridge;
  if (bridge.effect !== "read") {
    facts.denialCode = "SAR_WRITE_FORBIDDEN";
    facts.denialMessage = "写操作不进入数据投影，也不表示在途副作用已经撤回。";
    return facts;
  }
  if (
    !pinnedBridge ||
    bridge.verification !== "passed" ||
    bridge.version !== pinVersion ||
    bridge.artifactDigest !== pinDigest
  ) {
    facts.denialCode = "SAR_VERIFICATION_MISSING";
    facts.denialMessage = "执行版本与已验证制品不一致，目录升级不能替换钉死的版本。";
    return facts;
  }
  if (!record || record.verdict !== "passed" || validationBlocksVerifiedCallable(record)) {
    facts.denialCode = "SAR_VERIFICATION_MISSING";
    facts.denialMessage = "没有通过的验证记录。成熟度和桥上的标记都不能代替验证。";
    return facts;
  }
  if (record.version !== pinVersion || record.artifactDigest !== pinDigest) {
    facts.denialCode = "SAR_VERIFICATION_MISSING";
    facts.denialMessage = "验证记录与钉死的版本或摘要不一致。";
    return facts;
  }
  facts.executable = true;
  facts.executionVersion = pinVersion;
  facts.executionDigest = pinDigest;
  return facts;
}

/**
 * Installing a skill does not create or copy an AccountBinding.
 * The returned id list is the store's list, unchanged.
 */
export function installLeavesAccountBindingsUntouched(store: EnterpriseDataStore): {
  createdAccountBinding: false;
  bindingIds: string[];
} {
  return {
    createdAccountBinding: false,
    bindingIds: Object.keys(store.accountBindings ?? {}).toSorted(),
  };
}
