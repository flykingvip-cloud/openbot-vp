/**
 * Operator ALS misses a marketplace bot key that still lives in the unscoped
 * `$STATE_DIR/agents/<agentId>/sessions/sessions.json`. Heal copies it into
 * the operator store so chat.restore and checkpoint list see the same session.
 * Another operator's store is never read.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HealTestConfig = {
  data: { mode: string };
  session: { mainKey: string };
  gateway: { security: { profile: string } };
  agents?: { defaults: { workspace: string } };
};

const { loadConfigMock } = vi.hoisted(() => {
  const loadConfigMock = vi.fn(
    (): HealTestConfig => ({
      data: { mode: "local" },
      session: { mainKey: "main" },
      gateway: { security: { profile: "personal_local" } },
    }),
  );
  return { loadConfigMock };
});
vi.mock("../config/config.js", () => ({ loadConfig: loadConfigMock }));
vi.mock("./platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: false }),
  loadPlatformAuthStore: async () => ({}),
  findUserByEmail: () => undefined,
  findUserById: () => undefined,
  findMembershipByUserId: () => undefined,
  findUniqueMembershipByUserId: () => undefined,
  findMembershipByIdForUser: () => undefined,
}));

import { withOperatorStateScope } from "../config/operator-state-scope.js";
import { resolveDefaultSessionStorePath } from "../config/sessions/paths.js";
import {
  clearSessionStoreCacheForTest,
  loadSharedCanonicalSessionStore,
} from "../config/sessions/store.js";
import { listChatCheckpoints } from "./checkpoint-store.js";
import {
  formatClientSessionNotFoundDetail,
  healOperatorSessionEntryFromSharedStore,
} from "./operator-shared-session-heal.js";
import { chatHandlers } from "./server-methods/chat.js";
import { loadSessionEntryForClient } from "./tenant-context.js";

const OPERATOR_A = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
const OPERATOR_B = "operator-b";
const SESSION_KEY = "agent:bot-2:main";
const SESSION_ID = "d26ef24c-1111-4222-8333-bcc6165e32fa";
const CHECKPOINT_ID = "checkpoint_c4d52aab";

const ENV_KEYS = [
  "OPENBOT_STATE_DIR",
  "OPENCLAW_STATE_DIR",
  "CLAWDBOT_STATE_DIR",
  "OPENBOT_OPERATOR_ID",
  "OPENCLAW_OPERATOR_ID",
  "OPENBOT_MULTITENANT",
  "OPENCLAW_MULTITENANT",
  "OPENBOT_SECURITY_PROFILE",
  "OPENCLAW_SECURITY_PROFILE",
] as const;

describe("operator shared session heal", () => {
  const dirs: string[] = [];
  const envSnapshot: Record<string, string | undefined> = {};
  let stateDir = "";
  let workspaceDir = "";

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      envSnapshot[key] = process.env[key];
      delete process.env[key];
    }
    clearSessionStoreCacheForTest();
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const previous = envSnapshot[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
    clearSessionStoreCacheForTest();
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function setupState(): Promise<void> {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-op-heal-"));
    dirs.push(stateDir);
    workspaceDir = path.join(stateDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    process.env.OPENBOT_STATE_DIR = stateDir;
    delete process.env.OPENBOT_OPERATOR_ID;
    delete process.env.OPENCLAW_OPERATOR_ID;
    loadConfigMock.mockReturnValue({
      data: { mode: "local" },
      session: { mainKey: "main" },
      agents: { defaults: { workspace: workspaceDir } },
      gateway: { security: { profile: "personal_local" } },
    });
  }

  function sharedStorePath(): string {
    return path.join(stateDir, "agents", "bot-2", "sessions", "sessions.json");
  }

  function operatorStorePath(operatorId: string): string {
    return path.join(
      stateDir,
      "operators",
      operatorId,
      "agents",
      "bot-2",
      "sessions",
      "sessions.json",
    );
  }

  async function writeSharedBotSession(params?: {
    sessionFile?: string;
    transcriptBody?: string;
  }): Promise<string> {
    const sessionsDir = path.dirname(sharedStorePath());
    await fs.mkdir(sessionsDir, { recursive: true });
    const transcript = params?.sessionFile ?? path.join(sessionsDir, `${SESSION_ID}.jsonl`);
    if (!params?.sessionFile) {
      await fs.writeFile(
        transcript,
        params?.transcriptBody ??
          `${JSON.stringify({
            type: "session",
            version: 1,
            id: SESSION_ID,
            cwd: workspaceDir,
          })}\n${JSON.stringify({
            type: "message",
            id: "m0",
            message: { role: "assistant", content: "shared-bot-transcript" },
          })}\n`,
        "utf8",
      );
    }
    await fs.writeFile(
      sharedStorePath(),
      JSON.stringify({
        [SESSION_KEY]: {
          sessionId: SESSION_ID,
          updatedAt: 1_700_000_000_000,
          sessionFile: transcript,
        },
      }),
      "utf8",
    );
    return transcript;
  }

  async function writeCheckpoint(): Promise<void> {
    const checkpointDir = path.join(workspaceDir, "memory", "checkpoints");
    await fs.mkdir(checkpointDir, { recursive: true });
    await fs.writeFile(
      path.join(checkpointDir, `${CHECKPOINT_ID}.json`),
      JSON.stringify({
        id: CHECKPOINT_ID,
        scope: "agent",
        owner_id: "bot-2",
        session_id: SESSION_ID,
        session_key: SESSION_KEY,
        created_at: "2026-10-10T00:00:00.000Z",
        summary: "市场助手检查点",
        boundary_message_id: "m0",
        decisions: [],
        preferences: [],
        open_tasks: [],
        completed_tasks: [],
        artifacts: [],
        evidence_refs: [],
        restorable: { files: false, transcript: true },
      }),
      "utf8",
    );
  }

  it("heals an operator miss from the shared bot store and restores that session", async () => {
    await setupState();
    await writeSharedBotSession();
    await writeCheckpoint();
    await expect(fs.access(operatorStorePath(OPERATOR_A))).rejects.toThrow();

    const loaded = await withOperatorStateScope(OPERATOR_A, () =>
      loadSessionEntryForClient(SESSION_KEY, null),
    );
    expect(loaded.entry?.sessionId).toBe(SESSION_ID);
    expect(loaded.storePath).toBe(path.resolve(operatorStorePath(OPERATOR_A)));

    const operatorStore = JSON.parse(await fs.readFile(operatorStorePath(OPERATOR_A), "utf8")) as {
      [key: string]: { sessionId?: string; sessionFile?: string };
    };
    expect(operatorStore[SESSION_KEY]?.sessionId).toBe(SESSION_ID);
    const copiedTranscript = operatorStore[SESSION_KEY]?.sessionFile ?? "";
    expect(copiedTranscript).toContain(`${path.sep}operators${path.sep}${OPERATOR_A}${path.sep}`);
    expect(await fs.readFile(copiedTranscript, "utf8")).toContain("shared-bot-transcript");
    expect(await fs.readFile(sharedStorePath(), "utf8")).toContain(SESSION_ID);

    const checkpoints = await withOperatorStateScope(OPERATOR_A, () =>
      listChatCheckpoints(SESSION_KEY, null),
    );
    expect(checkpoints.map((checkpoint) => checkpoint.checkpointId)).toContain(CHECKPOINT_ID);

    const respond = vi.fn();
    await withOperatorStateScope(OPERATOR_A, () =>
      chatHandlers["chat.restore"]({
        params: { sessionKey: SESSION_KEY, checkpointId: CHECKPOINT_ID },
        respond: respond as never,
        context: {
          broadcastChat: vi.fn(),
          nodeSendToSession: vi.fn(),
          chatAbortControllers: new Map(),
          logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
        } as never,
        req: {} as never,
        client: null,
        isWebchatConnect: () => false,
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, checkpointId: CHECKPOINT_ID }),
    );
    const failure = respond.mock.calls.find((call) => call[0] === false);
    expect(failure?.[2]?.message ?? "").not.toContain("session not found");
  });

  it("keeps owner stamps on the healed session entry", async () => {
    await setupState();
    await writeSharedBotSession();

    await withOperatorStateScope(OPERATOR_A, () =>
      healOperatorSessionEntryFromSharedStore({
        sessionKey: SESSION_KEY,
        resolveAgentStorePath: (agentId) => resolveDefaultSessionStorePath(agentId),
        ownership: {
          ownerTenantId: "tenant-a",
          ownerUserId: "user-a",
          ownerBotId: "bot-2",
        },
      }),
    );

    const operatorStore = JSON.parse(await fs.readFile(operatorStorePath(OPERATOR_A), "utf8")) as {
      [key: string]: {
        sessionId?: string;
        ownerTenantId?: string;
        ownerUserId?: string;
        ownerBotId?: string;
      };
    };
    expect(operatorStore[SESSION_KEY]).toMatchObject({
      sessionId: SESSION_ID,
      ownerTenantId: "tenant-a",
      ownerUserId: "user-a",
      ownerBotId: "bot-2",
    });
  });

  it("reports storePath and sharedHasKey when the session is still missing", async () => {
    await setupState();
    const detail = await withOperatorStateScope(OPERATOR_A, async () => {
      const loaded = await loadSessionEntryForClient(SESSION_KEY, null);
      return formatClientSessionNotFoundDetail({
        sessionKey: SESSION_KEY,
        storePath: loaded.storePath,
      });
    });
    expect(detail).toContain("session not found");
    expect(detail).toContain(`storePath=${path.resolve(operatorStorePath(OPERATOR_A))}`);
    expect(detail).toContain("sharedHasKey=false");
    expect(detail).not.toContain(`${path.sep}operators${path.sep}${OPERATOR_B}${path.sep}`);
  });

  it("does not read or copy another operator store", async () => {
    await setupState();
    await writeSharedBotSession();
    const foreignDir = path.dirname(operatorStorePath(OPERATOR_B));
    await fs.mkdir(foreignDir, { recursive: true });
    const foreignTranscript = path.join(foreignDir, "foreign-secret.jsonl");
    await fs.writeFile(foreignTranscript, "operator-b-secret-transcript\n", "utf8");
    const foreignStore = JSON.stringify({
      [SESSION_KEY]: {
        sessionId: "bbbbbbbb-2222-4333-8444-bbbbbbbbbbbb",
        updatedAt: 9_999,
        sessionFile: foreignTranscript,
        marker: "operator-b-only",
      },
    });
    await fs.writeFile(operatorStorePath(OPERATOR_B), foreignStore, "utf8");

    await withOperatorStateScope(OPERATOR_A, () => loadSessionEntryForClient(SESSION_KEY, null));

    expect(await fs.readFile(operatorStorePath(OPERATOR_B), "utf8")).toBe(foreignStore);
    expect(await fs.readFile(foreignTranscript, "utf8")).toContain("operator-b-secret-transcript");
    const healed = await fs.readFile(operatorStorePath(OPERATOR_A), "utf8");
    expect(healed).toContain(SESSION_ID);
    expect(healed).not.toContain("operator-b-only");
    expect(healed).not.toContain("operator-b-secret");
    expect(healed).not.toContain("bbbbbbbb-2222-4333-8444-bbbbbbbbbbbb");
  });

  it("does not follow a shared store symlink into another operator directory", async () => {
    await setupState();
    const foreignDir = path.dirname(operatorStorePath(OPERATOR_B));
    await fs.mkdir(foreignDir, { recursive: true });
    await fs.writeFile(
      operatorStorePath(OPERATOR_B),
      JSON.stringify({
        [SESSION_KEY]: {
          sessionId: "cccccccc-3333-4444-8555-cccccccccccc",
          updatedAt: 5,
          marker: "operator-b-symlink-secret",
        },
      }),
      "utf8",
    );
    const sharedDir = path.dirname(sharedStorePath());
    await fs.mkdir(sharedDir, { recursive: true });
    await fs.symlink(operatorStorePath(OPERATOR_B), sharedStorePath());

    expect(loadSharedCanonicalSessionStore("bot-2")[SESSION_KEY]).toBeUndefined();
    const loaded = await withOperatorStateScope(OPERATOR_A, () =>
      loadSessionEntryForClient(SESSION_KEY, null),
    );
    expect(loaded.entry?.sessionId).toBeUndefined();
    await expect(fs.access(operatorStorePath(OPERATOR_A))).rejects.toThrow();
    expect(await fs.readFile(operatorStorePath(OPERATOR_B), "utf8")).toContain(
      "operator-b-symlink-secret",
    );
  });

  it("does not copy a transcript that points outside the shared sessions directory", async () => {
    await setupState();
    const foreignDir = path.dirname(operatorStorePath(OPERATOR_B));
    await fs.mkdir(foreignDir, { recursive: true });
    const foreignTranscript = path.join(foreignDir, `${SESSION_ID}.jsonl`);
    await fs.writeFile(foreignTranscript, "operator-b-secret-transcript\n", "utf8");
    const sessionsDir = path.dirname(sharedStorePath());
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      sharedStorePath(),
      JSON.stringify({
        [SESSION_KEY]: {
          sessionId: SESSION_ID,
          updatedAt: 10,
          sessionFile: foreignTranscript,
        },
      }),
      "utf8",
    );

    const loaded = await withOperatorStateScope(OPERATOR_A, () =>
      loadSessionEntryForClient(SESSION_KEY, null),
    );
    expect(loaded.entry?.sessionId).toBe(SESSION_ID);
    await expect(
      fs.access(path.join(path.dirname(operatorStorePath(OPERATOR_A)), `${SESSION_ID}.jsonl`)),
    ).rejects.toThrow();
    expect(await fs.readFile(foreignTranscript, "utf8")).toBe("operator-b-secret-transcript\n");
    const healed = await fs.readFile(operatorStorePath(OPERATOR_A), "utf8");
    expect(healed).not.toContain("operator-b-secret-transcript");
    expect(healed).not.toContain(foreignTranscript);
  });

  it("does not overwrite an operator entry that already exists", async () => {
    await setupState();
    await writeSharedBotSession();
    const operatorDir = path.dirname(operatorStorePath(OPERATOR_A));
    await fs.mkdir(operatorDir, { recursive: true });
    await fs.writeFile(
      operatorStorePath(OPERATOR_A),
      JSON.stringify({
        [SESSION_KEY]: {
          sessionId: "aaaaaaaa-1111-4222-8333-aaaaaaaaaaaa",
          updatedAt: 50,
        },
      }),
      "utf8",
    );

    const loaded = await withOperatorStateScope(OPERATOR_A, () =>
      loadSessionEntryForClient(SESSION_KEY, null),
    );
    expect(loaded.entry?.sessionId).toBe("aaaaaaaa-1111-4222-8333-aaaaaaaaaaaa");
  });

  it("does not fork a space: group transcript into the operator store", async () => {
    await setupState();
    const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionKey = "space:grp-shared";
    await fs.writeFile(
      path.join(sessionsDir, "sessions.json"),
      JSON.stringify({
        [sessionKey]: { sessionId: "space-session-1", updatedAt: 1 },
      }),
      "utf8",
    );
    const loaded = await withOperatorStateScope(OPERATOR_A, () =>
      loadSessionEntryForClient(sessionKey, null),
    );
    expect(loaded.entry).toBeUndefined();
    const operatorMain = path.join(
      stateDir,
      "operators",
      OPERATOR_A,
      "agents",
      "main",
      "sessions",
      "sessions.json",
    );
    await expect(fs.access(operatorMain)).rejects.toThrow();
  });
});
