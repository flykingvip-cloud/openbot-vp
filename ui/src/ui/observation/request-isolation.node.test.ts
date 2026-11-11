import { describe, expect, it } from "vitest";
import { isCurrentObservationResponse } from "./request-isolation.ts";

const current = {
  generation: 2,
  fingerprint: "fp-2",
  connected: true,
  authorized: true,
  sameClient: true,
};

describe("observation request isolation", () => {
  it("drops a late response after generation, fingerprint, auth, or client changes", () => {
    const request = { generation: 1, fingerprint: "fp-1" };
    expect(isCurrentObservationResponse(request, current)).toBe(false);
    expect(
      isCurrentObservationResponse(
        { generation: 2, fingerprint: "fp-2" },
        { ...current, authorized: false },
      ),
    ).toBe(false);
    expect(
      isCurrentObservationResponse(
        { generation: 2, fingerprint: "fp-2" },
        { ...current, sameClient: false },
      ),
    ).toBe(false);
    expect(
      isCurrentObservationResponse(
        { generation: 2, fingerprint: "fp-2" },
        { ...current, connected: false },
      ),
    ).toBe(false);
    expect(isCurrentObservationResponse({ generation: 2, fingerprint: "fp-2" }, current)).toBe(
      true,
    );
  });
});
