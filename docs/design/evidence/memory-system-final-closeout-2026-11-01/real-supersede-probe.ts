/**
 * Closeout probe: real active→deprecated transition via engine.supersedeAtom.
 * Does not pre-seed deprecated/conflicted rows. Does not call manager.search
 * (CogniWeave search syncs scope and can write). Does not purge.
 *
 * Evidence layer: sdk-unit (in-memory metadata). Not HTTP, not a model, not production.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  InMemoryCogniWeaveEngine,
  InMemoryMetadataStore,
  createMemoryPartitionKeyV1,
  createMemorySubjectBinding,
  isAtomRetrievable,
  type MemoryAtom,
  type Scope,
} from "../../../../packages/cogniweave-sdk/src/index.js";
import {
  applyIsolationEnv,
  assertNoRealHomeLeak,
  assertPathInsideIsolation,
  createIsolationLayout,
} from "../../../../src/memory/memory-batch1-isolation.js";

const scope: Scope = {
  workspaceId: "ws_closeout_supersede",
  projectId: "proj_closeout_supersede",
  agentId: "agent_closeout",
  visibility: "private",
};

const FACT_OLD = "FACT-OLD-CLOSEOUT-20261101";
const FACT_NEW = "FACT-NEW-CLOSEOUT-20261101";
const ATOM_OLD = "atom_closeout_old";
const ATOM_NEW = "atom_closeout_new";

function makeActive(id: string, statement: string): MemoryAtom {
  return {
    id,
    atomType: "strategy",
    scope,
    claim: { type: "causal", statement },
    trigger: { conditions: ["closeout"], contextTags: ["synthetic"] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: [], evidenceRefs: [] },
    versioning: { version: 1 },
    state: { status: "active", conflictsWith: [] },
    metrics: { confidence: 0.9, reuseCount: 0 },
  };
}

function assert(cond: unknown, message: string): void {
  if (!cond) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const layout = createIsolationLayout("openbot-mem-closeout-supersede-");
  const restore = applyIsolationEnv(layout);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.join(here, "real-supersede-probe.json");
  try {
    for (const value of [
      layout.root,
      layout.stateDir,
      layout.dataRoot,
      layout.workspace,
      layout.sessionsDir,
      layout.collaborationDir,
      layout.configPath,
      layout.tenantsRoot,
    ]) {
      assertPathInsideIsolation(value, layout.root);
      assertNoRealHomeLeak(value);
    }
    assert(process.env.OPENBOT_STATE_DIR === layout.stateDir, "state dir not pinned");
    assert(process.env.OPENBOT_DATA_ROOT === layout.dataRoot, "data root not pinned");
    assert(process.env.OPENBOT_DATA_MODE === "local", "data mode not local");
    assert(!process.env.OPENBOT_GATEWAY_TOKEN, "gateway token must stay unset");
    assert(!process.env.OPENCLAW_GATEWAY_TOKEN, "legacy gateway token must stay unset");

    const store = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore: store },
    );
    const tenantId = "tenant_closeout";
    const ownerId = "user_closeout";
    const dataPlaneId = await store.ensureDataPlaneId();
    const partition = createMemoryPartitionKeyV1(dataPlaneId, scope);
    await store.saveMemorySubjectBinding(
      createMemorySubjectBinding({
        partition,
        scope,
        subject: { tenantId, ownerType: "user", ownerId },
        scopeType: "personal",
      }),
    );
    await store.saveAtom(makeActive(ATOM_OLD, FACT_OLD));
    await store.saveAtom(makeActive(ATOM_NEW, FACT_NEW));
    const caller = { tenantId, ownerType: "user" as const, ownerId };

    const before = await engine.queryAtoms({ scope, caller });
    const beforeIds = before.map((hit) => hit.atom.id).toSorted();
    assert(
      beforeIds.join(",") === [ATOM_NEW, ATOM_OLD].toSorted().join(","),
      `expected both active atoms, got ${beforeIds.join(",")}`,
    );
    assert(
      before.every((hit) => hit.atom.state.status === "active"),
      "pre-supersede rows must be active",
    );

    const wrongBefore = JSON.stringify(await store.getAtom(ATOM_OLD));
    const denied = await engine.queryAtoms({
      scope,
      caller: { tenantId, ownerType: "user", ownerId: "user_other" },
    });
    assert(denied.length === 0, "wrong owner must not receive atoms");
    assert(
      !JSON.stringify(denied).includes(FACT_OLD) && !JSON.stringify(denied).includes(FACT_NEW),
      "deny payload leaked fact text",
    );
    assert(JSON.stringify(await store.getAtom(ATOM_OLD)) === wrongBefore, "deny mutated old atom");

    await engine.supersedeAtom(ATOM_OLD, ATOM_NEW);
    const oldAfter = await store.getAtom(ATOM_OLD);
    const newAfter = await store.getAtom(ATOM_NEW);
    assert(oldAfter?.state.status === "deprecated", "supersede did not deprecate old atom");
    assert(newAfter?.state.status === "active", "new atom must stay active");
    assert(newAfter?.versioning.parentVersion === ATOM_OLD, "parentVersion not linked");
    assert(!isAtomRetrievable(oldAfter!).retrievable, "deprecated atom still retrievable");
    assert(isAtomRetrievable(newAfter!).retrievable, "new atom not retrievable");

    const after = await engine.queryAtoms({ scope, caller });
    assert(
      after.map((hit) => hit.atom.id).join(",") === ATOM_NEW,
      `queryAtoms after supersede = ${after.map((hit) => hit.atom.id).join(",")}`,
    );
    assert(
      after.every((hit) => !hit.atom.claim.statement.includes(FACT_OLD)),
      "old fact statement still in default query",
    );

    const conflicts = await engine.detectConflicts({ scope });
    const oldStillDeprecated = (await store.getAtom(ATOM_OLD))?.state.status;
    assert(oldStillDeprecated === "deprecated", "detectConflicts mutated status");

    const sourceIdentityId = "sid_closeout_soft_forget";
    const forgetInput = {
      selector: { mode: "identity" as const, sourceIdentityId },
      subject: { scope },
      reasonCode: "CLOSEOUT_SOFT_FORGET",
    };
    const firstForget = await engine.forgetSource({
      ...forgetInput,
      operationId: "closeout-soft-forget-1",
    });
    assert(firstForget.currentStatus === "forgotten", "first soft forget did not reach forgotten");
    assert(firstForget.currentStatus !== "purged", "soft forget purged");
    const replay = await engine.forgetSource({
      ...forgetInput,
      operationId: "closeout-soft-forget-1",
    });
    assert(replay.operationId === firstForget.operationId, "idempotent replay changed operation");
    assert(replay.currentStatus === "forgotten", "replay status changed");
    const secondOp = await engine.forgetSource({
      ...forgetInput,
      operationId: "closeout-soft-forget-2",
    });
    assert(secondOp.currentStatus === "forgotten", "second op did not stay forgotten");
    assert(secondOp.affectedObjectCount === 0, "second op mutated objects");
    assert(
      engine.getSourceBindingStatus(forgetInput.selector) === "forgotten",
      "binding left forgotten",
    );

    const report = {
      evidenceLayer: "sdk-unit",
      searchCalled: false,
      purgeCalled: false,
      preseedDeprecated: false,
      factIds: { old: FACT_OLD, new: FACT_NEW, atomOld: ATOM_OLD, atomNew: ATOM_NEW },
      isolationRoot: layout.root,
      beforeIds,
      afterIds: after.map((hit) => hit.atom.id),
      oldStatusAfterSupersede: oldAfter?.state.status,
      newParentVersion: newAfter?.versioning.parentVersion,
      wrongOwnerHitCount: denied.length,
      detectConflictsReturn: conflicts,
      detectConflictsDoesNotFlipStatus: true,
      softForget: {
        firstStatus: firstForget.currentStatus,
        replayOperationId: replay.operationId,
        secondAffectedObjectCount: secondOp.affectedObjectCount,
        bindingStatus: engine.getSourceBindingStatus(forgetInput.selector),
        purgeCalled: false,
        physicalDeleteClaimed: false,
      },
      note: "Conflict rows are not produced by detectConflicts; this probe does not claim a product conflict workflow. Soft forget is source lifecycle forgotten, not purge.",
    };
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, outPath })}\n`);
  } finally {
    restore();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
