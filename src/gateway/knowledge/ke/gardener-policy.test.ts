import { describe, expect, it } from "vitest";
import {
  GARDENER_ALLOWED_WRITES,
  assertGardenerRpc,
  isGardenerRawHashOverwriteForbidden,
} from "./gardener-policy.js";

describe("ke gardener-policy", () => {
  it("allows the documented write menu", () => {
    for (const method of GARDENER_ALLOWED_WRITES) {
      expect(assertGardenerRpc(method)).toBe("allow");
    }
  });

  it("forbids delete, unbind, detach, and expert upsert", () => {
    expect(assertGardenerRpc("knowledge.base.delete")).toBe("forbid");
    expect(assertGardenerRpc("knowledge.base.documents.delete")).toBe("forbid");
    expect(assertGardenerRpc("knowledge.base.documents.detach")).toBe("forbid");
    expect(assertGardenerRpc("knowledge.source.unbind")).toBe("forbid");
    expect(assertGardenerRpc("knowledge.local-folder.unbind")).toBe("forbid");
    expect(assertGardenerRpc("knowledge.connector.unbind")).toBe("forbid");
    expect(assertGardenerRpc("knowledge.governance.expert.upsert")).toBe("forbid");
  });

  it("returns unknown for reads and unmarked writes, never overwrites raw_hash", () => {
    expect(assertGardenerRpc("knowledge.base.list")).toBe("unknown");
    expect(assertGardenerRpc("knowledge.personal.upload")).toBe("unknown");
    expect(assertGardenerRpc("")).toBe("unknown");
    expect(isGardenerRawHashOverwriteForbidden()).toBe(true);
  });
});
