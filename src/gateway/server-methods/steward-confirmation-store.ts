/**
 * Steward Confirmation Store — 大白需确认写动作的服务端票据（决策 G）。
 *
 * 防重放 / 幂等 / 防篡改：
 * - 首调（命中 requiresUserConfirmation）生成 { proposalId, confirmationToken, payloadHash, expiresAtMs }。
 * - 二次 execute 必须回带 proposalId + confirmationToken；服务端校验 token 匹配、未过期、
 *   payloadHash 与本次参数一致（防篡改）、且单次消费（防重放/幂等）。
 *
 * 票据短时有效（默认 5 分钟），进程内存储即可（单网关进程，无需落盘）。
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { stableStringify } from "../../agents/stable-stringify.js";
import type { DaibaiConfirmationEnvelope } from "../../shared/daibai-types.js";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

type ConfirmationTicket = {
  proposalId: string;
  confirmationToken: string;
  payloadHash: string;
  actionId: string;
  expiresAtMs: number;
  consumed: boolean;
};

const tickets = new Map<string, ConfirmationTicket>();

/**
 * 规范化参数 → 稳定哈希（递归键排序，绑定将执行的参数，防二次篡改）。
 *
 * 不能用 `JSON.stringify(payload, Object.keys(payload).toSorted())`：第二个参数是
 * *replacer*，数组形式是递归生效的「属性名白名单」，不是排序器。顶层键顺序确实被
 * 规范化了，但嵌套对象的键几乎不在白名单里，整个嵌套对象被序列化成 `{}`，嵌套字段
 * 完全不进哈希。
 *
 * 也不能只用 `stableStringify`：它不调用 `toJSON`（Date 写成 `{}`），并把 `undefined`
 * 写成 `null`。后者可被利用：网关用 `JSON.parse` 解析报文，`1e999` 会变成 `Infinity`，
 * 而 JSON 同样把 `Infinity` 写成 `null`。于是确认时省略的数值字段（如 `budget.set` 的
 * `alertThreshold`）可以在执行时换成 `1e999`，哈希不变。
 *
 * 所以先做一次 JSON 往返，再用 `stableStringify` 在每一层排序键。往返后 `toJSON` 生效，
 * 值为 `undefined` 的键被丢弃，与缺省等价，不再与 `null` 或 `Infinity` 碰撞。
 *
 * 往返保留了 JSON 自身的几类合并，目前都不改变 main 上任何调用方的结果：`NaN`、
 * `±Infinity` 与 `null` 互相碰撞；`-0` 与 `0` 碰撞；`Map`、`Set` 写成 `{}`；`toJSON`
 * 结果相同的值碰撞。哪个参数需要区分这些值，就在它的 `buildParams` 里先校验或规范化。
 */
export function computePayloadHash(payload: Record<string, unknown>): string {
  const json: unknown = JSON.parse(JSON.stringify(payload));
  return createHash("sha256").update(stableStringify(json)).digest("hex");
}

function purgeExpired(now: number): void {
  for (const [id, ticket] of tickets) {
    if (ticket.expiresAtMs <= now || ticket.consumed) {
      tickets.delete(id);
    }
  }
}

/** 创建确认票据，返回随 `pending_confirmation` 回传给前端的 envelope。 */
export function createConfirmation(params: {
  actionId: string;
  payload: Record<string, unknown>;
  ttlMs?: number;
  now?: number;
}): DaibaiConfirmationEnvelope {
  const now = params.now ?? Date.now();
  purgeExpired(now);
  const proposalId = `dbc_${randomUUID()}`;
  const confirmationToken = randomUUID();
  const payloadHash = computePayloadHash(params.payload);
  const expiresAtMs = now + (params.ttlMs ?? DEFAULT_TTL_MS);
  tickets.set(proposalId, {
    proposalId,
    confirmationToken,
    payloadHash,
    actionId: params.actionId,
    expiresAtMs,
    consumed: false,
  });
  return { proposalId, confirmationToken, payloadHash, expiresAtMs };
}

export type ConsumeConfirmationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "expired" | "token_mismatch" | "payload_mismatch" | "action_mismatch";
    };

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/**
 * 校验并消费确认票据（单次消费）。成功后票据立即作废，防重放。
 */
export function consumeConfirmation(params: {
  proposalId: string;
  confirmationToken: string;
  actionId: string;
  payload: Record<string, unknown>;
  now?: number;
}): ConsumeConfirmationResult {
  const now = params.now ?? Date.now();
  const ticket = tickets.get(params.proposalId);
  if (!ticket || ticket.consumed) {
    return { ok: false, reason: "not_found" };
  }
  if (ticket.expiresAtMs <= now) {
    tickets.delete(params.proposalId);
    return { ok: false, reason: "expired" };
  }
  if (!tokensEqual(ticket.confirmationToken, params.confirmationToken)) {
    return { ok: false, reason: "token_mismatch" };
  }
  if (ticket.actionId !== params.actionId) {
    return { ok: false, reason: "action_mismatch" };
  }
  if (ticket.payloadHash !== computePayloadHash(params.payload)) {
    return { ok: false, reason: "payload_mismatch" };
  }
  // Single-consume: invalidate immediately (replay/idempotency protection).
  tickets.delete(params.proposalId);
  return { ok: true };
}

/**
 * Drop unused tickets for an action. Does not extend their expiry or return tokens.
 * Expired tickets are purged and are not reusable authorization.
 */
export function supersedeUnusedConfirmations(
  actionId: string,
  now?: number,
): { invalidatedProposalIds: string[] } {
  const ts = now ?? Date.now();
  purgeExpired(ts);
  const target = actionId.trim();
  const invalidatedProposalIds: string[] = [];
  if (!target) {
    return { invalidatedProposalIds };
  }
  for (const [id, ticket] of tickets) {
    if (ticket.actionId === target && !ticket.consumed) {
      invalidatedProposalIds.push(ticket.proposalId);
      tickets.delete(id);
    }
  }
  return { invalidatedProposalIds };
}

/** Invalidate unused (unconsumed, unexpired) tickets for an actionId. Returns count removed. */
export function invalidateConfirmationsByActionId(actionId: string, now?: number): number {
  return supersedeUnusedConfirmations(actionId, now).invalidatedProposalIds.length;
}

/** 测试辅助：清空票据。 */
export function __clearConfirmationsForTest(): void {
  tickets.clear();
}
