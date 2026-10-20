/**
 * Per-bot private run bag (ephemeral) for collaboration group discussion turns.
 *
 * Separates group fact (GROUP_PUBLIC transcript SoT) from individual execution
 * state for one bot turn. The bag lives only on the in-memory MsgContext for
 * the turn — it must never be written into groups/<id>/runtime/transcript.jsonl.
 *
 * Side-effecting delivery tool steps that must survive retry/restart go through
 * scheduleDurableToolSideEffect. That ledger is a runtime directory
 * (`tool-side-effects`), not GROUP_PUBLIC and not the ephemeral bag. A second
 * schedule with the same task fingerprint skips the effect (at-most-once claim).
 * The embedded agent tool loop (`toToolDefinitions`) calls this helper via
 * `runDeliveryToolSideEffect` when a confirmed delivery fingerprint is present.
 *
 * Gated by collaboration.privateRunBag (default false).
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ParticipationOverlay } from "@openbot/collaboration-runtime";
import type { OpenBotConfig } from "../../config/config.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";

export type CollaborationPrivateCapabilitySet = {
  personal: string[];
  group: string[];
  participation: string[];
  final: string[];
};

export type CollaborationPrivateToolSideEffect = {
  toolName: string;
  atMs: number;
  summary?: string;
};

/**
 * Ephemeral per-bot execution state for one discussion turn.
 * `__privateRunBag` marks the object so transcript / public serializers can refuse it.
 */
export type CollaborationPrivateRunBag = {
  readonly __privateRunBag: true;
  agentId: string;
  roundId?: string;
  participationOverlay: ParticipationOverlay | null;
  capabilitySet: CollaborationPrivateCapabilitySet;
  /** Turn-local scratch; never durable, never GROUP_PUBLIC. */
  privateScratch: Record<string, unknown>;
  /** Index of tool side-effects observed this turn (in-memory only). */
  toolSideEffectIndex: CollaborationPrivateToolSideEffect[];
  createdAtMs: number;
};

export function isCollaborationPrivateRunBagEnabled(cfg?: OpenBotConfig | null): boolean {
  return cfg?.collaboration?.privateRunBag === true;
}

export function createCollaborationPrivateRunBag(params: {
  agentId: string;
  roundId?: string;
  participationOverlay?: ParticipationOverlay | null;
  capabilitySet?: Partial<CollaborationPrivateCapabilitySet>;
  createdAtMs?: number;
}): CollaborationPrivateRunBag {
  const agentId = params.agentId.trim();
  if (!agentId) {
    throw new Error("createCollaborationPrivateRunBag: agentId is required");
  }
  return {
    __privateRunBag: true,
    agentId,
    ...(params.roundId?.trim() ? { roundId: params.roundId.trim() } : {}),
    participationOverlay: params.participationOverlay ?? null,
    capabilitySet: {
      personal: [...(params.capabilitySet?.personal ?? [])],
      group: [...(params.capabilitySet?.group ?? [])],
      participation: [...(params.capabilitySet?.participation ?? [])],
      final: [...(params.capabilitySet?.final ?? [])],
    },
    privateScratch: {},
    toolSideEffectIndex: [],
    createdAtMs: params.createdAtMs ?? Date.now(),
  };
}

export function recordPrivateRunBagToolSideEffect(
  bag: CollaborationPrivateRunBag,
  effect: CollaborationPrivateToolSideEffect,
): void {
  bag.toolSideEffectIndex.push({
    toolName: effect.toolName,
    atMs: effect.atMs,
    ...(effect.summary ? { summary: effect.summary } : {}),
  });
}

export type DurableToolSideEffectFingerprint = {
  taskId: string;
  boardItemId: string;
  stepId: string;
  toolName: string;
};

/** Stable key for one side-effecting tool step of one task. */
export function durableToolSideEffectKey(fingerprint: DurableToolSideEffectFingerprint): string {
  return [
    fingerprint.taskId.trim(),
    fingerprint.boardItemId.trim(),
    fingerprint.stepId.trim(),
    fingerprint.toolName.trim(),
  ].join("|");
}

function durableToolSideEffectFile(ledgerDir: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(ledgerDir, `${digest}.json`);
}

/**
 * At-most-once side-effect schedule. Claims a durable slot before running so a
 * retry or process restart does not re-fire the same fingerprint. The slot is
 * not written into GROUP_PUBLIC. Failed runs stay claimed (no duplicate).
 */
export async function scheduleDurableToolSideEffect<T>(params: {
  ledgerDir: string;
  fingerprint: DurableToolSideEffectFingerprint;
  run: () => Promise<T> | T;
  bag?: CollaborationPrivateRunBag;
  summary?: string;
  nowMs?: number;
  cfg?: OpenBotConfig;
}): Promise<{ skipped: boolean; key: string; value?: T }> {
  const key = durableToolSideEffectKey(params.fingerprint);
  const parts = key.split("|");
  if (parts.some((part) => part.length === 0)) {
    throw new Error(
      "scheduleDurableToolSideEffect: fingerprint requires taskId, boardItemId, stepId, toolName",
    );
  }
  const ledgerDir = params.ledgerDir.trim();
  if (!ledgerDir) {
    throw new Error("scheduleDurableToolSideEffect: ledgerDir is required");
  }
  assertCollaborationRuntimeWritable(ledgerDir, params.cfg);
  await fs.mkdir(ledgerDir, { recursive: true });
  const file = durableToolSideEffectFile(ledgerDir, key);
  const nowMs = params.nowMs ?? Date.now();
  const body = `${JSON.stringify({
    key,
    taskId: params.fingerprint.taskId.trim(),
    boardItemId: params.fingerprint.boardItemId.trim(),
    stepId: params.fingerprint.stepId.trim(),
    toolName: params.fingerprint.toolName.trim(),
    claimedAtMs: nowMs,
  })}\n`;
  try {
    await fs.writeFile(file, body, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { skipped: true, key };
    }
    throw error;
  }
  const value = await params.run();
  if (params.bag) {
    recordPrivateRunBagToolSideEffect(params.bag, {
      toolName: params.fingerprint.toolName.trim(),
      atMs: nowMs,
      ...(params.summary ? { summary: params.summary } : {}),
    });
  }
  return { skipped: false, key, value };
}

export function setPrivateRunBagScratch(
  bag: CollaborationPrivateRunBag,
  key: string,
  value: unknown,
): void {
  const trimmed = key.trim();
  if (!trimmed) {
    return;
  }
  bag.privateScratch[trimmed] = value;
}

const PRIVATE_RUN_BAG_BODY_RE = /"__privateRunBag"\s*:\s*true/;

/** True when a value is (or embeds) a private run bag that must not hit GROUP_PUBLIC. */
export function containsPrivateRunBagMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return PRIVATE_RUN_BAG_BODY_RE.test(value);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.__privateRunBag === true) {
    return true;
  }
  if (record.CollaborationPrivateRunBag && typeof record.CollaborationPrivateRunBag === "object") {
    return (
      (record.CollaborationPrivateRunBag as { __privateRunBag?: unknown }).__privateRunBag === true
    );
  }
  if (record.privateRunBag && typeof record.privateRunBag === "object") {
    return (record.privateRunBag as { __privateRunBag?: unknown }).__privateRunBag === true;
  }
  // Nested message content / serialized fields
  for (const nested of Object.values(record)) {
    if (typeof nested === "string" && PRIVATE_RUN_BAG_BODY_RE.test(nested)) {
      return true;
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedRecord = nested as Record<string, unknown>;
      if (nestedRecord.__privateRunBag === true) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Hard guard for GROUP_PUBLIC / transcript writers.
 * Throws if a private run bag would be serialized into public group facts.
 */
export function assertNoPrivateRunBagInPublicPayload(
  value: unknown,
  context = "GROUP_PUBLIC",
): void {
  if (containsPrivateRunBagMarker(value)) {
    throw new Error(
      `Refusing to write CollaborationPrivateRunBag into ${context}; private execution state must stay ephemeral`,
    );
  }
}
