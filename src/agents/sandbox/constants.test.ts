import { describe, expect, it } from "vitest";
import {
  DEFAULT_SANDBOX_BROWSER_IMAGE,
  DEFAULT_SANDBOX_IMAGE,
  LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS,
  LEGACY_SANDBOX_IMAGE_ALIAS,
  planSandboxImageAlias,
  sandboxImageCompatPeer,
} from "./constants.js";

describe("sandbox image alias", () => {
  it("uses openbot-sandbox as the default and keeps openclaw-sandbox as the peer", () => {
    expect(DEFAULT_SANDBOX_IMAGE).toBe("openbot-sandbox:bookworm-slim");
    expect(LEGACY_SANDBOX_IMAGE_ALIAS).toBe("openclaw-sandbox:bookworm-slim");
    expect(sandboxImageCompatPeer(DEFAULT_SANDBOX_IMAGE)).toBe(LEGACY_SANDBOX_IMAGE_ALIAS);
    expect(sandboxImageCompatPeer(LEGACY_SANDBOX_IMAGE_ALIAS)).toBe(DEFAULT_SANDBOX_IMAGE);
    expect(DEFAULT_SANDBOX_BROWSER_IMAGE).toBe("openbot-sandbox-browser:bookworm-slim");
    expect(LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS).toBe("openclaw-sandbox-browser:bookworm-slim");
    expect(sandboxImageCompatPeer(DEFAULT_SANDBOX_BROWSER_IMAGE)).toBe(
      LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS,
    );
    expect(sandboxImageCompatPeer(LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS)).toBe(
      DEFAULT_SANDBOX_BROWSER_IMAGE,
    );
    expect(sandboxImageCompatPeer("custom:1")).toBeUndefined();
  });

  it("reuses the tag that is already present", () => {
    expect(
      planSandboxImageAlias({
        requested: DEFAULT_SANDBOX_IMAGE,
        requestedPresent: false,
        peerPresent: true,
      }),
    ).toEqual({
      kind: "retag",
      from: LEGACY_SANDBOX_IMAGE_ALIAS,
      to: DEFAULT_SANDBOX_IMAGE,
    });
    expect(
      planSandboxImageAlias({
        requested: LEGACY_SANDBOX_IMAGE_ALIAS,
        requestedPresent: false,
        peerPresent: true,
      }),
    ).toEqual({
      kind: "retag",
      from: DEFAULT_SANDBOX_IMAGE,
      to: LEGACY_SANDBOX_IMAGE_ALIAS,
    });
    expect(
      planSandboxImageAlias({
        requested: DEFAULT_SANDBOX_IMAGE,
        requestedPresent: true,
        peerPresent: false,
      }),
    ).toEqual({ kind: "use", image: DEFAULT_SANDBOX_IMAGE });
    expect(
      planSandboxImageAlias({
        requested: DEFAULT_SANDBOX_BROWSER_IMAGE,
        requestedPresent: false,
        peerPresent: true,
      }),
    ).toEqual({
      kind: "retag",
      from: LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS,
      to: DEFAULT_SANDBOX_BROWSER_IMAGE,
    });
    expect(
      planSandboxImageAlias({
        requested: LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS,
        requestedPresent: false,
        peerPresent: true,
      }),
    ).toEqual({
      kind: "retag",
      from: DEFAULT_SANDBOX_BROWSER_IMAGE,
      to: LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS,
    });
    expect(
      planSandboxImageAlias({
        requested: "custom:1",
        requestedPresent: false,
        peerPresent: false,
      }),
    ).toEqual({ kind: "absent" });
  });
});
