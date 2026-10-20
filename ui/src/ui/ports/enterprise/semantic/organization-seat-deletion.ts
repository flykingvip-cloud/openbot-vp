/**
 * 组织岗位删除资格与批量删除选择（只读纯函数）。
 * 与 gateway `deleteVacantPositionSeat` 对齐：空岗壳，或未注册待激活岗位
 *（assigned + pendingEmployeeUser、尚无正式成员）可直接删除。
 */

export type OrganizationSeatDeletionRow = {
  seatId: string;
  name: string;
  teamLabel: string;
  status: string;
  seatStatus: string;
  memberUserId?: string | null;
  pendingEmployeeUser?: string | null;
  offer?: unknown;
  handover?: unknown;
};

export type SeatDeleteEligibility = {
  allowed: boolean;
  reason: string | null;
  /** 在岗时引导用户先走流转，而非静默禁用 */
  nextStep: "unbind_or_handover" | "resolve_offer" | "wait_handover" | "none";
};

export function resolveOrganizationSeatDeleteEligibility(
  row: OrganizationSeatDeletionRow,
): SeatDeleteEligibility {
  if (row.handover) {
    return {
      allowed: false,
      reason: "岗位正在交接中，完成后或取消交接才可删除。",
      nextStep: "wait_handover",
    };
  }
  if (row.offer) {
    return {
      allowed: false,
      reason: "存在待确认绑定，请先撤回或完成确认。",
      nextStep: "resolve_offer",
    };
  }
  const seatStatus = row.seatStatus.trim().toLowerCase();
  const pendingEmail = row.pendingEmployeeUser?.trim() || "";
  const memberId = row.memberUserId?.trim() || "";
  // Position rows may echo pendingEmployeeUser into memberUserId for display;
  // only a distinct occupant counts as a formal member that blocks deletion.
  const hasFormalMember = Boolean(memberId) && memberId !== pendingEmail;
  if (hasFormalMember) {
    return {
      allowed: false,
      reason: "在岗岗位不可直接删除。请先更换成员或发起交接，使岗位回到空岗后再删除。",
      nextStep: "unbind_or_handover",
    };
  }
  const pendingOnly =
    Boolean(pendingEmail) && (seatStatus === "assigned" || seatStatus === "vacant");
  if (seatStatus === "vacant" || pendingOnly) {
    return { allowed: true, reason: null, nextStep: "none" };
  }
  return {
    allowed: false,
    reason: "在岗岗位不可直接删除。请先更换成员或发起交接，使岗位回到空岗后再删除。",
    nextStep: "unbind_or_handover",
  };
}

export function isOrganizationSeatDeletable(row: OrganizationSeatDeletionRow): boolean {
  return resolveOrganizationSeatDeleteEligibility(row).allowed;
}

/**
 * 人岗同删：在册成员或进行中的交接才显示。空岗和未注册待激活仍走「删除岗位」。
 */
export function isArchivePersonAndSeatDeleteVisible(row: OrganizationSeatDeletionRow): boolean {
  if (row.handover) {
    return true;
  }
  const seatStatus = row.seatStatus.trim().toLowerCase();
  const pendingEmail = row.pendingEmployeeUser?.trim() || "";
  const memberId = row.memberUserId?.trim() || "";
  const hasFormalMember = Boolean(memberId) && memberId !== pendingEmail;
  if (hasFormalMember) {
    return true;
  }
  return seatStatus === "occupied" || seatStatus === "handover_pending" || seatStatus === "frozen";
}

/**
 * 从多选结果中筛出可批量删除的空岗；其余记入 blocked（含原因）。
 */
export function partitionOrganizationSeatDeletionSelection(params: {
  rows: readonly OrganizationSeatDeletionRow[];
  selectedSeatIds: ReadonlySet<string> | readonly string[];
}): {
  deletable: OrganizationSeatDeletionRow[];
  blocked: Array<{ row: OrganizationSeatDeletionRow; reason: string }>;
  missingSeatIds: string[];
} {
  const selected =
    params.selectedSeatIds instanceof Set
      ? params.selectedSeatIds
      : new Set(params.selectedSeatIds);
  const byId = new Map(params.rows.map((row) => [row.seatId, row]));
  const deletable: OrganizationSeatDeletionRow[] = [];
  const blocked: Array<{ row: OrganizationSeatDeletionRow; reason: string }> = [];
  const missingSeatIds: string[] = [];

  for (const seatId of selected) {
    const row = byId.get(seatId);
    if (!row) {
      missingSeatIds.push(seatId);
      continue;
    }
    const eligibility = resolveOrganizationSeatDeleteEligibility(row);
    if (eligibility.allowed) {
      deletable.push(row);
      continue;
    }
    blocked.push({ row, reason: eligibility.reason ?? "不可删除" });
  }

  return { deletable, blocked, missingSeatIds };
}
