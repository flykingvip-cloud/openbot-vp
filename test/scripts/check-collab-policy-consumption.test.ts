import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LANES,
  POLICY_CONSUMPTION_ALLOWLIST,
  collectPolicyConsumptionFindings,
  evaluatePolicyConsumption,
  findPolicyConsumptionFindings,
  isConsumerFile,
} from "../../scripts/check-collab-policy-consumption.mjs";

const REPO_ROOT = path.resolve(__dirname, "../..");
const find = (source: string) =>
  findPolicyConsumptionFindings(source, "x.ts").map((f) => `${f.rule}|${f.detail}|${f.lane}`);
const withFile = (source: string, file = "src/gateway/collaboration-dispatch/x.ts") =>
  findPolicyConsumptionFindings(source, "x.ts").map((f) => ({ file, ...f }));
const emptyBuckets = () => ({
  participation: [],
  dispatch: [],
  governance: [],
  context: [],
  presentation: [],
});
/** Split-join so repo search for the retired bypass field stays at 0; fixtures still exercise the detector. */
const LR = ["leg", "acyReads"].join("");

describe("check-collab-policy-consumption (Floor v2.1 §5.5 P1-A4)", () => {
  it(`infers lanes for ${LR}.<field> (dot, optional chain, element access, destructuring)`, () => {
    expect(find(`const a = facts.${LR}?.maxVisibleRaw;`)).toEqual([
      `legacy-reads-field|${LR}.maxVisibleRaw|participation`,
    ]);
    expect(find(`const a = facts.${LR}.policyV1;`)).toEqual([
      `legacy-reads-field|${LR}.policyV1|dispatch`,
    ]);
    expect(find(`const a = facts.${LR}?.["coordinatorCandidates"];`)).toEqual([
      `legacy-reads-field|${LR}.coordinatorCandidates|governance`,
    ]);
    expect(find(`const { contextPolicyV1, replyLanguageRaw: r } = facts.${LR};`)).toEqual([
      `legacy-reads-field|${LR}.contextPolicyV1|context`,
      `legacy-reads-field|${LR}.replyLanguageRaw|presentation`,
    ]);
  });

  it(`aliasing ${LR} is detected and never allowlistable`, () => {
    const findings = withFile(`const legacy = facts.${LR}; f(legacy);`);
    expect(findings.map((f) => f.rule)).toEqual(["legacy-reads-alias"]);
    const allow = {
      ...emptyBuckets(),
      dispatch: [findings[0]].map(({ file, rule, detail }) => ({ file, rule, detail, count: 1 })),
    };
    const { errors } = evaluatePolicyConsumption(findings, allow);
    expect(errors.some((e) => e.includes("never allowlistable"))).toBe(true);
  });

  it("detects raw operatingState policy reads, BP-13/14/15/12/11 and recompiles", () => {
    expect(find(`const l = s.operatingState?.collaborationPolicy.replyLanguage;`)).toEqual([
      "raw-collaboration-policy|collaborationPolicy.replyLanguage|presentation",
    ]);
    expect(find(`build({ collaborationPolicy: os.collaborationPolicy });`)).toEqual([
      "raw-collaboration-policy|collaborationPolicy|null",
    ]);
    expect(find(`const m = os?.groupProfile.collaborationMode === "review_driven";`)).toEqual([
      "raw-collaboration-mode|groupProfile.collaborationMode|dispatch",
    ]);
    expect(
      find(
        `[ctx.runtimeOrganizationContext.coordinator?.agentId, managedSpace?.coordinatorBotId, os?.governance.coordinatorBotId];`,
      ),
    ).toEqual([
      "multi-source-coordinator|runtimeOrganizationContext.coordinator|governance",
      "multi-source-coordinator|managedSpace.coordinatorBotId|governance",
      "multi-source-coordinator|governance.coordinatorBotId|governance",
    ]);
    expect(find(`const t = e?.collaborationGroupProfile?.confidentialityTier;`)).toEqual([
      "raw-confidentiality|collaborationGroupProfile.confidentialityTier|context",
    ]);
    expect(find(`resolve({ contextPolicy: frozen.contextPolicy });`)).toEqual([
      "policy-v1-context|PolicyV1.contextPolicy|context",
    ]);
    expect(find(`const e = compileEffectivePolicyFromScope(scope);`)).toEqual([
      "policy-recompile|compileEffectivePolicyFromScope()|null",
    ]);
    expect(find(`const p = mod.resolveCollaborationPolicyV1({});`)).toEqual([
      "policy-recompile|resolveCollaborationPolicyV1()|null",
    ]);
  });

  it("ignores writes, comments, strings, unrelated receivers and non-call re-exports", () => {
    expect(find(`state.collaborationPolicy.replyLanguage = "zh";`)).toEqual([]);
    expect(
      find(`// facts.${LR}.policyV1\nconst s = "operatingState.collaborationPolicy";`),
    ).toEqual([]);
    expect(find(`const c = params.coordinatorBotId; const m = round.collaborationMode;`)).toEqual(
      [],
    );
    expect(find(`export { resolveCollaborationPolicyV1 };`)).toEqual([]);
  });

  it("skips the chat.ts composition-root function buildGroupRuntimeAuthority", () => {
    expect(find(`function buildGroupRuntimeAuthority() { return facts.${LR}?.policyV1; }`)).toEqual(
      [],
    );
    expect(find(`function other() { return facts.${LR}?.policyV1; }`)).toHaveLength(1);
  });

  it("scans dispatch + chat.ts + get-reply-run, but not composition roots / tests / fixtures", () => {
    const d = "src/gateway/collaboration-dispatch";
    expect(isConsumerFile(`${d}/round-runtime.ts`)).toBe(true);
    expect(isConsumerFile("src/gateway/server-methods/chat.ts")).toBe(true);
    expect(isConsumerFile("src/auto-reply/reply/get-reply-run.ts")).toBe(true);
    for (const root of [
      "runtime-authority.ts",
      "round-policy-snapshot.ts",
      "resolve-effective-policy.ts",
      "legacy-policy-view.ts",
      "policy-compiler.ts",
      "policy-compiler-sections.ts",
      "policy-migration-event.ts",
      "effective-policy.ts",
      "policy-lane-context.ts",
      "policy-lane-presentation.ts",
      "policy-lane-participation.ts",
    ]) {
      expect(isConsumerFile(`${d}/${root}`)).toBe(false);
    }
    expect(isConsumerFile(`${d}/round-runtime.test.ts`)).toBe(false);
    expect(isConsumerFile(`${d}/__fixtures__/digital-team-real-rounds.ts`)).toBe(false);
    expect(isConsumerFile("src/gateway/server-methods/other.ts")).toBe(false);
  });

  it("gate: new bypass / growth / stale allowance / mis-bucketing / bad buckets all fail", () => {
    const findings = withFile(
      `const a = f.${LR}?.maxVisibleRaw; const b = f.${LR}?.maxVisibleRaw;`,
    );
    const entry = {
      file: findings[0].file,
      rule: "legacy-reads-field",
      detail: `${LR}.maxVisibleRaw`,
    };
    // exact match passes
    expect(
      evaluatePolicyConsumption(findings, {
        ...emptyBuckets(),
        participation: [{ ...entry, count: 2 }],
      }).errors,
    ).toEqual([]);
    // new bypass
    expect(evaluatePolicyConsumption(findings, emptyBuckets()).errors[0]).toMatch(
      /new policy bypass/,
    );
    // growth
    expect(
      evaluatePolicyConsumption(findings, {
        ...emptyBuckets(),
        participation: [{ ...entry, count: 1 }],
      }).errors[0],
    ).toMatch(/bypass grew/);
    // stale
    expect(
      evaluatePolicyConsumption(findings, {
        ...emptyBuckets(),
        participation: [{ ...entry, count: 3 }],
      }).errors[0],
    ).toMatch(/shrink the bucket/);
    // mis-bucketed
    expect(
      evaluatePolicyConsumption(findings, { ...emptyBuckets(), dispatch: [{ ...entry, count: 2 }] })
        .errors[0],
    ).toMatch(/belongs to lane "participation"/);
    // duplicate across buckets
    expect(
      evaluatePolicyConsumption(findings, {
        ...emptyBuckets(),
        participation: [{ ...entry, count: 2 }],
        context: [{ ...entry, count: 2 }],
      }).errors.some((e) => e.includes("duplicate entry")),
    ).toBe(true);
    // missing / unknown lane buckets
    const { presentation: _drop, ...missing } = emptyBuckets();
    expect(evaluatePolicyConsumption([], missing).errors).toEqual([
      'allowlist: missing lane bucket "presentation"',
    ]);
    expect(evaluatePolicyConsumption([], { ...emptyBuckets(), misc: [] }).errors[0]).toMatch(
      /unknown lane bucket "misc"/,
    );
  });

  it("allowlist has exactly the 5 capability-lane buckets", () => {
    expect(Object.keys(POLICY_CONSUMPTION_ALLOWLIST).toSorted()).toEqual([...LANES].toSorted());
  });

  it("repository: bucket counts equal remaining bypass sites, per lane", async () => {
    const { findings } = await collectPolicyConsumptionFindings(REPO_ROOT);
    const { errors, laneCounts } = evaluatePolicyConsumption(findings);
    expect(errors).toEqual([]);
    for (const lane of LANES) {
      const allowed = POLICY_CONSUMPTION_ALLOWLIST[lane].reduce((n, e) => n + e.count, 0);
      expect(laneCounts[lane]).toBe(allowed);
    }
    expect(laneCounts).toEqual({
      participation: 0,
      dispatch: 0,
      governance: 0,
      context: 0,
      presentation: 0,
    });
    expect(findings).toHaveLength(0);
  });

  it("Phase 1-A consumption allowlist is fully cleared (P1-A5 ③)", async () => {
    const { findings } = await collectPolicyConsumptionFindings(REPO_ROOT);
    expect(findings).toHaveLength(0);
    const { errors } = evaluatePolicyConsumption(findings, emptyBuckets());
    expect(errors).toEqual([]);
    // Synthetic new bypass still fails against empty allowlist.
    const synthetic = withFile(`const a = facts.${LR}.coordinatorCandidates;`);
    const { errors: synErr } = evaluatePolicyConsumption(synthetic, emptyBuckets());
    expect(synErr.length).toBeGreaterThan(0);
    expect(synErr.every((e) => e.includes("new policy bypass"))).toBe(true);
  });
});
