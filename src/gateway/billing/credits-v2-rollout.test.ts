import { describe, expect, it } from "vitest";
import {
  resolveCreditsV2RolloutStage,
  resolveEffectiveCreditsV2Enabled,
} from "./credits-v2-rollout.js";

describe("credits-v2-rollout", () => {
  it("defaults rollout stage to off", () => {
    expect(resolveCreditsV2RolloutStage("ent-a", {})).toBe("off");
  });

  it("returns full when rollout env is full", () => {
    expect(resolveCreditsV2RolloutStage("ent-a", { OPENBOT_CREDITS_V2_ROLLOUT: "full" })).toBe(
      "full",
    );
  });

  it("canary only applies to allowlisted enterprises", () => {
    const env = {
      OPENBOT_CREDITS_V2_ROLLOUT: "canary",
      OPENBOT_CREDITS_V2_CANARY_ENTERPRISES: "ent-canary,ent-other",
    };
    expect(resolveCreditsV2RolloutStage("ent-canary", env)).toBe("canary");
    expect(resolveCreditsV2RolloutStage("ent-outsider", env)).toBe("off");
  });

  it("effective v2 requires tenant feature and rollout stage", () => {
    const features = { creditsV2Enabled: true };
    expect(resolveEffectiveCreditsV2Enabled("ent-a", features, {})).toBe(false);
    expect(
      resolveEffectiveCreditsV2Enabled("ent-a", features, {
        OPENBOT_CREDITS_V2_ROLLOUT: "full",
      }),
    ).toBe(true);
    expect(
      resolveEffectiveCreditsV2Enabled("ent-a", features, {
        OPENBOT_CREDITS_V2_ROLLOUT: "canary",
        OPENBOT_CREDITS_V2_CANARY_ENTERPRISES: "ent-a",
      }),
    ).toBe(true);
    expect(
      resolveEffectiveCreditsV2Enabled(
        "ent-a",
        { creditsV2Enabled: false },
        {
          OPENBOT_CREDITS_V2_ROLLOUT: "full",
        },
      ),
    ).toBe(false);
  });
});
