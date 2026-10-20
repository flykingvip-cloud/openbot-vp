import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isImportedAgentSessionKey,
  isLeftoverBotSpaceSessionKey,
  isRedundantRobotAliasSessionKey,
  isWecomGroupSessionKey,
} from "../../sessions/session-key-utils.js";
import {
  retireLeftoverBotSpaceSessions,
  retireRedundantRobotAliasSessions,
} from "./retire-workbench-alias-sessions.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fsp.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("redundant robot alias keys", () => {
  it("classifies imported workbuddy and wecom group placeholders", () => {
    expect(
      isImportedAgentSessionKey(
        "agent:bot-skill:imported:workbuddy:cace1775-1aca-4b96-8d30-74775fb1bd1a",
      ),
    ).toBe(true);
    expect(isWecomGroupSessionKey("agent:bot-2:wecom:group:daniel")).toBe(true);
    expect(isRedundantRobotAliasSessionKey("agent:bot-skill:main")).toBe(false);
    expect(isRedundantRobotAliasSessionKey("agent:main:employee:user-1")).toBe(false);
  });

  it("deletes imported and empty wecom keys without touching agent:id:main", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "openbot-retire-alias-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    const mainFile = path.join(dir, "main-session.jsonl");
    const importedFile = path.join(dir, "imported.jsonl");
    const wecomSid = "wecom-empty";
    const wecomFile = path.join(dir, `${wecomSid}.jsonl`);
    fs.writeFileSync(
      mainFile,
      '{"type":"session"}\n{"message":{"role":"user","content":"keep"}}\n',
    );
    fs.writeFileSync(
      importedFile,
      '{"type":"session"}\n{"message":{"role":"user","content":"imported leftover"}}\n',
    );
    fs.writeFileSync(wecomFile, "");
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        "agent:bot-skill:main": {
          sessionId: "main-sid",
          sessionFile: mainFile,
          updatedAt: 1,
        },
        "agent:bot-skill:imported:workbuddy:abc": {
          sessionId: "imported-sid",
          sessionFile: importedFile,
          updatedAt: 2,
        },
        "agent:bot-skill:wecom:group:daniel": {
          sessionId: wecomSid,
          updatedAt: 3,
        },
      }),
      "utf-8",
    );

    const retired = await retireRedundantRobotAliasSessions({ storePath });
    const store = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Record<string, unknown>;

    expect(retired.retiredKeys.toSorted()).toEqual([
      "agent:bot-skill:imported:workbuddy:abc",
      "agent:bot-skill:wecom:group:daniel",
    ]);
    expect(store["agent:bot-skill:main"]).toBeDefined();
    expect(store["agent:bot-skill:imported:workbuddy:abc"]).toBeUndefined();
    expect(store["agent:bot-skill:wecom:group:daniel"]).toBeUndefined();
    expect(fs.existsSync(mainFile)).toBe(true);
    expect(fs.existsSync(importedFile)).toBe(false);
    expect(fs.existsSync(wecomFile)).toBe(false);
  });

  it("deletes leftover org-bus space inboxes without touching agent:id:main or space:<id>", async () => {
    expect(isLeftoverBotSpaceSessionKey("agent:bot-2:main:space:upbeyond")).toBe(true);
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "openbot-retire-org-inbox-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    const mainFile = path.join(dir, "main-session.jsonl");
    const spaceFile = path.join(dir, "space-upbeyond.jsonl");
    const leftoverFile = path.join(dir, "org-inbox.jsonl");
    fs.writeFileSync(
      mainFile,
      '{"type":"session"}\n{"message":{"role":"user","content":"keep"}}\n',
    );
    fs.writeFileSync(
      spaceFile,
      '{"type":"session"}\n{"message":{"role":"user","content":"group"}}\n',
    );
    fs.writeFileSync(
      leftoverFile,
      '{"type":"session"}\n{"message":{"role":"user","content":"Organization task assignment:"}}\n',
    );
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        "agent:bot-2:main": {
          sessionId: "main-sid",
          sessionFile: mainFile,
          updatedAt: 1,
        },
        "space:upbeyond": {
          sessionId: "space-sid",
          sessionFile: spaceFile,
          updatedAt: 2,
        },
        "agent:bot-2:main:space:upbeyond": {
          sessionId: "org-inbox-sid",
          sessionFile: leftoverFile,
          updatedAt: 3,
        },
        "agent:bot-2:org:upbeyond": {
          sessionId: "new-org-sid",
          updatedAt: 4,
        },
      }),
      "utf-8",
    );

    const retired = await retireLeftoverBotSpaceSessions({ storePath });
    const store = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Record<string, unknown>;

    expect(retired.retiredKeys).toEqual(["agent:bot-2:main:space:upbeyond"]);
    expect(store["agent:bot-2:main"]).toBeDefined();
    expect(store["space:upbeyond"]).toBeDefined();
    expect(store["agent:bot-2:org:upbeyond"]).toBeDefined();
    expect(store["agent:bot-2:main:space:upbeyond"]).toBeUndefined();
    expect(fs.existsSync(mainFile)).toBe(true);
    expect(fs.existsSync(spaceFile)).toBe(true);
    expect(fs.existsSync(leftoverFile)).toBe(false);
  });
});
