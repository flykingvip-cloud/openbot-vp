// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ChatCheckpoint } from "../types/chat-types.ts";
import {
  diagnoseCheckpointListVisibility,
  diagnoseCheckpointVisibility,
} from "./checkpoint-visibility-diagnostics.ts";

function cp(
  partial: Partial<ChatCheckpoint> & Pick<ChatCheckpoint, "checkpointId">,
): ChatCheckpoint {
  return {
    createdAt: "2026-10-31T00:00:00.000Z",
    summary: "s",
    restorable: { files: true, transcript: true },
    externalEffects: { present: false, kinds: [] },
    ...partial,
  };
}

describe("checkpoint visibility diagnostics P0", () => {
  it("flags missing boundary as boundary_missing_source", () => {
    const d = diagnoseCheckpointVisibility(cp({ checkpointId: "cp-1" }), [
      { id: "u1", role: "user" },
    ]);
    expect(d.inlineVisible).toBe(false);
    expect(d.reasonCodes).toContain("boundary_missing_source");
  });

  it("flags dual-false restorable as not_restorable", () => {
    const d = diagnoseCheckpointVisibility(
      cp({
        checkpointId: "cp-2",
        boundaryMessageId: "b1",
        restorable: { files: false, transcript: false },
      }),
      [
        { id: "b1", role: "assistant" },
        { id: "u1", role: "user" },
      ],
    );
    expect(d.reasonCodes).toContain("not_restorable");
  });

  it("flags tip boundary as tip_noop but still matches tip-fallback paint", () => {
    const history = [
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant" },
    ];
    const d = diagnoseCheckpointVisibility(
      cp({ checkpointId: "cp-tip", boundaryMessageId: "a1" }),
      history,
    );
    // Source boundary is tip (no truncate), but UI tip-fallback still paints a line.
    expect(d.sourceBoundaryState).toBe("tip");
    expect(d.reasonCodes).toContain("tip_noop");
    expect(d.inlineVisible).toBe(true);
  });

  it("flags older-than-recent-window when a newer checkpoint already occupies the tip slot", () => {
    const history = [
      { id: "b-old", role: "assistant" },
      { id: "u-old", role: "user" },
      { id: "a-old", role: "assistant" },
      { id: "b-mid", role: "assistant" },
      { id: "u-mid", role: "user" },
      { id: "a-mid", role: "assistant" },
      { id: "b-new", role: "assistant" },
      { id: "u-new", role: "user" },
    ];
    // Alone, tip-fallback would still paint cp-old on the latest user turn.
    // With a truncating recent checkpoint present, cp-old stays outside the window.
    const list = diagnoseCheckpointListVisibility(
      [
        cp({
          checkpointId: "cp-old",
          boundaryMessageId: "b-old",
          createdAt: "2026-01-01T00:00:00Z",
        }),
        cp({
          checkpointId: "cp-new",
          boundaryMessageId: "b-new",
          createdAt: "2026-01-02T00:00:00Z",
        }),
      ],
      history,
    );
    const d = list.find((x) => x.checkpointId === "cp-old")!;
    expect(d.inlineVisible).toBe(false);
    expect(d.reasonCodes).toContain("outside_recent_window");
    expect(list.find((x) => x.checkpointId === "cp-new")?.inlineVisible).toBe(true);
  });

  it("flags unknown boundary id as outside_loaded_page even when tip-fallback paints", () => {
    const history = [{ id: "u1", role: "user" }];
    const d = diagnoseCheckpointVisibility(
      cp({ checkpointId: "cp-x", boundaryMessageId: "not-in-page" }),
      history,
    );
    // Stored id is absent from the page; UI tip-fallback may still paint a line.
    expect(d.reasonCodes).toContain("outside_loaded_page");
    expect(d.sourceBoundaryState).toBe("unknown");
    expect(d.inlineVisible).toBe(true);
  });

  it("keeps outside_loaded_page hidden when history has no user turn to paint on", () => {
    const d = diagnoseCheckpointVisibility(
      cp({ checkpointId: "cp-x", boundaryMessageId: "not-in-page" }),
      [{ id: "a1", role: "assistant" }],
    );
    expect(d.inlineVisible).toBe(false);
    expect(d.reasonCodes).toContain("outside_loaded_page");
  });

  it("marks a truncating recent-window checkpoint inlineVisible", () => {
    const history = [
      { id: "b1", role: "assistant" },
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant" },
    ];
    const list = diagnoseCheckpointListVisibility(
      [cp({ checkpointId: "cp-ok", boundaryMessageId: "b1" })],
      history,
    );
    expect(list[0]?.inlineVisible).toBe(true);
    expect(list[0]?.reasonCodes).toEqual([]);
  });
});
