/**
 * 组织岗位「未激活」筛选与批量激活选择纯函数（Phase 2）。
 */

export type OrganizationInactiveLikeStatus =
  | "VACANT"
  | "PENDING_ACTIVATION"
  | "NORMAL"
  | "PENDING_CONFIRM"
  | "HANDOVER"
  | "ERROR";

export type OrganizationActivationSelectableRow = {
  seatId: string;
  name: string;
  teamLabel: string;
  status: OrganizationInactiveLikeStatus;
  pendingEmployeeUser: string | null;
};

export function isOrganizationInactiveStatus(status: OrganizationInactiveLikeStatus): boolean {
  return status === "VACANT" || status === "PENDING_ACTIVATION";
}

export function organizationStatusMatchesInactiveFilter(
  status: OrganizationInactiveLikeStatus | null,
): boolean {
  if (!status) {
    return false;
  }
  return isOrganizationInactiveStatus(status);
}

/**
 * 将多选结果拆成：可批量发信的邮箱 vs 需跳转档案补邮箱的岗位。
 * - 有 pendingEmployeeUser → 进入 emailsToSend（去重保序）
 * - 无邮箱且状态属于未激活 → seatsNeedingEmail
 * - 其他选中项忽略（例如误选正常岗）
 */
export function partitionOrganizationActivationSelection(params: {
  rows: readonly OrganizationActivationSelectableRow[];
  selectedSeatIds: ReadonlySet<string> | readonly string[];
}): {
  emailsToSend: string[];
  seatsNeedingEmail: OrganizationActivationSelectableRow[];
  ignoredSeatIds: string[];
} {
  const selected =
    params.selectedSeatIds instanceof Set
      ? params.selectedSeatIds
      : new Set(params.selectedSeatIds);
  const byId = new Map(params.rows.map((row) => [row.seatId, row]));
  const emailsToSend: string[] = [];
  const seenEmail = new Set<string>();
  const seatsNeedingEmail: OrganizationActivationSelectableRow[] = [];
  const ignoredSeatIds: string[] = [];

  for (const seatId of selected) {
    const row = byId.get(seatId);
    if (!row) {
      ignoredSeatIds.push(seatId);
      continue;
    }
    const email = row.pendingEmployeeUser?.trim() || "";
    if (email) {
      const key = email.toLowerCase();
      if (!seenEmail.has(key)) {
        seenEmail.add(key);
        emailsToSend.push(email);
      }
      continue;
    }
    if (isOrganizationInactiveStatus(row.status)) {
      seatsNeedingEmail.push(row);
      continue;
    }
    ignoredSeatIds.push(seatId);
  }

  return { emailsToSend, seatsNeedingEmail, ignoredSeatIds };
}
