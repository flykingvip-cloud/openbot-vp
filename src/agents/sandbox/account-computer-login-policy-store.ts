/**
 * Per tenant + user + host login preference.
 * Stores the method choice and an opaque credential id. Never stores secrets.
 */
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR } from "../../utils.js";
import {
  normalizeLoginHost,
  type AccountComputerLoginMethod,
} from "./account-computer-login-classify.js";

export type AccountComputerLoginPolicy = {
  tenantId: string;
  userId: string;
  host: string;
  preferredMethod: AccountComputerLoginMethod;
  rememberedCredentialId?: string;
  firstChoiceRecorded: boolean;
  saveDeclined?: boolean;
  updatedAt: number;
};

type PolicyFile = {
  records: AccountComputerLoginPolicy[];
};

const lock = createAsyncLock();
let policyPathOverride: string | null = null;

export function setAccountComputerLoginPolicyPathForTests(next: string | null) {
  policyPathOverride = next;
}

export function resolveAccountComputerLoginPolicyPath(): string {
  return policyPathOverride ?? path.join(CONFIG_DIR, "account-computer-login-policy.json");
}

function sameAccountHost(
  record: AccountComputerLoginPolicy,
  tenantId: string,
  userId: string,
  host: string,
): boolean {
  return record.tenantId === tenantId && record.userId === userId && record.host === host;
}

export async function readLoginPolicy(params: {
  tenantId: string;
  userId: string;
  host: string;
}): Promise<AccountComputerLoginPolicy | null> {
  const host = normalizeLoginHost(params.host);
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  if (!host || !tenantId || !userId) {
    return null;
  }
  const file = await readJsonFile<PolicyFile>(resolveAccountComputerLoginPolicyPath());
  const found = file?.records?.find((record) => sameAccountHost(record, tenantId, userId, host));
  return found ?? null;
}

export async function writeLoginPolicy(
  record: Omit<AccountComputerLoginPolicy, "updatedAt"> & { updatedAt?: number },
): Promise<AccountComputerLoginPolicy> {
  const host = normalizeLoginHost(record.host);
  const tenantId = record.tenantId.trim();
  const userId = record.userId.trim();
  if (!host || !tenantId || !userId) {
    throw new Error("login policy requires tenant, user, and host");
  }
  const next: AccountComputerLoginPolicy = {
    tenantId,
    userId,
    host,
    preferredMethod: record.preferredMethod,
    firstChoiceRecorded: record.firstChoiceRecorded,
    ...(record.rememberedCredentialId
      ? { rememberedCredentialId: record.rememberedCredentialId }
      : {}),
    ...(record.saveDeclined ? { saveDeclined: true } : {}),
    updatedAt: record.updatedAt ?? Date.now(),
  };
  await lock(async () => {
    const file = (await readJsonFile<PolicyFile>(resolveAccountComputerLoginPolicyPath())) ?? {
      records: [],
    };
    const records = Array.isArray(file.records) ? file.records : [];
    const index = records.findIndex((row) => sameAccountHost(row, tenantId, userId, host));
    if (index >= 0) {
      records[index] = next;
    } else {
      records.push(next);
    }
    await writeJsonAtomic(resolveAccountComputerLoginPolicyPath(), { records }, { mode: 0o600 });
  });
  return next;
}

/**
 * Record a single-method observation so the next visit defaults to it.
 * Does not overwrite an explicit choice or a saved credential.
 */
export async function rememberObservedLoginMethod(params: {
  tenantId: string;
  userId: string;
  host: string;
  method: "password" | "qr";
}): Promise<AccountComputerLoginPolicy | null> {
  const existing = await readLoginPolicy(params);
  if (existing?.firstChoiceRecorded || existing?.rememberedCredentialId) {
    return existing;
  }
  return writeLoginPolicy({
    tenantId: params.tenantId,
    userId: params.userId,
    host: params.host,
    preferredMethod: params.method,
    firstChoiceRecorded: true,
    ...(existing?.saveDeclined ? { saveDeclined: true } : {}),
  });
}
