// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.ts";
import { parseExecApprovalRequested } from "./controllers/exec-approval.ts";
import { mountApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

beforeEach(async () => {
  await i18n.setLocale("en");
});

describe("immersive workspace exec approval", () => {
  it("mounts Always / Once / Never while the shell stays on tab=me", async () => {
    const app = mountApp("/");
    await app.updateComplete;
    expect(app.tab).toBe("me");
    expect(app.querySelector(".shell--workspace-immersive")).not.toBeNull();
    expect(app.querySelector("[data-surface='local-exec-permission']")).toBeNull();

    const entry = parseExecApprovalRequested({
      id: "approval-me",
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
      request: {
        command: "printf 'ok' > \"$HOME/Desktop/OpenBot-Local-Proof.txt\"",
        host: "node",
        nodeId: "f44169db-aaaa-bbbb-cccc-ddddeeee1111",
        nodeDisplayName: "UPBEYOND Mac",
        cwd: "/Users/demo",
        security: "allowlist",
        ask: "on-miss",
      },
    });
    if (!entry) {
      throw new Error("fixture failed to parse");
    }
    app.execApprovalQueue = [entry];
    await app.updateComplete;

    const thread = app.querySelector(".chat-thread");
    const inline = thread?.querySelector("[data-placement='conversation']");
    const overlay = app.querySelector(
      ".exec-approval-overlay[data-surface='local-exec-permission']",
    );
    expect(app.tab).toBe("me");
    expect(app.querySelector(".shell--workspace-immersive")).not.toBeNull();
    const card = inline ?? overlay;
    expect(card).not.toBeNull();
    if (thread) {
      expect(inline).not.toBeNull();
      expect(overlay).toBeNull();
      expect(inline?.getAttribute("data-placement")).toBe("conversation");
    }
    expect(card?.textContent).toContain("UPBEYOND Mac");
    expect(card?.textContent).not.toContain("f44169db");
    expect(
      [...(card?.querySelectorAll("button") ?? [])].map((button) =>
        button.getAttribute("data-decision"),
      ),
    ).toEqual(["allow-always", "allow-once", "deny"]);
  });
});
