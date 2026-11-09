import { beforeEach, expect, it, vi } from "vitest";
import { resolveAuthProfileOrder } from "../../agents/model-auth.js";
import { resolveRunAuthProfileCandidates } from "./auth-profile-candidates.js";
vi.mock("../../agents/model-auth.js", () => ({ resolveAuthProfileOrder: vi.fn() }));
beforeEach(() => vi.mocked(resolveAuthProfileOrder).mockReset());
const store = {
  version: 1 as const,
  profiles: { p: { type: "api_key" as const, provider: "openai", key: "test-only" } },
};
it("preserves a valid user pin and rejects excluded pins", () => {
  vi.mocked(resolveAuthProfileOrder).mockReturnValue(["other", "p"]);
  expect(
    resolveRunAuthProfileCandidates({
      store,
      config: undefined,
      provider: "openai",
      authProfileId: " p ",
      authProfileIdSource: "user",
    }),
  ).toEqual({ lockedProfileId: "p", profileCandidates: ["p"] });
  vi.mocked(resolveAuthProfileOrder).mockReturnValue(["other"]);
  expect(() =>
    resolveRunAuthProfileCandidates({
      store,
      config: undefined,
      provider: "openai",
      authProfileId: "p",
      authProfileIdSource: "user",
    }),
  ).toThrow("not configured");
});
it("does not lock a foreign provider and retains host fallback candidate", () => {
  vi.mocked(resolveAuthProfileOrder).mockReturnValue([]);
  expect(
    resolveRunAuthProfileCandidates({
      store,
      config: undefined,
      provider: "anthropic",
      authProfileId: "p",
      authProfileIdSource: "user",
    }),
  ).toEqual({ lockedProfileId: undefined, profileCandidates: [undefined] });
});
