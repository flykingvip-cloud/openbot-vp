import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyTenantSessionStores } from "./session-store-migrate.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function writeStore(
  storePath: string,
  sessions: Record<string, { sessionId: string; updatedAt: number; body: string }>,
): Promise<Record<string, string>> {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const record: Record<string, unknown> = {};
  const files: Record<string, string> = {};
  for (const [sessionKey, session] of Object.entries(sessions)) {
    const transcript = path.join(path.dirname(storePath), `${session.sessionId}.jsonl`);
    await fs.writeFile(transcript, session.body, "utf8");
    files[sessionKey] = transcript;
    record[sessionKey] = {
      sessionId: session.sessionId,
      updatedAt: session.updatedAt,
      sessionFile: transcript,
    };
  }
  await fs.writeFile(storePath, JSON.stringify(record), "utf8");
  return files;
}

describe("migrateLegacyTenantSessionStores", () => {
  it("merges two stores, keeps the newer transcript, records ownership, and is idempotent", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-migrate-state-"));
    const tenantsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-migrate-tenants-"));
    dirs.push(stateDir, tenantsRoot);

    const sessionKey = "agent:panda:main";
    const canonicalDir = path.join(stateDir, "agents", "panda", "sessions");
    const canonicalStore = path.join(canonicalDir, "sessions.json");
    await writeStore(canonicalStore, {
      [sessionKey]: {
        sessionId: "sess-mid",
        updatedAt: 3_000,
        body: '{"message":{"role":"user","content":"middle"}}\n',
      },
      "agent:panda:fresh": {
        sessionId: "sess-fresh",
        updatedAt: 9_000,
        body: '{"message":{"role":"user","content":"canonical-newer"}}\n',
      },
    });

    const olderStore = path.join(
      tenantsRoot,
      "acme",
      "users",
      "u-old",
      "state",
      "agents",
      "panda",
      "sessions",
      "sessions.json",
    );
    const olderFiles = await writeStore(olderStore, {
      [sessionKey]: {
        sessionId: "sess-old",
        updatedAt: 1_000,
        body: '{"message":{"role":"user","content":"older"}}\n',
      },
      "agent:panda:fresh": {
        sessionId: "sess-stale",
        updatedAt: 2_000,
        body: '{"message":{"role":"user","content":"stale-legacy"}}\n',
      },
      "space:grp-shared": {
        sessionId: "sess-space",
        updatedAt: 8_000,
        body: '{"message":{"role":"user","content":"do-not-fork"}}\n',
      },
    });

    const newerStore = path.join(
      tenantsRoot,
      "acme",
      "users",
      "u-new",
      "state",
      "agents",
      "panda",
      "sessions",
      "sessions.json",
    );
    const newerFiles = await writeStore(newerStore, {
      [sessionKey]: {
        sessionId: "sess-new",
        updatedAt: 5_000,
        body: '{"message":{"role":"user","content":"newer"}}\n',
      },
    });

    const first = await migrateLegacyTenantSessionStores({ stateDir, tenantsRoot });
    expect(first.errors).toEqual([]);
    expect(first.mergedFromLegacy).toBe(1);
    expect(first.ownershipStamped).toBe(1);
    expect(first.skippedGroupPublic).toBe(1);
    expect(first.legacyFilesDeleted).toBe(false);
    expect(first.legacyStoresRetained).toBe(2);

    const botTranscript = path.join(canonicalDir, "sess-new.jsonl");
    expect(await fs.readFile(botTranscript, "utf8")).toContain("newer");
    expect(botTranscript.startsWith(canonicalDir + path.sep)).toBe(true);
    expect(botTranscript).not.toContain(`${path.sep}tenants${path.sep}`);
    expect(botTranscript).not.toContain(`${path.sep}users${path.sep}`);

    const store = JSON.parse(await fs.readFile(canonicalStore, "utf8")) as Record<
      string,
      {
        sessionId?: string;
        sessionFile?: string;
        ownerTenantId?: string;
        ownerUserId?: string;
        ownerBotId?: string;
      }
    >;
    expect(store[sessionKey]?.sessionId).toBe("sess-new");
    expect(store[sessionKey]?.sessionFile).toBe(path.resolve(botTranscript));
    expect(store[sessionKey]?.ownerTenantId).toBe("acme");
    expect(store[sessionKey]?.ownerUserId).toBe("u-new");
    expect(store[sessionKey]?.ownerBotId).toBe("panda");
    expect(store["agent:panda:fresh"]?.sessionId).toBe("sess-fresh");
    expect(await fs.readFile(path.join(canonicalDir, "sess-fresh.jsonl"), "utf8")).toContain(
      "canonical-newer",
    );
    expect(store["agent:panda:fresh"]?.ownerTenantId).toBe("acme");
    expect(store["agent:panda:fresh"]?.ownerUserId).toBe("u-old");
    expect(store["space:grp-shared"]).toBeUndefined();
    await expect(fs.access(path.join(canonicalDir, "sess-space.jsonl"))).rejects.toThrow();

    await expect(fs.access(olderFiles[sessionKey])).resolves.toBeUndefined();
    await expect(fs.access(newerFiles[sessionKey])).resolves.toBeUndefined();
    await expect(fs.access(olderStore)).resolves.toBeUndefined();
    await expect(fs.access(newerStore)).resolves.toBeUndefined();
    const legacyStoreBytes = await fs.readFile(newerStore);
    const botStoreBytes = await fs.readFile(canonicalStore);
    const botTranscriptBytes = await fs.readFile(botTranscript);
    const botTranscriptStat = await fs.stat(botTranscript);

    const second = await migrateLegacyTenantSessionStores({ stateDir, tenantsRoot });
    expect(second.errors).toEqual([]);
    expect(second.mergedFromLegacy).toBe(0);
    expect(second.ownershipStamped).toBe(0);
    expect(second.legacyFilesDeleted).toBe(false);
    expect(await fs.readFile(canonicalStore)).toEqual(botStoreBytes);
    expect(await fs.readFile(botTranscript)).toEqual(botTranscriptBytes);
    expect((await fs.stat(botTranscript)).mtimeMs).toBe(botTranscriptStat.mtimeMs);
    expect(await fs.readFile(newerStore)).toEqual(legacyStoreBytes);
    expect(await fs.readFile(olderFiles[sessionKey], "utf8")).toContain("older");
  });
});
