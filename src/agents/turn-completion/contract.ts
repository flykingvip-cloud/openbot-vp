/**
 * Batch 6 turn-completion contract.
 *
 * A turn ends in exactly one explicit state when the contract applies:
 * - delivered: an openable path (or a registered readable deliverable)
 * - permanent_block: one reason + the degradation already tried + one user action
 * - true_fork: at least two mutually exclusive user choices
 *
 * Side-path failures (task_ledger, chmod of a non-deliverable) never refuse
 * the mainline file. An ls mode string alone is not a hard stop. 「继续」
 * opens a silent-exec window: no open parameter fishing. Skill-smoke wall
 * clock (default 15 minutes, OPENBOT_SKILL_SMOKE_SLA_MS) forces a degradation
 * file or one permanent_block line.
 *
 * Skill-term disambiguation lives in skill-gates/glossary.ts (Batch 8).
 */
import fs from "node:fs";
import path from "node:path";
import { oguiWaitBlocksSession } from "../../config/sessions/ogui-decision-wait-registry.js";
import {
  isActiveSkillTerminologyStopAsk,
  SKILL_BIND_GLOSSARY_STUB as GLOSSARY_BIND,
} from "../skill-gates/glossary.js";
import { applyTrialGate, isPreviewOkFormalBlocked } from "../skill-gates/trial-gate.js";

export const TURN_COMPLETION_STATES = ["delivered", "permanent_block", "true_fork"] as const;
export type TurnCompletionState = (typeof TURN_COMPLETION_STATES)[number];

export const BLOCKER_GRADES = ["mainline", "side_path", "already_cleared"] as const;
export type BlockerGrade = (typeof BLOCKER_GRADES)[number];

export const DEFAULT_SKILL_SMOKE_SLA_MS = 15 * 60 * 1000;
export const SKILL_SMOKE_SLA_ENV = "OPENBOT_SKILL_SMOKE_SLA_MS";
export const PROGRESS_PROSE_MAX_CHARS = 180;
export const DEGRADED_DELIVERABLE_RELATIVE = "deliverables/turn-completion-degraded.md";

/** Platform glossary entry for consulting-report「绑定」. */
export const SKILL_BIND_GLOSSARY_STUB = GLOSSARY_BIND;

export const TURN_COMPLETION_CONTINUITY_LINE =
  "Turn completion contract: finish with an openable path, one permanent_block line (reason + degradation + one user action), or a true_fork of two exclusive choices. A side-path failure such as task_ledger does not block the deliverable. After 继续, do not ask open parameters. Skill 绑定 means analysis-review task.json sha256, not WeChat, email, or OAuth.";

export type TurnCompletionContract = {
  state: TurnCompletionState;
  openablePath?: string;
  reason?: string;
  degradation?: string;
  requiredUserAction?: string;
  options?: string[];
  sidePathReceipt?: string;
};

export type EnvProbe = {
  reason: string;
  passed: boolean;
};

export type WritabilityProbe = {
  path: string;
  lsMode: string;
  writeAttempt: "ok" | "eacces" | "eperm" | "erofs" | "enoent" | "not_attempted" | "error";
  sandboxPolicyCode?: string;
  /** False when the only evidence is an ls mode string, or the path is a side path. */
  hardStop: boolean;
  blockerGrade: BlockerGrade;
};

export type TurnCompletionDeliverable = {
  relativePath: string;
  body: string;
};

export type TurnCompletionInput = {
  userText?: string;
  assistantText?: string;
  workspaceDir?: string | null;
  envProbes?: readonly EnvProbe[];
  /** Wall-clock start of the skill-smoke attempt. Absent on ordinary chat. */
  smokeStartedAtMs?: number;
  nowMs?: number;
  slaMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Force the skill-smoke SLA even when the text does not say smoke. */
  skillSmoke?: boolean;
  forkOptions?: readonly string[];
  openablePaths?: readonly string[];
  /** Simulated side-path write. A throw is bypassed; it must not cancel the deliverable. */
  sidePathAttempt?: () => void;
  sidePathLabel?: string;
  deliverable?: TurnCompletionDeliverable;
  sessionKey?: string;
  /**
   * Batch 11 E3. When true, do not settle this turn to delivered or
   * permanent_block. Omit or false preserves the existing settlement.
   * The default-off OGUI lifecycle never sets this.
   */
  oguiWaitActive?: boolean;
};

export type TurnCompletionHardStop = "empty_success" | "side_path_refusal";

export type TurnCompletionSettlement = {
  contract: TurnCompletionContract | null;
  visibleText: string;
  continueExecution: boolean;
  hardStopPrevented: TurnCompletionHardStop | null;
};

const SILENT_EXEC_RE =
  /(?:请)?继续尝试|我只要结果|只要结果|直接给(?:我)?结果|别再问|不要再问|别问了|(?:^|[\s，,。；;！!])(?:请)?继续(?!讨论|聊聊|聊下去|分析这个问题)/u;

const SKILL_SMOKE_RE = /技能试跑|\bsmoke\b|样张|skill孵化|consulting-report/iu;

const SIDE_PATH_RE =
  /task_ledger(?:\.json)?|memory\/task_ledger|chmod|非交付文件|幽灵任务|清表|清理任务/iu;

const TRUE_FORK_RE =
  /(?:两种规格|两个规格|两款|两个\s*SKU|\bSKU\b|规格\s*[AＡa]\s*(?:或|\/|、|还是)\s*(?:规格\s*)?[BＢb]|价(?:格)?\s*[AＡa].{0,24}(?:或|\/|还是).{0,24}价(?:格)?\s*[BＢb]|支付方式.{0,16}(?:或|\/|还是))/u;

const PROGRESS_RE =
  /下一步我会|接下来我会|随后我会|我会先|让我先|正在处理|正在收尾|稍等片刻|马上就好|我继续去|这一步正在做/u;

const EMPTY_SUCCESS_RE =
  /已交付|交付完成|已经完成|任务成功|✅|已成功完成|点预览就能打开|点预览即可|可以直接打开|可直接打开/u;

/** POSIX ls mode, including the over-long `-r----------` narration seen in sandbox replies. */
const LS_MODE_RE = /(?<![A-Za-z0-9])(-[r-][w-][xXsS-][r-][w-][xXsS-][r-][w-][xXtT-]-*)/;

const PATH_RE = /((?:\/|\.\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.[A-Za-z0-9]{1,8})/g;

const DELIVERABLE_EXT_RE = /\.(?:pdf|pptx|html|htm|md|txt|png|csv|docx)$/i;

const SENSITIVE_PREFIXES = ["/etc/", "/proc/", "/sys/", "/dev/", "/boot/"];

const smokeClock = new Map<string, number>();

export function resolveSkillSmokeSlaMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[SKILL_SMOKE_SLA_ENV]?.trim();
  if (!raw) {
    return DEFAULT_SKILL_SMOKE_SLA_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SKILL_SMOKE_SLA_MS;
  }
  return parsed;
}

export function isSilentExecWindow(userText: string): boolean {
  return SILENT_EXEC_RE.test(userText.trim());
}

export function isSkillSmokeTurn(userText: string, assistantText = ""): boolean {
  return SKILL_SMOKE_RE.test(`${userText}\n${assistantText}`);
}

export function noteSkillSmokeClock(params: {
  sessionKey?: string | null;
  userText: string;
  nowMs: number;
}): number | undefined {
  const key = params.sessionKey?.trim();
  if (!key || !isSkillSmokeTurn(params.userText, "")) {
    return key ? smokeClock.get(key) : undefined;
  }
  const existing = smokeClock.get(key);
  if (existing != null) {
    return existing;
  }
  smokeClock.set(key, params.nowMs);
  return params.nowMs;
}

export function clearSkillSmokeClock(sessionKey?: string | null): void {
  const key = sessionKey?.trim();
  if (key) {
    smokeClock.delete(key);
  }
}

export function resetSkillSmokeClockForTests(): void {
  smokeClock.clear();
}

export function readSkillSmokeClock(sessionKey?: string | null): number | undefined {
  const key = sessionKey?.trim();
  return key ? smokeClock.get(key) : undefined;
}

function field(value: string): string {
  const compact = value
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replace(/[\s=|]+/g, "_");
  return compact.slice(0, 80) || "unspecified";
}

export function formatPermanentBlock(params: {
  reason: string;
  degradation: string;
  requiredUserAction: string;
}): string {
  return `[turn_completion state=permanent_block reason=${field(params.reason)} degradation=${field(params.degradation)} required_user_action=${field(params.requiredUserAction)}]`;
}

/** Human-facing delivered copy (no bracket control marker). */
export function formatDeliveredLine(openablePath: string, receipt?: string): string {
  const lines = [`可打开：${openablePath}`];
  if (receipt) {
    lines.push(receipt);
  }
  return lines.join("\n");
}

export function formatTrueFork(options: readonly string[]): string {
  const cleaned = options.map((option) => field(option)).filter(Boolean);
  return `[turn_completion state=true_fork options=${cleaned.join("|")}]`;
}

function hasContractMarker(text: string): boolean {
  return /\[turn_completion\s+state=/.test(text);
}

export function isSidePathLabel(text: string): boolean {
  return SIDE_PATH_RE.test(text);
}

export function isTrueForkText(text: string, options?: readonly string[]): boolean {
  const explicit = (options ?? []).map((option) => option.trim()).filter(Boolean);
  if (explicit.length >= 2) {
    return true;
  }
  return TRUE_FORK_RE.test(text);
}

/**
 * Skill keyword asked as an unrelated platform concept.
 * consulting-report「绑定」asked as WeChat / email / knowledge-source OAuth
 * is the fixture. Not a true fork.
 */
export function isSkillBindTerminologyMisread(text: string, context = ""): boolean {
  if (isTrueForkText(text) && !/微信|邮箱|知识源|OAuth|绑定/u.test(text)) {
    return false;
  }
  return isActiveSkillTerminologyStopAsk(text, context);
}

export function isOpenEndedFishing(text: string, context = ""): boolean {
  if (isTrueForkText(text) && !isSkillBindTerminologyMisread(text, context)) {
    return false;
  }
  if (isSkillBindTerminologyMisread(text, context)) {
    return true;
  }
  return /[？?]|请告诉我|哪一份|哪个|评审对象|绑定方向|还缺|请补充/u.test(text);
}

/**
 * Silent-exec window stop that the embedded loop may continue once.
 * A real two-way fork stays terminal. A mainline permanent_block marker stays terminal.
 */
export function isSilentExecFishingStop(assistantText: string, userText: string): boolean {
  if (!isSilentExecWindow(userText)) {
    return false;
  }
  const assistant = assistantText.trim();
  if (!assistant || hasContractMarker(assistant)) {
    if (/state=permanent_block|state=true_fork/.test(assistant)) {
      return false;
    }
  }
  if (isTrueForkText(assistant) && !isSkillBindTerminologyMisread(assistant, userText)) {
    return false;
  }
  if (
    /state=permanent_block/.test(assistant) &&
    /reason=(?:render_engine|deliverable_unwritten|skill_smoke_sla)/.test(assistant)
  ) {
    return false;
  }
  return (
    isOpenEndedFishing(assistant, userText) ||
    isSidePathLabel(assistant) ||
    isLsOnlyHardStopNarrative(assistant) ||
    isProgressOnlyFinal(assistant)
  );
}

function isDeliverableRelative(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (/task_ledger\.json$/i.test(normalized)) {
    return false;
  }
  if (/^(?:runtime|governance|profile|sessions|\.git)\//i.test(normalized)) {
    return false;
  }
  return DELIVERABLE_EXT_RE.test(normalized);
}

export function firstDeliverablePath(text: string): string | null {
  const matches = text.match(PATH_RE) ?? [];
  for (const match of matches) {
    const cleaned = match.replace(/^[`'"(]+/, "");
    if (isDeliverableRelative(cleaned) || /\.(?:pdf|pptx|html|htm|md|txt|docx)$/i.test(cleaned)) {
      if (/task_ledger\.json$/i.test(cleaned)) {
        continue;
      }
      return cleaned;
    }
  }
  return null;
}

export function claimsSuccessWithoutArtifact(text: string): boolean {
  if (!EMPTY_SUCCESS_RE.test(text)) {
    return false;
  }
  if (hasContractMarker(text) && /state=delivered/.test(text)) {
    return false;
  }
  return firstDeliverablePath(text) == null;
}

export function isProgressOnlyFinal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || hasContractMarker(trimmed) || firstDeliverablePath(trimmed)) {
    return false;
  }
  if (isTrueForkText(trimmed)) {
    return false;
  }
  if (!PROGRESS_RE.test(trimmed)) {
    return false;
  }
  const lines = trimmed
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return false;
  }
  const progressLines = lines.filter((line) => PROGRESS_RE.test(line) || line.length < 24);
  return progressLines.length / lines.length >= 0.6;
}

export function violatesProgressProseBan(text: string): boolean {
  return isProgressOnlyFinal(text) && text.trim().length > PROGRESS_PROSE_MAX_CHARS;
}

export function isLsOnlyHardStopNarrative(text: string): boolean {
  if (!LS_MODE_RE.test(text)) {
    return false;
  }
  return !/writeAttempt=/.test(text);
}

export function formatLsMode(mode: number): string {
  const bits = mode & 0o777;
  let out = "-";
  const flags = ["r", "w", "x"];
  for (let index = 0; index < 9; index += 1) {
    const allowed = (bits & (1 << (8 - index))) !== 0;
    out += allowed ? flags[index % 3] : "-";
  }
  return out;
}

function errnoCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object" || !("code" in err)) {
    return undefined;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function sensitivePath(target: string): boolean {
  const resolved = path.resolve(target);
  return SENSITIVE_PREFIXES.some((prefix) => resolved.startsWith(prefix));
}

export function probeEffectiveWritability(targetPath: string): WritabilityProbe {
  const normalized = targetPath.trim();
  const sidePath = isSidePathLabel(normalized);
  const base: WritabilityProbe = {
    path: normalized,
    lsMode: "unknown",
    writeAttempt: "not_attempted",
    sandboxPolicyCode: "ls_narrative_only",
    hardStop: false,
    blockerGrade: sidePath ? "side_path" : "mainline",
  };
  if (!normalized || normalized.includes("..") || sensitivePath(normalized)) {
    return base;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(normalized);
  } catch (err) {
    const code = errnoCode(err);
    return {
      ...base,
      writeAttempt: code === "ENOENT" ? "enoent" : "not_attempted",
      sandboxPolicyCode: code ?? "ls_narrative_only",
    };
  }
  if (!stat.isFile()) {
    return { ...base, lsMode: formatLsMode(stat.mode), sandboxPolicyCode: "not_a_file" };
  }
  const lsMode = formatLsMode(stat.mode);
  try {
    const fd = fs.openSync(normalized, fs.constants.O_WRONLY | fs.constants.O_APPEND);
    fs.closeSync(fd);
    return {
      path: normalized,
      lsMode,
      writeAttempt: "ok",
      hardStop: false,
      blockerGrade: sidePath ? "side_path" : "already_cleared",
    };
  } catch (err) {
    const code = errnoCode(err) ?? "error";
    const writeAttempt = (
      code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ENOENT"
        ? code.toLowerCase()
        : "error"
    ) as WritabilityProbe["writeAttempt"];
    return {
      path: normalized,
      lsMode,
      writeAttempt,
      sandboxPolicyCode: code,
      hardStop: !sidePath && writeAttempt !== "ok",
      blockerGrade: sidePath ? "side_path" : "mainline",
    };
  }
}

export function formatWritabilityProbe(probe: WritabilityProbe): string {
  return [
    "writability",
    `path=${probe.path}`,
    `lsMode=${probe.lsMode}`,
    `writeAttempt=${probe.writeAttempt}`,
    `sandboxPolicyCode=${probe.sandboxPolicyCode ?? "-"}`,
    `hardStop=${probe.hardStop ? "true" : "false"}`,
    `blockerGrade=${probe.blockerGrade}`,
  ].join(" ");
}

function extractNarratedPath(text: string): string | null {
  const matches = text.match(PATH_RE) ?? [];
  return matches[0] ?? null;
}

/**
 * Tool-result normalizer. An ls mode string is kept, and the result gains
 * path + ls mode + a real write attempt or a sandbox policy code. Ls-only
 * narration cannot be the sole hard stop.
 */
export function annotateToolResultText(text: string): string {
  if (!text || !LS_MODE_RE.test(text) || /writeAttempt=/.test(text)) {
    return text;
  }
  const narratedPath = extractNarratedPath(text);
  const mode = LS_MODE_RE.exec(text)?.[1] ?? "unknown";
  if (!narratedPath) {
    return `${text}\nwritability path=- lsMode=${mode} writeAttempt=not_attempted sandboxPolicyCode=ls_narrative_only hardStop=false blockerGrade=side_path`;
  }
  const probeTarget = path.isAbsolute(narratedPath) ? narratedPath : narratedPath;
  let probe: WritabilityProbe;
  if (path.isAbsolute(probeTarget) && !sensitivePath(probeTarget)) {
    probe = probeEffectiveWritability(probeTarget);
  } else {
    const sidePath = isSidePathLabel(narratedPath);
    probe = {
      path: narratedPath,
      lsMode: mode,
      writeAttempt: "not_attempted",
      sandboxPolicyCode: "ls_narrative_only",
      hardStop: false,
      blockerGrade: sidePath ? "side_path" : "mainline",
    };
  }
  if (probe.lsMode === "unknown") {
    probe = { ...probe, lsMode: mode };
  }
  return `${text}\n${formatWritabilityProbe(probe)}`;
}

export function gradeBlocker(params: {
  narrative: string;
  deliverableProducible: boolean;
  clearedReasons?: readonly string[];
  probes?: readonly EnvProbe[];
}): BlockerGrade {
  const narrative = params.narrative;
  const probes = params.probes ?? [];
  for (const probe of probes) {
    if (!probe.passed) {
      continue;
    }
    if (
      params.clearedReasons?.includes(probe.reason) ||
      assistantRestopsCleared(narrative, probe)
    ) {
      return "already_cleared";
    }
  }
  if (isSidePathLabel(narrative) && params.deliverableProducible) {
    return "side_path";
  }
  if (isSidePathLabel(narrative) && !isMainlineBlockNarrative(narrative)) {
    return "side_path";
  }
  return "mainline";
}

function assistantRestopsCleared(narrative: string, probe: EnvProbe): boolean {
  if (!probe.passed) {
    return false;
  }
  if (probe.reason === "node") {
    return /node\s*v?18|只有\s*18|需要\s*node\s*20|升(?:级)?\s*node/iu.test(narrative);
  }
  if (probe.reason === "playwright") {
    return /没有\s*playwright|playwright\s*不可用|缺少\s*playwright|安装\s*playwright/iu.test(
      narrative,
    );
  }
  return (
    narrative.toLowerCase().includes(probe.reason.toLowerCase()) &&
    /不可用|缺少|没有|仍缺/.test(narrative)
  );
}

function isMainlineBlockNarrative(text: string): boolean {
  return /渲染引擎缺失|无法产生交付物|无法写出成果正文|mainline_block|成果正文写不出来/u.test(text);
}

export function defaultEnvProbes(userText: string): EnvProbe[] {
  const probes: EnvProbe[] = [];
  if (/node\s*20|具备[^。\n]{0,40}node/iu.test(userText)) {
    const major = Number(process.versions.node.split(".")[0] ?? "0");
    probes.push({ reason: "node", passed: major >= 20 });
  }
  if (/playwright/iu.test(userText)) {
    probes.push({ reason: "playwright", passed: playwrightResolvable() });
  }
  return probes;
}

function playwrightResolvable(): boolean {
  const candidates = [
    path.join(process.cwd(), "node_modules", "playwright"),
    path.join(process.cwd(), "node_modules", "playwright-core"),
  ];
  return candidates.some((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Batch 6 side-path receipt. Batch 7 keep-only reuses this exact line. */
export function formatSidePathBypassReceipt(label: string, err?: unknown): string {
  const code = errnoCode(err) ?? "write_failed";
  return `side_path_bypass: ${label} ${code}`;
}

function sidePathReceipt(label: string, err?: unknown): string {
  return formatSidePathBypassReceipt(label, err);
}

function writeWorkspaceFile(
  workspaceDir: string,
  relativePath: string,
  body: string,
): string | null {
  const root = path.resolve(workspaceDir);
  const relative = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relative || relative.includes("..") || path.isAbsolute(relative)) {
    return null;
  }
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  try {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, body.endsWith("\n") ? body : `${body}\n`, "utf8");
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size <= 0) {
      return null;
    }
    return relative;
  } catch {
    return null;
  }
}

function degradationBody(params: { reason: string; receipt?: string }): string {
  const lines = [
    "# 降级交付",
    "",
    "本回合没有交出原定二进制样张。下面这份文本可以直接打开。",
    "",
    `- reason: ${params.reason}`,
  ];
  if (params.receipt) {
    lines.push(`- ${params.receipt}`);
  }
  lines.push("- grade: degradation");
  return lines.join("\n");
}

function deliveredResult(params: {
  openablePath: string;
  receipt?: string;
  note?: string;
  hardStopPrevented: TurnCompletionHardStop | null;
  sessionKey?: string;
}): TurnCompletionSettlement {
  clearSkillSmokeClock(params.sessionKey);
  const contract: TurnCompletionContract = {
    state: "delivered",
    openablePath: params.openablePath,
    ...(params.receipt ? { sidePathReceipt: params.receipt } : {}),
  };
  return {
    contract,
    visibleText: [formatDeliveredLine(params.openablePath, params.receipt), params.note ?? ""]
      .filter(Boolean)
      .join("\n"),
    continueExecution: false,
    hardStopPrevented: params.hardStopPrevented,
  };
}

function formatPermanentBlockVisible(params: {
  reason: string;
  requiredUserAction: string;
  receipt?: string;
}): string {
  // Human speech only. Include 等待你确认 so task-board human-gate detection
  // still fires without embedding a [turn_completion …] control marker.
  const action = params.requiredUserAction.trim() || "确认后回复继续";
  const lines = [`等待你确认：${action}`];
  if (params.receipt?.trim()) {
    lines.push(params.receipt.trim());
  }
  return lines.join("\n");
}

function permanentResult(params: {
  reason: string;
  degradation: string;
  requiredUserAction: string;
  receipt?: string;
  hardStopPrevented: TurnCompletionHardStop | null;
}): TurnCompletionSettlement {
  // formatPermanentBlock remains exported for structured/logging callers; visible
  // chat must not include the bracket marker line.
  return {
    contract: {
      state: "permanent_block",
      reason: field(params.reason),
      degradation: field(params.degradation),
      requiredUserAction: field(params.requiredUserAction),
      ...(params.receipt ? { sidePathReceipt: params.receipt } : {}),
    },
    visibleText: formatPermanentBlockVisible(params),
    continueExecution: false,
    hardStopPrevented: params.hardStopPrevented,
  };
}

export function turnCompletionApplies(input: TurnCompletionInput): boolean {
  const assistant = (input.assistantText ?? "").trim();
  const user = input.userText ?? "";
  if (!assistant) {
    return false;
  }
  if (claimsSuccessWithoutArtifact(assistant)) {
    return true;
  }
  if (violatesProgressProseBan(assistant)) {
    return true;
  }
  if (
    isLsOnlyHardStopNarrative(assistant) &&
    (isSilentExecWindow(user) || /拒绝|无法|不能|到此结束|写操作被拒绝/u.test(assistant))
  ) {
    return true;
  }
  if (
    isSidePathLabel(assistant) &&
    /拒绝|无法|不能|不会|只读|read-only|readonly|写操作被拒绝|到此结束/iu.test(assistant)
  ) {
    return true;
  }
  if (isSkillBindTerminologyMisread(assistant, user)) {
    return true;
  }
  const probes = input.envProbes ?? defaultEnvProbes(user);
  if (probes.some((probe) => assistantRestopsCleared(assistant, probe))) {
    return true;
  }
  if (isSilentExecWindow(user) && isSilentExecFishingStop(assistant, user)) {
    return true;
  }
  if (
    isTrueForkText(assistant, input.forkOptions) &&
    !isSkillBindTerminologyMisread(assistant, user)
  ) {
    return true;
  }
  const slaMs = input.slaMs ?? resolveSkillSmokeSlaMs(input.env);
  const smoke = input.skillSmoke === true || isSkillSmokeTurn(user, assistant);
  if (
    smoke &&
    input.smokeStartedAtMs != null &&
    (input.nowMs ?? 0) - input.smokeStartedAtMs >= slaMs &&
    !firstDeliverablePath(assistant)
  ) {
    return true;
  }
  return false;
}

/**
 * Settle one assistant final against the turn-completion contract.
 * Ordinary replies pass through unchanged.
 */
export function settleTurnCompletion(input: TurnCompletionInput): TurnCompletionSettlement {
  const assistantText = input.assistantText ?? "";
  const userText = input.userText ?? "";
  const unchanged = (): TurnCompletionSettlement => ({
    contract: null,
    visibleText: assistantText,
    continueExecution: false,
    hardStopPrevented: null,
  });
  // E3: a valid OGUI WAIT is not rewritten to delivered or permanent_block by
  // deliverable write, trial, existing-deliverable, or SLA. Visible text stays
  // so a deliverable mention can coexist with the waiting card. Flag-off
  // callers omit the flag and leave the in-process registry empty.
  if (input.oguiWaitActive === true || oguiWaitBlocksSession(input.sessionKey)) {
    return unchanged();
  }
  const trial = input.skillSmoke === true || isSkillSmokeTurn(userText, assistantText);
  const trialApplies = trial && isPreviewOkFormalBlocked(`${userText}\n${assistantText}`);
  if (
    !turnCompletionApplies(input) &&
    !input.deliverable &&
    !input.sidePathAttempt &&
    !trialApplies
  ) {
    return unchanged();
  }

  let receipt: string | undefined;
  if (input.sidePathAttempt) {
    try {
      input.sidePathAttempt();
    } catch (err) {
      receipt = sidePathReceipt(input.sidePathLabel ?? "memory/task_ledger.json", err);
    }
  } else if (isSidePathLabel(assistantText)) {
    receipt = sidePathReceipt(extractNarratedPath(assistantText) ?? "memory/task_ledger.json");
  }

  const emptySuccess = claimsSuccessWithoutArtifact(assistantText);
  const sideRefusal =
    isSidePathLabel(assistantText) &&
    /拒绝|无法出|不能出|不会.*(?:pdf|pptx|稿)|到此结束|写操作被拒绝/iu.test(assistantText);
  const hardStopPrevented: TurnCompletionHardStop | null = emptySuccess
    ? "empty_success"
    : sideRefusal
      ? "side_path_refusal"
      : null;

  const probes = input.envProbes ?? defaultEnvProbes(userText);
  const slaMs = input.slaMs ?? resolveSkillSmokeSlaMs(input.env);
  const nowMs = input.nowMs ?? Date.now();
  const smoke = input.skillSmoke === true || isSkillSmokeTurn(userText, assistantText);
  const slaExpired =
    smoke && input.smokeStartedAtMs != null && nowMs - input.smokeStartedAtMs >= slaMs;
  const misread = isSkillBindTerminologyMisread(assistantText, userText);
  const fork = !misread && isTrueForkText(assistantText, input.forkOptions) && !slaExpired;
  const cleared = probes.some((probe) => assistantRestopsCleared(assistantText, probe));
  const lsOnly =
    isLsOnlyHardStopNarrative(assistantText) &&
    (isSilentExecWindow(userText) || /拒绝|无法|不能|到此结束|写操作被拒绝/u.test(assistantText));

  if (input.deliverable && input.workspaceDir) {
    const written = writeWorkspaceFile(
      input.workspaceDir,
      input.deliverable.relativePath,
      input.deliverable.body,
    );
    if (written) {
      return deliveredResult({
        openablePath: written,
        receipt,
        note: "主线成果已落盘。",
        hardStopPrevented,
        sessionKey: input.sessionKey,
      });
    }
  }

  const trialDecision = applyTrialGate({
    trial,
    narrative: `${userText}\n${assistantText}`,
    workspaceDir: input.workspaceDir,
    previewPath: firstDeliverablePath(assistantText),
  });
  if (trialDecision?.openablePath) {
    return deliveredResult({
      openablePath: trialDecision.openablePath,
      receipt,
      note: trialDecision.declaration,
      hardStopPrevented,
      sessionKey: input.sessionKey,
    });
  }
  if (trialDecision?.action === "permanent_block") {
    return permanentResult({
      reason: trialDecision.reason,
      degradation: "unavailable",
      requiredUserAction: "确认成果目录可写后回复继续",
      receipt,
      hardStopPrevented,
    });
  }

  const existing =
    firstDeliverablePath(assistantText) ?? input.openablePaths?.find((item) => item.trim()) ?? null;
  if (existing && !emptySuccess && !slaExpired && !misread && !sideRefusal) {
    return {
      contract: {
        state: "delivered",
        openablePath: existing,
        ...(receipt ? { sidePathReceipt: receipt } : {}),
      },
      visibleText: receipt ? `${assistantText.trim()}\n${receipt}` : assistantText,
      continueExecution: false,
      hardStopPrevented,
    };
  }

  if (fork) {
    const options =
      input.forkOptions && input.forkOptions.length >= 2
        ? [...input.forkOptions]
        : ["option_a", "option_b"];
    // formatTrueFork remains exported for structured consumers; never put the
    // bracket marker into visibleText (end-user chat).
    const speech = assistantText.trim();
    const hasGate =
      /等待你确认|等待确认后|waiting_confirmation|owner-decision|owner_decision|请扫码|请支付|二维码|验证码|授权登录/iu.test(
        speech,
      );
    const visibleText = hasGate ? speech : speech ? `${speech}\n\n等待你确认下一步。` : "等待你确认下一步。";
    return {
      contract: { state: "true_fork", options },
      visibleText,
      continueExecution: false,
      hardStopPrevented: null,
    };
  }

  const mustForce =
    slaExpired ||
    misread ||
    cleared ||
    lsOnly ||
    sideRefusal ||
    emptySuccess ||
    violatesProgressProseBan(assistantText) ||
    (isSilentExecWindow(userText) && isSilentExecFishingStop(assistantText, userText)) ||
    Boolean(input.deliverable);

  if (!mustForce && isMainlineBlockNarrative(assistantText)) {
    const degraded = input.workspaceDir
      ? writeWorkspaceFile(
          input.workspaceDir,
          DEGRADED_DELIVERABLE_RELATIVE,
          degradationBody({ reason: "mainline_degraded", receipt }),
        )
      : null;
    if (degraded) {
      return deliveredResult({
        openablePath: degraded,
        receipt,
        hardStopPrevented,
        sessionKey: input.sessionKey,
      });
    }
    return permanentResult({
      reason: "render_engine_missing",
      degradation: "unavailable",
      requiredUserAction: "提供可写成果目录或可用渲染环境后回复继续",
      receipt,
      hardStopPrevented,
    });
  }

  if (!mustForce) {
    return unchanged();
  }

  const reason = slaExpired
    ? "skill_smoke_sla"
    : emptySuccess
      ? "empty_success"
      : misread
        ? "skill_bind_terminology"
        : cleared
          ? "already_cleared"
          : "side_path_or_incomplete";
  const degraded = input.workspaceDir
    ? writeWorkspaceFile(
        input.workspaceDir,
        DEGRADED_DELIVERABLE_RELATIVE,
        degradationBody({ reason, receipt }),
      )
    : null;
  if (degraded) {
    return deliveredResult({
      openablePath: degraded,
      receipt,
      hardStopPrevented,
      sessionKey: input.sessionKey,
    });
  }
  return permanentResult({
    reason: slaExpired ? "skill_smoke_sla" : reason,
    degradation: "unavailable",
    requiredUserAction: "确认成果目录可写后回复继续",
    receipt,
    hardStopPrevented,
  });
}
