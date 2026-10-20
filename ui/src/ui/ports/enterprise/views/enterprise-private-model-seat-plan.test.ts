import { describe, expect, it } from "vitest";
import { planSeatModelGrantWrites } from "./enterprise-private-model-seat-plan.ts";

describe("planSeatModelGrantWrites", () => {
  const seats = [
    { seatId: "seat-a", grantedModelIds: ["ent/c/m", "platform/other"] },
    { seatId: "seat-b", grantedModelIds: ["platform/other"] },
    { seatId: "seat-c", grantedModelIds: [] },
  ];

  it("unions newly checked seats and replaces unchecked seats without dropping other models", () => {
    const writes = planSeatModelGrantWrites({
      modelId: "ent/c/m",
      seats,
      selectedSeatIds: new Set(["seat-b", "seat-c"]),
    });
    expect(writes).toEqual([
      {
        subjectType: "seat",
        subjectId: "seat-a",
        grantedModelIds: ["platform/other"],
        mergeMode: "replace",
      },
      {
        subjectType: "seat",
        subjectId: "seat-b",
        grantedModelIds: ["ent/c/m"],
        mergeMode: "union",
      },
      {
        subjectType: "seat",
        subjectId: "seat-c",
        grantedModelIds: ["ent/c/m"],
        mergeMode: "union",
      },
    ]);
  });

  it("writes nothing when the selection already matches the grant", () => {
    expect(
      planSeatModelGrantWrites({
        modelId: "ent/c/m",
        seats,
        selectedSeatIds: new Set(["seat-a"]),
      }),
    ).toEqual([]);
  });
});
