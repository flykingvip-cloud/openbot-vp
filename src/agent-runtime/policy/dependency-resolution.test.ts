import { expect, it } from "vitest";
import { resolveDependencyBlock } from "./dependency-resolution.js";
const fallback = {
  id: "use-authorized-local-material",
  authorized: true,
  reversible: true,
  attempted: false,
};
it.each(["permission", "payment", "missing_user_fact"] as const)(
  "requires human input for %s without bypass",
  (reason) => {
    expect(
      resolveDependencyBlock({ reason, fallbacks: [fallback], retryCount: 0, maxRetries: 2 }),
    ).toEqual({ kind: "needs_user", reason });
  },
);
it("selects only an untried authorized reversible alternative", () => {
  expect(
    resolveDependencyBlock({
      reason: "timeout",
      fallbacks: [
        { ...fallback, id: "unauthorized", authorized: false },
        { ...fallback, id: "already-tried", attempted: true },
        fallback,
      ],
      retryCount: 0,
      maxRetries: 2,
    }),
  ).toEqual({ kind: "fallback", fallbackId: fallback.id });
});
it("escalates exhausted or unavailable alternatives instead of looping", () => {
  expect(
    resolveDependencyBlock({
      reason: "child_failed",
      fallbacks: [fallback],
      retryCount: 2,
      maxRetries: 2,
    }).kind,
  ).toBe("needs_user");
  expect(
    resolveDependencyBlock({ reason: "partial", fallbacks: [], retryCount: 0, maxRetries: 2 }),
  ).toEqual({ kind: "needs_user", reason: "partial" });
});
