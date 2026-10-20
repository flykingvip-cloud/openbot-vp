import type {
  ExecApprovalDecision,
  ExecApprovalRequestPayload as InfraExecApprovalRequestPayload,
} from "../infra/exec-approvals.js";
import {
  ApprovalLifecycle,
  type ApprovalIdLookupResult,
  type ApprovalRecord,
} from "./approval-lifecycle.js";

export type ExecApprovalRequestPayload = InfraExecApprovalRequestPayload;

export type ExecApprovalRecord = ApprovalRecord<ExecApprovalRequestPayload>;

export type ExecApprovalIdLookupResult = ApprovalIdLookupResult;

/**
 * Shell-exec approval manager.
 *
 * The lifecycle (pending, timeout, double-resolve guard, atomic one-shot
 * consumption) lives in `ApprovalLifecycle` so other approval types can reuse the
 * mechanism without inheriting the shell-exec policy. Behaviour here is unchanged;
 * this is a naming and typing boundary only.
 */
export class ExecApprovalManager extends ApprovalLifecycle<ExecApprovalRequestPayload> {}

export type { ExecApprovalDecision };
