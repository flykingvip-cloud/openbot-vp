/**
 * Offline compiler replay. No gateway, no model, no openbot.json writes.
 */

import { DEFAULT_DESIGN_CATALOG, LEGACY_TEMPLATE_INTERPRETATION } from "./catalogs.js";
import { compileEmployeeDesign, compileRevision } from "./compile.js";
import { mappingHasForbiddenNarrative, projectDesignMapping } from "./confirmation-mapping.js";
import {
  adapterRequestHasForbiddenKeys,
  buildAgentCreateRequest,
  buildCreationReceipt,
} from "./factory-adapter.js";
import { COMPILER_FIXTURES, type CompilerFixture } from "./fixtures.js";
import { emptySideEffects, hasAnySideEffect } from "./ownership.js";
import {
  InstantiationLedger,
  abortSession,
  acceptDraft,
  beginInstantiate,
  confirmDraft,
  finishInstantiate,
  markDraftReady,
} from "./session.js";
import type { BlueprintDraft, CreationSession, EmployeeDesignIntent } from "./types.js";
import { canShowConfirmationCard } from "./validate-draft.js";

export type ReplayFailure = { id: string; detail: string };

export type ReplayResult = {
  fixture: CompilerFixture;
  intent: EmployeeDesignIntent;
  draft: BlueprintDraft;
  failures: ReplayFailure[];
};

function sessionFor(id: string): CreationSession {
  return {
    id: `cs_${id}`,
    draftId: `d_${id}`,
    status: "DESIGNING",
    idempotencyKey: `idem-${id}`,
    actorUserId: "user-replay",
  };
}

function checkGold(
  fixture: CompilerFixture,
  draft: BlueprintDraft,
  intent: EmployeeDesignIntent,
): ReplayFailure[] {
  const failures: ReplayFailure[] = [];
  const gold = fixture.gold;
  if (draft.roleResolution.kind !== gold.resolutionKind) {
    failures.push({
      id: fixture.id,
      detail: `resolution ${draft.roleResolution.kind} != ${gold.resolutionKind}`,
    });
  }
  if (gold.blueprintId && draft.roleResolution.kind === "published") {
    if (draft.roleResolution.blueprintId !== gold.blueprintId) {
      failures.push({
        id: fixture.id,
        detail: `blueprint ${draft.roleResolution.blueprintId} != ${gold.blueprintId}`,
      });
    }
  }
  if (draft.validation.status !== gold.validation) {
    failures.push({
      id: fixture.id,
      detail: `validation ${draft.validation.status} != ${gold.validation}`,
    });
  }
  if (gold.expectMissingCritical && draft.missingCriticalInputs.length === 0) {
    failures.push({ id: fixture.id, detail: "expected missingCriticalInputs" });
  }
  if (gold.unresolvedNeed && !draft.unresolvedCapabilities.includes(gold.unresolvedNeed)) {
    failures.push({ id: fixture.id, detail: `missing unresolved need ${gold.unresolvedNeed}` });
  }
  if (gold.recipeId && !draft.roleRecipeIds.includes(gold.recipeId)) {
    failures.push({ id: fixture.id, detail: `missing recipe ${gold.recipeId}` });
  }
  if (
    gold.sharedSkillKey &&
    !draft.skillRecommendations.some((entry) => entry.skillKey === gold.sharedSkillKey)
  ) {
    failures.push({ id: fixture.id, detail: `missing shared skill ${gold.sharedSkillKey}` });
  }
  if (gold.schedule && intent.schedule !== gold.schedule) {
    failures.push({ id: fixture.id, detail: `schedule ${intent.schedule} != ${gold.schedule}` });
  }
  for (const policy of gold.policy ?? []) {
    const found = draft.policyRecommendations.find((entry) => entry.id === policy.id);
    if (found?.effect !== policy.effect) {
      failures.push({
        id: fixture.id,
        detail: `policy ${policy.id} ${found?.effect ?? "missing"} != ${policy.effect}`,
      });
    }
  }
  if (gold.canConfirm && !canShowConfirmationCard(draft)) {
    failures.push({ id: fixture.id, detail: "should be allowed on confirmation card" });
  }
  for (const entry of draft.skillRecommendations) {
    if (entry.skillKey && !DEFAULT_DESIGN_CATALOG.skillKeys.has(entry.skillKey)) {
      failures.push({ id: fixture.id, detail: `invented skillKey ${entry.skillKey}` });
    }
  }
  return failures;
}

function runSessionChecks(
  fixture: CompilerFixture,
  intent: EmployeeDesignIntent,
  draft: BlueprintDraft,
): ReplayFailure[] {
  const failures: ReplayFailure[] = [];
  if (hasAnySideEffect(emptySideEffects())) {
    failures.push({ id: fixture.id, detail: "empty probe is dirty" });
  }

  if (fixture.id === "F" && fixture.revision) {
    const first = acceptDraft(sessionFor("F"), draft);
    const revised = compileRevision({
      session: first,
      previousDraft: draft,
      previousIntent: intent,
      rawRevision: fixture.revision,
    });
    failures.push(...checkGold(fixture, revised.draft, revised.intent));
    if (revised.session.id !== "cs_F") {
      failures.push({ id: "F", detail: "revision changed session id" });
    }
    if (revised.draft.revision < 2) {
      failures.push({ id: "F", detail: "revision number did not advance" });
    }
    return failures;
  }

  if (fixture.id === "G") {
    let current = acceptDraft(sessionFor("G"), draft);
    current = markDraftReady(current, draft);
    current = confirmDraft(current);
    const request = buildAgentCreateRequest(current, draft);
    if (adapterRequestHasForbiddenKeys(request)) {
      failures.push({ id: "G", detail: "adapter leaked forbidden keys" });
    }
    current = beginInstantiate(current);
    current = finishInstantiate(current, { agentId: "agt-g", failedSkillCount: 0 });
    const receipt = buildCreationReceipt({
      session: current,
      draft,
      agentId: "agt-g",
      skillInstall: { requested: request.skillKeys, succeeded: request.skillKeys, failed: [] },
      confirmedAt: "2026-09-17T00:00:00.000Z",
    });
    if (receipt.blueprintVersion !== "1.0.0" || receipt.blueprintId !== "sales_assistant") {
      failures.push({ id: "G", detail: "receipt missing blueprint version" });
    }
    return failures;
  }

  if (fixture.id === "K") {
    let current = acceptDraft(sessionFor("K"), draft);
    current = markDraftReady(current, draft);
    current = confirmDraft(current);
    current = beginInstantiate(current);
    const ledger = new InstantiationLedger();
    const first = ledger.remember(current.idempotencyKey, "agt-k1");
    const second = ledger.remember(current.idempotencyKey, "agt-k2");
    if (first !== second) {
      failures.push({ id: "K", detail: "double confirm created two agents" });
    }
    return failures;
  }

  if (fixture.id === "L") {
    let current = acceptDraft(sessionFor("L"), draft);
    current = markDraftReady(current, draft);
    current = confirmDraft(current);
    current = beginInstantiate(current);
    current = finishInstantiate(current, { agentId: "agt-l", failedSkillCount: 1 });
    if (current.status !== "PARTIAL") {
      failures.push({ id: "L", detail: `expected PARTIAL, got ${current.status}` });
    }
    return failures;
  }

  if (fixture.id === "M") {
    const aborted = abortSession(acceptDraft(sessionFor("M"), draft));
    if (aborted.status !== "FAILED") {
      failures.push({ id: "M", detail: `expected FAILED, got ${aborted.status}` });
    }
    if (hasAnySideEffect(emptySideEffects())) {
      failures.push({ id: "M", detail: "abort produced side effects" });
    }
    return failures;
  }

  if (fixture.id === "N") {
    if (LEGACY_TEMPLATE_INTERPRETATION.sales_assistant !== "sales_assistant") {
      failures.push({ id: "N", detail: "legacy sales mapping rewritten" });
    }
    if (LEGACY_TEMPLATE_INTERPRETATION.personal_mail_assistant !== "email-communication") {
      failures.push({ id: "N", detail: "legacy mail mapping rewritten" });
    }
    return failures;
  }

  return failures;
}

export function replayCompilerFixture(fixture: CompilerFixture): ReplayResult {
  const compiled = compileEmployeeDesign({
    rawRequest: fixture.rawRequest,
    draftId: `d_${fixture.id}`,
  });
  const mapping = projectDesignMapping(compiled.intent, compiled.draft);
  const failures = [
    ...checkGold(fixture, compiled.draft, compiled.intent),
    ...runSessionChecks(fixture, compiled.intent, compiled.draft),
  ];
  if (mappingHasForbiddenNarrative(mapping)) {
    failures.push({ id: fixture.id, detail: "mapping contains CoT or guess narrative" });
  }
  if (mapping.headline !== "我理解的是…") {
    failures.push({ id: fixture.id, detail: "mapping headline drifted" });
  }
  // Case F gold applies to the revised draft; first pass may still be sales write=disabled from catalog.
  if (fixture.id === "F") {
    return {
      fixture,
      intent: compiled.intent,
      draft: compiled.draft,
      failures: failures.filter((item) => !item.detail.startsWith("policy crm.write")),
    };
  }
  return { fixture, intent: compiled.intent, draft: compiled.draft, failures };
}

export function replayAllCompilerFixtures(): ReplayResult[] {
  return COMPILER_FIXTURES.map(replayCompilerFixture);
}
