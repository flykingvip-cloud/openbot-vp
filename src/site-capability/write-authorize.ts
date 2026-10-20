/**
 * Write authorization. Decisions here happen before any fixture dispatch.
 * A read effect, a wrong version, or a wrong binding never reaches apply_draft.
 */

import { SAR_DENIAL_CODE } from "./codes.js";
import { findSarScriptKey } from "./operations.js";
import {
  denialForForbiddenTarget,
  deriveAccountBrowserScopeKey,
  findForbiddenTargetKey,
  type AccountBinding,
  type ServerPrincipal,
} from "./session-handle.js";
import { writePayloadDigest, type SarWriteEffect } from "./write-effect.js";
import type { WriteCapabilityGrant, WriteCapabilityRecord } from "./write-runtime.js";

export type ParsedWriteArgs = {
  idempotencyKey: string;
  title: string;
  body: string;
  noteId: string | null;
};

export type ReadyWrite = {
  record: WriteCapabilityRecord;
  binding: AccountBinding;
  scopeKey: string;
  args: ParsedWriteArgs;
  payloadDigest: string;
};

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const NOTE_ID_PATTERN = /^note_[a-f0-9]{12}$/;
const IDENTITY_ARG_KEYS = new Set([
  "tenantId",
  "userId",
  "principal",
  "platformUserId",
  "enterpriseId",
  "subject",
  "oiGrant",
  "effect",
]);
const BLOCKED_LIFECYCLE = new Set([
  "private",
  "draft",
  "reviewing",
  "deprecated",
  "rejected",
  "retired",
]);

export function writeGrantKey(
  tenantId: string,
  userId: string,
  capabilityId: string,
  version: string,
  effect: string,
): string {
  return `${tenantId}\n${userId}\n${capabilityId}\n${version}\n${effect}`;
}

export function writeRecordKey(capabilityId: string, version: string): string {
  return `${capabilityId}@${version}`;
}

export function writeCapabilityAvailable(record: WriteCapabilityRecord): boolean {
  return (
    record.enabled &&
    !record.disabled &&
    !record.published &&
    record.verification === "passed" &&
    !BLOCKED_LIFECYCLE.has(record.lifecycle)
  );
}

type AuthFailure = { ok: false; code: string; message: string };

export function authorizeWrite(input: {
  principal: ServerPrincipal;
  request: {
    capabilityId?: string;
    version?: string;
    args?: unknown;
    accountBindingId?: string;
  };
  records: ReadonlyMap<string, WriteCapabilityRecord>;
  grants: ReadonlyMap<string, WriteCapabilityGrant>;
  bindings: ReadonlyMap<string, AccountBinding>;
}): { ok: true; value: ReadyWrite } | AuthFailure {
  const scriptKey = findSarScriptKey(input.request.args);
  if (scriptKey) {
    return {
      ok: false,
      code: SAR_DENIAL_CODE.evaluate,
      message: `SAR rejects page script payload (${scriptKey}) even when browser evaluate is enabled`,
    };
  }
  const forbidden = findForbiddenTargetKey(input.request.args);
  if (forbidden) {
    return denialForForbiddenTarget(forbidden);
  }
  const capabilityId = input.request.capabilityId?.trim() ?? "";
  const version = input.request.version?.trim() ?? "";
  if (!capabilityId || !version) {
    return {
      ok: false,
      code: "VERSION_REQUIRED",
      message: "invoke requires a fixed capability version",
    };
  }
  const record = input.records.get(writeRecordKey(capabilityId, version));
  const granted = record
    ? input.grants.get(
        writeGrantKey(
          input.principal.tenantId,
          input.principal.userId,
          capabilityId,
          version,
          record.manifest.effect,
        ),
      )
    : undefined;
  if (
    !record ||
    !granted ||
    granted.artifactDigest !== record.artifactDigest ||
    !writeCapabilityAvailable(record)
  ) {
    return { ok: false, code: "NOT_AUTHORIZED", message: "capability is not available" };
  }
  const parsed = parseWriteArgs(record.manifest.effect, input.request.args);
  if (!parsed.ok) {
    return parsed;
  }
  const bindingId = selectWriteBinding(granted, input.request.accountBindingId);
  if (!bindingId.ok) {
    return bindingId;
  }
  const binding = input.bindings.get(bindingId.bindingId);
  if (!binding) {
    return {
      ok: false,
      code: SAR_DENIAL_CODE.bindingNotFound,
      message: "account binding is not registered",
    };
  }
  if (binding.tenantId !== input.principal.tenantId || binding.userId !== input.principal.userId) {
    return {
      ok: false,
      code: SAR_DENIAL_CODE.crossAccount,
      message: "principal cannot use another tenant or user binding",
    };
  }
  const scopeKey = deriveAccountBrowserScopeKey(binding.tenantId, binding.userId);
  if (!scopeKey) {
    return {
      ok: false,
      code: SAR_DENIAL_CODE.bindingNotFound,
      message: "account browser scope could not be derived",
    };
  }
  const noteId = record.manifest.effect === "create" ? "" : (parsed.args.noteId ?? "");
  return {
    ok: true,
    value: {
      record,
      binding,
      scopeKey,
      args: parsed.args,
      payloadDigest: writePayloadDigest({
        effect: record.manifest.effect,
        noteId,
        title: parsed.args.title,
        body: parsed.args.body,
      }),
    },
  };
}

export function principalOwnsWrite(
  principal: ServerPrincipal,
  binding: AccountBinding | undefined,
  grants: ReadonlyMap<string, WriteCapabilityGrant>,
  capabilityId: string,
  version: string,
  effect: string,
): boolean {
  if (!binding || binding.tenantId !== principal.tenantId || binding.userId !== principal.userId) {
    return false;
  }
  return grants.has(
    writeGrantKey(principal.tenantId, principal.userId, capabilityId, version, effect),
  );
}

function selectWriteBinding(
  grant: WriteCapabilityGrant,
  requested: string | undefined,
): { ok: true; bindingId: string } | AuthFailure {
  const allowed = grant.accountBindingIds.map((id) => id.trim()).filter((id) => id.length > 0);
  const bindingId = requested?.trim() ?? "";
  if (bindingId) {
    if (!allowed.includes(bindingId)) {
      return {
        ok: false,
        code: SAR_DENIAL_CODE.policyDenied,
        message: "account binding is not authorized for this capability",
      };
    }
    return { ok: true, bindingId };
  }
  const only = allowed[0];
  if (allowed.length === 1 && only) {
    return { ok: true, bindingId: only };
  }
  return {
    ok: false,
    code: SAR_DENIAL_CODE.bindingNotFound,
    message: "accountBindingId is required",
  };
}

function parseWriteArgs(
  effect: SarWriteEffect,
  raw: unknown,
): { ok: true; args: ParsedWriteArgs } | AuthFailure {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: SAR_DENIAL_CODE.opNotInSet, message: "args must be an object" };
  }
  const record = raw as Record<string, unknown>;
  const allowed = new Set(
    effect === "update"
      ? ["idempotencyKey", "noteId", "title", "body"]
      : ["idempotencyKey", "title", "body"],
  );
  for (const key of Object.keys(record)) {
    if (IDENTITY_ARG_KEYS.has(key)) {
      return {
        ok: false,
        code: SAR_DENIAL_CODE.policyDenied,
        message: "identity fields are not invoke arguments",
      };
    }
    if (!allowed.has(key)) {
      return { ok: false, code: SAR_DENIAL_CODE.opNotInSet, message: `unexpected argument ${key}` };
    }
  }
  const idempotencyKey = record.idempotencyKey;
  const title = record.title;
  const body = record.body;
  if (typeof idempotencyKey !== "string" || !KEY_PATTERN.test(idempotencyKey)) {
    return { ok: false, code: SAR_DENIAL_CODE.opNotInSet, message: "idempotencyKey is required" };
  }
  if (typeof title !== "string" || title.length < 1 || title.length > 200) {
    return {
      ok: false,
      code: SAR_DENIAL_CODE.opNotInSet,
      message: "title is not a bounded string",
    };
  }
  if (typeof body !== "string" || body.length < 1 || body.length > 200) {
    return { ok: false, code: SAR_DENIAL_CODE.opNotInSet, message: "body is not a bounded string" };
  }
  let noteId: string | null = null;
  if (effect === "update") {
    if (typeof record.noteId !== "string" || !NOTE_ID_PATTERN.test(record.noteId)) {
      return { ok: false, code: SAR_DENIAL_CODE.opNotInSet, message: "noteId is required" };
    }
    noteId = record.noteId;
  }
  return { ok: true, args: { idempotencyKey, title, body, noteId } };
}
