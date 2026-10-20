import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../terminal/theme.js", () => ({
  theme: {
    command: (s: string) => s,
    muted: (s: string) => s,
  },
}));

const { formatHelpExample, formatHelpExampleLine } = await import("./help-format.js");

describe("help format", () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("rewrites help examples to the active cli name", () => {
    process.argv = ["node", "openbot", "--help"];

    expect(formatHelpExample("openclaw models --help", "Show model help.")).toContain(
      "openbot models --help",
    );
    expect(
      formatHelpExampleLine('openclaw message send --message "Hi"', "Send a message."),
    ).toContain('openbot message send --message "Hi"');
  });

  it("preserves runner-prefixed commands when swapping the cli name", () => {
    process.argv = ["node", "openbot", "--help"];

    expect(formatHelpExampleLine("pnpm openclaw gateway", "Run the gateway.")).toContain(
      "pnpm openbot gateway",
    );
  });
});
