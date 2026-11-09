import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildEmployeeBuiltinStewardSessionKey } from "../../agents/builtin-steward/employee-isolation.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { GatewayClient } from "./types.js";

const HANDLE_CWD = "/srv/authorized-handle-workspace";

const cwdMock = vi.hoisted(() => ({
  resolveAuthorizedToolCwdDetailed: vi.fn(),
}));

vi.mock("../knowledge/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../knowledge/context.js")>();
  return {
    ...original,
    resolveKnowledgeSourceContext: vi.fn(async () => ({
      tenantId: null,
      seatId: null,
      userId: null,
      teamLabel: null,
      roleCode: null,
      departmentId: null,
      agentType: "employee-agent" as const,
      hasEnterpriseScope: false,
    })),
  };
});

vi.mock("../workspace/handler-bridge.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../workspace/handler-bridge.js")>();
  return {
    ...original,
    resolveAuthorizedToolCwdDetailed: (
      params: Parameters<typeof original.resolveAuthorizedToolCwdDetailed>[0],
    ) => cwdMock.resolveAuthorizedToolCwdDetailed(params),
  };
});

const { resolveCallerWorkspaceCwd } = await import("./chat.js");

const managedCfg = {
  data: { mode: "managed" },
  gateway: { security: { profile: "managed_enterprise" } },
} as OpenBotConfig;

const ownerId = "usr-ceo";
const tempDirs: string[] = [];
const envKeys = [
  "OPENBOT_STATE_DIR",
  "OPENBOT_SECURITY_PROFILE",
  "OPENCLAW_SECURITY_PROFILE",
  "OPENBOT_DATA_MODE",
  "OPENCLAW_DATA_MODE",
] as const;
const savedEnv = new Map<string, string | undefined>();

function employeeClient(): GatewayClient {
  return {
    platformUserId: ownerId,
    sessionDomain: "employee",
    sessionEnterpriseId: "ent-upbeyond",
  } as GatewayClient;
}

beforeEach(() => {
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
  }
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-transcript-cwd-"));
  tempDirs.push(stateDir);
  process.env.OPENBOT_STATE_DIR = stateDir;
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  delete process.env.OPENBOT_DATA_MODE;
  delete process.env.OPENCLAW_DATA_MODE;
  cwdMock.resolveAuthorizedToolCwdDetailed.mockReset();
});

afterEach(() => {
  for (const key of envKeys) {
    const previous = savedEnv.get(key);
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("creates a steward transcript cwd from the Handle workspace, not the shadow helper", async () => {
  cwdMock.resolveAuthorizedToolCwdDetailed.mockImplementation(
    async (params: { stewardException?: boolean; stewardWorkspaceDir?: string | null }) => {
      // Production gate: a steward lookup without the shadow helper never reaches Handle.
      if (params.stewardException && !params.stewardWorkspaceDir?.trim()) {
        return { cwd: null, reasonCode: "missing_steward_workspace" };
      }
      return { cwd: HANDLE_CWD };
    },
  );

  const cwd = await resolveCallerWorkspaceCwd({
    cfg: managedCfg,
    sessionKey: buildEmployeeBuiltinStewardSessionKey(ownerId),
    agentId: "main",
    client: employeeClient(),
  });

  expect(cwd).toBe(HANDLE_CWD);
  expect(cwdMock.resolveAuthorizedToolCwdDetailed).toHaveBeenCalledTimes(1);
  const params = cwdMock.resolveAuthorizedToolCwdDetailed.mock.calls[0]?.[0] as {
    stewardException?: boolean;
    stewardWorkspaceDir?: string | null;
    purpose?: string;
  };
  expect(params.stewardException).toBe(true);
  expect(params.purpose).toBe("chat.transcript.cwd");
  expect(params.stewardWorkspaceDir?.trim()).toBeTruthy();
  expect(params.stewardWorkspaceDir).not.toBe(HANDLE_CWD);
});

it("keeps a managed steward transcript closed when Handle denies the workspace", async () => {
  cwdMock.resolveAuthorizedToolCwdDetailed.mockResolvedValue({
    cwd: null,
    reasonCode: "resolver_denied",
  });

  const cwd = await resolveCallerWorkspaceCwd({
    cfg: managedCfg,
    sessionKey: buildEmployeeBuiltinStewardSessionKey(ownerId),
    agentId: "main",
    client: employeeClient(),
  });

  expect(cwd).toBeNull();
});
