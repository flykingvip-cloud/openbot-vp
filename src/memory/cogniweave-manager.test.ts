import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalMetadataStore } from "../../packages/cogniweave-sdk/src/index.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  resolveDefaultSessionStorePath,
  resolveSessionTranscriptPath,
} from "../config/sessions.js";
import { emitSessionTranscriptUpdate } from "../sessions/transcript-events.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import {
  CogniWeaveMemoryManager,
  resolveCogniWeaveDocumentScope,
  resolveCogniWeaveSearchScope,
  resolveCogniWeaveSourcePolicy,
} from "./cogniweave-manager.js";
import { closeAllMemorySearchManagers, getMemorySearchManager } from "./search-manager.js";

const tempDirs: string[] = [];
const ORIGINAL_STATE_DIR = process.env.OPENBOT_STATE_DIR;

type CogniWeaveManagerTestSeam = {
  syncAllScopes: (params?: unknown) => Promise<void>;
  syncImpactedScopesForSessionFile: (sessionFile: string) => Promise<void>;
  syncImpactedScopesForSessionFiles: (sessionFiles: string[]) => Promise<void>;
  syncScope: (...args: unknown[]) => Promise<unknown>;
};

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cogniweave-"));
  tempDirs.push(dir);
  return dir;
}

function dataRootForWorkspace(workspace: string): string {
  return path.join(workspace, "data-root");
}

function createConfig(workspace: string): OpenBotConfig {
  return {
    data: { root: dataRootForWorkspace(workspace), mode: "local", schemaVersion: 1 },
    memory: {
      backend: "cogniweave",
      cogniweave: {
        mode: "embedded",
        writeSync: "sync",
      },
    },
    agents: {
      list: [{ id: "main", default: true, workspace }],
    },
  };
}

function createCogniWeaveConfig(
  workspace: string,
  overrides?: Partial<NonNullable<OpenBotConfig["memory"]>["cogniweave"]>,
): OpenBotConfig {
  return {
    data: { root: dataRootForWorkspace(workspace), mode: "local", schemaVersion: 1 },
    memory: {
      backend: "cogniweave",
      cogniweave: {
        mode: "embedded",
        writeSync: "sync",
        ...overrides,
      },
    },
    agents: {
      list: [{ id: "main", default: true, workspace }],
    },
  };
}

function createMultiAgentConfig(workspaces: Record<string, string>): OpenBotConfig {
  const entries = Object.entries(workspaces);
  const firstWorkspace = entries[0]?.[1] ?? os.tmpdir();
  return {
    data: { root: dataRootForWorkspace(firstWorkspace), mode: "local", schemaVersion: 1 },
    memory: {
      backend: "cogniweave",
      cogniweave: {
        mode: "embedded",
        writeSync: "sync",
      },
    },
    agents: {
      list: entries.map(([id, workspace], index) => ({
        id,
        workspace,
        ...(index === 0 ? { default: true } : {}),
      })),
    },
  };
}

afterEach(async () => {
  if (ORIGINAL_STATE_DIR === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = ORIGINAL_STATE_DIR;
  }
  await closeAllMemorySearchManagers();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeSessionTranscript(params: {
  agentId?: string;
  sessionKey: string;
  sessionId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<void> {
  const agentId = params.agentId ?? "main";
  const transcriptPath = resolveSessionTranscriptPath(params.sessionId, agentId);
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  const lines = [
    JSON.stringify({ type: "session", session_id: params.sessionId }),
    ...params.messages.map((message) => JSON.stringify({ type: "message", message })),
  ];
  await fs.writeFile(transcriptPath, `${lines.join("\n")}\n`, "utf8");

  const storePath = resolveDefaultSessionStorePath(agentId);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const existingStore = JSON.parse(
    await fs.readFile(storePath, "utf8").catch(() => "{}"),
  ) as Record<
    string,
    {
      sessionId: string;
      sessionFile: string;
      updatedAt: number;
    }
  >;
  await fs.writeFile(
    storePath,
    JSON.stringify(
      {
        ...existingStore,
        [params.sessionKey]: {
          sessionId: params.sessionId,
          sessionFile: path.basename(transcriptPath),
          updatedAt: Date.now(),
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 19) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

describe("CogniWeaveMemoryManager", () => {
  it("maps direct, group, space, and thread sessions into stable CogniWeave scopes", () => {
    const workspaceId = "ws_test";
    expect(
      resolveCogniWeaveSearchScope({
        agentId: "main",
        workspaceId,
      }),
    ).toEqual({
      workspaceId,
      projectId: "agent:main",
      agentId: "main",
      visibility: "private",
    });

    expect(
      resolveCogniWeaveSearchScope({
        agentId: "main",
        workspaceId,
        sessionKey: "agent:main:discord:direct:user-1",
      }),
    ).toEqual({
      workspaceId,
      projectId: "agent:main",
      agentId: "main",
      visibility: "private",
    });

    expect(
      resolveCogniWeaveSearchScope({
        agentId: "main",
        workspaceId,
        sessionKey: "agent:main:telegram:group:ops-room",
      }),
    ).toEqual({
      workspaceId,
      projectId: "chat:telegram:group:ops-room",
      agentId: "shared",
      visibility: "shared",
    });

    expect(
      resolveCogniWeaveSearchScope({
        agentId: "main",
        workspaceId,
        sessionKey: "space:market-research",
      }),
    ).toEqual({
      workspaceId,
      projectId: "space:market-research",
      agentId: "shared",
      visibility: "shared",
    });

    expect(
      resolveCogniWeaveSearchScope({
        agentId: "main",
        workspaceId,
        sessionKey: "agent:main:main:space:market-research",
      }),
    ).toEqual({
      workspaceId,
      projectId: "space:market-research",
      agentId: "shared",
      visibility: "shared",
    });

    expect(
      resolveCogniWeaveSearchScope({
        agentId: "main",
        workspaceId,
        sessionKey: "agent:main:discord:channel:alerts:thread:incident-42",
      }),
    ).toEqual({
      workspaceId,
      projectId: "chat:discord:channel:alerts",
      agentId: "shared",
      visibility: "shared",
    });
  });

  it("enforces source policy boundaries for private and shared scopes", () => {
    const workspaceId = "ws_test";

    expect(resolveCogniWeaveSourcePolicy("memory")).toEqual({
      enabled: true,
      allowsSharedScope: false,
      metadataSource: "workspace-memory",
    });
    expect(resolveCogniWeaveSourcePolicy("sessions")).toEqual({
      enabled: true,
      allowsSharedScope: true,
      metadataSource: "session-transcript",
    });

    expect(
      resolveCogniWeaveDocumentScope({
        agentId: "main",
        workspaceId,
        writeSync: "sync",
        sources: ["memory", "sessions"],
        sharedSources: ["sessions"],
        doc: {
          source: "memory",
          sessionKey: "agent:main:discord:channel:alerts",
        },
      }),
    ).toEqual({
      workspaceId,
      projectId: "agent:main",
      agentId: "main",
      visibility: "private",
    });

    expect(
      resolveCogniWeaveDocumentScope({
        agentId: "main",
        workspaceId,
        writeSync: "sync",
        sources: ["memory", "sessions"],
        sharedSources: ["sessions"],
        doc: {
          source: "sessions",
          sessionKey: "agent:main:discord:channel:alerts",
        },
      }),
    ).toEqual({
      workspaceId,
      projectId: "chat:discord:channel:alerts",
      agentId: "shared",
      visibility: "shared",
    });

    expect(
      resolveCogniWeaveDocumentScope({
        agentId: "main",
        workspaceId,
        writeSync: "disabled",
        sources: ["memory", "sessions"],
        sharedSources: ["sessions"],
        doc: {
          source: "sessions",
          sessionKey: "agent:main:discord:channel:alerts",
        },
      }),
    ).toEqual({
      workspaceId,
      projectId: "agent:main",
      agentId: "main",
      visibility: "private",
    });

    expect(
      resolveCogniWeaveDocumentScope({
        agentId: "main",
        workspaceId,
        writeSync: "sync",
        sources: ["memory"],
        sharedSources: ["sessions"],
        doc: {
          source: "sessions",
          sessionKey: "agent:main:discord:channel:alerts",
        },
      }),
    ).toEqual({
      workspaceId,
      projectId: "agent:main",
      agentId: "main",
      visibility: "private",
    });
  });

  it("indexes workspace memory files and returns search results", async () => {
    const workspace = await makeWorkspace();
    await fs.writeFile(
      path.join(workspace, "MEMORY.md"),
      [
        "Under high latency, synchronous retry loops should be avoided.",
        "Prefer asynchronous buffering or batching instead of synchronous retries.",
        "Require idempotency safeguards before enabling retry-based recovery paths.",
      ].join("\n"),
      "utf8",
    );
    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.backend).toBe("cogniweave");
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });

    const results = await manager.search("high latency sync retry idempotency", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toBe("MEMORY.md");
    expect(results[0]?.snippet.toLowerCase()).toContain("latency");
    expect(results[0]?.explainability?.whySummary.length).toBeGreaterThan(0);
    expect(results[0]?.explainability?.supportingAtoms.length).toBeGreaterThan(0);
    expect(results[0]?.evidence?.[0]?.uri).toBe("MEMORY.md");
    expect(results[0]?.evidence?.[0]?.snippet.length).toBeGreaterThan(0);

    const file = await manager.readFile({ relPath: "MEMORY.md" });
    expect(file.text).toContain("synchronous retry loops should be avoided");

    const status = manager.status();
    expect(status.backend).toBe("cogniweave");
    expect(status.custom?.queryStatus).toBe("ok");
    expect(status.custom?.writeStatus).toBe("sync");
    expect(status.custom?.traceSupport).toBe(true);
    expect(status.custom?.persistence).toMatchObject({
      backend: "local",
      restartSafe: true,
    });
    const distillation = status.custom?.distillation as { atoms: number; evidence: number };
    expect(distillation).toEqual({
      atoms: expect.any(Number),
      evidence: expect.any(Number),
    });
    expect(distillation.atoms).toBeGreaterThan(0);
    expect(distillation.evidence).toBeGreaterThan(0);
    expect(status.custom?.cloudSync).toMatchObject({ enabled: false });

    const atoms = await manager.listMemoryCenterAtoms({ limit: 50 });
    expect(atoms.length).toBeGreaterThan(0);
    expect(atoms[0]?.summary.length).toBeGreaterThan(0);
    expect(JSON.stringify(atoms)).not.toMatch(/provenance|evidenceRef|embedding|journal/i);
  });

  it("keeps explicit markdown memory recall ahead of noisy session history", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const workspace = await makeWorkspace();
    await fs.writeFile(
      path.join(workspace, "MEMORY.md"),
      [
        "CogniWeave durable Markdown memory is the primary curated memory path.",
        "Workspace Markdown memory source of truth lives in MEMORY.md and memory/*.md.",
        "JSON ledgers are not directly indexed by the current memory bridge.",
      ].join("\n"),
      "utf8",
    );
    await writeSessionTranscript({
      sessionKey: "agent:main:discord:direct:user-1",
      sessionId: "noisy-direct-session",
      messages: [
        {
          role: "user",
          content: "Please make a marketing brief and continue previous free-talk collaboration.",
        },
        {
          role: "assistant",
          content: "I will inspect current workspace status and recent session history first.",
        },
      ],
    });

    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });

    const results = await manager.search("CogniWeave durable Markdown memory", {
      maxResults: 5,
    });
    expect(results[0]).toMatchObject({
      path: "MEMORY.md",
      source: "memory",
    });
    expect(results[0]?.snippet).toContain("CogniWeave durable Markdown memory");
    expect(results[0]?.explainability?.matchedPatterns).toContain("evidence_search");
  });

  it("defaults canonical store under Data Space and cutovers legacy stateDir store", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const workspace = await makeWorkspace();
    const dataRoot = dataRootForWorkspace(workspace);
    const legacyPath = path.join(stateDir, "cogniweave", "canonical.sqlite");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    const legacyStore = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: legacyPath,
    });
    const legacyDataPlaneId = await legacyStore.ensureDataPlaneId();
    legacyStore.close();
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "portable cutover marker\n", "utf8");

    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }
    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });
    const portablePath = path.join(dataRoot, ".meta", "cogniweave", "canonical.sqlite");
    expect(manager.status().custom?.persistence).toMatchObject({
      canonicalStorePath: portablePath,
      restartSafe: true,
    });
    expect(await fs.stat(portablePath)).toBeDefined();
    const portableStore = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: portablePath,
    });
    expect(await portableStore.getDataPlaneId()).toBe(legacyDataPlaneId);
    portableStore.close();
    const migrationState = JSON.parse(
      await fs.readFile(path.join(dataRoot, ".meta", "cogniweave", "migration_state.json"), "utf8"),
    ) as { phase: string; fromPath: string; toPath: string };
    expect(migrationState.phase).toBe("completed");
    expect(migrationState.fromPath).toBe(legacyPath);
    expect(migrationState.toPath).toBe(portablePath);
    // Legacy retained for switch-back until full FSM ships.
    expect(await fs.stat(legacyPath)).toBeDefined();
    await manager.close();
  });

  it("uses a restart-safe local canonical store for embedded CogniWeave metadata", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const workspace = await makeWorkspace();
    const storePath = path.join(stateDir, "custom-cogniweave", "canonical.sqlite");
    await fs.writeFile(
      path.join(workspace, "MEMORY.md"),
      "Persistent CogniWeave canonical store should survive manager recreation.",
      "utf8",
    );
    const cfg = createCogniWeaveConfig(workspace, { storePath });
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });
    const firstResults = await manager.search("canonical store survive recreation", {
      maxResults: 5,
    });
    expect(firstResults[0]?.path).toBe("MEMORY.md");
    expect(await fs.stat(storePath)).toBeDefined();
    expect(manager.status().custom?.persistence).toMatchObject({
      backend: "local",
      canonicalStorePath: storePath,
      restartSafe: true,
    });
    await manager.close();

    const recreated = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });
    const secondResults = await recreated.search("canonical store survive recreation", {
      maxResults: 5,
    });
    expect(secondResults[0]?.path).toBe("MEMORY.md");
    expect(recreated.status().custom?.persistence).toMatchObject({
      canonicalStorePath: storePath,
      restartSafe: true,
    });
    await recreated.close();
  });

  it("tracks scope-specific indexes separately for private and shared searches", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const workspace = await makeWorkspace();
    await fs.writeFile(
      path.join(workspace, "MEMORY.md"),
      "Escalations should use the incident channel and preserve an idempotent audit trail.",
      "utf8",
    );
    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });

    await manager.search("audit trail", { sessionKey: "agent:main:discord:direct:user-1" });
    expect(manager.status().custom?.activeScopes).toBe(1);

    await manager.search("incident channel", {
      sessionKey: "agent:main:discord:channel:alerts",
    });
    expect(manager.status().custom?.activeScopes).toBe(2);

    await manager.search("incident channel", {
      sessionKey: "agent:main:discord:channel:alerts:thread:incident-42",
    });
    expect(manager.status().custom?.activeScopes).toBe(2);

    await manager.search("incident channel", {
      sessionKey: "space:market-research",
    });
    expect(manager.status().custom?.activeScopes).toBe(3);
  });

  it("ingests session transcripts into the matching session scope", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const workspace = await makeWorkspace();
    await fs.writeFile(
      path.join(workspace, "MEMORY.md"),
      "Private workspace memory says billing runbooks stay in the finance vault.",
      "utf8",
    );
    await writeSessionTranscript({
      sessionKey: "agent:main:discord:channel:alerts",
      sessionId: "alerts-session",
      messages: [
        {
          role: "user",
          content:
            "For the alerts group, remember that high latency plus sync retry needs idempotent async buffering.",
        },
        {
          role: "assistant",
          content:
            "The alerts group should avoid sync retry during high latency and require idempotency safeguards.",
        },
      ],
    });

    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });

    const directResults = await manager.search("high latency sync retry", {
      sessionKey: "agent:main:discord:direct:user-1",
    });
    expect(directResults.some((result) => result.source === "sessions")).toBe(false);

    const groupResults = await manager.search("high latency sync retry", {
      sessionKey: "agent:main:discord:channel:alerts",
    });
    expect(groupResults.some((result) => result.source === "sessions")).toBe(true);
    expect(groupResults[0]?.path).toBe("sessions/main/alerts-session.jsonl");
    expect(groupResults[0]?.evidence?.[0]?.uri).toBe("sessions/main/alerts-session.jsonl");
  });

  it("skips session transcript ingest when cogniweave sources exclude sessions", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const workspace = await makeWorkspace();
    await fs.writeFile(
      path.join(workspace, "MEMORY.md"),
      "Workspace memory says idempotent finance ledgers stay searchable without session ingest.",
      "utf8",
    );
    await writeSessionTranscript({
      sessionKey: "agent:main:discord:channel:alerts",
      sessionId: "alerts-session",
      messages: [
        {
          role: "user",
          content: "Session-only alerts content should not be ingested.",
        },
        {
          role: "assistant",
          content: "This transcript should stay outside cogniweave when sessions are disabled.",
        },
      ],
    });

    const cfg = createCogniWeaveConfig(workspace, { sources: ["memory"] });
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });

    const workspaceFile = await manager.readFile({ relPath: "MEMORY.md" });
    expect(workspaceFile.text).toContain("idempotent finance ledgers");

    const groupResults = await manager.search("session-only alerts content", {
      sessionKey: "agent:main:discord:channel:alerts",
    });
    expect(groupResults.some((result) => result.source === "sessions")).toBe(false);
    expect(manager.status().custom?.sourcePolicy).toMatchObject({
      memory: { enabled: true, allowsSharedScope: false },
      sessions: { enabled: false, allowsSharedScope: false },
    });
  });

  it("shares group transcript memory across agent managers", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const mainWorkspace = await makeWorkspace();
    const helperWorkspace = await makeWorkspace();
    await fs.writeFile(
      path.join(mainWorkspace, "MEMORY.md"),
      "Main agent private memory should not be required for group transcript sharing.",
      "utf8",
    );
    await fs.writeFile(
      path.join(helperWorkspace, "MEMORY.md"),
      "Helper agent private memory is separate from the main agent.",
      "utf8",
    );
    await writeSessionTranscript({
      agentId: "main",
      sessionKey: "agent:main:discord:channel:alerts",
      sessionId: "shared-alerts-session",
      messages: [
        {
          role: "user",
          content:
            "For shared alerts, high latency plus sync retry needs idempotent async buffering.",
        },
        {
          role: "assistant",
          content:
            "Shared alerts should avoid sync retry during high latency and require idempotency safeguards.",
        },
      ],
    });

    const cfg = createMultiAgentConfig({ main: mainWorkspace, helper: helperWorkspace });
    const mainResolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    const helperResolved = resolveMemoryBackendConfig({ cfg, agentId: "helper" });
    if (!mainResolved.cogniweave || !helperResolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const mainManager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: mainResolved.cogniweave,
    });
    await mainManager.search("high latency sync retry", {
      sessionKey: "agent:main:discord:channel:alerts",
    });

    const helperManager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "helper",
      resolved: helperResolved.cogniweave,
    });
    const helperGroupResults = await helperManager.search("high latency sync retry", {
      sessionKey: "agent:helper:discord:channel:alerts",
    });

    expect(helperGroupResults.some((result) => result.source === "sessions")).toBe(true);
    expect(helperGroupResults[0]?.path).toBe("sessions/main/shared-alerts-session.jsonl");
  });

  it("restores shared group memory from scope snapshots after managers close", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const mainWorkspace = await makeWorkspace();
    const helperWorkspace = await makeWorkspace();
    await fs.writeFile(
      path.join(mainWorkspace, "MEMORY.md"),
      "Main agent private memory is not visible to helper direct chats.",
      "utf8",
    );
    await fs.writeFile(
      path.join(helperWorkspace, "MEMORY.md"),
      "Helper agent private memory should not contain the persisted alerts transcript.",
      "utf8",
    );
    await writeSessionTranscript({
      agentId: "main",
      sessionKey: "agent:main:discord:channel:alerts",
      sessionId: "persisted-alerts-session",
      messages: [
        {
          role: "user",
          content:
            "For persisted alerts, high latency plus sync retry needs idempotent async buffering.",
        },
        {
          role: "assistant",
          content:
            "Persisted alerts should avoid sync retry during high latency and require idempotency safeguards.",
        },
      ],
    });

    const cfg = createMultiAgentConfig({ main: mainWorkspace, helper: helperWorkspace });
    const mainResolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    const helperResolved = resolveMemoryBackendConfig({ cfg, agentId: "helper" });
    if (!mainResolved.cogniweave || !helperResolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const mainManager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: mainResolved.cogniweave,
    });
    const initialGroupResults = await mainManager.search("high latency sync retry", {
      sessionKey: "agent:main:discord:channel:alerts",
    });
    expect(initialGroupResults[0]?.path).toBe("sessions/main/persisted-alerts-session.jsonl");
    await mainManager.close();

    const helperManager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "helper",
      resolved: helperResolved.cogniweave,
    });
    const restoredGroupResults = await helperManager.search("high latency sync retry", {
      sessionKey: "agent:helper:discord:channel:alerts",
    });

    expect(restoredGroupResults.some((result) => result.source === "sessions")).toBe(true);
    expect(restoredGroupResults[0]?.path).toBe("sessions/main/persisted-alerts-session.jsonl");
    await helperManager.close();
  });

  it("removes deleted session docs from shared scope snapshots", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const mainWorkspace = await makeWorkspace();
    const helperWorkspace = await makeWorkspace();
    await fs.writeFile(
      path.join(mainWorkspace, "MEMORY.md"),
      "Main agent private memory does not mention deleted alerts.",
      "utf8",
    );
    await fs.writeFile(
      path.join(helperWorkspace, "MEMORY.md"),
      "Helper agent private memory does not mention deleted alerts.",
      "utf8",
    );
    await writeSessionTranscript({
      agentId: "main",
      sessionKey: "agent:main:discord:channel:alerts",
      sessionId: "deleted-alerts-session",
      messages: [
        {
          role: "user",
          content: "Deleted alerts memory says high latency sync retry needs temporary quarantine.",
        },
        {
          role: "assistant",
          content: "Deleted alerts should use temporary quarantine during high latency.",
        },
      ],
    });

    const cfg = createMultiAgentConfig({ main: mainWorkspace, helper: helperWorkspace });
    const mainResolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    const helperResolved = resolveMemoryBackendConfig({ cfg, agentId: "helper" });
    if (!mainResolved.cogniweave || !helperResolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const mainManager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: mainResolved.cogniweave,
    });
    const initialGroupResults = await mainManager.search("temporary quarantine high latency", {
      sessionKey: "agent:main:discord:channel:alerts",
    });
    expect(initialGroupResults[0]?.path).toBe("sessions/main/deleted-alerts-session.jsonl");

    await fs.rm(resolveSessionTranscriptPath("deleted-alerts-session", "main"), { force: true });
    const afterDeleteResults = await mainManager.search("temporary quarantine high latency", {
      sessionKey: "agent:main:discord:channel:alerts",
    });
    expect(afterDeleteResults.some((result) => result.source === "sessions")).toBe(false);
    await mainManager.close();

    const helperManager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "helper",
      resolved: helperResolved.cogniweave,
    });
    const restoredAfterDeleteResults = await helperManager.search(
      "temporary quarantine high latency",
      {
        sessionKey: "agent:helper:discord:channel:alerts",
      },
    );

    expect(restoredAfterDeleteResults.some((result) => result.source === "sessions")).toBe(false);
    await helperManager.close();
  });

  it("batches session transcript updates before syncing impacted scopes", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const workspace = await makeWorkspace();
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "Targeted sync smoke test.", "utf8");

    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });
    const testManager = manager as unknown as CogniWeaveManagerTestSeam;
    const syncAllScopesSpy = vi
      .spyOn(testManager, "syncAllScopes")
      .mockResolvedValue(undefined as never);
    const targetedSyncSpy = vi
      .spyOn(testManager, "syncImpactedScopesForSessionFiles")
      .mockResolvedValue(undefined as never);

    emitSessionTranscriptUpdate(resolveSessionTranscriptPath("delta-session", "main"));
    emitSessionTranscriptUpdate(resolveSessionTranscriptPath("delta-session-2", "main"));

    await waitForAssertion(() => {
      expect(targetedSyncSpy).toHaveBeenCalledTimes(1);
    });
    expect(targetedSyncSpy).toHaveBeenCalledWith([
      resolveSessionTranscriptPath("delta-session", "main"),
      resolveSessionTranscriptPath("delta-session-2", "main"),
    ]);
    expect(syncAllScopesSpy).not.toHaveBeenCalled();
    await manager.close();
  });

  it("resolves a session transcript update to only the impacted shared scope", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const workspace = await makeWorkspace();
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "Scoped delta routing test.", "utf8");
    await writeSessionTranscript({
      sessionKey: "agent:main:discord:channel:alerts",
      sessionId: "alerts-session",
      messages: [
        {
          role: "user",
          content: "Group alerts remember incident breadcrumbs.",
        },
        {
          role: "assistant",
          content: "Incident breadcrumbs stay in the alerts room.",
        },
      ],
    });
    await writeSessionTranscript({
      sessionKey: "agent:main:discord:direct:user-1",
      sessionId: "direct-session",
      messages: [
        {
          role: "user",
          content: "Direct notes stay private.",
        },
        {
          role: "assistant",
          content: "Private direct notes are agent scoped.",
        },
      ],
    });

    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });
    const testManager = manager as unknown as CogniWeaveManagerTestSeam;
    const syncAllScopesSpy = vi.spyOn(testManager, "syncAllScopes");
    const syncScopeSpy = vi.spyOn(testManager, "syncScope");
    syncAllScopesSpy.mockClear();
    syncScopeSpy.mockClear();

    await testManager.syncImpactedScopesForSessionFile(
      resolveSessionTranscriptPath("alerts-session", "main"),
    );

    expect(syncAllScopesSpy).not.toHaveBeenCalled();
    expect(syncScopeSpy).toHaveBeenCalledTimes(1);
    expect(syncScopeSpy.mock.calls[0]?.[0]).toMatchObject({
      projectId: "chat:discord:channel:alerts",
      agentId: "shared",
      visibility: "shared",
    });
    await manager.close();
  });

  it("deduplicates repeated session updates that resolve to the same scope", async () => {
    const stateDir = await makeWorkspace();
    process.env.OPENBOT_STATE_DIR = stateDir;
    const workspace = await makeWorkspace();
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "Scope dedupe test.", "utf8");
    await writeSessionTranscript({
      sessionKey: "agent:main:discord:channel:alerts",
      sessionId: "alerts-session",
      messages: [
        {
          role: "user",
          content: "Alerts room keeps the group plan.",
        },
        {
          role: "assistant",
          content: "The group plan stays in alerts.",
        },
      ],
    });
    await writeSessionTranscript({
      sessionKey: "agent:main:discord:channel:alerts:thread:incident-42",
      sessionId: "thread-session",
      messages: [
        {
          role: "user",
          content: "Thread follow-up stays under alerts.",
        },
        {
          role: "assistant",
          content: "Thread notes reuse the alerts scope.",
        },
      ],
    });

    const cfg = createConfig(workspace);
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave config");
    }

    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });
    const testManager = manager as unknown as CogniWeaveManagerTestSeam;
    const syncScopeSpy = vi.spyOn(testManager, "syncScope");
    syncScopeSpy.mockClear();

    await testManager.syncImpactedScopesForSessionFiles([
      resolveSessionTranscriptPath("alerts-session", "main"),
      resolveSessionTranscriptPath("thread-session", "main"),
    ]);

    expect(syncScopeSpy).toHaveBeenCalledTimes(1);
    expect(syncScopeSpy.mock.calls[0]?.[0]).toMatchObject({
      projectId: "chat:discord:channel:alerts",
      agentId: "shared",
      visibility: "shared",
    });
    await manager.close();
  });

  it("is selected by getMemorySearchManager when cogniweave backend is configured", async () => {
    const workspace = await makeWorkspace();
    await fs.writeFile(
      path.join(workspace, "MEMORY.md"),
      "High latency and sync retry require async buffering plus idempotency safeguards.",
      "utf8",
    );
    const cfg = createConfig(workspace);

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).toBeTruthy();
    expect(result.manager?.status().backend).toBe("cogniweave");
  });
});
