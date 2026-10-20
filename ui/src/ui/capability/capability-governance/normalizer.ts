// Normalizer: adapts OpenClaw's SkillStatusReport into the
// CapabilityGovernance* model. This is the integration seam so the rest
// of the platform UI can talk in governance terms without reaching into
// skill internals. Real external adapters (npm, GitHub, clawhub, MCP
// registry) will plug in here later, producing additional proposals.

import type { SkillInstallOption, SkillStatusEntry, SkillStatusReport } from "../../types.ts";
import type { RuntimeCapabilityBinding } from "../runtime-canonical/index.ts";
import type {
  CapabilityCategoryId,
  CapabilityContracts,
  CapabilityDistributionPolicy,
  CapabilityGovernanceSnapshot,
  CapabilityInvocationMetric,
  CapabilityIOField,
  CapabilityInstallSpec,
  CapabilityKind,
  CapabilityLifecycleEvent,
  CapabilityLifecycleState,
  CapabilityManifest,
  CapabilityProposal,
  CapabilityProposalStatus,
  CapabilityRegistryEntry,
  CapabilityRequirements,
  CapabilityRiskProfile,
  CapabilitySideEffect,
  CapabilitySourceKind,
  CapabilitySourceRef,
  SecurityFinding,
} from "./types.ts";

// Known first-party OpenClaw skill source tags. These come from
// `src/agents/skills/workspace.ts`.
const SOURCE_KIND_MAP: Record<string, CapabilitySourceKind> = {
  "openclaw-bundled": "bundled",
  "openclaw-workspace": "workspace",
  "openclaw-managed": "managed",
  "openclaw-extra": "extra",
  "agents-skills-personal": "personal",
  "agents-skills-project": "personal",
};

const SOURCE_TRUST_MAP: Record<CapabilitySourceKind, CapabilitySourceRef["trustTier"]> = {
  bundled: "first-party",
  workspace: "workspace",
  managed: "user",
  extra: "user",
  personal: "user",
  plugin: "first-party",
  upload: "third-party",
  npm: "external",
  github: "external",
  clawhub: "external",
  "mcp-registry": "external",
};

function classifyCategory(params: {
  name: string;
  description: string;
  sourceOrigin: string;
}): CapabilityCategoryId {
  const haystack = `${params.name} ${params.description} ${params.sourceOrigin}`.toLowerCase();
  if (
    /\b(github|gh-issues|coding-agent|skill-creator|session-logs|blucli|gog|ordercli)\b/.test(
      haystack,
    )
  ) {
    return "code";
  }
  if (
    /\b(apple-reminders|notion|obsidian|slack|trello|discord|imsg|bluebubbles|things-mac|himalaya)\b/.test(
      haystack,
    )
  ) {
    return "integration";
  }
  if (/\b(healthcheck|voice-call|wacli|weather|blogwatcher)\b/.test(haystack)) {
    return "automation";
  }
  if (/\b(gemini|summarize|oracle)\b/.test(haystack)) {
    return "chat";
  }
  if (
    /\b(rag|retriev|vector|embed|knowledge[ -]?base|knowledge[ -]?graph|doc[ -]?qa)\b/.test(
      haystack,
    )
  ) {
    return "rag";
  }
  if (
    /\b(ocr|invoice|receipt|pdf|document[ -]?parse|form[ -]?extract|textract|tesseract)\b/.test(
      haystack,
    )
  ) {
    return "ocr";
  }
  if (
    /\b(vision|image|vlm|clip|yolo|diffusion|midjourney|stable[ -]?diffusion|canvas|draw|generate[ -]?image)\b/.test(
      haystack,
    )
  ) {
    return "vision";
  }
  if (/\b(audio|voice|tts|stt|speech|whisper|video|ffmpeg|transcribe)\b/.test(haystack)) {
    return "media";
  }
  if (/\b(search|bing|google|brave|duckduckgo|serper|searx|web[ -]?search)\b/.test(haystack)) {
    return "search";
  }
  if (
    /\b(browser|puppeteer|playwright|chromium|selenium|scrape|crawl|fetch[ -]?page|browser-scan-proxy|扫码登录|扫码代操作)\b/.test(
      haystack,
    )
  ) {
    return "browser";
  }
  if (/\b(workflow|flow|pipeline|approval|task[ -]?queue|orchestrat)\b/.test(haystack)) {
    return "workflow";
  }
  if (/\b(cron|schedule|automation|trigger|webhook|automat)\b/.test(haystack)) {
    return "automation";
  }
  if (
    /\b(code|git|repo|compile|lint|ide|typescript|python|node|interpret|execute|sandbox)\b/.test(
      haystack,
    )
  ) {
    return "code";
  }
  if (
    /\b(slack|discord|telegram|notion|jira|github|gitlab|zoom|gmail|outlook|calendar|sheet|integration|connector)\b/.test(
      haystack,
    )
  ) {
    return "integration";
  }
  if (/\b(chat|assistant|persona|conversation|responder|dialog|agent)\b/.test(haystack)) {
    return "chat";
  }
  return "other";
}

const DESCRIPTION_ZH_OVERRIDES: Record<string, string> = {
  "1password": "通过 1Password CLI 管理密码与凭据，适用于本地安全配置和密钥协作场景。",
  "apple-reminders": "管理 Apple 提醒事项，支持读取、创建、完成和整理提醒任务。",
  "bear-notes": "连接 Bear 笔记，支持创建、搜索和管理笔记内容。",
  blogwatcher: "监控博客、RSS 或 Atom 更新，自动收集新的内容变更。",
  blucli: "连接 BluOS CLI，支持发现、播放、分组与音量控制。",
  github: "通过 GitHub CLI 执行 issue、PR、CI、代码审阅和仓库操作。",
  "gh-issues": "聚焦 GitHub issue 处理，可查询问题、创建修复任务并联动子智能体。",
  gemini: "提供 Gemini 对话、总结和生成能力，适用于问答与内容产出。",
  healthcheck: "执行主机与服务健康检查，用于风险扫描与稳定性巡检。",
  "coding-agent": "用于代码生成、修改、审阅和执行的工程能力代理。",
  "skill-creator": "帮助创建、编辑与优化新技能定义及其说明文档。",
  weather: "获取天气与预报信息，用于行程、出行与环境感知场景。",
};

function classifySource(rawSource: string): CapabilitySourceRef {
  const trimmed = rawSource.trim();
  if (!trimmed) {
    return { kind: "upload", origin: rawSource, trustTier: "third-party" };
  }
  const mapped = SOURCE_KIND_MAP[trimmed];
  if (mapped) {
    return { kind: mapped, origin: trimmed, trustTier: SOURCE_TRUST_MAP[mapped] };
  }
  // Plugin skills show up with plugin:<id> or plugin/<id>-like prefixes.
  if (trimmed.startsWith("plugin:") || trimmed.startsWith("extension:")) {
    return { kind: "plugin", origin: trimmed, trustTier: SOURCE_TRUST_MAP.plugin };
  }
  // Everything else is treated as third-party/upload until an explicit
  // adapter annotates it.
  return { kind: "upload", origin: trimmed, trustTier: SOURCE_TRUST_MAP.upload };
}

function mapInstallOption(option: SkillInstallOption): CapabilityInstallSpec {
  return {
    id: option.id,
    kind: option.kind as CapabilityInstallSpec["kind"],
    label: option.label,
    bins: option.bins,
  };
}

function classifyRisk(skill: SkillStatusEntry, source: CapabilitySourceRef): CapabilityRiskProfile {
  const hasSubprocess = skill.requirements.bins.length > 0;
  const hasNetwork = hasSubprocess; // heuristic: CLI skills usually reach out
  const hasFilesystem = hasSubprocess;
  const hasSecrets = skill.requirements.env.some((key) =>
    /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(key),
  );

  // Base level depends on trust.
  let level: CapabilityRiskProfile["level"] = "low";
  if (source.trustTier === "external" || source.trustTier === "third-party") {
    level = hasSecrets ? "high" : "medium";
  } else if (source.trustTier === "user") {
    level = hasSecrets ? "medium" : "low";
  } else if (hasSecrets && hasNetwork) {
    level = "medium";
  }

  return {
    level,
    network: hasNetwork,
    filesystem: hasFilesystem,
    subprocess: hasSubprocess,
    secrets: hasSecrets,
  };
}

function buildContracts(skill: SkillStatusEntry): CapabilityContracts {
  const effects: CapabilitySideEffect[] = [];
  if (skill.requirements.bins.length > 0) {
    effects.push("subprocess");
  }
  if (skill.requirements.env.some((k) => /(TOKEN|KEY|SECRET|PASSWORD)/i.test(k))) {
    effects.push("secrets_read");
  }
  // Without parsing SKILL.md body, we can't prove idempotence; be
  // conservative for CLI-invoking skills.
  const idempotent = effects.length === 0;
  return {
    sideEffects: effects.length > 0 ? effects : ["read_only"],
    idempotent,
    requiresConfirmation: false,
    timeoutSeconds: undefined,
  };
}

function buildRequirements(skill: SkillStatusEntry): CapabilityRequirements {
  return {
    bins: skill.requirements.bins,
    env: skill.requirements.env,
    configPaths: skill.requirements.config,
    operatingSystems: skill.requirements.os,
  };
}

function buildInputsOutputs(): {
  inputs: readonly CapabilityIOField[];
  outputs: readonly CapabilityIOField[];
} {
  // SkillStatusEntry doesn't carry typed IO; ship empty until capability manifests
  // populate typed inputs/outputs directly.
  return { inputs: [], outputs: [] };
}

function manifestVersion(): string {
  // SkillStatusEntry doesn't carry a version; default to 0.0.0 so the
  // id stays deterministic. Bumping is the job of whoever writes to the
  // registry after manifests start tracking versions.
  return "0.0.0";
}

function toManifestId(kind: CapabilityKind, skillKey: string, version: string): string {
  return `urn:openclaw:${kind}:${skillKey}@${version}`;
}

function scanFindings(skill: SkillStatusEntry, source: CapabilitySourceRef): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  if (source.trustTier === "external" || source.trustTier === "third-party") {
    findings.push({
      id: `${skill.skillKey}:missing_signature`,
      category: "missing_signature",
      severity: "low",
      message: "Capability is not signed by a trusted publisher.",
    });
  }

  const installSteps = skill.install ?? [];
  for (const step of installSteps) {
    const label = (step.label ?? "").toLowerCase();
    if (label.includes("curl") && label.includes("bash")) {
      findings.push({
        id: `${skill.skillKey}:${step.id}:suspicious_install`,
        category: "suspicious_install",
        severity: "medium",
        message: `Install step "${step.label}" pipes to a shell; review before approving.`,
      });
    }
  }

  // Typosquat guard: anything claiming to be "openclaw-*" but shipped
  // from a non first-party source.
  if (source.trustTier !== "first-party" && skill.skillKey.startsWith("openclaw-")) {
    findings.push({
      id: `${skill.skillKey}:typosquat`,
      category: "typosquat",
      severity: "high",
      message:
        "Skill uses the openclaw-* namespace but is not sourced from a first-party registry.",
      evidence: source.origin,
    });
  }

  const contracts = buildContracts(skill);
  if (
    !contracts.requiresConfirmation &&
    contracts.sideEffects.some((effect) => effect.endsWith("_write") || effect === "subprocess")
  ) {
    findings.push({
      id: `${skill.skillKey}:overbroad_scope`,
      category: "overbroad_scope",
      severity: "info",
      message: "Capability has write/subprocess side effects but does not require confirmation.",
    });
  }

  return findings;
}

function manifestFromSkill(skill: SkillStatusEntry): {
  manifest: CapabilityManifest;
  source: CapabilitySourceRef;
  findings: readonly SecurityFinding[];
} {
  const source = classifySource(skill.source);
  const version = manifestVersion();
  const manifest: CapabilityManifest = {
    id: toManifestId("skill", skill.skillKey, version),
    kind: "skill",
    version,
    skillKey: skill.skillKey,
    name: skill.name,
    description: skill.description,
    descriptionZh: DESCRIPTION_ZH_OVERRIDES[skill.skillKey] ?? undefined,
    categoryId: classifyCategory({
      name: skill.name,
      description: skill.description,
      sourceOrigin: skill.source,
    }),
    emoji: skill.emoji,
    homepage: skill.homepage,
    source,
    interface: buildInputsOutputs(),
    contracts: buildContracts(skill),
    behavior: {
      undoStrategy: undefined,
      costModel: skill.requirements.bins.length > 0 ? "subprocess" : "free",
    },
    requirements: buildRequirements(skill),
    install: (skill.install ?? []).map(mapInstallOption),
    risk: classifyRisk(skill, source),
  };
  const findings = scanFindings(skill, source);
  return { manifest, source, findings };
}

function initialLifecycleState(
  source: CapabilitySourceRef,
  skill: SkillStatusEntry,
): CapabilityLifecycleState {
  // First-party and workspace-owned skills count as already-approved
  // registry entries: they ship with the runtime or live in the
  // operator's workspace. External/third-party sources must go through
  // the proposal flow.
  if (source.trustTier === "first-party" || source.trustTier === "workspace") {
    if (skill.disabled) {
      return "deprecated";
    }
    return skill.eligible ? "active" : "approved";
  }
  return "review";
}

function buildLifecycleEvent(
  state: CapabilityLifecycleState,
  at: string,
): CapabilityLifecycleEvent {
  return {
    capabilityId: "", // filled in by caller so event can be reused
    fromState: null,
    toState: state,
    at,
    notes: "Derived from current skill status report.",
  };
}

function isProposalState(state: CapabilityLifecycleState): boolean {
  return state === "draft" || state === "review";
}

function proposalStatusFromState(state: CapabilityLifecycleState): CapabilityProposalStatus {
  return state === "draft" ? "proposed" : "under_review";
}

function buildDistribution(
  capabilityId: string,
  source: CapabilitySourceRef,
  now: string,
): CapabilityDistributionPolicy {
  // Default: first-party skills are globally available and on by default;
  // user / workspace skills are globally available but require tenant opt-in;
  // external skills are opt-in per tenant.
  const defaultEnabled = source.trustTier === "first-party";
  return {
    capabilityId,
    scope: {},
    defaultEnabled,
    employeeVisibilityMode: "enterprise_review_required",
    updatedAt: now,
  };
}

type NormalizeOptions = {
  now?: () => string;
  runtimeBindings?: readonly RuntimeCapabilityBinding[];
};

function buildInvocationMetrics(
  registry: readonly CapabilityRegistryEntry[],
  runtimeBindings: readonly RuntimeCapabilityBinding[],
  now: string,
): CapabilityInvocationMetric[] {
  const activeCapabilityIds = new Set(
    registry.filter((entry) => entry.lifecycleState === "active").map((entry) => entry.manifest.id),
  );
  const byCapability = new Map<string, RuntimeCapabilityBinding[]>();
  for (const binding of runtimeBindings) {
    if (!activeCapabilityIds.has(binding.capabilityId)) {
      continue;
    }
    const bucket = byCapability.get(binding.capabilityId) ?? [];
    bucket.push(binding);
    byCapability.set(binding.capabilityId, bucket);
  }

  const metrics: CapabilityInvocationMetric[] = [];
  for (const [capabilityId, bindings] of byCapability.entries()) {
    const invocationCount = bindings.reduce(
      (sum, binding) => sum + binding.invocationMetrics.calls7d,
      0,
    );
    const errorCount = bindings.reduce(
      (sum, binding) => sum + binding.invocationMetrics.errorCount7d,
      0,
    );
    const p95LatencyMs =
      bindings.length > 0
        ? Math.round(
            bindings.reduce((sum, binding) => sum + binding.invocationMetrics.p95LatencyMs, 0) /
              bindings.length,
          )
        : null;
    const costTotal = null;
    metrics.push({
      capabilityId,
      invocationCount,
      errorCount,
      p95LatencyMs,
      costTotal,
      periodStart: now,
      periodEnd: now,
    });
  }

  return metrics;
}

export function normalizeSkillReport(
  report: SkillStatusReport | null | undefined,
  options: NormalizeOptions = {},
): CapabilityGovernanceSnapshot {
  const nowFn = options.now ?? (() => new Date().toISOString());
  const now = nowFn();
  const proposals: CapabilityProposal[] = [];
  const registry: CapabilityRegistryEntry[] = [];

  const skills = report?.skills ?? [];
  for (const skill of skills) {
    const { manifest, source, findings } = manifestFromSkill(skill);
    const state = initialLifecycleState(source, skill);
    const event: CapabilityLifecycleEvent = {
      ...buildLifecycleEvent(state, now),
      capabilityId: manifest.id,
    };

    if (isProposalState(state)) {
      proposals.push({
        proposalId: `proposal:${manifest.id}`,
        submittedAt: now,
        submittedBy: source.kind,
        status: proposalStatusFromState(state),
        manifest,
        findings,
      });
      continue;
    }

    registry.push({
      manifest,
      lifecycleState: state,
      lastLifecycleEvent: event,
      distribution: buildDistribution(manifest.id, source, now),
    });
  }

  const metrics = buildInvocationMetrics(registry, options.runtimeBindings ?? [], now);
  return { proposals, registry, metrics };
}

// Utility for callers that want the raw bridge info for one skill.
export function manifestFromSkillEntry(skill: SkillStatusEntry): CapabilityManifest {
  return manifestFromSkill(skill).manifest;
}

// Helper: does this snapshot contain any proposals requiring attention?
export function countPendingProposals(snapshot: CapabilityGovernanceSnapshot): number {
  return snapshot.proposals.filter((p) => p.status === "proposed" || p.status === "under_review")
    .length;
}
