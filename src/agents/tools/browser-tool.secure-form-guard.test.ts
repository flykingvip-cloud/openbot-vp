import { describe, expect, it, vi } from "vitest";

vi.mock("../../browser/client-actions.js", () => ({
  browserAct: vi.fn(),
  browserArmDialog: vi.fn(),
  browserArmFileChooser: vi.fn(),
  browserNavigate: vi.fn(),
  browserPdfSave: vi.fn(),
  browserScreenshotAction: vi.fn(),
}));
vi.mock("../../browser/client.js", () => ({
  browserCloseTab: vi.fn(),
  browserFocusTab: vi.fn(),
  browserOpenTab: vi.fn(),
  browserProfiles: vi.fn(),
  browserStart: vi.fn(),
  browserStatus: vi.fn(async () => ({ running: false })),
  browserStop: vi.fn(),
}));
vi.mock("../../browser/config.js", () => ({
  resolveBrowserConfig: () => ({ enabled: true }),
}));
vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ gateway: { nodes: { browser: { mode: "off" } } }, browser: {} }),
  resolveConfigPath: () => "/tmp/openbot.json",
}));
vi.mock("../../browser/account-browser-namespace.js", () => ({
  assertNoClientBrowserProfileOverride: () => undefined,
  isMultitenantManagedBrowser: () => false,
}));
vi.mock("./nodes-utils.js", async () => {
  const actual = await vi.importActual<typeof import("./nodes-utils.js")>("./nodes-utils.js");
  return {
    ...actual,
    listNodes: vi.fn(async () => []),
  };
});
vi.mock("./gateway.js", () => ({
  callGatewayTool: vi.fn(),
}));

import { createBrowserTool } from "./browser-tool.js";

describe("browser tool secret guard", () => {
  it("rejects act type targeting password", async () => {
    const tool = createBrowserTool({ allowHostControl: true });
    await expect(
      tool.execute("1", {
        action: "act",
        request: {
          kind: "type",
          ref: "password",
          text: "nope",
        },
      }),
    ).rejects.toThrow(/secure_form/);
  });
});
