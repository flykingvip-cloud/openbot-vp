// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

describe("chat focus mode", () => {
  it("redirects legacy /chat and keeps focus mode as a persisted setting", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(app.tab).toBe("me");
    expect(window.location.pathname).toBe("/");
    expect(app.querySelector(".shell--workspace-immersive")).not.toBeNull();

    app.applySettings({
      ...app.settings,
      chatFocusMode: true,
    });
    await app.updateComplete;
    expect(app.settings.chatFocusMode).toBe(true);

    app.applySettings({
      ...app.settings,
      chatFocusMode: false,
    });
    await app.updateComplete;
    expect(app.settings.chatFocusMode).toBe(false);
  });
});
