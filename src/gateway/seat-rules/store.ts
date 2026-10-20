/**
 * 席位 AI 规则存储。主键是 tenantId + seatId。
 * 缺租户或 `_local` 直接拒绝，不落入用户建模桶。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveDataRoot } from "../../config/data-space.js";
import type { ExecAsk, ExecSecurity } from "../../infra/exec-approvals.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { inspectSeatRuleText } from "./content-guard.js";
import {
  countSeatRuleChars,
  SEAT_RULE_MAX_CHARS,
  SEAT_RULES_MAX_COUNT,
  SEAT_RULES_MAX_TOTAL_CHARS,
} from "./limits.js";

const STORE_VERSION = 1;

export type SeatAiRule = {
  id: string;
  text: string;
};

export type SeatExecPreference = {
  security?: ExecSecurity;
  ask?: ExecAsk;
};

export type SeatRulesRecord = {
  tenantId: string;
  seatId: string;
  rules: SeatAiRule[];
  execPreference?: SeatExecPreference;
  updatedAt: string;
};

type Store = {
  version: number;
  /** key = tenantId + seatId */
  seats: Record<string, SeatRulesRecord>;
};

export type SeatRuleRejection = {
  ruleId?: string;
  reason: string;
};

export class SeatRulesScopeError extends Error {
  readonly code = "SEAT_RULES_SCOPE_REJECTED" as const;

  constructor(message: string) {
    super(message);
    this.name = "SeatRulesScopeError";
  }
}

export class SeatRulesRejectedError extends Error {
  readonly code = "SEAT_RULES_REJECTED" as const;
  readonly rejections: SeatRuleRejection[];

  constructor(rejections: SeatRuleRejection[]) {
    super(rejections.map((entry) => entry.reason).join("; ") || "seat rules rejected");
    this.name = "SeatRulesRejectedError";
    this.rejections = rejections;
  }
}

export type SeatRulesSaveInput = {
  tenantId: string;
  seatId: string;
  rules: readonly { id?: string; text: string }[];
  execPreference?: {
    security?: ExecSecurity;
    ask?: ExecAsk;
    host?: string;
    credentialPolicy?: string;
    executionPlacement?: string;
  };
};

const ASK_VALUES = new Set<ExecAsk>(["off", "on-miss", "always"]);
const SECURITY_VALUES = new Set<ExecSecurity>(["deny", "allowlist", "full"]);
const withLock = createAsyncLock();

function scopeKey(tenantId: string, seatId: string): string {
  return `${encodeURIComponent(tenantId)}\u0000${encodeURIComponent(seatId)}`;
}

export function assertSeatRulesScope(
  tenantId: string,
  seatId: string,
): { tenantId: string; seatId: string } {
  const tenant = tenantId.trim();
  const seat = seatId.trim();
  if (!tenant) {
    throw new SeatRulesScopeError("tenantId is required");
  }
  if (tenant.toLowerCase() === "_local") {
    throw new SeatRulesScopeError("tenantId _local is not a seat-rules scope");
  }
  if (tenant.includes("/") || tenant.includes("\\") || tenant.includes("..")) {
    throw new SeatRulesScopeError("tenantId is invalid");
  }
  if (!seat) {
    throw new SeatRulesScopeError("seatId is required");
  }
  if (seat.includes("/") || seat.includes("\\") || seat.includes("..")) {
    throw new SeatRulesScopeError("seatId is invalid");
  }
  return { tenantId: tenant, seatId: seat };
}

export function resolveSeatRulesStorePath(
  tenantId: string,
  opts?: { storePath?: string; cfg?: OpenBotConfig },
): string {
  if (opts?.storePath?.trim()) {
    return opts.storePath.trim();
  }
  const root = resolveDataRoot(opts?.cfg);
  return path.join(root, "tenants", tenantId, "live", "control-plane", "seat-ai-rules.json");
}

function createEmptyStore(): Store {
  return { version: STORE_VERSION, seats: {} };
}

async function loadStore(filePath: string): Promise<Store> {
  const parsed = await readJsonFile<Partial<Store>>(filePath);
  if (!parsed || typeof parsed.seats !== "object" || parsed.seats === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, seats: parsed.seats };
}

export function validateSeatRulesSave(input: SeatRulesSaveInput): SeatRuleRejection[] {
  const rejections: SeatRuleRejection[] = [];
  if (input.rules.length > SEAT_RULES_MAX_COUNT) {
    rejections.push({ reason: `seat_rules_max_count_${SEAT_RULES_MAX_COUNT}` });
  }
  let total = 0;
  const seenIds = new Set<string>();
  for (const [index, rule] of input.rules.entries()) {
    const ruleId = rule.id?.trim() || `index:${index}`;
    const text = typeof rule.text === "string" ? rule.text : "";
    if (!text.trim()) {
      rejections.push({ ruleId, reason: "empty_rule" });
      continue;
    }
    const chars = countSeatRuleChars(text);
    total += chars;
    if (chars > SEAT_RULE_MAX_CHARS) {
      rejections.push({ ruleId, reason: `seat_rule_max_chars_${SEAT_RULE_MAX_CHARS}` });
    }
    const content = inspectSeatRuleText(text);
    if (content) {
      rejections.push({ ruleId, reason: content });
    }
    if (rule.id?.trim()) {
      if (seenIds.has(rule.id.trim())) {
        rejections.push({ ruleId: rule.id.trim(), reason: "duplicate_rule_id" });
      }
      seenIds.add(rule.id.trim());
    }
  }
  if (total > SEAT_RULES_MAX_TOTAL_CHARS) {
    rejections.push({ reason: `seat_rules_max_total_chars_${SEAT_RULES_MAX_TOTAL_CHARS}` });
  }
  const preference = input.execPreference;
  if (preference?.host) {
    rejections.push({ reason: "seat_cannot_set_host" });
  }
  if (preference?.credentialPolicy) {
    rejections.push({ reason: "seat_cannot_set_credential_policy" });
  }
  if (preference?.executionPlacement) {
    rejections.push({ reason: "seat_cannot_set_execution_placement" });
  }
  if (preference?.security && !SECURITY_VALUES.has(preference.security)) {
    rejections.push({ reason: "invalid_security" });
  }
  if (preference?.ask && !ASK_VALUES.has(preference.ask)) {
    rejections.push({ reason: "invalid_ask" });
  }
  return rejections;
}

function normalizeRecord(
  scope: { tenantId: string; seatId: string },
  input: SeatRulesSaveInput,
): SeatRulesRecord {
  const rules: SeatAiRule[] = input.rules.map((rule) => ({
    id: rule.id?.trim() || crypto.randomUUID(),
    text: rule.text,
  }));
  const execPreference: SeatExecPreference = {};
  if (input.execPreference?.security) {
    execPreference.security = input.execPreference.security;
  }
  if (input.execPreference?.ask) {
    execPreference.ask = input.execPreference.ask;
  }
  return {
    tenantId: scope.tenantId,
    seatId: scope.seatId,
    rules,
    ...(Object.keys(execPreference).length > 0 ? { execPreference } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export async function readSeatRules(
  tenantId: string,
  seatId: string,
  opts?: { storePath?: string; cfg?: OpenBotConfig },
): Promise<SeatRulesRecord | null> {
  const scope = assertSeatRulesScope(tenantId, seatId);
  const store = await loadStore(resolveSeatRulesStorePath(scope.tenantId, opts));
  const record = store.seats[scopeKey(scope.tenantId, scope.seatId)];
  if (!record || record.tenantId !== scope.tenantId || record.seatId !== scope.seatId) {
    return null;
  }
  return record;
}

export async function saveSeatRules(
  input: SeatRulesSaveInput,
  opts?: { storePath?: string; cfg?: OpenBotConfig },
): Promise<SeatRulesRecord> {
  const scope = assertSeatRulesScope(input.tenantId, input.seatId);
  const rejections = validateSeatRulesSave(input);
  if (rejections.length > 0) {
    throw new SeatRulesRejectedError(rejections);
  }
  const record = normalizeRecord(scope, input);
  const filePath = resolveSeatRulesStorePath(scope.tenantId, opts);
  return await withLock(async () => {
    const store = await loadStore(filePath);
    store.seats[scopeKey(scope.tenantId, scope.seatId)] = record;
    await writeJsonAtomic(filePath, store);
    return record;
  });
}

export async function readSeatRulesFileBytes(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }
}
