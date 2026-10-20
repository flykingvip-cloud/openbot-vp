/**
 * 组织岗位 roleCode 前缀 → 计费席位档位（与 UI `BUILTIN_SEAT_ROLE_PREFIX_RULES` 对齐）。
 */

import type { SeatRole } from "./types.js";

export const BUILTIN_SEAT_ROLE_PREFIX_RULES: Record<string, SeatRole> = {
  MGR: "admin",
  MANAGER: "admin",
  ADMIN: "admin",
  DIRECTOR: "admin",
  LEAD: "creator",
  SALES: "creator",
  CS: "creator",
  OPS: "creator",
  DEV: "creator",
  ENG: "creator",
  FIN: "viewer",
  HR: "viewer",
  VIEW: "viewer",
};

export function extractRoleCodePrefix(roleCode: string | null | undefined): string | null {
  const normalized = roleCode?.trim();
  if (!normalized) {
    return null;
  }
  const segment = normalized.split("-")[0]?.trim();
  return segment ? segment.toUpperCase() : null;
}

export function resolveSeatRoleFromRoleCode(roleCode: string | null | undefined): SeatRole {
  const prefix = extractRoleCodePrefix(roleCode);
  if (prefix && BUILTIN_SEAT_ROLE_PREFIX_RULES[prefix]) {
    return BUILTIN_SEAT_ROLE_PREFIX_RULES[prefix];
  }
  return "viewer";
}
