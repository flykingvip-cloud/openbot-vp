import { describe, expect, it } from "vitest";
import { listActiveMembersForWrap } from "./client-team-rotation.ts";

describe("listActiveMembersForWrap", () => {
  it("keeps active members with public keys", () => {
    const out = listActiveMembersForWrap([
      { memberAccountId: "owner", status: "active", publicKeyB64: "pk-owner" },
      { memberAccountId: "gone", status: "revoked", publicKeyB64: "pk-gone" },
      { memberAccountId: "broken", status: "active", publicKeyB64: "" },
    ]);
    expect(out).toEqual([{ memberAccountId: "owner", publicKeyB64: "pk-owner" }]);
  });
});
