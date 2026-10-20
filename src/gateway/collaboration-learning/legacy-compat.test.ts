import { describe, expect, it } from "vitest";
import {
  COLLABORATION_CONVERGENCE_STATUS,
  COLLABORATION_SPACES_MIRROR_SENTENCE,
  LEGACY_COMPAT_REMOVAL_COMPLETED,
  LEGACY_COMPAT_REMOVAL_QUEUE,
} from "./legacy-compat.js";

describe("collaboration legacy compat registry", () => {
  it("declares legacy-free status after Phase 6", () => {
    expect(COLLABORATION_CONVERGENCE_STATUS).toBe("legacy-free");
  });

  it("pins the spaces mirror sentence for docs and onboarding", () => {
    expect(COLLABORATION_SPACES_MIRROR_SENTENCE).toContain("UI / 治理镜像");
    expect(COLLABORATION_SPACES_MIRROR_SENTENCE).toContain("runtime memory");
  });

  it("records completed LC-1 through LC-7 removals", () => {
    expect(LEGACY_COMPAT_REMOVAL_COMPLETED.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["LC-1", "LC-5", "LC-7"]),
    );
    expect(LEGACY_COMPAT_REMOVAL_QUEUE).toEqual([]);
  });
});
