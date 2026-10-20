/**
 * When a group turn sends a decision widget to DM, post this single room
 * anchor instead of dumping the option list into the room.
 */

export const DM_DECISION_ROOM_ANCHOR_ZH =
  "需要你确认的选项我发到私聊了；定下来我再把结果贴回这里。";

export const DM_DECISION_ROOM_ANCHOR_EN =
  "I sent the options that need your confirmation to DM. Once you decide, I'll post the result back here.";

const DM_TARGET_ALIASES = new Set(["dm", "direct"]);

const DECISION_WIDGET_KINDS = new Set([
  "decision",
  "decision_widget",
  "decision-widget",
  "choice",
  "confirm",
]);

function normalizeToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isDmDeliveryTarget(target: unknown): boolean {
  const token = normalizeToken(target);
  if (DM_TARGET_ALIASES.has(token)) {
    return true;
  }
  if (!target || typeof target !== "object") {
    return false;
  }
  const record = target as Record<string, unknown>;
  return [record.to, record.target, record.destination, record.channel].some((value) =>
    DM_TARGET_ALIASES.has(normalizeToken(value)),
  );
}

export function isDecisionWidgetKind(kind: unknown): boolean {
  return DECISION_WIDGET_KINDS.has(normalizeToken(kind));
}

/** True when a group-context payload is a decision widget aimed at DM. */
export function isDmDecisionWidgetFromGroup(payload: {
  to?: unknown;
  target?: unknown;
  destination?: unknown;
  kind?: unknown;
  widgetKind?: unknown;
  type?: unknown;
  groupContext?: boolean;
}): boolean {
  if (payload.groupContext === false) {
    return false;
  }
  const target = payload.to ?? payload.target ?? payload.destination;
  const kind = payload.kind ?? payload.widgetKind ?? payload.type;
  return isDmDeliveryTarget(target) && isDecisionWidgetKind(kind);
}

export function resolveDmDecisionRoomAnchorText(language?: string | null): string {
  const normalized = language?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("en")) {
    return DM_DECISION_ROOM_ANCHOR_EN;
  }
  return DM_DECISION_ROOM_ANCHOR_ZH;
}
