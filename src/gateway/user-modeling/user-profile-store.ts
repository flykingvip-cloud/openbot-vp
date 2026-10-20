import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveDataRoot } from "../../config/data-space.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import {
  countRecurringDirectiveFriction,
  deriveUserProfileDelta,
  evaluateUserProfileEffect,
  type UserInteractionSignals,
} from "./derive.js";
import { renderUserProfileInstructions, type UserProfileRenderOptions } from "./render.js";
import {
  applyUserProfileDelta,
  DEFAULT_USER_PROFILE,
  sameUserProfileDelta,
  type UserProfile,
  type UserProfileChangeRecord,
  type UserProfileSuppression,
} from "./types.js";
import { hashUserKey, type UserModelingKey } from "./user-key.js";

export const USER_PROFILE_FILENAME = "user-profile.json";
export const USER_PROFILE_CHANGE_FILENAME = "user-profile-change.json";
export const USER_PROFILE_SUPPRESSION_FILENAME = "user-profile-suppression.json";

export type UserModelingPathOpts = { userModelingDir?: string };

function resolveTenantUserModelingRoot(cfg: OpenBotConfig, tenantId: string): string {
  return path.join(resolveDataRoot(cfg), "tenants", tenantId.trim(), "live", "user-modeling");
}

export function resolveUserModelingDir(
  cfg: OpenBotConfig,
  userKeyHash: string,
  opts?: UserModelingPathOpts & { tenantId?: string | null },
): string {
  if (opts?.userModelingDir) {
    return path.join(opts.userModelingDir, userKeyHash);
  }
  const hash = userKeyHash.trim();
  const tenantId = opts?.tenantId?.trim();
  const base = tenantId
    ? resolveTenantUserModelingRoot(cfg, tenantId)
    : path.join(resolveDataRoot(cfg), "user-modeling");
  return path.join(base, hash);
}

function resolveUserProfilePath(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  opts?: UserModelingPathOpts,
): string {
  return path.join(
    resolveUserModelingDir(cfg, hashUserKey(key), { ...opts, tenantId: key.tenantId }),
    USER_PROFILE_FILENAME,
  );
}

function resolveUserProfileChangePath(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  opts?: UserModelingPathOpts,
): string {
  return path.join(
    resolveUserModelingDir(cfg, hashUserKey(key), { ...opts, tenantId: key.tenantId }),
    USER_PROFILE_CHANGE_FILENAME,
  );
}

function resolveUserProfileSuppressionPath(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  opts?: UserModelingPathOpts,
): string {
  return path.join(
    resolveUserModelingDir(cfg, hashUserKey(key), { ...opts, tenantId: key.tenantId }),
    USER_PROFILE_SUPPRESSION_FILENAME,
  );
}

const lock = createAsyncLock();
const changeLock = createAsyncLock();

export async function readUserProfile(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  opts?: UserModelingPathOpts,
): Promise<UserProfile | null> {
  return await readJsonFile<UserProfile>(resolveUserProfilePath(cfg, key, opts));
}

export async function readUserProfileOrDefault(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  opts?: UserModelingPathOpts,
): Promise<UserProfile> {
  const stored = await readUserProfile(cfg, key, opts);
  return stored ? { ...DEFAULT_USER_PROFILE, ...stored } : { ...DEFAULT_USER_PROFILE };
}

export async function writeUserProfile(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  profile: UserProfile,
  opts?: UserModelingPathOpts,
): Promise<void> {
  await writeJsonAtomic(resolveUserProfilePath(cfg, key, opts), profile);
}

export async function updateUserProfile(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  updater: (current: UserProfile) => UserProfile | null,
  opts?: UserModelingPathOpts,
): Promise<UserProfile | null> {
  return await lock(async () => {
    const current = await readUserProfileOrDefault(cfg, key, opts);
    const next = updater(current);
    if (next === null) {
      return current;
    }
    await writeUserProfile(cfg, key, next, opts);
    return next;
  });
}

async function clearSuppression(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  opts?: UserModelingPathOpts,
): Promise<void> {
  await fs.rm(resolveUserProfileSuppressionPath(cfg, key, opts), { force: true });
}

export async function readUserProfileChange(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  opts?: UserModelingPathOpts,
): Promise<UserProfileChangeRecord | null> {
  return await readJsonFile<UserProfileChangeRecord>(resolveUserProfileChangePath(cfg, key, opts));
}

export async function readUserProfileByHash(
  cfg: OpenBotConfig,
  tenantId: string,
  userKeyHash: string,
  opts?: UserModelingPathOpts,
): Promise<UserProfile | null> {
  const hash = userKeyHash.trim();
  if (!hash) {
    return null;
  }
  return await readJsonFile<UserProfile>(
    path.join(resolveUserModelingDir(cfg, hash, { ...opts, tenantId }), USER_PROFILE_FILENAME),
  );
}

export async function resetUserProfileByHash(
  cfg: OpenBotConfig,
  tenantId: string,
  userKeyHash: string,
  opts?: UserModelingPathOpts,
): Promise<void> {
  const hash = userKeyHash.trim();
  const dir = resolveUserModelingDir(cfg, hash, { ...opts, tenantId });
  await fs.rm(path.join(dir, USER_PROFILE_FILENAME), { force: true });
  await fs.rm(path.join(dir, USER_PROFILE_CHANGE_FILENAME), { force: true });
  await fs.rm(path.join(dir, USER_PROFILE_SUPPRESSION_FILENAME), { force: true });
}

export async function resetUserProfile(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  opts?: UserModelingPathOpts,
): Promise<void> {
  const dir = resolveUserModelingDir(cfg, hashUserKey(key), {
    ...opts,
    tenantId: key.tenantId,
  });
  await fs.rm(path.join(dir, USER_PROFILE_FILENAME), { force: true });
  await fs.rm(path.join(dir, USER_PROFILE_CHANGE_FILENAME), { force: true });
  await fs.rm(path.join(dir, USER_PROFILE_SUPPRESSION_FILENAME), { force: true });
}

export async function applyUserInteractionSignals(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  signals: UserInteractionSignals,
  baselineFriction?: number | null,
  opts?: UserModelingPathOpts,
): Promise<UserProfile | null> {
  const current = await readUserProfileOrDefault(cfg, key, opts);
  const delta = deriveUserProfileDelta(current, signals);
  if (Object.keys(delta).length === 0) {
    return null;
  }

  const suppression = await readJsonFile<UserProfileSuppression>(
    resolveUserProfileSuppressionPath(cfg, key, opts),
  );
  if (suppression && sameUserProfileDelta(suppression.suppressedDelta, delta)) {
    return null;
  }

  let didChange = false;
  let previousValues: Partial<UserProfile> = {};
  const result = await updateUserProfile(
    cfg,
    key,
    (profile) => {
      const next = applyUserProfileDelta(profile, delta);
      const changedKeys = (Object.keys(delta) as Array<keyof UserProfile>).filter(
        (field) => field !== "observations" && profile[field] !== next[field],
      );
      didChange = changedKeys.length > 0;
      if (didChange) {
        previousValues = Object.fromEntries(
          changedKeys.map((field) => [field, profile[field]]),
        ) as Partial<UserProfile>;
      }
      return didChange ? next : null;
    },
    opts,
  );

  if (didChange) {
    await changeLock(async () => {
      await writeJsonAtomic(resolveUserProfileChangePath(cfg, key, opts), {
        changedAtMs: Date.now(),
        baselineFriction: typeof baselineFriction === "number" ? baselineFriction : null,
        appliedDelta: delta,
        previousValues,
        assessedAtMs: null,
      } satisfies UserProfileChangeRecord);
      await clearSuppression(cfg, key, opts);
    });
    return result;
  }
  return null;
}

export async function assessAndMarkUserProfileEffect(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  currentFriction: number | null,
  opts?: UserModelingPathOpts,
): Promise<{
  status: ReturnType<typeof evaluateUserProfileEffect>["status"];
  deltaFriction: number | null;
  newlyAssessed: boolean;
  rolledBack: boolean;
} | null> {
  return await changeLock(async () => {
    const filePath = resolveUserProfileChangePath(cfg, key, opts);
    const record = await readJsonFile<UserProfileChangeRecord>(filePath);
    if (!record || record.assessedAtMs !== null) {
      return null;
    }
    const effect = evaluateUserProfileEffect(record.baselineFriction, currentFriction);
    if (effect.status === "inconclusive") {
      return {
        status: effect.status,
        deltaFriction: effect.deltaFriction,
        newlyAssessed: false,
        rolledBack: false,
      };
    }
    let rolledBack = false;
    if (
      effect.status === "regressed" &&
      record.previousValues &&
      Object.keys(record.previousValues).length > 0
    ) {
      await updateUserProfile(
        cfg,
        key,
        (current) => applyUserProfileDelta(current, record.previousValues ?? {}),
        opts,
      );
      await writeJsonAtomic(resolveUserProfileSuppressionPath(cfg, key, opts), {
        suppressedDelta: record.appliedDelta,
        suppressedAtMs: Date.now(),
      } satisfies UserProfileSuppression);
      rolledBack = true;
    }
    await writeJsonAtomic(filePath, {
      ...record,
      assessedAtMs: Date.now(),
      effectStatus: effect.status,
      deltaFriction: effect.deltaFriction,
      rolledBack,
    } satisfies UserProfileChangeRecord);
    return {
      status: effect.status,
      deltaFriction: effect.deltaFriction,
      newlyAssessed: true,
      rolledBack,
    };
  });
}

export async function resolveUserProfileInstructions(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  opts?: UserModelingPathOpts & UserProfileRenderOptions,
): Promise<string | undefined> {
  const stored = await readUserProfile(cfg, key, opts);
  if (!stored) {
    return undefined;
  }
  const rendered = renderUserProfileInstructions(
    { ...DEFAULT_USER_PROFILE, ...stored },
    { execAsk: opts?.execAsk },
  ).trim();
  return rendered.length > 0 ? rendered : undefined;
}

export function frictionFromSignals(
  record: UserProfileChangeRecord | null,
  signals: UserInteractionSignals,
): number {
  if (!record) {
    return 0;
  }
  return countRecurringDirectiveFriction(record.appliedDelta, signals.directives ?? []);
}
