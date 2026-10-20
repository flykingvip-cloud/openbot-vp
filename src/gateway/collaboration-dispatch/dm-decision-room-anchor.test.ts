import { describe, expect, test } from "vitest";
import {
  DM_DECISION_ROOM_ANCHOR_EN,
  DM_DECISION_ROOM_ANCHOR_ZH,
  isDmDecisionWidgetFromGroup,
  isDmDeliveryTarget,
  resolveDmDecisionRoomAnchorText,
} from "./dm-decision-room-anchor.js";

describe("dm decision room anchor", () => {
  test("recognizes to:dm and direct aliases", () => {
    expect(isDmDeliveryTarget("dm")).toBe(true);
    expect(isDmDeliveryTarget("direct")).toBe(true);
    expect(isDmDeliveryTarget({ to: "dm" })).toBe(true);
    expect(isDmDeliveryTarget("room")).toBe(false);
  });

  test("matches a group-context decision widget aimed at DM", () => {
    expect(
      isDmDecisionWidgetFromGroup({
        to: "dm",
        kind: "decision",
        groupContext: true,
      }),
    ).toBe(true);
    expect(
      isDmDecisionWidgetFromGroup({
        to: "dm",
        kind: "decision",
        groupContext: false,
      }),
    ).toBe(false);
    expect(
      isDmDecisionWidgetFromGroup({
        to: "room",
        kind: "decision",
      }),
    ).toBe(false);
  });

  test("does not include option lists in the room anchor", () => {
    expect(DM_DECISION_ROOM_ANCHOR_ZH).toBe(
      "需要你确认的选项我发到私聊了；定下来我再把结果贴回这里。",
    );
    expect(DM_DECISION_ROOM_ANCHOR_EN).not.toMatch(/A\)|option 1|选项一/i);
    expect(resolveDmDecisionRoomAnchorText("zh")).toBe(DM_DECISION_ROOM_ANCHOR_ZH);
    expect(resolveDmDecisionRoomAnchorText("en")).toBe(DM_DECISION_ROOM_ANCHOR_EN);
  });
});
