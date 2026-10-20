import { afterEach, describe, expect, it } from "vitest";
import {
  listUserPresence,
  releaseUserPresence,
  resetUserPresenceForTests,
  resolveUserPresence,
  touchUserPresenceOnline,
} from "./user-presence.js";

describe("user-presence", () => {
  afterEach(() => {
    resetUserPresenceForTests();
  });

  it("marks a user online on connect and offline after matching disconnects", () => {
    touchUserPresenceOnline({ userEmail: "Ceo@Example.com", userId: "uuid-1" }, 1_000);
    expect(resolveUserPresence(["ceo@example.com"]).online).toBe(true);
    expect(resolveUserPresence(["uuid-1"]).online).toBe(true);
    expect(resolveUserPresence(["ceo@example.com"]).lastActiveAtMs).toBe(1_000);

    releaseUserPresence({ userEmail: "ceo@example.com" }, 2_000);
    expect(resolveUserPresence(["uuid-1"]).online).toBe(false);
    expect(resolveUserPresence(["uuid-1"]).lastActiveAtMs).toBe(2_000);
  });

  it("keeps the user online while any connection remains", () => {
    touchUserPresenceOnline({ userEmail: "a@x.com" }, 1);
    touchUserPresenceOnline({ userEmail: "a@x.com", userId: "u-a" }, 2);
    expect(resolveUserPresence(["a@x.com"]).online).toBe(true);

    releaseUserPresence({ userEmail: "a@x.com" }, 3);
    expect(resolveUserPresence(["u-a"]).online).toBe(true);

    releaseUserPresence({ userId: "u-a" }, 4);
    expect(resolveUserPresence(["a@x.com", "u-a"]).online).toBe(false);
  });

  it("ignores empty identities and unknown users", () => {
    touchUserPresenceOnline({});
    releaseUserPresence({});
    expect(resolveUserPresence([])).toEqual({ online: false });
    expect(resolveUserPresence(["missing@x.com"]).online).toBe(false);
    expect(listUserPresence()).toEqual([]);
  });
});
