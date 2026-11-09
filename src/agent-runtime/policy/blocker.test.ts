import { describe, expect, it } from "vitest";
import { gradeBlocker } from "./blocker.js";

describe("blocker classification evidence", () => {
  it("prioritizes passed evidence over repeated blockers", () => {
    expect(
      gradeBlocker({
        narrative: "需要 node 20",
        deliverableProducible: false,
        probes: [{ reason: "node", passed: true }],
      }),
    ).toBe("already_cleared");
    expect(
      gradeBlocker({
        narrative: "缺少 playwright",
        deliverableProducible: false,
        probes: [{ reason: "playwright", passed: false }],
      }),
    ).toBe("mainline");
  });
  it("keeps side-path problems separate unless the mainline is genuinely blocked", () => {
    expect(gradeBlocker({ narrative: "task_ledger失败", deliverableProducible: false })).toBe(
      "side_path",
    );
    expect(
      gradeBlocker({ narrative: "task_ledger失败，无法产生交付物", deliverableProducible: false }),
    ).toBe("mainline");
    expect(
      gradeBlocker({ narrative: "task_ledger失败，无法产生交付物", deliverableProducible: true }),
    ).toBe("side_path");
  });
});
