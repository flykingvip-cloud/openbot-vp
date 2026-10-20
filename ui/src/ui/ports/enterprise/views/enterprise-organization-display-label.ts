/** Display SoT for organization queue labels. Never render an email, UUID, or role code as a job, person, or digital-human name. */

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrganizationOpaqueId(value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  return Boolean(text) && OPAQUE_ID.test(text);
}

export function isOrganizationEmailLikeLabel(value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  return Boolean(text) && (EMAIL_LIKE.test(text) || text.includes("@"));
}

export function resolveOrganizationHumanLabel(value: string | null | undefined): string | null {
  const text = value?.trim() || null;
  if (!text || isOrganizationEmailLikeLabel(text) || isOrganizationOpaqueId(text)) {
    return null;
  }
  return text;
}

export function resolveOrganizationSeatDisplayName(title: string): string {
  const human = resolveOrganizationHumanLabel(title);
  return human ?? "待补岗位名";
}

export function resolveOrganizationMemberDisplayLabel(params: {
  lookup: Map<string, string>;
  userId: string | null | undefined;
  explicitDisplayName?: string | null;
}): string | null {
  const humanExplicit = resolveOrganizationHumanLabel(params.explicitDisplayName);
  const userId = params.userId?.trim() || "";
  if (humanExplicit) {
    return humanExplicit;
  }
  if (userId) {
    const fromLookup = resolveOrganizationHumanLabel(params.lookup.get(userId.toLowerCase()));
    if (fromLookup) {
      return fromLookup;
    }
    if (isOrganizationOpaqueId(userId)) {
      return null;
    }
    if (userId.includes("@")) {
      return userId.split("@")[0] || null;
    }
    const humanUserId = resolveOrganizationHumanLabel(userId);
    return humanUserId;
  }
  return null;
}

/** 数字人可见名跟着岗位名走，不使用角色编码或 agent id。 */
export function resolveOrganizationDigitalHumanName(seatTitle: string): string {
  const position = resolveOrganizationSeatDisplayName(seatTitle);
  if (position === "待补岗位名") {
    return "待补数字人名";
  }
  return `${position}数字人`;
}

/** Older approval labels append `· 席位 <id>`. Keep the human prefix only. */
export function stripOrganizationSeatIdSuffix(label: string): string {
  return label.replace(/\s*·\s*席位\s+\S+$/u, "").trim();
}

export function buildOrganizationMemberDisplayLookup(
  members: ReadonlyArray<{ user: string; displayLabel: string }>,
): Map<string, string> {
  return new Map(
    members.flatMap((member) => {
      const user = member.user.trim().toLowerCase();
      const label = resolveOrganizationHumanLabel(member.displayLabel);
      return user && label ? ([[user, label]] as const) : [];
    }),
  );
}
