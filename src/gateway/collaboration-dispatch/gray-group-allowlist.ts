/**
 * FINAL v3 P0 — Gray-group allowlist matching for Claim / Wake / Challenge contracts.
 *
 * Managed enterprise gray enable MUST bind `{tenantId, groupId}` as
 * `tenantId/groupId`. Bare `groupId` entries are personal_local-only: they
 * never authorize a call that carries a non-empty tenantId (same groupId can
 * collide across tenants). Wildcard tenant `*` matches any present tenantId.
 *
 * Does not flip claimContract / wakeContract / challengeWindow / runtimeNamespace defaults.
 * Does not perform N2 production cutover.
 */

export type GrayGroupAllowlistEntry =
  | { kind: "bare"; groupId: string }
  | { kind: "scoped"; tenantId: string; groupId: string };

/**
 * Parse one allowlist string. Empty / malformed scoped forms return null.
 * Scoped form requires a non-empty tenant segment and group segment
 * (`tenantId/groupId`). Bare form is a non-empty groupId without `/`.
 */
export function parseGrayGroupAllowlistEntry(entry: string): GrayGroupAllowlistEntry | null {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }
  const slash = trimmed.indexOf("/");
  if (slash < 0) {
    return { kind: "bare", groupId: trimmed };
  }
  if (slash === 0 || slash === trimmed.length - 1) {
    return null;
  }
  const tenantId = trimmed.slice(0, slash).trim();
  const groupId = trimmed.slice(slash + 1).trim();
  if (!tenantId || !groupId) {
    return null;
  }
  return { kind: "scoped", tenantId, groupId };
}

/** True when the raw entry is a bare groupId (no tenant segment). */
export function isBareGrayGroupAllowlistEntry(entry: string): boolean {
  return parseGrayGroupAllowlistEntry(entry)?.kind === "bare";
}

/**
 * List bare entries that MUST NOT be used to authorize managed_enterprise
 * gray groups. Ops / tip configs for tenant-scoped groups should use
 * `tenantId/groupId` only.
 */
export function listBareGrayGroupAllowlistEntries(entries: readonly string[]): string[] {
  return entries.filter((entry) => isBareGrayGroupAllowlistEntry(entry));
}

export type MatchGrayGroupAllowlistParams = {
  groupId: string;
  /** Server-resolved tenant; when non-empty, bare entries never match. */
  tenantId?: string | null;
  entries: readonly string[];
};

/**
 * Match group (+ optional tenant) against allowlist entries.
 *
 * Rules (FINAL v3 P0):
 * - Empty groupId → false.
 * - Bare entry matches only when `tenantId` is empty/absent (personal_local).
 * - Scoped entry matches when groupId equals and:
 *   - entry tenant === caller tenant, or
 *   - entry tenant is `*` and caller tenant is non-empty, or
 *   - caller tenant empty and entry tenant is `_local` or `personal_local`
 *     (personal_local layouts only — not `001`, which would be a managed
 *     collision hazard without a proven tenant).
 */
export function matchGrayGroupAllowlist(params: MatchGrayGroupAllowlistParams): boolean {
  const groupId = params.groupId.trim();
  if (!groupId) {
    return false;
  }
  const tenantId = (params.tenantId ?? "").trim();
  const managedCaller = tenantId.length > 0;

  for (const raw of params.entries) {
    const parsed = parseGrayGroupAllowlistEntry(typeof raw === "string" ? raw : "");
    if (!parsed || parsed.groupId !== groupId) {
      continue;
    }
    if (parsed.kind === "bare") {
      if (!managedCaller) {
        return true;
      }
      continue;
    }
    if (parsed.tenantId === tenantId) {
      return true;
    }
    if (parsed.tenantId === "*" && managedCaller) {
      return true;
    }
    if (!managedCaller && (parsed.tenantId === "_local" || parsed.tenantId === "personal_local")) {
      return true;
    }
  }
  return false;
}

/**
 * Format the required managed gray key for docs / tip configs.
 * Example: `formatManagedGrayAllowlistKey("001", "grp-x")` → `001/grp-x`.
 */
export function formatManagedGrayAllowlistKey(tenantId: string, groupId: string): string {
  return `${tenantId.trim()}/${groupId.trim()}`;
}
