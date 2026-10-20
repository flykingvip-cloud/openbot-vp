/**
 * P2 learning loop: a non-empty complete success can become a private draft.
 * Business verification is a later record, not completeness.
 * A human accept enables site_invoke only from a promotable validation.
 * Repair never publishes, expands grants, or rewrites the plan.
 *
 * R3: optional disk persistence (storeRoot) and skill-lifecycle mirroring
 * (private→approved). Site contracts stay independent of skill packs.
 */

import { randomUUID } from "node:crypto";
import { decideAcceptance } from "./approval.js";
import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";
import {
  candidateRecord,
  DraftStore,
  parseDeclarativePlan,
  parseDraftManifest,
  type DraftAcceptance,
  type PrivatePlanDraft,
  type VerifiedSuccessEvidence,
} from "./draft-store.js";
import { proposeRepair, type RepairProposal } from "./failure-class.js";
import {
  createLearningAssetStore,
  createSkillLifecycleBridge,
  type LearningAssetStore,
  type LearningPersistenceSnapshot,
  type SarSkillLifecycleBridge,
} from "./learning-persistence.js";
import { isEmptyData, type SiteRunResult } from "./result.js";
import { parseInvokeArgs, type SiteCapabilityRuntime, type SiteInputField } from "./runtime.js";
import type { ServerPrincipal } from "./session-handle.js";
import {
  ThinValidationRunner,
  type IndependentReviewEvidence,
  type ValidationBasis,
  type ValidationRecord,
  type ValidationVerdict,
} from "./validation-record.js";

export type ExplorationInput = {
  principal: ServerPrincipal;
  accountBindingId: string;
  manifest: unknown;
  inputFields: readonly SiteInputField[];
  plan: unknown;
  args: unknown;
};

export type SiteLearningLoopOptions = {
  now?: () => number;
  mintDraftId?: () => string;
  mintRecordId?: () => string;
  /** When set, drafts/evidence/validations/acceptances are loaded and saved here. */
  storeRoot?: string;
  /** Optional injectable store (tests). Overrides storeRoot when both set. */
  assetStore?: LearningAssetStore;
  /**
   * Mirror private→approved into skill-lifecycle-store (discovery only).
   * Pass `null` to disable. Default: enabled when persistence is on.
   */
  lifecycleBridge?: SarSkillLifecycleBridge | null;
};

/**
 * Operational evidence for a private draft.
 * `verification: passed` is not inferred here. A verifier rejection blocks the draft.
 */
function isOperationalDraftEvidence(result: SiteRunResult): boolean {
  return (
    result.status === "succeeded" &&
    result.verification !== "failed" &&
    result.completeness === "complete" &&
    result.repair === "none" &&
    !result.error &&
    !isEmptyData(result.data)
  );
}

export class SiteLearningLoop {
  private readonly drafts = new DraftStore();
  private readonly evidence = new Map<string, VerifiedSuccessEvidence>();
  private readonly acceptances = new Map<string, DraftAcceptance>();
  private readonly lifecycleSkillIds = new Map<string, string>();
  private readonly validation: ThinValidationRunner;
  private readonly assetStore: LearningAssetStore | null;
  private readonly lifecycleBridge: SarSkillLifecycleBridge | null;

  constructor(
    private readonly runtime: SiteCapabilityRuntime,
    private readonly options: SiteLearningLoopOptions = {},
  ) {
    this.validation = new ThinValidationRunner(
      options.mintRecordId ?? (() => `val_${randomUUID()}`),
    );
    this.assetStore =
      options.assetStore ??
      (options.storeRoot ? createLearningAssetStore(options.storeRoot) : null);
    if (options.lifecycleBridge === null) {
      this.lifecycleBridge = null;
    } else if (options.lifecycleBridge) {
      this.lifecycleBridge = options.lifecycleBridge;
    } else if (this.assetStore) {
      this.lifecycleBridge = createSkillLifecycleBridge();
    } else {
      this.lifecycleBridge = null;
    }
    if (this.assetStore) {
      this.hydrateFromStore(this.assetStore.load());
    }
  }

  readDraft(draftId: string): PrivatePlanDraft | undefined {
    return this.drafts.get(draftId);
  }

  readAcceptance(draftId: string): DraftAcceptance | undefined {
    const found = this.acceptances.get(draftId);
    return found ? { ...found } : undefined;
  }

  readValidation(recordId: string): ValidationRecord | undefined {
    return this.validation.get(recordId);
  }

  readEvidence(evidenceRef: string): VerifiedSuccessEvidence | undefined {
    const found = this.evidence.get(evidenceRef);
    return found ? { ...found, args: { ...found.args }, plan: [...found.plan] } : undefined;
  }

  readLifecycleSkillId(draftId: string): string | undefined {
    return this.lifecycleSkillIds.get(draftId);
  }

  draftCount(): number {
    return this.drafts.list().length;
  }

  async explore(
    input: ExplorationInput,
  ): Promise<
    | { ok: true; evidence: VerifiedSuccessEvidence; result: SiteRunResult }
    | { ok: false; code: string; message: string; result?: SiteRunResult }
  > {
    const manifest = parseDraftManifest(input.manifest);
    if (!manifest.ok) {
      return manifest;
    }
    const plan = parseDeclarativePlan(input.plan);
    if (!plan.ok) {
      return plan;
    }
    const bindingId = input.accountBindingId.trim();
    if (!bindingId) {
      return sarDeny(SAR_DENIAL_CODE.bindingNotFound, "accountBindingId is required");
    }
    const packageId = `private:${manifest.manifest.id}`;
    const record = candidateRecord({
      manifest: manifest.manifest,
      inputFields: input.inputFields,
      plan: plan.plan,
      packageId,
    });
    const parsedArgs = parseInvokeArgs(record, input.args);
    if (!parsedArgs.ok) {
      return parsedArgs;
    }
    const result = await this.runtime.runCandidate(input.principal, {
      record,
      args: parsedArgs.args,
      accountBindingId: bindingId,
    });
    if (!isOperationalDraftEvidence(result)) {
      const empty = result.status === "succeeded" && isEmptyData(result.data);
      return {
        ok: false,
        code: empty ? "EMPTY_SUCCESS" : (result.error?.code ?? "NOT_VERIFIABLE"),
        message: empty
          ? "empty success is not verifiable draft evidence"
          : (result.error?.message ?? "exploration did not produce verifiable success evidence"),
        result,
      };
    }
    const evidence: VerifiedSuccessEvidence = {
      evidenceRef: result.evidenceRef,
      runId: result.runId,
      capabilityId: manifest.manifest.id,
      version: manifest.manifest.version,
      artifactDigest: record.artifactDigest,
      args: parsedArgs.args,
      plan: plan.plan,
      manifest: manifest.manifest,
      inputFields: input.inputFields,
      accountBindingId: bindingId,
      tenantId: input.principal.tenantId,
      userId: input.principal.userId,
      packageId,
      output: result.data,
      completeness: "complete",
      status: "succeeded",
      verification: result.verification,
    };
    this.evidence.set(evidence.evidenceRef, evidence);
    this.persist();
    return { ok: true, evidence, result };
  }

  draftFromEvidence(evidenceRef: string): { ok: true; draft: PrivatePlanDraft } | SarDenial {
    const evidence = this.evidence.get(evidenceRef);
    if (!evidence) {
      return sarDeny(
        SAR_DENIAL_CODE.policyDenied,
        "verifiable non-empty success evidence is required",
      );
    }
    const draft: PrivatePlanDraft = {
      draftId: this.mintDraftId(),
      capabilityId: evidence.capabilityId,
      version: evidence.version,
      lifecycle: "private",
      enabled: false,
      published: false,
      manifest: evidence.manifest,
      plan: evidence.plan,
      inputFields: evidence.inputFields,
      artifactDigest: evidence.artifactDigest,
      sourceEvidenceRef: evidence.evidenceRef,
      generationParams: { ...evidence.args },
      accountBindingIds: [evidence.accountBindingId],
      tenantId: evidence.tenantId,
      userId: evidence.userId,
      packageId: evidence.packageId,
      createdAt: this.nowIso(),
    };
    this.drafts.put(draft);
    this.mirrorPrivateLifecycle(draft);
    this.persist();
    return { ok: true, draft: this.drafts.get(draft.draftId) ?? draft };
  }

  async validate(input: {
    draftId: string;
    principal: ServerPrincipal;
    args: unknown;
    reviewer: string;
    basis: ValidationBasis;
    humanVerdict?: ValidationVerdict;
    humanReason?: string;
    independentReviewEvidence?: IndependentReviewEvidence;
  }): Promise<{ ok: true; record: ValidationRecord } | SarDenial> {
    const draft = this.drafts.get(input.draftId);
    if (!draft) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, "draft was not found");
    }
    if (draft.tenantId !== input.principal.tenantId || draft.userId !== input.principal.userId) {
      return sarDeny(SAR_DENIAL_CODE.crossAccount, "validation cannot switch accounts");
    }
    const bindingId = draft.accountBindingIds[0];
    if (!bindingId) {
      return sarDeny(SAR_DENIAL_CODE.bindingNotFound, "draft has no account binding");
    }
    const record = candidateRecord({
      manifest: draft.manifest,
      inputFields: draft.inputFields,
      plan: draft.plan,
      packageId: draft.packageId,
    });
    const parsedArgs = parseInvokeArgs(record, input.args);
    if (!parsedArgs.ok) {
      return parsedArgs;
    }
    const run = await this.runtime.runCandidate(input.principal, {
      record,
      args: parsedArgs.args,
      accountBindingId: bindingId,
    });
    const evidence = this.runtime.readEvidence(run.evidenceRef);
    if (!evidence || evidence.artifactDigest !== draft.artifactDigest) {
      return sarDeny(
        SAR_DENIAL_CODE.policyDenied,
        "validation requires evidence linked to this artifact",
      );
    }
    const assessed = this.validation.assess({
      capabilityId: draft.capabilityId,
      version: draft.version,
      artifactDigest: draft.artifactDigest,
      args: parsedArgs.args,
      generationParams: draft.generationParams,
      run,
      evidence,
      reviewer: input.reviewer,
      reviewedAt: this.nowIso(),
      basis: input.basis,
      humanVerdict: input.humanVerdict,
      humanReason: input.humanReason,
      independentReviewEvidence: input.independentReviewEvidence,
    });
    if (!assessed.ok) {
      return assessed;
    }
    const stored = this.drafts.get(input.draftId);
    if (!stored || stored.lifecycle !== draft.lifecycle || stored.enabled !== draft.enabled) {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "validation must not enable the candidate");
    }
    this.persist();
    return assessed;
  }

  accept(input: {
    draftId: string;
    validationRecordId: string;
    reviewer: string;
  }): { ok: true; acceptance: DraftAcceptance } | SarDenial {
    const existing = this.acceptances.get(input.draftId);
    if (existing) {
      return { ok: true, acceptance: { ...existing } };
    }
    const draft = this.drafts.get(input.draftId);
    if (!draft || draft.enabled || draft.lifecycle !== "private") {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "only a private candidate can be accepted");
    }
    const validation = this.validation.get(input.validationRecordId);
    if (!validation) {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "human acceptance requires a validation record");
    }
    const decided = decideAcceptance({
      draft,
      validation,
      reviewer: input.reviewer,
      acceptedAt: this.nowIso(),
    });
    if (!decided.ok) {
      return decided;
    }
    const registered = this.runtime.register(decided.record);
    if (!registered.ok) {
      return registered;
    }
    const granted = this.runtime.grant({
      tenantId: draft.tenantId,
      userId: draft.userId,
      capabilityId: draft.capabilityId,
      version: draft.version,
      artifactDigest: draft.artifactDigest,
      accountBindingIds: [...draft.accountBindingIds],
    });
    if (!granted.ok) {
      return granted;
    }
    const marked = this.drafts.markApproved(draft.draftId);
    if (!marked.ok) {
      return marked;
    }
    this.acceptances.set(draft.draftId, decided.acceptance);
    this.mirrorApprovedLifecycle(draft.draftId);
    this.persist();
    return { ok: true, acceptance: { ...decided.acceptance } };
  }

  /**
   * Failure hook. Stores a private candidate when the class allows one.
   * Never grants, never publishes, never changes the source plan.
   */
  repair(input: {
    result?: SiteRunResult;
    validationRecordId?: string;
    sourceDraftId?: string;
    accountBindingId?: string;
  }): RepairProposal {
    const validation = input.validationRecordId
      ? this.validation.get(input.validationRecordId)
      : undefined;
    const source = input.sourceDraftId ? this.drafts.get(input.sourceDraftId) : undefined;
    const proposal = proposeRepair({
      result: input.result,
      validationFailed: validation?.verdict === "failed",
      sourceDraft: source,
      accountBindingId: input.accountBindingId,
      now: this.nowIso(),
      mintDraftId: () => this.mintDraftId(),
    });
    if (proposal.candidate) {
      this.drafts.put(proposal.candidate);
      this.mirrorPrivateLifecycle(proposal.candidate);
      this.persist();
    }
    return proposal;
  }

  private hydrateFromStore(snapshot: LearningPersistenceSnapshot): void {
    for (const draft of snapshot.drafts) {
      this.drafts.put(draft);
    }
    for (const item of snapshot.evidence) {
      this.evidence.set(item.evidenceRef, item);
    }
    this.validation.hydrate(snapshot.validations);
    for (const acceptance of snapshot.acceptances) {
      this.acceptances.set(acceptance.draftId, acceptance);
    }
    for (const [draftId, skillId] of Object.entries(snapshot.lifecycleSkillIds)) {
      this.lifecycleSkillIds.set(draftId, skillId);
    }
  }

  private persist(): void {
    if (!this.assetStore) {
      return;
    }
    const snapshot: LearningPersistenceSnapshot = {
      schemaVersion: 1,
      drafts: this.drafts.list(),
      evidence: [...this.evidence.values()],
      validations: this.validation.list(),
      acceptances: [...this.acceptances.values()],
      lifecycleSkillIds: Object.fromEntries(this.lifecycleSkillIds),
    };
    this.assetStore.save(snapshot);
  }

  private mirrorPrivateLifecycle(draft: PrivatePlanDraft): void {
    if (!this.lifecycleBridge) {
      return;
    }
    const { skillId } = this.lifecycleBridge.ensurePrivate(draft);
    this.lifecycleSkillIds.set(draft.draftId, skillId);
  }

  private mirrorApprovedLifecycle(draftId: string): void {
    if (!this.lifecycleBridge) {
      return;
    }
    let skillId = this.lifecycleSkillIds.get(draftId);
    if (!skillId) {
      const draft = this.drafts.get(draftId);
      if (!draft) {
        return;
      }
      skillId = this.lifecycleBridge.ensurePrivate(draft).skillId;
      this.lifecycleSkillIds.set(draftId, skillId);
    }
    this.lifecycleBridge.markApproved(skillId);
  }

  private nowIso(): string {
    return new Date(this.options.now?.() ?? Date.now()).toISOString();
  }

  private mintDraftId(): string {
    return this.options.mintDraftId?.() ?? `draft_${randomUUID()}`;
  }
}
