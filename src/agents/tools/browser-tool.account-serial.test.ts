import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resetAccountBrowserCoordinatorForTests } from "../../site-capability/coordinator.js";
import {
  getActiveAccountBrowserDesk,
  resetActiveAccountBrowserDeskForTests,
} from "../../site-capability/desk.js";
import { runWithAccountBrowserSerial } from "./browser-tool.account-serial.js";

describe("runWithAccountBrowserSerial", () => {
  beforeEach(() => {
    resetAccountBrowserCoordinatorForTests();
    resetActiveAccountBrowserDeskForTests();
  });
  afterEach(() => {
    resetAccountBrowserCoordinatorForTests();
    resetActiveAccountBrowserDeskForTests();
  });

  it("installs the account-browser desk before snapshot when none is active", async () => {
    expect(getActiveAccountBrowserDesk()).toBeNull();
    const out = await runWithAccountBrowserSerial({
      accountBrowserScopeKey: "account:001:90fed19a:browser",
      action: "snapshot",
      params: {},
      run: async () => "ok-snapshot",
    });
    expect(out).toBe("ok-snapshot");
    expect(getActiveAccountBrowserDesk()).not.toBeNull();
  });
});
