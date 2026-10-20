import { describe, expect, it } from "vitest";
import { computeRevisionId } from "./revision-id.js";

describe("computeRevisionId", () => {
  it("is stable and idempotent for identical inputs", () => {
    const params = {
      vaultId: "vault-1",
      opaquePathId: "path-abc",
      deviceId: "device-a",
      deviceSequence: 3,
      ciphertextHash: "deadbeef",
      parentRevisionIds: ["p2", "p1"],
    };
    const a = computeRevisionId(params);
    const b = computeRevisionId(params);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("sorts parent ids so order does not matter", () => {
    const base = {
      vaultId: "vault-1",
      opaquePathId: "path-abc",
      deviceId: "device-a",
      deviceSequence: 3,
      ciphertextHash: "deadbeef",
    };
    expect(computeRevisionId({ ...base, parentRevisionIds: ["b", "a"] })).toBe(
      computeRevisionId({ ...base, parentRevisionIds: ["a", "b"] }),
    );
  });

  it("changes when sequence or hash changes", () => {
    const base = {
      vaultId: "vault-1",
      opaquePathId: "path-abc",
      deviceId: "device-a",
      deviceSequence: 3,
      ciphertextHash: "deadbeef",
      parentRevisionIds: [] as string[],
    };
    expect(computeRevisionId(base)).not.toBe(computeRevisionId({ ...base, deviceSequence: 4 }));
    expect(computeRevisionId(base)).not.toBe(
      computeRevisionId({ ...base, ciphertextHash: "cafebabe" }),
    );
  });
});
