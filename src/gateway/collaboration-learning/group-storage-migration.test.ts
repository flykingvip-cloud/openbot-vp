import { describe, expect, it } from "vitest";
import { mergeLedgerItems, type LedgerItem } from "./group-storage-migration.js";

describe("mergeLedgerItems", () => {
  it("merges by id and keeps the newest updated_at", () => {
    const merged = mergeLedgerItems<LedgerItem>([
      [
        { id: "task_a", updated_at: "2026-05-01T00:00:00.000Z" },
        { id: "task_b", updated_at: "2026-05-02T00:00:00.000Z" },
      ],
      [
        { id: "task_a", updated_at: "2026-06-19T02:02:27.458Z" },
        { id: "task_c", updated_at: "2026-05-03T00:00:00.000Z" },
      ],
    ]);
    expect(merged.map((entry) => entry.id)).toEqual(["task_b", "task_c", "task_a"]);
    expect(merged.find((entry) => entry.id === "task_a")?.updated_at).toBe(
      "2026-06-19T02:02:27.458Z",
    );
  });
});
