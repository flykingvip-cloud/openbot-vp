import { describe, expect, it } from "vitest";
import {
  exposeStoredHostReadBinding,
  withStoredResultReadContext,
} from "../../state/stored-result-read-binding.js";
import {
  createAuthorizeStoredResultRead,
  resolveStoredResultReadHook,
} from "./authorize-stored-result-read.js";

describe("createAuthorizeStoredResultRead", () => {
  it("fails closed when the current host binding is missing", () => {
    expect(createAuthorizeStoredResultRead(undefined)({ forged: true })).toBe("unverifiable");
    expect(createAuthorizeStoredResultRead("  ")({ forged: true })).toBe("unverifiable");
  });

  it("fails closed when the stored receipt has no stamp", async () => {
    const hook = resolveStoredResultReadHook({ sessionKey: "sess", runId: "run" });
    expect(hook.hostReadBinding).toBeDefined();
    await withStoredResultReadContext(hook.hostReadBinding!, async () => {
      expect(hook.authorizeStoredResultRead({ anything: "from-model" })).toBe("unverifiable");
    });
  });

  it("allows only an exact current-to-stored host binding match", async () => {
    const same = resolveStoredResultReadHook({ sessionKey: "sess", runId: "run-a" });
    const other = resolveStoredResultReadHook({ sessionKey: "sess", runId: "run-b" });
    await withStoredResultReadContext(same.hostReadBinding!, async () => {
      exposeStoredHostReadBinding(same.hostReadBinding);
      expect(same.authorizeStoredResultRead({})).toBe("allowed");
    });
    await withStoredResultReadContext(other.hostReadBinding!, async () => {
      exposeStoredHostReadBinding(same.hostReadBinding);
      expect(other.authorizeStoredResultRead({})).toBe("denied");
    });
  });

  it("ignores model parameters and does not use write or membership inputs", async () => {
    const hook = resolveStoredResultReadHook({
      sessionKey: "sess",
      runId: "run",
    });
    await withStoredResultReadContext(hook.hostReadBinding!, async () => {
      exposeStoredHostReadBinding(hook.hostReadBinding);
      expect(
        hook.authorizeStoredResultRead({
          enterpriseId: "ent-admin",
          membershipId: "member-1",
          owner: true,
        }),
      ).toBe("allowed");
    });
    const membershipOnly = resolveStoredResultReadHook({
      sessionKey: undefined,
      runId: undefined,
    });
    expect(membershipOnly.hostReadBinding).toBeUndefined();
    expect(membershipOnly.authorizeStoredResultRead({ membershipId: "member-1" })).toBe(
      "unverifiable",
    );
  });
});
