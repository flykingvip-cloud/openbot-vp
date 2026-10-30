// @vitest-environment node
/**
 * P2-G — resolvePlatformModelsMode defaults + saved aor_enhanced path.
 * native is a legitimate default (not a bug). Saved mode must be what the gate reads.
 */
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { resolvePlatformModelsMode } from "./platform-models-config.js";

describe("resolvePlatformModelsMode (P2-G)", () => {
  it("defaults to native when mode unset (legitimate default)", () => {
    expect(resolvePlatformModelsMode({} as OpenBotConfig)).toBe("native");
    expect(resolvePlatformModelsMode({ gateway: { platform: {} } } as OpenBotConfig)).toBe(
      "native",
    );
    expect(
      resolvePlatformModelsMode({
        gateway: { platform: { models: {} } },
      } as OpenBotConfig),
    ).toBe("native");
  });

  it("reads saved aor_enhanced from gateway.platform.models.mode (onboarding/system-settings save path)", () => {
    const cfg = {
      gateway: { platform: { models: { mode: "aor_enhanced" } } },
    } as OpenBotConfig;
    expect(resolvePlatformModelsMode(cfg)).toBe("aor_enhanced");
  });

  it("rejects unknown mode values back to native (no synthetic smart label)", () => {
    const cfg = {
      gateway: { platform: { models: { mode: "smart" } } },
    } as unknown as OpenBotConfig;
    expect(resolvePlatformModelsMode(cfg)).toBe("native");
  });
});
