import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { readEvolutionTaskOutcomes } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { publishEvolutionFromTaskOutcome } from "./growth-bridge.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:x",
  subjectRef: "u",
  authzScopeRef: "s",
};

describe("growth-bridge", () => {
  let root = "";
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "to-bridge-"));
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "to-agent-"));
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("does not publish incomplete awaiting tasks as success", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "g1",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const pub = publishEvolutionFromTaskOutcome(cfg, "bot", opened.record);
    expect(pub.written).toBe(false);
    expect(readEvolutionTaskOutcomes(cfg, "bot")).toHaveLength(0);
  });

  it("does not publish cancelled as capability failure", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "g2",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const cancelled = chat.cancel("g2", opened.record.outcomeVersion, opened.fencingToken, {
      scope,
    });
    if (!cancelled.ok) {
      throw new Error("cancel");
    }
    const pub = publishEvolutionFromTaskOutcome(cfg, "bot", cancelled.record);
    expect(pub.written).toBe(false);
    expect(readEvolutionTaskOutcomes(cfg, "bot")).toHaveLength(0);
  });
});
