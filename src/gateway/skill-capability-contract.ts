/**
 * Capability contract borrowed from CLI-Hub: verb discovery, install-time
 * availability, and provider kinds. Lives on top of the existing skill
 * lifecycle — it does not replace governance, packs, or employee projections.
 */

import {
  ALL_CAPABILITY_PACKS,
  findPackIdsForSkillKey,
  getPackById,
  type PackSkillDef,
} from "./capability-packs/starter-packs.js";
import { assessBrowserScanProxyRoute } from "./skill-browser-scan-proxy-routing.js";
import { assessWebResearchRoute } from "./skill-web-research-routing.js";

export type SkillProviderKind = "skill" | "api" | "native" | "pack";

export type SkillCapabilityProvider = {
  id: string;
  kind: SkillProviderKind;
  capability: string;
  requiresSecret?: boolean;
};

export type SkillLifecycleHint =
  | "draft"
  | "private"
  | "reviewing"
  | "approved"
  | "published"
  | "deprecated"
  | "rejected"
  | "retired";

export const SKILL_CAPABILITY_VERBS = [
  "text.summarize",
  "meeting.notes",
  "document.pdf",
  "document.ppt",
  "web.extract",
  "web.search",
  "weather.query",
  "speech.transcribe",
  "visual.canvas",
  "guidance.user",
  "integration.api",
  "platform.ops",
  "content.wechat",
  "research.finance",
  "research.web",
  "browser.scan-proxy",
  "identity.wechat-official",
] as const;

export type SkillCapabilityVerb = (typeof SKILL_CAPABILITY_VERBS)[number];

const VERB_SET = new Set<string>(SKILL_CAPABILITY_VERBS);

const VERB_LABELS: Record<SkillCapabilityVerb, string[]> = {
  "text.summarize": ["摘要", "总结", "概括", "summarize", "summary"],
  "meeting.notes": ["会议纪要", "会议记录", "纪要", "meeting notes"],
  "document.pdf": ["pdf", "PDF"],
  "document.ppt": ["ppt", "PPT", "演示文稿", "幻灯片"],
  "web.extract": ["网页正文", "正文提取", "网页提取"],
  "web.search": ["搜索网页", "联网搜索", "网上找"],
  "weather.query": ["天气", "天气预报", "weather"],
  "speech.transcribe": ["转写", "语音转文字", "听写", "whisper", "录音转文字"],
  "visual.canvas": ["画布", "图表", "可视化"],
  "guidance.user": ["引导", "不会操作"],
  "integration.api": ["外部接口", "API 知识源"],
  "platform.ops": ["平台运维", "平台功能"],
  "content.wechat": ["公众号", "微信成稿"],
  "research.finance": ["金融研究", "研报"],
  "research.web": ["网页调研", "联网调研", "web research", "搜证", "调研", "研究"],
  "browser.scan-proxy": ["扫码登录", "打开网页我来扫", "重新启动浏览器", "授权过期", "二次扫码"],
  "identity.wechat-official": [
    "配公众号",
    "IP 白名单",
    "出口 IP",
    "AppSecret",
    "40164",
    "开发者密码",
    "扫码帮我写白名单",
  ],
};

const TASK_LABEL: Record<SkillCapabilityVerb, string> = {
  "text.summarize": "整理摘要",
  "meeting.notes": "整理会议纪要",
  "document.pdf": "处理 PDF",
  "document.ppt": "处理演示文稿",
  "web.extract": "提取网页正文",
  "web.search": "联网查找资料",
  "weather.query": "查询天气",
  "speech.transcribe": "把语音转成文字",
  "visual.canvas": "做可视化",
  "guidance.user": "引导操作",
  "integration.api": "接入外部服务",
  "platform.ops": "使用平台功能",
  "content.wechat": "写公众号成稿",
  "research.finance": "做金融研究",
  "research.web": "做网页调研",
  "browser.scan-proxy": "扫码后代操作控制台",
  "identity.wechat-official": "配置公众号凭证",
};

export type SkillAvailabilityStatus =
  | "already_on_robot"
  | "can_use_now"
  | "needs_setup"
  | "not_available";

export type SkillAvailabilityAssessment = {
  status: SkillAvailabilityStatus;
  /** Employee-facing next step. Never includes runtime field names. */
  nextStep: string;
  installAllowed: boolean;
};

export type CapabilityMatchCandidate = {
  id: string;
  name: string;
  summary: string;
  tags: string[];
  category: string;
  verbs: string[];
  installed: boolean;
  lifecycle?: SkillLifecycleHint;
  secrets?: boolean;
  native?: boolean;
};

export type RankedCapabilityMatch = {
  id: string;
  task: string;
  verbs: string[];
  score: number;
  assessment: SkillAvailabilityAssessment;
};

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function isSkillCapabilityVerb(value: string): value is SkillCapabilityVerb {
  return VERB_SET.has(value);
}

export function skillCapabilityTaskLabel(verb: string): string {
  if (isSkillCapabilityVerb(verb)) {
    return TASK_LABEL[verb];
  }
  return "完成这项工作";
}

export function sanitizeCapabilityVerbs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const verb = entry.trim();
    if (isSkillCapabilityVerb(verb) && !out.includes(verb)) {
      out.push(verb);
    }
  }
  return out;
}

export function sanitizeCapabilityProviders(value: unknown): SkillCapabilityProvider[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: SkillCapabilityProvider[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const kind = record.kind;
    if (kind !== "skill" && kind !== "api" && kind !== "native" && kind !== "pack") {
      continue;
    }
    const capability = typeof record.capability === "string" ? record.capability.trim() : "";
    if (!isSkillCapabilityVerb(capability)) {
      continue;
    }
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : `${capability}:${kind}`;
    out.push({
      id,
      kind,
      capability,
      ...(record.requiresSecret === true ? { requiresSecret: true } : {}),
    });
  }
  return out;
}

export function inferCapabilityVerbsFromText(text: string): string[] {
  const haystack = normalizeText(text);
  if (!haystack) {
    return [];
  }
  const matched: string[] = [];
  for (const verb of SKILL_CAPABILITY_VERBS) {
    if (VERB_LABELS[verb].some((label) => haystack.includes(normalizeText(label)))) {
      matched.push(verb);
    }
  }
  // Three-dimension route can add research.web without the exact skill name.
  // Suppress label-only 调研/研究 when the user is rewriting or analyzing local files.
  const researchRoute = assessWebResearchRoute(text);
  if (researchRoute.trigger && !matched.includes("research.web")) {
    matched.push("research.web");
  }
  if (!researchRoute.trigger && researchRoute.intent !== "research") {
    const idx = matched.indexOf("research.web");
    if (
      idx >= 0 &&
      (researchRoute.intent === "rewrite" || researchRoute.intent === "local_material")
    ) {
      matched.splice(idx, 1);
    }
  }
  const scanRoute = assessBrowserScanProxyRoute(text);
  if (scanRoute.trigger && !matched.includes("browser.scan-proxy")) {
    matched.push("browser.scan-proxy");
  }
  if (
    !scanRoute.trigger &&
    (scanRoute.intent === "guidance" || scanRoute.intent === "public_web")
  ) {
    const idx = matched.indexOf("browser.scan-proxy");
    if (idx >= 0) {
      matched.splice(idx, 1);
    }
  }
  return matched;
}

export function findPackSkillByKey(skillKey: string): PackSkillDef | null {
  const key = skillKey.trim();
  if (!key) {
    return null;
  }
  for (const pack of ALL_CAPABILITY_PACKS) {
    const skill = pack.skills.find((entry) => entry.skillKey === key);
    if (skill) {
      return skill;
    }
  }
  return null;
}

export function resolveVerbsForSkillKey(skillKey: string): string[] {
  const packSkill = findPackSkillByKey(skillKey);
  if (!packSkill) {
    return [];
  }
  const explicit = sanitizeCapabilityVerbs(packSkill.capabilities);
  if (explicit.length > 0) {
    return explicit;
  }
  return inferCapabilityVerbsFromText(
    `${packSkill.skillKey} ${packSkill.name ?? ""} ${packSkill.description ?? ""}`,
  );
}

export function resolveVerbsForSkill(params: {
  skillId?: string;
  skillKey?: string;
  name?: string;
  summary?: string;
  tags?: string[];
  explicit?: unknown;
}): string[] {
  const explicit = sanitizeCapabilityVerbs(params.explicit);
  if (explicit.length > 0) {
    return explicit;
  }
  const fromKey = resolveVerbsForSkillKey(params.skillKey ?? params.skillId ?? "");
  if (fromKey.length > 0) {
    return fromKey;
  }
  return inferCapabilityVerbsFromText(
    [params.name, params.summary, ...(params.tags ?? [])].filter(Boolean).join(" "),
  );
}

export function defaultProvidersForVerbs(
  verbs: string[],
  flags?: { secrets?: boolean; native?: boolean },
): SkillCapabilityProvider[] {
  const kind: SkillCapabilityProvider["kind"] = flags?.native
    ? "native"
    : flags?.secrets
      ? "api"
      : "skill";
  return verbs.map((capability) => ({
    id: `${capability}:${kind}`,
    kind,
    capability,
    ...(flags?.secrets ? { requiresSecret: true } : {}),
  }));
}

export function packSkillIsNative(skillKey: string): boolean {
  return findPackIdsForSkillKey(skillKey).includes("local-dev");
}

export function packSkillRequiresSecret(skillKey: string): boolean {
  return findPackSkillByKey(skillKey)?.secrets === true;
}

export function assessSkillAvailability(
  candidate: CapabilityMatchCandidate,
): SkillAvailabilityAssessment {
  if (candidate.lifecycle === "rejected" || candidate.lifecycle === "retired") {
    return {
      status: "not_available",
      nextStep: "这个能力已经停用，换一个能用的试试",
      installAllowed: false,
    };
  }
  if (candidate.native) {
    return {
      status: "needs_setup",
      nextStep: "需要在本机使用，云端机器人用不了",
      installAllowed: false,
    };
  }
  // Secrets/native beat lifecycle: a reviewing copy of a keyed API skill still cannot install.
  if (candidate.secrets && !candidate.installed) {
    return {
      status: "needs_setup",
      nextStep: "需要先完成服务配置",
      installAllowed: false,
    };
  }
  if (candidate.installed) {
    return {
      status: "already_on_robot",
      nextStep: "这个机器人已经会",
      installAllowed: true,
    };
  }
  if (candidate.lifecycle === "reviewing") {
    return {
      status: "needs_setup",
      nextStep: "还在审核中，通过后才会出现在更多机器人里",
      installAllowed: true,
    };
  }
  if (candidate.lifecycle === "draft") {
    return {
      status: "needs_setup",
      nextStep: "还在整理中，整理完成后再给其他机器人用",
      installAllowed: true,
    };
  }
  return {
    status: "can_use_now",
    nextStep: "可以立刻给这个机器人用",
    installAllowed: true,
  };
}

function intentTokens(intent: string): string[] {
  return normalizeText(intent)
    .split(/[\s,，。！？、]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function matchCapabilityIntent(
  intent: string,
  candidates: CapabilityMatchCandidate[],
): RankedCapabilityMatch[] {
  const query = normalizeText(intent);
  if (!query) {
    return [];
  }
  const tokens = intentTokens(intent);
  const researchRoute = assessWebResearchRoute(intent);
  const scanRoute = assessBrowserScanProxyRoute(intent);
  const ranked: RankedCapabilityMatch[] = [];
  for (const candidate of candidates) {
    let score = 0;
    const matchedVerbs: string[] = [];
    for (const verb of candidate.verbs) {
      if (!isSkillCapabilityVerb(verb)) {
        continue;
      }
      const labels = VERB_LABELS[verb];
      if (labels.some((label) => query.includes(normalizeText(label)))) {
        score += 5;
        matchedVerbs.push(verb);
      }
    }
    const blob = normalizeText(
      `${candidate.name} ${candidate.summary} ${candidate.tags.join(" ")} ${candidate.category}`,
    );
    if (blob.includes(query)) {
      score += 3;
    }
    for (const token of tokens) {
      if (blob.includes(token)) {
        score += 1;
      }
    }
    if (
      researchRoute.trigger &&
      candidate.verbs.some((verb) => verb === "research.web" || verb === "web.search")
    ) {
      score += 8;
      if (!matchedVerbs.includes("research.web") && candidate.verbs.includes("research.web")) {
        matchedVerbs.push("research.web");
      }
    }
    if (scanRoute.trigger && candidate.verbs.includes("browser.scan-proxy")) {
      score += 8;
      if (!matchedVerbs.includes("browser.scan-proxy")) {
        matchedVerbs.push("browser.scan-proxy");
      }
    }
    if (score <= 0) {
      continue;
    }
    const verbs = matchedVerbs.length > 0 ? matchedVerbs : candidate.verbs;
    const primary = verbs[0] ?? candidate.verbs[0] ?? "";
    ranked.push({
      id: candidate.id,
      task: skillCapabilityTaskLabel(primary),
      verbs,
      score,
      assessment: assessSkillAvailability(candidate),
    });
  }
  return ranked.toSorted(
    (left, right) => right.score - left.score || left.id.localeCompare(right.id),
  );
}

export function skillKeysForPackCapability(packId: string, capability: string): string[] {
  const pack = getPackById(packId);
  if (!pack) {
    return [];
  }
  const verb = capability.trim();
  return pack.skills
    .filter((skill) => resolveVerbsForSkillKey(skill.skillKey).includes(verb))
    .map((skill) => skill.skillKey);
}

export function skillKeysForPackRecipe(packId: string, recipeId: string): string[] {
  const pack = getPackById(packId);
  const recipe = pack?.recipes?.find((entry) => entry.id === recipeId.trim());
  if (!pack || !recipe) {
    return [];
  }
  const keys = new Set<string>();
  for (const capability of recipe.capabilities) {
    for (const skillKey of skillKeysForPackCapability(pack.id, capability)) {
      keys.add(skillKey);
    }
  }
  return [...keys];
}
