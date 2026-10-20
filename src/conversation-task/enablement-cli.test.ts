import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runRegisteredCli } from "../test-utils/command-runner.js";

const setTenantAllowlistEntry = vi.fn();
const setShadowFlag = vi.fn();
const readEnablementStatusView = vi.fn(() => ({
  flags: [],
  allowlist: { enabledCount: 0, totalCount: 0, entries: [] },
  hmacKeyConfigured: false,
}));

const defaultRuntime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

vi.mock("./enablement.js", () => ({
  setTenantAllowlistEntry: (params: unknown) => setTenantAllowlistEntry(params),
  setShadowFlag: (params: unknown) => setShadowFlag(params),
  readEnablementStatusView: () => readEnablementStatusView(),
}));

vi.mock("./config-store.js", () => ({
  ConversationTaskConfigStore: class {
    close() {}
  },
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime,
}));

describe("conversation-task cli", () => {
  let registerConversationTaskCli: typeof import("./enablement-cli.js").registerConversationTaskCli;

  beforeAll(async () => {
    ({ registerConversationTaskCli } = await import("./enablement-cli.js"));
  });

  beforeEach(() => {
    setTenantAllowlistEntry.mockReset();
    setShadowFlag.mockReset();
    defaultRuntime.log.mockClear();
    defaultRuntime.error.mockClear();
    setTenantAllowlistEntry.mockReturnValue({
      applied: false,
      kind: "allow-tenant",
      actor: "local-test",
      reason: "canary",
      tenantIdPresent: true,
      enabled: true,
    });
  });

  it("prints JSON for allow-tenant dry-run when --json is after the subcommand", async () => {
    await runRegisteredCli({
      register: registerConversationTaskCli as (program: Command) => void,
      argv: [
        "conversation-task",
        "allow-tenant",
        "租户001",
        "--actor",
        "local-test",
        "--reason",
        "canary",
        "--json",
      ],
    });
    const dumped = String(defaultRuntime.log.mock.calls.at(-1)?.[0] ?? "");
    expect(dumped).toContain('"applied": false');
    expect(dumped).toContain('"kind": "allow-tenant"');
    expect(dumped).not.toContain("pass --confirm");
    expect(setTenantAllowlistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "租户001", confirm: false }),
    );
  });

  it("honors parent-captured --json on write commands", async () => {
    await runRegisteredCli({
      register: registerConversationTaskCli as (program: Command) => void,
      argv: [
        "conversation-task",
        "--json",
        "allow-tenant",
        "租户001",
        "--actor",
        "local-test",
        "--reason",
        "canary",
      ],
    });
    const dumped = String(defaultRuntime.log.mock.calls.at(-1)?.[0] ?? "");
    expect(dumped).toContain('"applied": false');
    expect(dumped).not.toContain("pass --confirm");
  });
});
