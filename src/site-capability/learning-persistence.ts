/**
 * R3 learning-asset persistence.
 *
 * Drafts, validation records, acceptances, and explore evidence leave pure
 * memory when a store root is configured. Process restart loads the same JSON
 * snapshot. Site capability contracts stay independent of skill packs: the
 * optional lifecycle bridge only mirrors private→approved discovery state.
 *
 * Honesty: fixture persistence is not verified enterprise/external-site or R5.
 */

import fs from "node:fs";
import path from "node:path";
import {
  getPersonalSkillAssetDetail,
  restoreSkillLifecycleState,
  saveSkillAsset,
  SkillAssetStoreError,
  type SkillLifecycleState,
} from "../gateway/skill-lifecycle-store.js";
import type { DraftAcceptance, PrivatePlanDraft, VerifiedSuccessEvidence } from "./draft-store.js";
import type { ValidationRecord } from "./validation-record.js";

export const LEARNING_PERSISTENCE_SCHEMA = 1 as const;

export type LearningPersistenceSnapshot = {
  schemaVersion: typeof LEARNING_PERSISTENCE_SCHEMA;
  drafts: PrivatePlanDraft[];
  evidence: VerifiedSuccessEvidence[];
  validations: ValidationRecord[];
  acceptances: DraftAcceptance[];
  /** draftId → skill-lifecycle-store skill id (discovery/lifecycle only). */
  lifecycleSkillIds: Record<string, string>;
};

export type SarSkillLifecycleBridge = {
  /** Ensure a private lifecycle entry exists for this SAR draft. No plan payload. */
  ensurePrivate(draft: PrivatePlanDraft): { skillId: string };
  /** Move the mirrored skill private → approved after human accept. */
  markApproved(skillId: string): { skillId: string; lifecycle: "approved" };
  /** Read current lifecycle for tests / diagnostics. */
  readLifecycle?(skillId: string): SkillLifecycleState | null;
};

const EMPTY: LearningPersistenceSnapshot = {
  schemaVersion: LEARNING_PERSISTENCE_SCHEMA,
  drafts: [],
  evidence: [],
  validations: [],
  acceptances: [],
  lifecycleSkillIds: {},
};

function snapshotPath(rootDir: string): string {
  return path.join(rootDir, "learning-assets.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Stable skill id for a SAR draft. Not a site capability id. */
export function sarLifecycleSkillId(draftId: string): string {
  const trimmed = draftId.trim();
  return `sar_lc_${trimmed}`;
}

export function emptyLearningSnapshot(): LearningPersistenceSnapshot {
  return {
    schemaVersion: LEARNING_PERSISTENCE_SCHEMA,
    drafts: [],
    evidence: [],
    validations: [],
    acceptances: [],
    lifecycleSkillIds: {},
  };
}

/**
 * Load a learning snapshot from disk. Missing file → empty.
 * Corrupt / wrong schema → empty (fail closed for restart recovery tests).
 */
export function loadLearningSnapshot(rootDir: string): LearningPersistenceSnapshot {
  const file = snapshotPath(rootDir);
  if (!fs.existsSync(file)) {
    return emptyLearningSnapshot();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    if (!isRecord(raw) || raw.schemaVersion !== LEARNING_PERSISTENCE_SCHEMA) {
      return emptyLearningSnapshot();
    }
    return {
      schemaVersion: LEARNING_PERSISTENCE_SCHEMA,
      drafts: Array.isArray(raw.drafts) ? (raw.drafts as PrivatePlanDraft[]) : [],
      evidence: Array.isArray(raw.evidence) ? (raw.evidence as VerifiedSuccessEvidence[]) : [],
      validations: Array.isArray(raw.validations) ? (raw.validations as ValidationRecord[]) : [],
      acceptances: Array.isArray(raw.acceptances) ? (raw.acceptances as DraftAcceptance[]) : [],
      lifecycleSkillIds: isRecord(raw.lifecycleSkillIds)
        ? Object.fromEntries(
            Object.entries(raw.lifecycleSkillIds).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {},
    };
  } catch {
    return emptyLearningSnapshot();
  }
}

/** Atomic JSON write under rootDir. */
export function saveLearningSnapshot(rootDir: string, snapshot: LearningPersistenceSnapshot): void {
  fs.mkdirSync(rootDir, { recursive: true });
  const file = snapshotPath(rootDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const body: LearningPersistenceSnapshot = {
    schemaVersion: LEARNING_PERSISTENCE_SCHEMA,
    drafts: snapshot.drafts,
    evidence: snapshot.evidence,
    validations: snapshot.validations,
    acceptances: snapshot.acceptances,
    lifecycleSkillIds: { ...snapshot.lifecycleSkillIds },
  };
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
}

/**
 * Default bridge into skill-lifecycle-store.
 * Reuses discovery/lifecycle only — does not embed SAR plans or site contracts.
 */
export function createSkillLifecycleBridge(): SarSkillLifecycleBridge {
  return {
    ensurePrivate(draft) {
      const skillId = sarLifecycleSkillId(draft.draftId);
      try {
        const detail = getPersonalSkillAssetDetail(skillId);
        if (detail.lifecycle === "draft") {
          restoreSkillLifecycleState(skillId, "private");
        }
        return { skillId };
      } catch (err) {
        if (!(err instanceof SkillAssetStoreError)) {
          throw err;
        }
      }
      saveSkillAsset({
        skillId,
        lifecycle: "private",
        autoInstallEnabled: false,
        ownerUserId: draft.userId,
        profile: {
          name: draft.capabilityId,
          summary: `SAR site-capability candidate ${draft.capabilityId}@${draft.version}`,
          assetType: "capability",
          visibility: "private",
          category: "site-capability",
          tags: ["sar-site-capability", draft.manifest.site, draft.manifest.operation],
          usageExamples: [],
          inputDescription: "See SiteCapabilityManifest / DraftStore (not skill runtime).",
          outputDescription: "See SiteRunResult evidence (not skill runtime).",
          avatar: "",
        },
        // Deliberately omit plan / manifest bytes — site contract stays independent.
        runtimeDefinition: {
          prompts: [],
          tools: [],
          capabilities: [],
          providers: [],
        },
      });
      return { skillId };
    },
    markApproved(skillId) {
      restoreSkillLifecycleState(skillId, "approved");
      return { skillId, lifecycle: "approved" };
    },
    readLifecycle(skillId) {
      try {
        return getPersonalSkillAssetDetail(skillId).lifecycle;
      } catch {
        return null;
      }
    },
  };
}

export type LearningAssetStore = {
  readonly rootDir: string;
  load(): LearningPersistenceSnapshot;
  save(snapshot: LearningPersistenceSnapshot): void;
};

export function createLearningAssetStore(rootDir: string): LearningAssetStore {
  const resolved = path.resolve(rootDir);
  return {
    rootDir: resolved,
    load: () => loadLearningSnapshot(resolved),
    save: (snapshot) => saveLearningSnapshot(resolved, snapshot),
  };
}

export { EMPTY as EMPTY_LEARNING_SNAPSHOT };
