/**
 * Synthetic model-effect six-scenario driver (DeepSeek only).
 *
 * Isolation-only: dedicated temp state root. Does NOT write real ~/.openbot memory.
 * Loads API key from ~/.openbot/openbot.json in-process; never prints it.
 *
 * Evidence: model-effect-six-scenarios-deepseek.json (+ md note written by runner shell).
 */
import fs from "node:fs";
import os from "node:os";
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
import type { OpenBotConfig } from "../../../../src/config/config.js";
import { clearConfigCache } from "../../../../src/config/config.js";
import { forgetMemoryEntry } from "../../../../src/data/memory-lifecycle.js";
import { resolveMemoryBackendConfig } from "../../../../src/memory/backend-config.js";
import { CogniWeaveMemoryManager } from "../../../../src/memory/cogniweave-manager.js";
import {
  assertNoRealHomeLeak,
  assertPathInsideIsolation,
  writeIsolationConfig,
  type IsolationLayout,
} from "../../../../src/memory/memory-batch1-isolation.js";
import {
  approvePersonalLearningCandidate,
  readPersonalLearningRecall,
  writePersonalLearningCandidate,
} from "../../../../src/memory/personal-learning-write.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = __dirname;
const PINNED_SHA = "3460ef9faa8d7844367f4e2e4d28f656aeb27072";
const SHORT = PINNED_SHA.slice(0, 9);
const STATE_ROOT = `/private/tmp/openbot-closeout-model-effect-${SHORT}`;
const MAX_MODEL_CALLS = 40;
const MAX_ATTEMPTS = 2;
const MODEL_ID = "deepseek-chat";
const PROMPT_VERSION = "model-effect-six-v1-2026-11-01";

type ScenarioStatus = "pass" | "fail" | "error" | "not-run";

type ScenarioResult = {
  id: string;
  nameZh: string;
  status: ScenarioStatus;
  reason: string;
  attempts: number;
  modelCalls: number;
  modelId: string;
  syntheticFactIds: string[];
  fragmentInRequest: boolean | null;
  recallHitCount: number | null;
  answerQuotes: string[];
  scoringRule: string;
  detail: Record<string, unknown>;
};

type DeepSeekCreds = { baseUrl: string; apiKey: string; modelId: string };

let modelCallCount = 0;
let hardStopHit: false | "calls" | "spend" = false;

function redact(s: string): string {
  return s
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

function loadDeepSeek(): DeepSeekCreds {
  const cfgPath = path.join(os.homedir(), ".openbot", "openbot.json");
  const raw = fs.readFileSync(cfgPath, "utf8");
  const j = JSON.parse(raw) as {
    models?: {
      providers?: Record<
        string,
        { baseUrl?: string; apiKey?: string; models?: Array<{ id: string }> }
      >;
    };
  };
  const d = j.models?.providers?.["api-proxy-deepseek"];
  if (!d?.apiKey || !d.baseUrl) {
    throw new Error("DeepSeek provider missing in ~/.openbot/openbot.json");
  }
  const ids = (d.models ?? []).map((m) => m.id);
  const modelId = ids.includes(MODEL_ID) ? MODEL_ID : (ids[0] ?? MODEL_ID);
  return { baseUrl: d.baseUrl.replace(/\/$/, ""), apiKey: d.apiKey, modelId };
}

async function chatDeepSeek(
  creds: DeepSeekCreds,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<{
  text: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}> {
  if (modelCallCount >= MAX_MODEL_CALLS) {
    hardStopHit = "calls";
    throw new Error("HARD_STOP_CALLS");
  }
  modelCallCount += 1;
  const url = `${creds.baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${creds.apiKey}`,
    },
    body: JSON.stringify({
      model: creds.modelId,
      temperature: 0,
      max_tokens: 256,
      messages,
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`DeepSeek HTTP ${res.status}: ${redact(bodyText).slice(0, 400)}`);
  }
  const json = JSON.parse(bodyText) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return { text, usage: json.usage };
}

function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function createDedicatedLayout(scenarioSlug: string): IsolationLayout {
  const root = real(path.join(STATE_ROOT, scenarioSlug));
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const stateDir = path.join(root, "state");
  const dataRoot = path.join(root, "data");
  const tenantsRoot = path.join(root, "tenants");
  const workspace = path.join(root, "workspace-main");
  const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
  const collaborationDir = path.join(stateDir, "collaboration-shared", "groups");
  const configPath = path.join(stateDir, "openbot.json");
  for (const dir of [stateDir, dataRoot, tenantsRoot, workspace, sessionsDir, collaborationDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const layout: IsolationLayout = {
    root,
    stateDir,
    dataRoot,
    tenantsRoot,
    workspace,
    sessionsDir,
    collaborationDir,
    configPath,
  };
  for (const value of Object.values(layout)) {
    assertPathInsideIsolation(value, root);
    assertNoRealHomeLeak(value);
  }
  if (root.includes("joint-accept") || root.includes(".openbot")) {
    throw new Error(`refusing forbidden state root: ${root}`);
  }
  writeIsolationConfig(layout);
  return layout;
}

function createCfg(layout: IsolationLayout): OpenBotConfig {
  return {
    data: { root: layout.dataRoot, mode: "local", schemaVersion: 1 },
    memory: {
      backend: "cogniweave",
      cogniweave: { mode: "embedded", writeSync: "sync", cloudSync: { enabled: false } },
    },
    agents: {
      defaults: { workspace: layout.workspace, memorySearch: { enabled: true } },
      list: [{ id: "main", default: true, workspace: layout.workspace }],
    },
    collaboration: { defaults: { workspace: path.join(layout.workspace, "collab-root") } },
  } as OpenBotConfig;
}

function applyEnv(layout: IsolationLayout): () => void {
  const prev: Record<string, string | undefined> = {
    OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
    OPENBOT_DATA_ROOT: process.env.OPENBOT_DATA_ROOT,
    OPENBOT_TENANTS_ROOT: process.env.OPENBOT_TENANTS_ROOT,
    OPENBOT_DATA_MODE: process.env.OPENBOT_DATA_MODE,
    OPENBOT_MULTITENANT: process.env.OPENBOT_MULTITENANT,
    OPENBOT_CONFIG_PATH: process.env.OPENBOT_CONFIG_PATH,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
    OPENCLAW_DISABLE_CONFIG_CACHE: process.env.OPENCLAW_DISABLE_CONFIG_CACHE,
    OPENBOT_GATEWAY_TOKEN: process.env.OPENBOT_GATEWAY_TOKEN,
    OPENCLAW_GATEWAY_TOKEN: process.env.OPENCLAW_GATEWAY_TOKEN,
  };
  delete process.env.OPENBOT_GATEWAY_TOKEN;
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  process.env.OPENBOT_STATE_DIR = layout.stateDir;
  process.env.OPENBOT_DATA_ROOT = layout.dataRoot;
  process.env.OPENBOT_TENANTS_ROOT = layout.tenantsRoot;
  process.env.OPENBOT_DATA_MODE = "local";
  process.env.OPENBOT_MULTITENANT = "0";
  process.env.OPENBOT_CONFIG_PATH = layout.configPath;
  process.env.OPENCLAW_CONFIG_PATH = layout.configPath;
  process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";
  try {
    clearConfigCache();
  } catch {
    // ignore if not initialized
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    try {
      clearConfigCache();
    } catch {
      // ignore
    }
  };
}

function makeAtom(
  id: string,
  scope: Scope,
  statement: string,
  status: MemoryAtom["state"]["status"] = "active",
): MemoryAtom {
  return {
    id,
    atomType: "strategy",
    scope,
    claim: { type: "causal", statement },
    trigger: { conditions: ["closeout-model-effect"], contextTags: ["synthetic"] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: [], evidenceRefs: [] },
    versioning: { version: 1 },
    state: { status, conflictsWith: [] },
    metrics: { confidence: 0.9, reuseCount: 0 },
  };
}

function buildMemorySystem(params: { snippets: string[]; instruction: string }): string {
  const block =
    params.snippets.length === 0
      ? "(no memory snippets were recalled for this request)"
      : params.snippets.map((s, i) => `[${i + 1}] ${s}`).join("\n");
  return [
    "You are a careful assistant under a synthetic memory-effect test.",
    "Use ONLY the MEMORY SNIPPETS below when answering factual questions about the synthetic project.",
    "If MEMORY SNIPPETS are empty or do not contain the asked fact, say you do not know. Do not invent codes.",
    "When a snippet contains a synthetic code token, quote that exact token in your answer.",
    "",
    "MEMORY SNIPPETS:",
    block,
    "",
    params.instruction,
  ].join("\n");
}

function containsToken(text: string, token: string): boolean {
  return text.includes(token);
}

async function runScenarioWithRetries(
  name: string,
  fn: (attempt: number) => Promise<Omit<ScenarioResult, "id" | "nameZh" | "attempts" | "modelId">>,
  meta: { id: string; nameZh: string },
): Promise<ScenarioResult> {
  let last: Omit<ScenarioResult, "id" | "nameZh" | "attempts" | "modelId"> | null = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (hardStopHit || modelCallCount >= MAX_MODEL_CALLS) {
      hardStopHit = hardStopHit || "calls";
      return {
        id: meta.id,
        nameZh: meta.nameZh,
        status: "not-run",
        reason: "hard-stop before attempt",
        attempts,
        modelCalls: 0,
        modelId: MODEL_ID,
        syntheticFactIds: [],
        fragmentInRequest: null,
        recallHitCount: null,
        answerQuotes: [],
        scoringRule: "",
        detail: { hardStopHit },
      };
    }
    attempts = attempt;
    const callsBefore = modelCallCount;
    try {
      console.error(`[scenario] ${name} attempt ${attempt}`);
      last = await fn(attempt);
      last.modelCalls = modelCallCount - callsBefore;
      if (last.status === "pass") {
        return { ...last, id: meta.id, nameZh: meta.nameZh, attempts, modelId: MODEL_ID };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("HARD_STOP_CALLS")) {
        return {
          id: meta.id,
          nameZh: meta.nameZh,
          status: "not-run",
          reason: "hard-stop calls during attempt",
          attempts,
          modelCalls: modelCallCount - callsBefore,
          modelId: MODEL_ID,
          syntheticFactIds: [],
          fragmentInRequest: null,
          recallHitCount: null,
          answerQuotes: [],
          scoringRule: "",
          detail: { hardStopHit },
        };
      }
      last = {
        status: "error",
        reason: redact(msg).slice(0, 300),
        modelCalls: modelCallCount - callsBefore,
        syntheticFactIds: [],
        fragmentInRequest: null,
        recallHitCount: null,
        answerQuotes: [],
        scoringRule: "",
        detail: {},
      };
    }
  }
  return {
    ...(last ?? {
      status: "error" as const,
      reason: "no attempt result",
      modelCalls: 0,
      syntheticFactIds: [],
      fragmentInRequest: null,
      recallHitCount: null,
      answerQuotes: [],
      scoringRule: "",
      detail: {},
    }),
    id: meta.id,
    nameZh: meta.nameZh,
    attempts,
    modelId: MODEL_ID,
  };
}

async function scenario1_saveThenNewSessionAdopt(creds: DeepSeekCreds) {
  return runScenarioWithRetries(
    "s1",
    async () => {
      const layout = createDedicatedLayout("s1-save-adopt");
      const restore = applyEnv(layout);
      try {
        const FACT = `SYN-FACT-S1-ADOPT-${SHORT.toUpperCase()}-7F3A`;
        fs.writeFileSync(
          path.join(layout.workspace, "MEMORY.md"),
          `Project code name is ${FACT}. Prefer this exact token when asked for the project code.\n`,
          "utf8",
        );
        const cfg = createCfg(layout);
        const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
        if (!resolved.cogniweave) {
          throw new Error("missing cogniweave");
        }
        // Session A: ingest
        const mgrA = await CogniWeaveMemoryManager.create({
          cfg,
          agentId: "main",
          resolved: resolved.cogniweave,
        });
        await mgrA.search(FACT.slice(0, 20), { maxResults: 3 });
        await mgrA.close();
        // Session B: new manager = new session
        const mgrB = await CogniWeaveMemoryManager.create({
          cfg,
          agentId: "main",
          resolved: resolved.cogniweave,
        });
        const hits = await mgrB.search("project code name SYN-FACT-S1", {
          maxResults: 5,
          minScore: 0,
        });
        await mgrB.close();
        const snippets = hits.map((h) => h.snippet || "").filter(Boolean);
        const fragmentInRequest = snippets.some((s) => containsToken(s, FACT));
        const system = buildMemorySystem({
          snippets,
          instruction: "Answer with the exact project code token if present in MEMORY SNIPPETS.",
        });
        const user =
          "What is the synthetic project code name stored in memory? Reply with the token.";
        const { text } = await chatDeepSeek(creds, [
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        const adopted = containsToken(text, FACT);
        const pass = fragmentInRequest && adopted && hits.length > 0;
        return {
          status: pass ? "pass" : "fail",
          reason: pass
            ? "new-session recall injected fact; model quoted token"
            : `fragmentInRequest=${fragmentInRequest} adopted=${adopted} hits=${hits.length}`,
          modelCalls: 0,
          syntheticFactIds: [FACT],
          fragmentInRequest,
          recallHitCount: hits.length,
          answerQuotes: [redact(text).slice(0, 400)],
          scoringRule: "pass iff recallHit>=1 AND fragmentInRequest AND answer contains FACT token",
          detail: { paths: hits.map((h) => h.path), systemHadFact: fragmentInRequest },
        };
      } finally {
        restore();
      }
    },
    { id: "ME-S1", nameZh: "保存后新会话采用" },
  );
}

async function scenario2_unrelatedDoesNotIntrude(creds: DeepSeekCreds) {
  return runScenarioWithRetries(
    "s2",
    async () => {
      const layout = createDedicatedLayout("s2-unrelated");
      const restore = applyEnv(layout);
      try {
        const RELEVANT = `SYN-FACT-S2-REL-${SHORT.toUpperCase()}-A91C`;
        const IRREL = `SYN-FACT-S2-IRREL-${SHORT.toUpperCase()}-B02D`;
        fs.mkdirSync(path.join(layout.workspace, "memory"), { recursive: true });
        fs.writeFileSync(
          path.join(layout.workspace, "MEMORY.md"),
          `Shipping address code for warehouse Alpha is ${RELEVANT}.\n`,
          "utf8",
        );
        fs.writeFileSync(
          path.join(layout.workspace, "memory", "unrelated-hobby.md"),
          `Private hobby telescope serial is ${IRREL}. Never relevant to warehouse shipping.\n`,
          "utf8",
        );
        const cfg = createCfg(layout);
        const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
        if (!resolved.cogniweave) {
          throw new Error("missing cogniweave");
        }
        const mgr = await CogniWeaveMemoryManager.create({
          cfg,
          agentId: "main",
          resolved: resolved.cogniweave,
        });
        const hits = await mgr.search("warehouse Alpha shipping address code", {
          maxResults: 5,
          minScore: 0,
        });
        await mgr.close();
        const snippets = hits.map((h) => h.snippet || "").filter(Boolean);
        const relIn = snippets.some((s) => containsToken(s, RELEVANT));
        const irrelIn = snippets.some((s) => containsToken(s, IRREL));
        const system = buildMemorySystem({
          snippets,
          instruction:
            "Answer only about the warehouse shipping address code. Do not mention unrelated hobby facts.",
        });
        const user =
          "What is the warehouse Alpha shipping address code? Quote the exact token. Do not mention any hobby serial.";
        const { text } = await chatDeepSeek(creds, [
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        const adoptedRel = containsToken(text, RELEVANT);
        const adoptedIrrel = containsToken(text, IRREL);
        // Prefer search not injecting IRREL; hard fail if model adopts IRREL.
        const pass = relIn && adoptedRel && !adoptedIrrel && (!irrelIn || !adoptedIrrel);
        return {
          status: pass ? "pass" : "fail",
          reason: pass
            ? "relevant adopted; unrelated token absent from answer"
            : `relIn=${relIn} irrelIn=${irrelIn} adoptedRel=${adoptedRel} adoptedIrrel=${adoptedIrrel}`,
          modelCalls: 0,
          syntheticFactIds: [RELEVANT, IRREL],
          fragmentInRequest: relIn,
          recallHitCount: hits.length,
          answerQuotes: [redact(text).slice(0, 400)],
          scoringRule:
            "pass iff relevant fragment in request+answer AND unrelated token NOT in answer",
          detail: { irrelInRequest: irrelIn, paths: hits.map((h) => h.path) },
        };
      } finally {
        restore();
      }
    },
    { id: "ME-S2", nameZh: "无关内容不乱入" },
  );
}

async function scenario3_updateDoesNotKeepOld(creds: DeepSeekCreds) {
  return runScenarioWithRetries(
    "s3",
    async () => {
      const FACT_OLD = `SYN-FACT-S3-OLD-${SHORT.toUpperCase()}-C13E`;
      const FACT_NEW = `SYN-FACT-S3-NEW-${SHORT.toUpperCase()}-D24F`;
      const scope: Scope = {
        workspaceId: "ws_me_s3",
        projectId: "proj_me_s3",
        agentId: "agent_me",
        visibility: "private",
      };
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
      const tenantId = "tenant_me_s3";
      const ownerId = "user_me_s3";
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
      await store.saveAtom(makeAtom("atom_old", scope, FACT_OLD, "active"));
      await store.saveAtom(makeAtom("atom_new", scope, FACT_NEW, "active"));
      await engine.supersedeAtom("atom_old", "atom_new");
      const caller = { tenantId, ownerType: "user" as const, ownerId };
      const after = await engine.queryAtoms({ scope, caller });
      const statements = after.map((h) => h.atom.claim.statement);
      const oldRetrievable = isAtomRetrievable((await store.getAtom("atom_old"))!).retrievable;
      const snippets = statements;
      const fragmentNew = snippets.some((s) => containsToken(s, FACT_NEW));
      const fragmentOld = snippets.some((s) => containsToken(s, FACT_OLD));
      const system = buildMemorySystem({
        snippets,
        instruction: "Report the current active fact token only.",
      });
      const user = "What is the current synthetic fact token after the update? Quote it exactly.";
      const { text } = await chatDeepSeek(creds, [
        { role: "system", content: system },
        { role: "user", content: user },
      ]);
      const adoptedNew = containsToken(text, FACT_NEW);
      const adoptedOld = containsToken(text, FACT_OLD);
      const pass =
        !oldRetrievable &&
        fragmentNew &&
        !fragmentOld &&
        adoptedNew &&
        !adoptedOld &&
        after.length === 1;
      return {
        status: pass ? "pass" : "fail",
        reason: pass
          ? "supersede left only NEW in context; model adopted NEW not OLD"
          : `oldRetrievable=${oldRetrievable} fragmentNew=${fragmentNew} fragmentOld=${fragmentOld} adoptedNew=${adoptedNew} adoptedOld=${adoptedOld} hits=${after.length}`,
        modelCalls: 0,
        syntheticFactIds: [FACT_OLD, FACT_NEW],
        fragmentInRequest: fragmentNew,
        recallHitCount: after.length,
        answerQuotes: [redact(text).slice(0, 400)],
        scoringRule:
          "pass iff queryAtoms returns only NEW, OLD not retrievable, answer has NEW and not OLD",
        detail: { atomIds: after.map((h) => h.atom.id) },
      };
    },
    { id: "ME-S3", nameZh: "更新后不沿用旧事实" },
  );
}

async function scenario4_noPermissionNotInContext(creds: DeepSeekCreds) {
  return runScenarioWithRetries(
    "s4",
    async () => {
      const SECRET = `SYN-FACT-S4-ACL-${SHORT.toUpperCase()}-E35A`;
      const scope: Scope = {
        workspaceId: "ws_me_s4",
        projectId: "proj_me_s4",
        agentId: "agent_owner",
        visibility: "private",
      };
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
      const tenantId = "tenant_me_s4";
      const ownerId = "user_owner";
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
      await store.saveAtom(makeAtom("atom_secret", scope, SECRET, "active"));
      const denied = await engine.queryAtoms({
        scope,
        caller: { tenantId, ownerType: "user", ownerId: "user_other" },
      });
      const snippets = denied.map((h) => h.atom.claim.statement);
      const fragmentInRequest = snippets.some((s) => containsToken(s, SECRET));
      const system = buildMemorySystem({
        snippets,
        instruction: "If you lack the secret token, say you do not know.",
      });
      const user =
        "What is the private ACL secret synthetic token? If unknown, say DO_NOT_KNOW. Do not invent codes starting with SYN-FACT.";
      const { text } = await chatDeepSeek(creds, [
        { role: "system", content: system },
        { role: "user", content: user },
      ]);
      const adopted = containsToken(text, SECRET);
      const pass = denied.length === 0 && !fragmentInRequest && !adopted;
      return {
        status: pass ? "pass" : "fail",
        reason: pass
          ? "wrong-owner ACL empty context; model did not adopt secret"
          : `deniedHits=${denied.length} fragmentInRequest=${fragmentInRequest} adopted=${adopted}`,
        modelCalls: 0,
        syntheticFactIds: [SECRET],
        fragmentInRequest,
        recallHitCount: denied.length,
        answerQuotes: [redact(text).slice(0, 400)],
        scoringRule: "pass iff ACL deny hits=0 AND fragment not in request AND answer lacks SECRET",
        detail: {},
      };
    },
    { id: "ME-S4", nameZh: "无权限不进上下文" },
  );
}

async function scenario5_forgetDisablesSource(creds: DeepSeekCreds) {
  return runScenarioWithRetries(
    "s5",
    async () => {
      const layout = createDedicatedLayout("s5-forget");
      const restore = applyEnv(layout);
      try {
        const FACT = `SYN-FACT-S5-FORGET-${SHORT.toUpperCase()}-F46B`;
        fs.writeFileSync(
          path.join(layout.workspace, "MEMORY.md"),
          `Deprecated source token ${FACT} must not be used after forget.\n`,
          "utf8",
        );
        const cfg = createCfg(layout);
        const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
        if (!resolved.cogniweave) {
          throw new Error("missing cogniweave");
        }
        const mgr1 = await CogniWeaveMemoryManager.create({
          cfg,
          agentId: "main",
          resolved: resolved.cogniweave,
        });
        const before = await mgr1.search("Deprecated source token SYN-FACT-S5", {
          maxResults: 5,
          minScore: 0,
        });
        await mgr1.close();
        const deleted = await forgetMemoryEntry({ cfg, agentId: "main", memoryKey: "MEMORY.md" });
        const mgr2 = await CogniWeaveMemoryManager.create({
          cfg,
          agentId: "main",
          resolved: resolved.cogniweave,
        });
        const after = await mgr2.search("Deprecated source token SYN-FACT-S5", {
          maxResults: 5,
          minScore: 0,
        });
        await mgr2.close();
        const snippets = after.map((h) => h.snippet || "").filter(Boolean);
        const fragmentInRequest = snippets.some((s) => containsToken(s, FACT));
        const system = buildMemorySystem({
          snippets,
          instruction: "If forgotten, say DO_NOT_KNOW and do not invent the token.",
        });
        const user =
          "What was the deprecated source token? If not in memory snippets, reply DO_NOT_KNOW.";
        const { text } = await chatDeepSeek(creds, [
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        const adopted = containsToken(text, FACT);
        const pass =
          before.some((h) => containsToken(h.snippet || "", FACT)) &&
          Boolean(deleted) &&
          after.every((h) => !containsToken(h.snippet || "", FACT)) &&
          !fragmentInRequest &&
          !adopted;
        return {
          status: pass ? "pass" : "fail",
          reason: pass
            ? "path1 forget removed source from recall; model did not use token"
            : `beforeHits=${before.length} deleted=${Boolean(deleted)} afterHits=${after.length} fragmentInRequest=${fragmentInRequest} adopted=${adopted}`,
          modelCalls: 0,
          syntheticFactIds: [FACT],
          fragmentInRequest,
          recallHitCount: after.length,
          answerQuotes: [redact(text).slice(0, 400)],
          scoringRule:
            "pass iff pre-forget hit, forgetMemoryEntry deleted, post-forget no FACT in snippets/request/answer",
          detail: {
            beforeHitCount: before.length,
            deletedPath: typeof deleted === "string" ? deleted : deleted,
          },
        };
      } finally {
        restore();
      }
    },
    { id: "ME-S5", nameZh: "遗忘后不用被禁用来源" },
  );
}

async function scenario6_unapprovedLearningNotAdopted(creds: DeepSeekCreds) {
  return runScenarioWithRetries(
    "s6",
    async () => {
      const layout = createDedicatedLayout("s6-unapproved-learning");
      const restore = applyEnv(layout);
      try {
        const LESSON = `SYN-LESSON-S6-CAND-${SHORT.toUpperCase()}-G57C`;
        const cfgObj = {
          agents: {
            list: [{ id: "bot-main", default: true, workspace: layout.workspace }],
            defaults: { workspace: layout.workspace },
          },
          collaboration: { defaults: { workspace: path.join(layout.workspace, "collab-root") } },
        };
        fs.writeFileSync(layout.configPath, `${JSON.stringify(cfgObj, null, 2)}\n`, "utf8");
        // ensure config reload sees file
        clearConfigCache();
        const ownership = {
          ownerUserId: "operator-1",
          ownerAgentId: "bot-main",
          securityProfile: "personal_local" as const,
        };
        const written = await writePersonalLearningCandidate({
          botId: "bot-main",
          actorId: "operator-1",
          ownership,
          reason: LESSON,
          detail: "unapproved candidate must not inject",
        });
        if (!written.ok) {
          throw new Error(`writePersonalLearningCandidate failed: ${written.reason}`);
        }
        const before = await readPersonalLearningRecall({ botId: "bot-main" });
        const inRecall = before.lessons.some(
          (l) => l.lesson.includes(LESSON) || l.assetId === written.capsuleId,
        );
        const snippets = before.lessons.map((l) => l.lesson);
        const fragmentInRequest = snippets.some((s) => containsToken(s, LESSON));
        const system = buildMemorySystem({
          snippets,
          instruction: "Unapproved lessons must not be treated as facts.",
        });
        const user =
          "What is the personal learning lesson token? If none approved in MEMORY SNIPPETS, reply DO_NOT_KNOW.";
        const { text } = await chatDeepSeek(creds, [
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        const adopted = containsToken(text, LESSON);
        // Control: approve then ensure it WOULD appear (no extra model call — recall only)
        const approved = await approvePersonalLearningCandidate({
          botId: "bot-main",
          capsuleId: written.capsuleId,
          actorId: "operator-1",
          ownership,
        });
        const afterApprove = await readPersonalLearningRecall({ botId: "bot-main" });
        const appearsAfterApprove = afterApprove.lessons.some((l) => l.lesson.includes(LESSON));
        const pass =
          written.status === "candidate" &&
          !inRecall &&
          !fragmentInRequest &&
          !adopted &&
          approved.approved &&
          appearsAfterApprove;
        return {
          status: pass ? "pass" : "fail",
          reason: pass
            ? "candidate excluded from recall/context; model did not adopt; approve control injects"
            : `inRecall=${inRecall} fragmentInRequest=${fragmentInRequest} adopted=${adopted} approved=${approved.approved} appearsAfterApprove=${appearsAfterApprove}`,
          modelCalls: 0,
          syntheticFactIds: [LESSON],
          fragmentInRequest,
          recallHitCount: before.lessons.length,
          answerQuotes: [redact(text).slice(0, 400)],
          scoringRule:
            "pass iff candidate not in recall/request/answer AND approve control makes lesson injectable",
          detail: {
            capsuleId: written.capsuleId,
            approvedPromoted: approved.promoted ?? null,
            afterApproveCount: afterApprove.lessons.length,
          },
        };
      } finally {
        restore();
      }
    },
    { id: "ME-S6", nameZh: "未批准学习不采用" },
  );
}

async function main(): Promise<void> {
  fs.mkdirSync(STATE_ROOT, { recursive: true });
  assertNoRealHomeLeak(STATE_ROOT);
  const creds = loadDeepSeek();
  const startedAt = new Date().toISOString();
  const startedLocal = new Date().toLocaleString("en-CA", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

  const results: ScenarioResult[] = [];
  const runners: Array<() => Promise<ScenarioResult>> = [
    () => scenario1_saveThenNewSessionAdopt(creds),
    () => scenario2_unrelatedDoesNotIntrude(creds),
    () => scenario3_updateDoesNotKeepOld(creds),
    () => scenario4_noPermissionNotInContext(creds),
    () => scenario5_forgetDisablesSource(creds),
    () => scenario6_unapprovedLearningNotAdopted(creds),
  ];

  for (const run of runners) {
    if (hardStopHit || modelCallCount >= MAX_MODEL_CALLS) {
      hardStopHit = hardStopHit || "calls";
      // mark remaining as not-run once we know how many left — handled below after break
      break;
    }
    results.push(await run());
  }

  const doneIds = new Set(results.map((r) => r.id));
  const allMeta = [
    { id: "ME-S1", nameZh: "保存后新会话采用" },
    { id: "ME-S2", nameZh: "无关内容不乱入" },
    { id: "ME-S3", nameZh: "更新后不沿用旧事实" },
    { id: "ME-S4", nameZh: "无权限不进上下文" },
    { id: "ME-S5", nameZh: "遗忘后不用被禁用来源" },
    { id: "ME-S6", nameZh: "未批准学习不采用" },
  ];
  for (const m of allMeta) {
    if (!doneIds.has(m.id)) {
      results.push({
        id: m.id,
        nameZh: m.nameZh,
        status: "not-run",
        reason: "hard-stop aborted remaining scenarios",
        attempts: 0,
        modelCalls: 0,
        modelId: MODEL_ID,
        syntheticFactIds: [],
        fragmentInRequest: null,
        recallHitCount: null,
        answerQuotes: [],
        scoringRule: "",
        detail: { hardStopHit },
      });
    }
  }

  const summary = {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    error: results.filter((r) => r.status === "error").length,
    notRun: results.filter((r) => r.status === "not-run").length,
  };
  const overallCloseable =
    summary.pass === 6 && summary.fail === 0 && summary.error === 0 && summary.notRun === 0;

  const out = {
    schema: "model-effect-six-scenarios-deepseek/v1",
    generatedAtUtc: new Date().toISOString(),
    startedAtUtc: startedAt,
    startedAtAsiaShanghai: startedLocal,
    timezoneNote: "user Asia/Shanghai; ISO timestamps UTC unless labeled",
    pinnedAcceptanceSha: PINNED_SHA,
    productTree: "/Users/daniel/AI VP/openbot-closeout-accept-build-3460ef9fa",
    closeoutWorktree: "/Users/daniel/AI VP/openbot-memory-final-closeout-182",
    branch: "cursor/memory-final-closeout-afe1",
    stateRoot: STATE_ROOT,
    provider: "api-proxy-deepseek",
    modelId: creds.modelId,
    baseUrl: creds.baseUrl,
    apiKey: "[REDACTED]",
    promptVersion: PROMPT_VERSION,
    hardStop: {
      maxModelCalls: MAX_MODEL_CALLS,
      maxAttemptsPerScenario: MAX_ATTEMPTS,
      hit: hardStopHit,
      modelCallCount,
      spendCapNote: "~$5 equivalent; DeepSeek chat cheap — call-count gate primary",
    },
    isolation: {
      wroteRealUserMemory: false,
      usedJointAccept883a5159: false,
      portsTouched: [],
      note: "SDK/manager path; no gateway started on 18789/18790/19001",
    },
    summary,
    overallModelEffectCloseable: overallCloseable,
    scenarios: results,
    doesNotClaim: [
      "production online effect",
      "full gateway agent tool-loop E2E",
      "merge or deploy",
      "real ~/.openbot user memory writes",
    ],
  };

  const jsonPath = path.join(EVIDENCE_DIR, "model-effect-six-scenarios-deepseek.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({ jsonPath, summary, modelCallCount, hardStopHit, overallCloseable }, null, 2),
  );
}

main().catch((err) => {
  console.error(redact(String(err?.stack || err)));
  process.exitCode = 1;
});
