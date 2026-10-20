import { resolveDmDecisionRoomAnchorText } from "../../../../src/gateway/collaboration-dispatch/dm-decision-room-anchor.js";
import { t } from "../../i18n/index.ts";

/** Client helper: room-only anchor copy when a group turn sends a DM decision widget. */
export function resolveClientDmDecisionRoomAnchor(locale?: string | null): string {
  const fromI18n = t("chat.dmDecisionRoomAnchor");
  if (fromI18n && fromI18n !== "chat.dmDecisionRoomAnchor") {
    return fromI18n;
  }
  return resolveDmDecisionRoomAnchorText(locale);
}
