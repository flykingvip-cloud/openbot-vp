import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import { hydrateKnowledgeUniverseVaultSyncPanel } from "./knowledge-universe-vault-sync.ts";
import { setKnowledgeUniverseLibraryWorkspaceImportKind } from "./knowledge-universe-workspace.ts";
import { getKnowledgeUniverseRuntime } from "./knowledge-universe.ts";

function createState(): AppPortState {
  return {
    client: {
      request: vi.fn(),
    },
    requestUpdate: vi.fn(),
    connected: true,
    workbenchPrimaryModule: "knowledge",
  } as unknown as AppPortState;
}

describe("knowledge-universe vault sync panel hydrate", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { showDirectoryPicker: vi.fn() });
  });

  it("hydrateKnowledgeUniverseVaultSyncPanel loads devices and team when session exists", async () => {
    const state = createState();
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.vaultSyncVaultId = "vault-1";
    runtime.vaultSyncDeviceId = "device-1";
    runtime.vaultSyncRootPath = "notes";

    const request = vi.fn();
    state.client = { request } as never;
    request.mockImplementation(async (method: string) => {
      if (method === "knowledge.vault-sync.status") {
        return { teamEnabled: true };
      }
      if (method === "knowledge.vault-sync.devices.list") {
        return { devices: [{ deviceId: "device-1", platform: "desktop", status: "active" }] };
      }
      if (method === "knowledge.vault-sync.selective-sync.get") {
        return { selectiveSync: { includeImages: false, excludeGlobs: ["**/.git/**"] } };
      }
      if (method === "knowledge.vault-sync.members.list") {
        return {
          members: [{ memberAccountId: "owner@example.com", role: "owner", status: "active" }],
        };
      }
      if (method === "knowledge.vault-sync.invites.list") {
        return { invites: [{ inviteId: "inv-1", status: "pending" }] };
      }
      throw new Error(`unexpected rpc ${method}`);
    });

    await hydrateKnowledgeUniverseVaultSyncPanel(state);

    expect(runtime.vaultSyncTeamEnabled).toBe(true);
    expect(runtime.vaultSyncDevices).toHaveLength(1);
    expect(runtime.vaultSyncIncludeImages).toBe(false);
    expect(runtime.vaultSyncExcludeGlobsText).toBe("**/.git/**");
    expect(runtime.vaultSyncMembers).toHaveLength(1);
    expect(runtime.vaultSyncInvites).toHaveLength(1);
    expect(runtime.personalActionNotice).toBeNull();
  });

  it("setKnowledgeUniverseLibraryWorkspaceImportKind(vaultSync) triggers hydrate", async () => {
    const state = createState();
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.vaultSyncVaultId = "vault-2";
    runtime.vaultSyncDeviceId = "device-2";

    const request = vi.fn();
    state.client = { request } as never;
    request.mockImplementation(async (method: string) => {
      if (method === "knowledge.vault-sync.status") {
        return { teamEnabled: false };
      }
      if (method === "knowledge.vault-sync.devices.list") {
        return { devices: [] };
      }
      if (method === "knowledge.vault-sync.selective-sync.get") {
        return { selectiveSync: {} };
      }
      throw new Error(`unexpected rpc ${method}`);
    });

    setKnowledgeUniverseLibraryWorkspaceImportKind(state, "vaultSync");
    await vi.waitFor(() => {
      expect(runtime.libraryWorkspaceImportKind).toBe("vaultSync");
      expect(request.mock.calls.length).toBeGreaterThan(0);
    });
  });
});
