import { isTenantCapabilityPackId } from "./catalogs.js";
import { adapterRequestHasForbiddenKeys } from "./factory-adapter.js";
import { hasAnySideEffect, type SideEffectProbe } from "./ownership.js";
import { canCallFactory } from "./session.js";
import {
  DRAFT_FORBIDDEN_FIELDS,
  type AgentCreateRequest,
  type BlueprintDraft,
  type CreationReceipt,
  type CreationSession,
} from "./types.js";

export type DecInvariantId =
  | "DEC-I1"
  | "DEC-I2"
  | "DEC-I3"
  | "DEC-I4"
  | "DEC-I5"
  | "DEC-I6"
  | "DEC-I7"
  | "DEC-I8"
  | "DEC-I9"
  | "DEC-I10"
  | "DEC-I11"
  | "DEC-I12"
  | "DEC-I13"
  | "DEC-I14"
  | "DEC-I15"
  | "DEC-I16"
  | "DEC-I17"
  | "DEC-I18";

export type InvariantViolation = { id: DecInvariantId; message: string };

function fail(id: DecInvariantId, message: string): never {
  throw new Error(`${id}: ${message}`);
}

export function assertNoSecondEmployeeId(value: unknown): void {
  const record = value as Record<string, unknown>;
  if (
    record &&
    typeof record === "object" &&
    "digitalEmployeeId" in record &&
    record.digitalEmployeeId
  ) {
    fail("DEC-I1", "digitalEmployeeId is not a runtime identity");
  }
}

export function assertFactoryClosedUntilConfirmed(session: CreationSession): void {
  if (
    session.status !== "CONFIRMED" &&
    session.status !== "INSTANTIATING" &&
    canCallFactory(session)
  ) {
    fail("DEC-I2", "factory entry leaked");
  }
  if (session.status !== "CONFIRMED" && session.status !== "INSTANTIATING") {
    if (canCallFactory(session)) {
      fail("DEC-I2", "unconfirmed session may not call factory");
    }
  }
}

export function assertZeroSideEffectsOnAbort(probe: SideEffectProbe): void {
  if (hasAnySideEffect(probe)) {
    fail("DEC-I3", "designer abort produced side effects");
  }
}

export function assertAdapterSkillOnly(request: AgentCreateRequest): void {
  if (adapterRequestHasForbiddenKeys(request)) {
    fail("DEC-I4", "adapter request contains auth/account/task fields");
  }
}

export function assertRecipesReferenceExistingSkills(
  draft: BlueprintDraft,
  knownSkillKeys: ReadonlySet<string>,
): void {
  for (const entry of draft.skillRecommendations) {
    if (entry.status === "resolved" && entry.skillKey && !knownSkillKeys.has(entry.skillKey)) {
      fail("DEC-I5", `resolved skill not in registry: ${entry.skillKey}`);
    }
  }
}

export function assertRecipeNotTenantPack(recipeId: string): void {
  if (isTenantCapabilityPackId(recipeId)) {
    fail("DEC-I6", `recipe id collides with tenant capability pack: ${recipeId}`);
  }
}

export function assertNoTaskCronLedgerOnDraft(draft: BlueprintDraft): void {
  const record = draft as unknown as Record<string, unknown>;
  for (const field of ["conversationTaskId", "cronId", "ledgerEventId", "missionId"] as const) {
    if (field in record && record[field] != null) {
      fail("DEC-I7", `draft carries ${field}`);
    }
  }
}

export function assertNoEnterpriseData(draft: BlueprintDraft): void {
  if (/\b(sk-|ghp_|Bearer\s)\b/.test(JSON.stringify(draft))) {
    fail("DEC-I8", "draft contains enterprise secret material");
  }
}

export function assertGrowthTemplateUntouched(growthTemplateId: string, replaced: boolean): void {
  if (replaced) {
    fail("DEC-I9", `growth template ${growthTemplateId} must not be replaced by blueprint`);
  }
}

export function assertReceiptNotRuntimeSource(
  agent: { agentId: string; allowed: boolean },
  receipt: CreationReceipt | null,
): void {
  const allowedWithoutReceipt = agent.allowed;
  if (!receipt && !allowedWithoutReceipt) {
    fail("DEC-I10", "agent authorization must not depend on receipt presence");
  }
}

export function assertIncompleteDraftHonest(draft: BlueprintDraft): void {
  const inventedWrite = draft.policyRecommendations.some(
    (entry) =>
      entry.id.includes("write") && entry.risk === "high" && entry.effect === "recommended",
  );
  if (inventedWrite && draft.missingCriticalInputs.length === 0) {
    fail("DEC-I11", "incomplete role invented a high-risk write grant");
  }
}

export function assertInferenceNotResolution(draft: BlueprintDraft): void {
  if (draft.roleResolution.kind === "published") {
    if (
      draft.roleHypothesis.role === draft.roleResolution.blueprintId &&
      !draft.roleResolution.blueprintId
    ) {
      fail("DEC-I12", "resolution missing while hypothesis copied");
    }
    return;
  }
  if ("blueprintId" in draft.roleResolution) {
    fail("DEC-I12", "custom resolution must not carry published blueprintId");
  }
}

export function assertNoInventedSkillKey(draft: BlueprintDraft, known: ReadonlySet<string>): void {
  for (const entry of draft.skillRecommendations) {
    if (entry.skillKey && !known.has(entry.skillKey)) {
      fail("DEC-I13", `invented skillKey: ${entry.skillKey}`);
    }
    if (entry.status === "resolved" && !entry.skillKey) {
      fail("DEC-I13", "resolved recommendation missing skillKey");
    }
  }
}

export function assertIdempotentInstantiate(firstAgentId: string, secondAgentId: string): void {
  if (firstAgentId !== secondAgentId) {
    fail("DEC-I14", "idempotency key created two agents");
  }
}

export function assertDesignerAbortClean(probe: SideEffectProbe): void {
  assertZeroSideEffectsOnAbort(probe);
}

export function assertConfirmationGate(draft: BlueprintDraft, enteringReady: boolean): void {
  if (enteringReady && draft.validation.status === "invalid") {
    fail("DEC-I16", "invalid draft entered confirmation");
  }
}

export function assertPartialNotSuccess(session: CreationSession, failedSkillCount: number): void {
  if (failedSkillCount > 0 && session.status !== "PARTIAL") {
    fail("DEC-I17", "partial skill install reported as full success");
  }
}

export function assertDraftHasNoAgentId(draft: BlueprintDraft): void {
  const record = draft as unknown as Record<string, unknown>;
  if ("agentId" in record && record.agentId) {
    fail("DEC-I18", "draft pre-assigned agentId");
  }
  for (const field of DRAFT_FORBIDDEN_FIELDS) {
    if (field === "agentId" && field in record && record[field]) {
      fail("DEC-I18", "draft pre-assigned agentId");
    }
  }
}
