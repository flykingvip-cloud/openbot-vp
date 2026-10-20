/**
 * Governance Notification — 治理通知与升级
 *
 * 职责：
 * 1. Critical 治理项产生时通知归属岗位当前负责人
 * 2. 超时未处理时升级到上级管理岗位
 */

import type { GovernanceItem } from "./types.ts";

export type NotificationPayload = {
  recipientUserId: string;
  recipientPositionId: string;
  issueId: string;
  title: string;
  summary: string;
  targetName: string;
  detectedAt: string;
  suggestedAction: string;
  directLink: string;
  isEscalation: boolean;
};

export type NotificationSender = (payload: NotificationPayload) => Promise<void>;

/**
 * 当新的 Critical 级别治理项产生时，向归属岗位当前负责人发送通知。
 */
export function buildCriticalNotification(
  issue: GovernanceItem,
  directLink: string,
): NotificationPayload {
  return {
    recipientUserId: issue.target.ownership.currentManagerUserId,
    recipientPositionId: issue.target.ownership.positionId,
    issueId: issue.id,
    title: `[紧急] ${issue.title}`,
    summary: `${issue.target.name} 触发了 Critical 级别治理告警，需要立即处理。`,
    targetName: issue.target.name,
    detectedAt: issue.detectedAt,
    suggestedAction: issue.suggestedAction,
    directLink,
    isEscalation: false,
  };
}

/**
 * 当 Critical 治理项超过指定时间未处理时，升级通知到上级管理岗位。
 */
export function buildEscalationNotification(
  issue: GovernanceItem,
  escalationTarget: { userId: string; positionId: string },
  hoursUnhandled: number,
  directLink: string,
): NotificationPayload {
  return {
    recipientUserId: escalationTarget.userId,
    recipientPositionId: escalationTarget.positionId,
    issueId: issue.id,
    title: `[升级] ${issue.title} — 已超过 ${hoursUnhandled} 小时未处理`,
    summary: `${issue.target.name} 的 Critical 治理项已超过 ${hoursUnhandled} 小时未处理，已升级到您。`,
    targetName: issue.target.name,
    detectedAt: issue.detectedAt,
    suggestedAction: issue.suggestedAction,
    directLink,
    isEscalation: true,
  };
}

/**
 * 检查是否需要升级通知。
 * 规则：Critical 治理项超过 4 小时未处理。
 */
export function shouldEscalate(
  issue: GovernanceItem,
  now: number,
  escalationThresholdHours: number = 4,
): boolean {
  if (issue.level !== "critical") {
    return false;
  }
  const detectedAt = new Date(issue.detectedAt).getTime();
  const hoursElapsed = (now - detectedAt) / (1000 * 60 * 60);
  return hoursElapsed >= escalationThresholdHours;
}

/**
 * 计算未处理时长（小时）。
 */
export function hoursUnhandled(issue: GovernanceItem, now: number): number {
  const detectedAt = new Date(issue.detectedAt).getTime();
  return Math.floor((now - detectedAt) / (1000 * 60 * 60));
}
