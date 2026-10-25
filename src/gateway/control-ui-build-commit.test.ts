import { describe, expect, it } from "vitest";
import { resolveControlUiBuildCommit } from "./control-ui-build-commit.js";

describe("resolveControlUiBuildCommit", () => {
  it("prefers OPENBOT_BUILD_SHA full tip", () => {
    expect(
      resolveControlUiBuildCommit({
        OPENBOT_BUILD_SHA: "d06542abea832b48c4ef0ba96d428e8a922e3e3d",
      }),
    ).toBe("d06542abea832b48c4ef0ba96d428e8a922e3e3d");
  });

  it("accepts short GIT_SHA when build sha absent", () => {
    expect(resolveControlUiBuildCommit({ GIT_SHA: "52a025f" })).toBe("52a025f");
  });

  it("returns null-ish fallback via resolveCommitHash when env empty", () => {
    const got = resolveControlUiBuildCommit({});
    // May be short hash from live checkout or null in bare env — just must not throw.
    expect(got === null || /^[0-9a-f]{7,40}$/.test(got)).toBe(true);
  });
});
