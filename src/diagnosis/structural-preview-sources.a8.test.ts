import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { appendEvolutionTaskOutcome } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { DEFAULT_WORKING_STYLE } from "../gateway/agent-growth/genome.js";
import { writeRobotWorkingStyle } from "../gateway/agent-growth/working-style-store.js";
import { createWorkingDnaAdapter } from "../gateway/evolution-control/adapters/working-dna.js";
import { confirmDiagnosisCandidatePreview } from "../gateway/evolution-control/confirm-diagnosis-candidate.js";
import { diagnosisGrantViewFromAuthorization } from "../gateway/evolution-control/confirm-diagnosis-candidate.js";
import { createEvolutionControlPlane } from "../gateway/evolution-control/control-plane.js";
import {
  approveEvolutionGrant,
  evolutionGrantActorFromPrincipal,
  requestEvolutionWorkingDnaGrant,
} from "../gateway/evolution-control/evolution-grant.js";
import {
  createControlPlaneDiagnosisSubmitPorts,
  defaultSnapshotReader,
  workingDnaBaselineHash,
} from "../gateway/evolution-control/submit-diagnosis-candidate.js";
import { recordSkillInvocationCompleted } from "../gateway/skill-invocation/record.js";
import { createDiagnosisDelegationMachine } from "./delegation.js";
import { executeParsedDiagnoseRequest } from "./diagnose-live-request.js";
import { parseDiagnoseRequest } from "./diagnose-policy.js";
import type { StructuralEvolutionCandidate } from "./structural-evolution-candidate.js";

const TENANT = "001";
const AGENT = "a8-m1-isolated";
const ADMIN_USER_ID = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
const CHAT_SENTENCE = "请把汇报节奏改成 milestone，这是聊天正文。";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "a8-preview-"));
  dirs.push(dir);
  return dir;
}

function cfgFor(agentDir: string): OpenBotConfig {
  return { agents: { list: [{ id: AGENT, agentDir }] } } as unknown as OpenBotConfig;
}

function fingerprint(root: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of ["proposals.json", "candidates.json", "ledger.jsonl"]) {
    const file = path.join(root, name);
    try {
      const buf = readFileSync(file);
      out[name] = createHash("sha256").update(buf).digest("hex");
    } catch {
      out[name] = null;
    }
  }
  return out;
}

async function seedFacts(input: { root: string; task: boolean; baseline: boolean; nowMs: number }) {
  const agentDir = path.join(input.root, "agent");
  const skillDir = path.join(input.root, "skill");
  const persistDir = path.join(input.root, "outcome-bind");
  mkdirSync(agentDir, { recursive: true });
  const cfg = cfgFor(agentDir);
  if (input.baseline) {
    await writeRobotWorkingStyle(cfg, AGENT, { ...DEFAULT_WORKING_STYLE });
  }
  const sessionId = "sess-a8-isolated";
  const sessionKey = `agent:${AGENT}:main`;
  writeFileSync(
    path.join(input.root, "sessions.json"),
    `${JSON.stringify({
      [sessionKey]: {
        sessionId,
        updatedAt: input.nowMs - 1_000,
        sessionFile: path.join(agentDir, "transcript.jsonl"),
        lastHeartbeatText: CHAT_SENTENCE,
      },
    })}\n`,
  );
  writeFileSync(
    path.join(agentDir, "transcript.jsonl"),
    `${JSON.stringify({ text: CHAT_SENTENCE })}\n`,
  );
  const runId = "run-a8-isolated";
  recordSkillInvocationCompleted(
    {
      invocationId: "inv-a8-isolated",
      skillId: "briefing",
      agentId: AGENT,
      tenantId: TENANT,
      outcome: "success",
      startedAt: input.nowMs - 2_000,
      completedAt: input.nowMs - 1_000,
      runId,
      taskId: runId,
      sessionKey,
      businessOutcome: CHAT_SENTENCE,
    },
    { configDir: skillDir, persistDir },
  );
  if (input.task) {
    appendEvolutionTaskOutcome(
      cfg,
      {
        agentId: AGENT,
        occurredAt: input.nowMs - 1_000,
        succeeded: true,
        tenantId: TENANT,
        runId,
        taskId: runId,
      },
      { persistDir },
    );
  }
  return { cfg, skillDir, sessionStorePath: path.join(input.root, "sessions.json") };
}

async function diagnose(input: {
  cfg: OpenBotConfig;
  skillDir: string;
  sessionStorePath: string;
  nowMs: number;
  forgedObservation?: boolean;
}) {
  return executeParsedDiagnoseRequest({
    request: parseDiagnoseRequest({
      agentId: AGENT,
      sessionKey: `agent:${AGENT}:main`,
      window: "24h",
      mode: "TARGETED",
    }),
    trusted: { tenantId: TENANT },
    requestedBy: {
      schemaVersion: 1,
      principalId: ADMIN_USER_ID,
      kind: "user",
      tenantId: TENANT,
    },
    skillConfigDir: input.skillDir,
    now: input.nowMs,
    allowConversationDelivery: false,
    allowSelfEvolutionConfirm: false,
    structuralPreview: { cfg: input.cfg, sessionStorePath: input.sessionStorePath },
    ...(input.forgedObservation
      ? {
          growthReads: [
            {
              agentId: AGENT,
              tenantId: TENANT,
              agentAssetId: "forged-asset",
              targetOwnerId: "forged-owner",
              structuralObservation: {
                kind: "task_result" as const,
                observationRef: "task-outcome:forged:run",
                proposedChange: { field: "reportingCadence" as const, value: "milestone" as const },
              },
              structuralBaseline: {
                baselineHash: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
                reportingCadence: "on_completion" as const,
              },
            },
          ],
        }
      : {}),
  });
}

function previewRecords(skillDir: string): StructuralEvolutionCandidate[] {
  const root = path.join(skillDir, "diagnosis-evolution-previews");
  const files: string[] = [];
  const visit = (dir: string) => {
    if (!statExists(dir)) {
      return;
    }
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        visit(full);
      } else if (name.endsWith(".json")) {
        files.push(full);
      }
    }
  };
  visit(root);
  return files.map((file) => {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      candidate: StructuralEvolutionCandidate;
    };
    return parsed.candidate;
  });
}

function statExists(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

describe("A8 structural preview sources", () => {
  it("keeps Preview at 0 when task activity or baseline is missing", async () => {
    const nowMs = Date.parse("2026-09-22T05:20:00.000Z");
    const missingTask = tempDir();
    const noTask = await seedFacts({ root: missingTask, task: false, baseline: true, nowMs });
    const withoutTask = await diagnose({ ...noTask, nowMs, forgedObservation: true });
    expect(withoutTask.professionalReport?.producer.structuralCandidates ?? []).toEqual([]);
    expect(previewRecords(noTask.skillDir)).toEqual([]);
    expect(JSON.stringify(withoutTask)).not.toContain(CHAT_SENTENCE);

    const missingBaseline = tempDir();
    const noBaseline = await seedFacts({
      root: missingBaseline,
      task: true,
      baseline: false,
      nowMs,
    });
    const withoutBaseline = await diagnose({ ...noBaseline, nowMs });
    expect(withoutBaseline.professionalReport?.producer.structuralCandidates ?? []).toEqual([]);
    expect(previewRecords(noBaseline.skillDir)).toEqual([]);
  });

  it("turns one replayable task into a preview and an enterprise-admin proposal", async () => {
    const nowMs = Date.parse("2026-09-22T05:30:00.000Z");
    const liveRoot = path.join(process.env.HOME ?? "", ".openbot/evolution-control");
    const liveBefore = fingerprint(liveRoot);
    const root = tempDir();
    const seeded = await seedFacts({ root, task: true, baseline: true, nowMs });
    const payload = await diagnose({ ...seeded, nowMs });
    const candidates = payload.professionalReport?.producer.structuralCandidates ?? [];
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate?.proposedChange).toEqual({ field: "reportingCadence", value: "milestone" });
    expect(candidate?.baselineHash).toBe(workingDnaBaselineHash(DEFAULT_WORKING_STYLE));
    expect(candidate?.evidenceRefs).toEqual(
      expect.arrayContaining([
        "task-outcome:a8-m1-isolated:run-a8-isolated",
        "session:a8-m1-isolated:sess-a8-isolated",
        "skill-invocation:inv-a8-isolated",
      ]),
    );
    expect(JSON.stringify(candidate)).not.toContain(CHAT_SENTENCE);
    const stored = previewRecords(seeded.skillDir);
    expect(stored).toHaveLength(1);
    expect(statExists(path.join(seeded.skillDir, "diagnosis-growth-snapshots"))).toBe(true);

    const persistDir = path.join(root, "control");
    const machine = createDiagnosisDelegationMachine({ now: () => nowMs });
    const enterprise = evolutionGrantActorFromPrincipal(
      { schemaVersion: 1, principalId: ADMIN_USER_ID, kind: "user", tenantId: TENANT },
      "enterprise",
    );
    const issuer = evolutionGrantActorFromPrincipal(
      { schemaVersion: 1, principalId: "platform-evolution", kind: "service", tenantId: null },
      "platform",
    );
    const { grantId } = requestEvolutionWorkingDnaGrant({
      machine,
      commandId: "cmd-a8-grant",
      trusted: { tenantId: TENANT },
      issuer,
      approver: enterprise,
      grantee: enterprise,
      tenantId: TENANT,
      agentId: AGENT,
      evidenceRefs: candidate?.evidenceRefs ?? [],
      expiresAt: "2026-09-29T00:00:00.000Z",
    });
    const approved = approveEvolutionGrant({
      machine,
      commandId: "cmd-a8-grant-approve",
      trusted: { tenantId: TENANT },
      approver: enterprise,
      grantId,
    });
    expect(approved.status).toBe("APPROVED");
    const plane = createEvolutionControlPlane({
      inspector: {
        inspect: () => {
          throw new Error("confirm must use the server grant");
        },
      },
      workingDnaAdapter: createWorkingDnaAdapter(seeded.cfg),
      persistDir,
      now: () => new Date(nowMs).toISOString(),
    });
    const walFile = path.join(persistDir, "diagnosis-ingest-wal.json");
    const confirmed = await confirmDiagnosisCandidatePreview({
      commandId: "cmd-a8-confirm",
      grantId,
      candidateVersion: candidate?.candidateVersion ?? "",
      tenantId: TENANT,
      principalRef: ADMIN_USER_ID,
      confirmedByUser: true,
      configDir: seeded.skillDir,
      nowMs,
      deps: {
        ports: createControlPlaneDiagnosisSubmitPorts(plane, walFile),
        inspectGrant: (id) => diagnosisGrantViewFromAuthorization(machine.getGrant(id), nowMs),
        readSnapshot: defaultSnapshotReader(seeded.skillDir, nowMs),
        readBaseline: () => ({
          style: DEFAULT_WORKING_STYLE,
          hash: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
        }),
        now: () => new Date(nowMs).toISOString(),
      },
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    const proposal = plane.getProposal(confirmed.receipt.proposalId);
    expect(proposal?.status).toBe("APPROVED_FOR_EXPERIMENT");
    expect(plane.listApplications()).toEqual([]);
    expect(plane.ledger.list().map((event) => event.type)).toContain("proposal.created");
    expect(statExists(walFile)).toBe(true);
    expect(plane.ledger.list().some((event) => event.type === "application.applied")).toBe(false);
    expect(liveBefore).toEqual(fingerprint(liveRoot));
    const evidence = {
      tenantId: TENANT,
      agentId: AGENT,
      principalUserId: ADMIN_USER_ID,
      sessionKind: "enterprise-admin",
      previewCount: stored.length,
      candidateVersion: candidate?.candidateVersion,
      observationRef: "task-outcome:a8-m1-isolated:run-a8-isolated",
      baselineHash: candidate?.baselineHash,
      proposalId: confirmed.receipt.proposalId,
      proposalStatus: proposal?.status,
      ledgerTypes: plane.ledger.list().map((event) => event.type),
      wal: walFile,
      applicationCount: plane.listApplications().length,
      verificationCount: 0,
      recheck: null,
      liveStoreUnchanged: true,
      boundary: "A8 proposal registration is not M1 completion and is not E5.2",
    };
    writeFileSync("/tmp/a8-m1-evidence.json", `${JSON.stringify(evidence, null, 2)}\n`);
  });
});
