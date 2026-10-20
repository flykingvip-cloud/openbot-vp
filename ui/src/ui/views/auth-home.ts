import { html, nothing } from "lit";
import type {
  ControlUiMembershipChoice,
  ControlUiPlatformAuthMode,
  ControlUiPlatformAuthState,
} from "../../../../src/gateway/control-ui-contract.js";
import { t, type Locale } from "../../i18n/index.ts";
import { resolveBundledBrandWordmarkSrc } from "../brand-assets.ts";
import { isSafeOpenBotLoginHref } from "../controllers/surface-mismatch-message.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { pathForTab } from "../navigation.ts";
import { resolveEmployeePublicHomeHref } from "../public-home.ts";
import type { FrontendPort } from "../routing/cross-port-context.ts";
import { readPasswordResetAuthMode } from "../routing/password-reset-link.ts";
import { originForPort, resolvePortFromSubdomain } from "../routing/subdomain-resolver.ts";

type AuthHomeProps = {
  brandLogoSrc?: string | null;
  basePath?: string;
  client?: GatewayBrowserClient | null;
  currentLocale: Locale;
  state: ControlUiPlatformAuthState | null;
  mode: ControlUiPlatformAuthMode | "enterpriseLogin" | "platformLogin";
  busy: boolean;
  error: string | null;
  notice: string | null;
  email: string;
  password: string;
  displayName: string;
  tenantName: string;
  expectedUsers: string;
  useCase: string;
  companySize: string;
  needsDemo: string;
  industry: string;
  trialStep: 1 | 2;
  inviteCode: string;
  mfaCode?: string;
  mfaStage?: "none" | "code" | "enroll";
  mfaEnrollment?: { otpAuthUrl: string; recoveryCodes: string[] } | null;
  membershipChoices?: ControlUiMembershipChoice[];
  membershipId?: string;
  onMembershipIdChange?: (value: string) => void;
  onMfaCodeChange?: (value: string) => void;
  onModeChange: (mode: ControlUiPlatformAuthMode) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onTenantNameChange: (value: string) => void;
  onExpectedUsersChange: (value: string) => void;
  onUseCaseChange: (value: string) => void;
  onCompanySizeChange: (value: string) => void;
  onNeedsDemoChange: (value: string) => void;
  onIndustryChange: (value: string) => void;
  onTrialStepChange: (step: 1 | 2) => void;
  onInviteCodeChange: (value: string) => void;
  onLocaleChange: (locale: Locale) => void;
  onForgotAccountHelp: () => void;
  onSubmit: (mode: ControlUiPlatformAuthMode) => void;
  entryVariant?: "public" | "enterprise" | "platform";
  /** Set only when auto-redirect off the login tab is unsafe. Hides the password form. */
  continueHref?: string | null;
  continueLabel?: string | null;
};

/** Stable CDN path served by nginx on openbot.love / www.openbot.love. */
const MAC_APP_DOWNLOAD_HREF = "/downloads/OpenBot-mac.zip";

const PUBLIC_AUTH_HOME_BASE_MODES = [
  "enterprise-create",
  "employee-register",
  "enterprise-activate",
  "login",
  "forgot-password",
  "password-reset",
] as const satisfies readonly ControlUiPlatformAuthMode[];
const PUBLIC_AUTH_HOME_MODES = new Set<ControlUiPlatformAuthMode>(PUBLIC_AUTH_HOME_BASE_MODES);

function isPublicAuthHomeMode(mode: ControlUiPlatformAuthMode): boolean {
  return PUBLIC_AUTH_HOME_MODES.has(mode);
}

function nextLocale(locale: Locale): Locale {
  return locale === "zh-CN" ? "en" : "zh-CN";
}

function localeBadge(locale: Locale) {
  return locale === "zh-CN" ? "中" : "EN";
}

function navigateToRoute(event: MouseEvent, href: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  if (typeof window === "undefined") {
    return;
  }
  try {
    const target = new URL(href, window.location.href);
    if (target.origin !== window.location.origin) {
      window.location.assign(target.toString());
      return;
    }
    window.history.pushState({}, "", `${target.pathname}${target.search}${target.hash}`);
  } catch {
    window.history.pushState({}, "", href);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function modeLabel(mode: ControlUiPlatformAuthMode): string {
  switch (mode) {
    case "platform-bootstrap":
      return t("overview.platformAuth.modes.platformBootstrap.tab");
    case "platform-super-admin-login":
      return t("overview.platformAuth.modes.platformSuperAdminLogin.tab");
    case "platform-admin-login":
      return t("overview.platformAuth.modes.platformAdminLogin.tab");
    case "enterprise-create":
      return t("overview.platformAuth.modes.enterpriseCreate.tab");
    case "employee-register":
      return t("overview.platformAuth.modes.employeeRegister.tab");
    case "enterprise-activate":
      return t("overview.platformAuth.modes.enterpriseActivate.tab");
    case "login":
      return t("overview.platformAuth.modes.login.tab");
    case "forgot-password":
      return t("overview.platformAuth.modes.forgotPassword.tab");
    case "password-reset":
      return t("overview.platformAuth.modes.passwordReset.tab");
    case "platform-enterprise-create":
      return t("overview.platformAuth.modes.platformEnterpriseCreate.tab");
    default:
      return mode;
  }
}

function authTabLabel(mode: ControlUiPlatformAuthMode): string {
  switch (mode) {
    case "platform-super-admin-login":
      return t("authHome.authTabs.platformSuperAdminLogin");
    case "platform-admin-login":
      return t("authHome.authTabs.platformAdminLogin");
    case "enterprise-create":
      return t("authHome.authTabs.enterpriseCreate");
    case "employee-register":
      return t("authHome.authTabs.employeeRegister");
    case "enterprise-activate":
      return t("authHome.authTabs.adminActivation");
    case "login":
      return t("authHome.authTabs.login");
    default:
      return modeLabel(mode);
  }
}

function modeTitle(mode: ControlUiPlatformAuthMode): string {
  switch (mode) {
    case "platform-bootstrap":
      return t("overview.platformAuth.modes.platformBootstrap.title");
    case "platform-super-admin-login":
      return t("overview.platformAuth.modes.platformSuperAdminLogin.title");
    case "platform-admin-login":
      return t("overview.platformAuth.modes.platformAdminLogin.title");
    case "enterprise-create":
      return t("authHome.trialApply.title");
    case "employee-register":
      return t("authHome.employeeRegister.title");
    case "enterprise-activate":
      return t("overview.platformAuth.modes.enterpriseActivate.title");
    case "login":
      return t("overview.platformAuth.modes.login.title");
    case "forgot-password":
      return t("overview.platformAuth.modes.forgotPassword.title");
    case "password-reset":
      return t("overview.platformAuth.modes.passwordReset.title");
    case "platform-enterprise-create":
      return t("overview.platformAuth.modes.platformEnterpriseCreate.title");
    default:
      return "";
  }
}

function modeSubtitle(mode: ControlUiPlatformAuthMode): string {
  switch (mode) {
    case "platform-bootstrap":
      return t("overview.platformAuth.modes.platformBootstrap.subtitle");
    case "platform-super-admin-login":
      return t("overview.platformAuth.modes.platformSuperAdminLogin.subtitle");
    case "platform-admin-login":
      return t("overview.platformAuth.modes.platformAdminLogin.subtitle");
    case "enterprise-create":
      return t("authHome.trialApply.subtitle");
    case "employee-register":
      return t("authHome.employeeRegister.subtitle");
    case "enterprise-activate":
      return t("overview.platformAuth.modes.enterpriseActivate.subtitle");
    case "login":
      return t("overview.platformAuth.modes.login.subtitle");
    case "forgot-password":
      return t("overview.platformAuth.modes.forgotPassword.subtitle");
    case "password-reset":
      return t("overview.platformAuth.modes.passwordReset.subtitle");
    case "platform-enterprise-create":
      return t("overview.platformAuth.modes.platformEnterpriseCreate.subtitle");
    default:
      return "";
  }
}

function submitLabel(
  mode: ControlUiPlatformAuthMode,
  busy: boolean,
  trialStep?: 1 | 2,
  locale?: Locale,
): string {
  if (busy) {
    return t("overview.platformAuth.submitting");
  }
  switch (mode) {
    case "platform-bootstrap":
      return t("overview.platformAuth.modes.platformBootstrap.submit");
    case "platform-super-admin-login":
      return t("overview.platformAuth.modes.platformSuperAdminLogin.submit");
    case "platform-admin-login":
      return t("overview.platformAuth.modes.platformAdminLogin.submit");
    case "enterprise-create":
      return trialStep === 1
        ? trialText(locale ?? "en", "authHome.trialApply.ctaStepOne", "ctaStepOne")
        : t("authHome.trialApply.ctaStepTwo");
    case "employee-register":
      return t("authHome.employeeRegister.submit");
    case "enterprise-activate":
      return t("overview.platformAuth.modes.enterpriseActivate.submit");
    case "login":
      return t("overview.platformAuth.modes.login.submit");
    case "forgot-password":
      return t("overview.platformAuth.modes.forgotPassword.submit");
    case "password-reset":
      return t("overview.platformAuth.modes.passwordReset.submit");
    case "platform-enterprise-create":
      return t("overview.platformAuth.modes.platformEnterpriseCreate.submit");
    default:
      return t("overview.platformAuth.submitting");
  }
}

function renderField(params: {
  label: string;
  value: string;
  type?: "email" | "password" | "text";
  placeholder?: string;
  autocomplete?: string;
  stacked?: boolean;
  disabled: boolean;
  onInput: (value: string) => void;
}) {
  return html`
    <label class=${`auth-home__field ${params.stacked ? "auth-home__field--stacked" : ""}`}>
      <span>${params.label}</span>
      <input
        .value=${params.value}
        type=${params.type ?? "text"}
        placeholder=${params.placeholder ?? ""}
        autocomplete=${params.autocomplete ?? "off"}
        ?disabled=${params.disabled}
        @input=${(event: Event) => params.onInput((event.target as HTMLInputElement).value)}
      />
    </label>
  `;
}

function trialCompanySizeOptions() {
  return [
    { value: "", label: t("authHome.trialApply.companySizeOptions.placeholder") },
    { value: "1-20", label: t("authHome.trialApply.companySizeOptions.oneToTwenty") },
    { value: "21-50", label: t("authHome.trialApply.companySizeOptions.twentyOneToFifty") },
    { value: "51-200", label: t("authHome.trialApply.companySizeOptions.fiftyOneToTwoHundred") },
    { value: "201-1000", label: t("authHome.trialApply.companySizeOptions.twoHundredToThousand") },
    { value: "1000+", label: t("authHome.trialApply.companySizeOptions.overThousand") },
  ];
}

function trialNeedsDemoOptions() {
  return [
    { value: "", label: t("authHome.trialApply.needsDemoOptions.placeholder") },
    { value: "yes", label: t("authHome.trialApply.needsDemoOptions.yes") },
    { value: "no", label: t("authHome.trialApply.needsDemoOptions.no") },
  ];
}

function trialIndustryOptions() {
  return [
    { value: "", label: t("authHome.trialApply.industryOptions.placeholder") },
    { value: "software", label: t("authHome.trialApply.industryOptions.software") },
    { value: "manufacturing", label: t("authHome.trialApply.industryOptions.manufacturing") },
    { value: "finance", label: t("authHome.trialApply.industryOptions.finance") },
    { value: "education", label: t("authHome.trialApply.industryOptions.education") },
    { value: "healthcare", label: t("authHome.trialApply.industryOptions.healthcare") },
    { value: "retail", label: t("authHome.trialApply.industryOptions.retail") },
    { value: "professional-services", label: t("authHome.trialApply.industryOptions.services") },
    { value: "other", label: t("authHome.trialApply.industryOptions.other") },
  ];
}

function trialUseCaseOptions(locale: Locale) {
  return [
    trialText(
      locale,
      "authHome.trialApply.useCaseOptions.customerService",
      "useCaseCustomerService",
    ),
    trialText(locale, "authHome.trialApply.useCaseOptions.knowledgeBase", "useCaseKnowledgeBase"),
    trialText(locale, "authHome.trialApply.useCaseOptions.automation", "useCaseAutomation"),
    trialText(locale, "authHome.trialApply.useCaseOptions.assistant", "useCaseAssistant"),
    trialText(locale, "authHome.trialApply.useCaseOptions.other", "useCaseOther"),
  ];
}

function selectedTrialUseCases(value: string): string[] {
  return value
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toggleTrialUseCase(current: string, option: string): string {
  const tokens = selectedTrialUseCases(current);
  return tokens.includes(option)
    ? tokens.filter((entry) => entry !== option).join(" / ")
    : [...tokens, option].join(" / ");
}

function fallbackTrialText(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const zh = locale === "zh-CN" || locale === "zh-TW";
  const map: Record<string, string> = zh
    ? {
        badge: "申请试用",
        stepOneHeading: "基本信息",
        stepTwoHeading: "使用需求",
        stepCount: `第 ${params?.step ?? "1"} / 2 步`,
        stepOneDescription: "",
        stepTwoDescription: "",
        quickOpenTitle: "基本信息",
        quickOpenDescription: "确认企业与团队规模",
        detailNeedsTitle: "使用需求",
        detailNeedsDescription: "定制试用环境与跟进方式",
        nextStep: "继续",
        ctaStepOne: "立即创建试用环境 →",
        ctaStepTwo: "提交申请并开通试用",
        backStep: "返回上一步",
        stepOneHint: "",
        terms: "提交即表示你已阅读并同意我们的隐私政策与试用条款。",
        routing: "",
        trustInstant: "",
        trustTeam: "",
        trustNoCard: "",
        useCaseCustomerService: "AI 客服",
        useCaseKnowledgeBase: "内部知识库",
        useCaseAutomation: "自动化流程",
        useCaseAssistant: "AI 助手",
        useCaseOther: "其他",
        useCasePlaceholder: "请选择使用场景（可多选）",
        useCaseMultiSelectHint: "可同时选择多个，再次点击取消",
        tocStepOne: "核心信息",
        tocCompany: "企业信息",
        tocContact: "联系人",
        tocUseCase: "使用场景",
        tocCompanyMeta: "企业画像",
        tocDemo: "演示需求",
        pageTitle: "",
        pageSubtitle: "",
        visualBadge: "企业工作系统",
        visualTitle: "把 AI 对话、知识库和流程执行连成一个工作系统",
        visualSubtitle: "从试用开始，就把团队协作、知识沉淀与流程自动化放进同一套环境。",
        visualChatLabel: "AI 协作中枢",
        visualChatPrompt: "整理本周客户反馈，输出行动项并同步给销售与客服团队。",
        visualChatReply: "已汇总 12 条反馈，生成优先级列表，并创建售后跟进流程。",
        visualFlowTitle: "自动化工作流",
        visualFlowCollect: "汇总多渠道需求",
        visualFlowRoute: "分发到团队与机器人",
        visualFlowDeliver: "沉淀知识与执行结果",
        successTitle: "申请已处理",
        backHome: "返回首页",
        goLogin: "前往登录",
      }
    : {
        badge: "Apply for Trial",
        stepOneHeading: "Basics",
        stepTwoHeading: "Needs",
        stepCount: `Step ${params?.step ?? "1"} / 2`,
        stepOneDescription: "",
        stepTwoDescription: "",
        quickOpenTitle: "Basic Info",
        quickOpenDescription: "Confirm company and team size",
        detailNeedsTitle: "Usage Needs",
        detailNeedsDescription: "Tailor the trial environment",
        nextStep: "Continue",
        ctaStepOne: "Create Trial Environment →",
        ctaStepTwo: "Submit and Open Trial",
        backStep: "Back",
        stepOneHint: "",
        terms: "By submitting, you agree to our privacy policy and trial terms.",
        routing: "",
        trustInstant: "",
        trustTeam: "",
        trustNoCard: "",
        useCaseCustomerService: "AI Customer Support",
        useCaseKnowledgeBase: "Internal Knowledge Base",
        useCaseAutomation: "Workflow Automation",
        useCaseAssistant: "AI Assistant",
        useCaseOther: "Other",
        useCasePlaceholder: "Select use cases (multi-select)",
        useCaseMultiSelectHint: "Tap to toggle; pick as many as you need.",
        tocStepOne: "Core Info",
        tocCompany: "Company",
        tocContact: "Contact",
        tocUseCase: "Use Cases",
        tocCompanyMeta: "Company Profile",
        tocDemo: "Demo Need",
        pageTitle: "",
        pageSubtitle: "",
        visualBadge: "Enterprise Work System",
        visualTitle: "Turn AI chat, knowledge, and workflows into one operating layer",
        visualSubtitle:
          "Start with a trial and give your team one environment for collaboration, knowledge capture, and execution.",
        visualChatLabel: "AI Operations Hub",
        visualChatPrompt:
          "Summarize this week's customer feedback, turn it into action items, and sync it to sales and support.",
        visualChatReply:
          "12 items grouped by priority. Follow-up workflow created and synced to the team workspace.",
        visualFlowTitle: "Automation Workflow",
        visualFlowCollect: "Collect requests across channels",
        visualFlowRoute: "Route to teams and AI workers",
        visualFlowDeliver: "Capture knowledge and outcomes",
        successTitle: "Application processed",
        backHome: "Back to home",
        goLogin: "Go to login",
      };
  return map[key] ?? key;
}

function trialText(
  locale: Locale,
  translationKey: string,
  fallbackKey: string,
  params?: Record<string, string | number>,
): string {
  const resolved = t(translationKey, params as Record<string, string> | undefined);
  return resolved === translationKey ? fallbackTrialText(locale, fallbackKey, params) : resolved;
}

function renderTrialApplyStepper(props: AuthHomeProps) {
  const step = props.trialStep;
  const steps = [
    {
      id: 1,
      title: trialText(
        props.currentLocale,
        "authHome.trialApply.steps.quickOpen.title",
        "quickOpenTitle",
      ),
    },
    {
      id: 2,
      title: trialText(
        props.currentLocale,
        "authHome.trialApply.steps.detailNeeds.title",
        "detailNeedsTitle",
      ),
    },
  ] as const;
  return html`
    <div class="auth-home__trial-topbar">
      <div class="auth-home__trial-badge">
        ${trialText(props.currentLocale, "authHome.trialApply.badge", "badge")}
      </div>
      <div class="auth-home__trial-counter">
        ${trialText(props.currentLocale, "authHome.trialApply.stepCount", "stepCount", { step })}
      </div>
    </div>
    <div class="auth-home__trial-stepbar">
      ${steps.map(
        (entry, index) => html`
          <div class=${`auth-home__trial-step ${step >= entry.id ? "is-active" : ""}`}>
            <span class="auth-home__trial-step-dot">${entry.id}</span>
            <div class="auth-home__trial-step-copy">
              <strong>${entry.title}</strong>
            </div>
          </div>
          ${
            index < steps.length - 1
              ? html`
                  <div class="auth-home__trial-step-divider" aria-hidden="true"></div>
                `
              : nothing
          }
        `,
      )}
    </div>
  `;
}

function renderTrialApplyVisual(locale: Locale, screenshotSrc: string) {
  return html`
    <section class="trial-apply-page__visual-panel">
      <div class="trial-apply-page__visual-header">
        <div class="trial-apply-page__eyebrow">
          ${trialText(locale, "authHome.trialApply.visualBadge", "visualBadge")}
        </div>
        <h2>${trialText(locale, "authHome.trialApply.visualTitle", "visualTitle")}</h2>
        <p>${trialText(locale, "authHome.trialApply.visualSubtitle", "visualSubtitle")}</p>
      </div>
      <div class="trial-apply-page__visual-canvas">
        <div class="trial-apply-page__visual-window">
          <img
            class="trial-apply-page__visual-shot"
            src=${screenshotSrc}
            alt=${trialText(locale, "authHome.trialApply.visualTitle", "visualTitle")}
          />
          <div class="trial-apply-page__visual-overlay"></div>
          <div class="trial-apply-page__visual-window-bar">
            <span></span>
            <span></span>
            <span></span>
            <div class="trial-apply-page__visual-window-pill">
              ${trialText(locale, "authHome.trialApply.visualChatLabel", "visualChatLabel")}
            </div>
          </div>
          <div class="trial-apply-page__visual-dialog">
            <div class="trial-apply-page__visual-bubble">
              ${trialText(locale, "authHome.trialApply.visualChatPrompt", "visualChatPrompt")}
            </div>
            <div class="trial-apply-page__visual-bubble trial-apply-page__visual-bubble--accent">
              ${trialText(locale, "authHome.trialApply.visualChatReply", "visualChatReply")}
            </div>
          </div>
          <div class="trial-apply-page__visual-flow">
            <div class="trial-apply-page__visual-flow-title">
              ${trialText(locale, "authHome.trialApply.visualFlowTitle", "visualFlowTitle")}
            </div>
            <div class="trial-apply-page__visual-flow-row">
              <span>${trialText(locale, "authHome.trialApply.visualFlowCollect", "visualFlowCollect")}</span>
              <span>${trialText(locale, "authHome.trialApply.visualFlowRoute", "visualFlowRoute")}</span>
              <span>${trialText(locale, "authHome.trialApply.visualFlowDeliver", "visualFlowDeliver")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderTrialCompactField(params: {
  label: string;
  value: string;
  type?: "email" | "text";
  placeholder?: string;
  autocomplete?: string;
  disabled: boolean;
  onInput: (value: string) => void;
}) {
  const hasValue = params.value.trim().length > 0;
  return html`
    <label class=${`trial-apply-page__compact-field ${hasValue ? "is-filled" : ""}`}>
      <span class="trial-apply-page__compact-label">${params.label}</span>
      <span class=${`trial-apply-page__compact-value ${hasValue ? "" : "is-placeholder"}`}>
        ${hasValue ? params.value : (params.placeholder ?? "")}
      </span>
      <input
        class="trial-apply-page__compact-control"
        .value=${params.value}
        type=${params.type ?? "text"}
        placeholder=${params.placeholder ?? ""}
        autocomplete=${params.autocomplete ?? "off"}
        ?disabled=${params.disabled}
        @input=${(event: Event) => params.onInput((event.target as HTMLInputElement).value)}
      />
    </label>
  `;
}

function renderTrialCompactSelectField(params: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onInput: (value: string) => void;
}) {
  const selectedLabel =
    params.options.find((option) => option.value === params.value)?.label ??
    params.options[0]?.label ??
    "";
  const hasValue = params.value.trim().length > 0;
  return html`
    <label
      class=${`trial-apply-page__compact-field trial-apply-page__compact-field--select ${
        hasValue ? "is-filled" : ""
      }`}
    >
      <span class="trial-apply-page__compact-label">${params.label}</span>
      <span class=${`trial-apply-page__compact-value ${hasValue ? "" : "is-placeholder"}`}>
        ${selectedLabel}
      </span>
      <select
        class="trial-apply-page__compact-control"
        .value=${params.value}
        ?disabled=${params.disabled}
        @change=${(event: Event) => params.onInput((event.target as HTMLSelectElement).value)}
      >
        ${params.options.map(
          (option) => html`<option value=${option.value}>${option.label}</option>`,
        )}
      </select>
    </label>
  `;
}

function renderTrialUseCaseMultiSelect(props: AuthHomeProps) {
  const useCases = trialUseCaseOptions(props.currentLocale);
  const selected = selectedTrialUseCases(props.useCase);
  const summary = (() => {
    if (selected.length === 0) {
      return html`
        <span
          class="auth-home__trial-multiselect-summary auth-home__trial-multiselect-summary--placeholder"
        >
          ${trialText(
            props.currentLocale,
            "authHome.trialApply.placeholders.useCase",
            "useCasePlaceholder",
          )}
        </span>
      `;
    }
    const visible = selected.slice(0, 2).join("、");
    const more = selected.length - 2;
    return html`
      <span class="auth-home__trial-multiselect-summary">
        ${visible}${
          more > 0
            ? html`<span class="auth-home__trial-multiselect-counter">+${more}</span>`
            : nothing
        }
      </span>
    `;
  })();
  // Native <details> + <summary> gives us free open/close state, focus, and
  // keyboard handling (Enter/Space toggles). We render the chip-grid inside
  // and let the user click multiple options without closing the panel; a
  // second click on the trigger collapses it.
  return html`
    <details class="auth-home__trial-multiselect">
      <summary
        class="auth-home__trial-multiselect-trigger"
        ?disabled=${props.busy}
        aria-haspopup="listbox"
        @click=${(event: MouseEvent) => {
          if (props.busy) {
            event.preventDefault();
          }
        }}
      >
        ${summary}
        <span class="auth-home__trial-multiselect-chevron" aria-hidden="true"></span>
      </summary>
      <div class="auth-home__trial-multiselect-panel" role="listbox" aria-multiselectable="true">
        <div class="auth-home__trial-multiselect-options">
          ${useCases.map((option) => {
            const active = selected.includes(option);
            return html`
              <button
                class=${`auth-home__trial-chip ${active ? "is-active" : ""}`}
                type="button"
                role="option"
                aria-selected=${active ? "true" : "false"}
                ?disabled=${props.busy}
                @click=${() => props.onUseCaseChange(toggleTrialUseCase(props.useCase, option))}
              >
                ${option}
              </button>
            `;
          })}
        </div>
        <div class="auth-home__trial-multiselect-hint">
          ${trialText(
            props.currentLocale,
            "authHome.trialApply.useCaseMultiSelectHint",
            "useCaseMultiSelectHint",
          )}
        </div>
      </div>
    </details>
  `;
}

function renderTrialApplyForm(props: AuthHomeProps) {
  if (props.trialStep === 1) {
    return html`
      <div class="auth-home__trial-panel auth-home__trial-panel--page">
        ${renderTrialApplyStepper(props)}
        <div class="trial-apply-page__compact-stack">
          ${renderTrialCompactField({
            label: t("authHome.trialApply.fields.companyName"),
            value: props.tenantName,
            placeholder: t("authHome.trialApply.placeholders.companyName"),
            disabled: props.busy,
            autocomplete: "organization",
            onInput: props.onTenantNameChange,
          })}
          ${renderTrialCompactField({
            label: t("authHome.trialApply.fields.workEmail"),
            value: props.email,
            type: "email",
            placeholder: t("authHome.trialApply.placeholders.workEmail"),
            autocomplete: "username",
            disabled: props.busy,
            onInput: props.onEmailChange,
          })}
          ${renderTrialCompactSelectField({
            label: t("authHome.trialApply.fields.expectedUsers"),
            value: props.expectedUsers,
            options: [
              {
                value: "",
                label: t("authHome.trialApply.expectedUsersOptions.placeholder"),
              },
              { value: "5", label: t("authHome.trialApply.expectedUsersOptions.oneToFive") },
              { value: "20", label: t("authHome.trialApply.expectedUsersOptions.sixToTwenty") },
              {
                value: "50",
                label: t("authHome.trialApply.expectedUsersOptions.twentyOneToFifty"),
              },
              { value: "51", label: t("authHome.trialApply.expectedUsersOptions.fiftyPlus") },
            ],
            disabled: props.busy,
            onInput: props.onExpectedUsersChange,
          })}
        </div>
      </div>
    `;
  }
  return html`
    <div class="auth-home__trial-panel auth-home__trial-panel--page">
      ${renderTrialApplyStepper(props)}
      <label class="auth-home__field auth-home__field--row">
        <span>${t("authHome.trialApply.fields.contactName")}</span>
        <input
          .value=${props.displayName}
          type="text"
          placeholder=${t("authHome.trialApply.placeholders.contactName")}
          autocomplete="name"
          ?disabled=${props.busy}
          @input=${(event: Event) =>
            props.onDisplayNameChange((event.target as HTMLInputElement).value)}
        />
      </label>
      <label class="auth-home__field auth-home__field--row">
        <span>${t("authHome.trialApply.fields.useCase")}</span>
        ${renderTrialUseCaseMultiSelect(props)}
      </label>
      <div class="auth-home__trial-row-pair">
        <span>${t("authHome.trialApply.fields.companySize")}</span>
        <select
          .value=${props.companySize}
          ?disabled=${props.busy}
          @change=${(event: Event) =>
            props.onCompanySizeChange((event.target as HTMLSelectElement).value)}
        >
          ${trialCompanySizeOptions().map(
            (option) => html`<option value=${option.value}>${option.label}</option>`,
          )}
        </select>
        <span>${t("authHome.trialApply.fields.industry")}</span>
        <select
          .value=${props.industry}
          ?disabled=${props.busy}
          @change=${(event: Event) =>
            props.onIndustryChange((event.target as HTMLSelectElement).value)}
        >
          ${trialIndustryOptions().map(
            (option) => html`<option value=${option.value}>${option.label}</option>`,
          )}
        </select>
      </div>
      <label class="auth-home__field auth-home__field--row">
        <span>${t("authHome.trialApply.fields.needsDemo")}</span>
        <div class="auth-home__trial-choice-list auth-home__trial-choice-list--inline">
          ${trialNeedsDemoOptions()
            .filter((option) => option.value)
            .map((option) => {
              const selected = props.needsDemo === option.value;
              return html`
                <button
                  class=${`auth-home__trial-choice ${selected ? "is-active" : ""}`}
                  type="button"
                  ?disabled=${props.busy}
                  @click=${() => props.onNeedsDemoChange(option.value)}
                >
                  ${option.label}
                </button>
              `;
            })}
        </div>
      </label>
    </div>
  `;
}

function renderPendingCodes(state: ControlUiPlatformAuthState) {
  const pending = [state.pendingActivation, state.pendingPasswordReset].filter(Boolean);
  if (pending.length === 0) {
    return nothing;
  }
  return html`
    <div style="display:grid; gap:10px; margin-bottom: 14px;">
      ${pending.map(
        (entry) => html`
          <div class="auth-home__callout auth-home__callout--success">
            <div><strong>${t(`overview.platformAuth.pending.${entry!.kind}.title`)}</strong></div>
            ${
              entry?.enterpriseName
                ? html`<div style="margin-top: 6px;">${entry.enterpriseName}</div>`
                : nothing
            }
            <div style="margin-top: 6px;" class="mono">${entry?.code}</div>
            <div style="margin-top: 6px;" class="muted">
              ${t("overview.platformAuth.pending.expiresAt", { time: entry?.expiresAt ?? "" })}
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function extractMfaSecret(otpAuthUrl: string): string | null {
  try {
    const secret = new URL(otpAuthUrl).searchParams.get("secret");
    return secret && secret.trim() ? secret.trim() : null;
  } catch {
    return null;
  }
}

function renderMembershipChoices(props: AuthHomeProps) {
  const choices = props.membershipChoices ?? [];
  if (choices.length < 2) {
    return nothing;
  }
  return html`
    <label class="auth-home__field auth-home__field--row">
      <span>选择企业</span>
      <select
        data-membership-choice="true"
        .value=${props.membershipId ?? ""}
        ?disabled=${props.busy}
        @change=${(event: Event) =>
          props.onMembershipIdChange?.((event.target as HTMLSelectElement).value)}
      >
        <option value="">请选择要进入的企业</option>
        ${choices.map(
          (choice) => html`<option value=${choice.membershipId}>${choice.enterpriseName}</option>`,
        )}
      </select>
    </label>
  `;
}

function renderMfaSection(props: AuthHomeProps) {
  const stage = props.mfaStage ?? "none";
  if (stage === "none") {
    return nothing;
  }
  const enrollment = props.mfaEnrollment ?? null;
  const otpField = renderField({
    label: t("authHome.form.mfaCode"),
    value: props.mfaCode ?? "",
    placeholder: "123456",
    disabled: props.busy,
    autocomplete: "one-time-code",
    onInput: (value) => props.onMfaCodeChange?.(value),
  });
  if (stage === "code") {
    return html`
      <div class="auth-home__mfa">
        <p class="auth-home__mfa-hint">${t("authHome.mfa.codeHint")}</p>
        ${otpField}
      </div>
    `;
  }
  // stage === "enroll"
  const secret = enrollment ? extractMfaSecret(enrollment.otpAuthUrl) : null;
  const copyText = (value: string) => {
    void navigator.clipboard?.writeText(value).catch(() => undefined);
  };
  return html`
    <div class="auth-home__mfa auth-home__mfa--enroll">
      <p class="auth-home__mfa-hint">${t("authHome.mfa.enrollHint")}</p>
      ${
        enrollment
          ? html`
              <ol class="auth-home__mfa-steps">
                <li>${t("authHome.mfa.step1")}</li>
                <li>${t("authHome.mfa.step2")}</li>
                <li>${t("authHome.mfa.step3")}</li>
              </ol>
              ${
                secret
                  ? html`
                      <div class="auth-home__mfa-secret">
                        <span class="auth-home__mfa-label">${t("authHome.mfa.secretLabel")}</span>
                        <div class="auth-home__mfa-secret-row">
                          <code class="auth-home__mfa-secret-value">${secret}</code>
                          <button
                            class="auth-home__mfa-copy"
                            type="button"
                            @click=${() => copyText(secret)}
                          >
                            ${t("authHome.mfa.copy")}
                          </button>
                        </div>
                      </div>
                    `
                  : nothing
              }
              <div class="auth-home__mfa-recovery">
                <span class="auth-home__mfa-label">${t("authHome.mfa.recoveryLabel")}</span>
                <ul class="auth-home__mfa-recovery-list">
                  ${enrollment.recoveryCodes.map((code) => html`<li><code>${code}</code></li>`)}
                </ul>
              </div>
              <details class="auth-home__mfa-otpauth">
                <summary class="auth-home__mfa-label">${t("authHome.mfa.otpAuthLabel")}</summary>
                <code class="auth-home__mfa-otpauth-uri">${enrollment.otpAuthUrl}</code>
              </details>
            `
          : nothing
      }
      ${otpField}
    </div>
  `;
}

const AUTH_ERROR_URL_PATTERN = /https:\/\/[^\s，。,]+/g;

function renderAuthErrorMessage(error: string) {
  const parts: unknown[] = [];
  let last = 0;
  for (const match of error.matchAll(AUTH_ERROR_URL_PATTERN)) {
    const url = match[0];
    const index = match.index ?? 0;
    if (index > last) {
      parts.push(error.slice(last, index));
    }
    parts.push(
      isSafeOpenBotLoginHref(url)
        ? html`<a class="auth-home__error-link" href=${url} rel="noopener noreferrer">${url}</a>`
        : url,
    );
    last = index + url.length;
  }
  if (last < error.length) {
    parts.push(error.slice(last));
  }
  return parts.length > 0 ? parts : error;
}

function renderAuthFormCallouts(props: AuthHomeProps) {
  const mfaChallenge = props.mfaStage === "code" || props.mfaStage === "enroll";
  return html`
    ${
      props.notice
        ? html`<div
            class=${`auth-home__callout ${mfaChallenge ? "auth-home__callout--info" : "auth-home__callout--success"}`}
            data-testid=${mfaChallenge ? "auth-home-mfa-notice" : "auth-home-notice"}
            role="status"
          >
            ${props.notice}
          </div>`
        : nothing
    }
    ${
      props.error
        ? html`<div
            class="auth-home__callout auth-home__callout--danger"
            data-testid="auth-home-error"
            role="alert"
          >
            ${renderAuthErrorMessage(props.error)}
          </div>`
        : nothing
    }
  `;
}

function renderModeFields(props: AuthHomeProps, mode: ControlUiPlatformAuthMode) {
  switch (mode) {
    case "platform-bootstrap":
      return html`
        ${renderField({
          label: t("overview.platformAuth.fields.displayName"),
          value: props.displayName,
          disabled: props.busy,
          autocomplete: "name",
          onInput: props.onDisplayNameChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.email"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.password"),
          value: props.password,
          type: "password",
          autocomplete: "new-password",
          disabled: props.busy,
          onInput: props.onPasswordChange,
        })}
      `;
    case "enterprise-create":
      return renderTrialApplyForm(props);
    case "employee-register":
      return html`
        ${renderField({
          label: t("authHome.form.displayName"),
          value: props.displayName,
          disabled: props.busy,
          autocomplete: "name",
          onInput: props.onDisplayNameChange,
        })}
        ${renderField({
          label: t("authHome.form.registerEmail"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("authHome.form.inviteCode"),
          value: props.inviteCode,
          disabled: props.busy,
          onInput: props.onInviteCodeChange,
        })}
        ${renderField({
          label: t("authHome.form.password"),
          value: props.password,
          type: "password",
          placeholder: t("authHome.form.passwordPlaceholder"),
          autocomplete: "new-password",
          disabled: props.busy,
          onInput: props.onPasswordChange,
        })}
      `;
    case "enterprise-activate":
      return html`
        ${renderField({
          label: t("authHome.form.displayName"),
          value: props.displayName,
          placeholder: t("authHome.form.displayNamePlaceholder"),
          disabled: props.busy,
          autocomplete: "name",
          onInput: props.onDisplayNameChange,
        })}
        ${renderField({
          label: t("authHome.form.registerEmail"),
          value: props.email,
          type: "email",
          placeholder: "name@company.com",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("authHome.form.password"),
          value: props.password,
          type: "password",
          placeholder: t("authHome.form.passwordPlaceholder"),
          autocomplete: "new-password",
          disabled: props.busy,
          onInput: props.onPasswordChange,
        })}
        ${renderField({
          label: t("authHome.form.inviteCode"),
          value: props.inviteCode,
          placeholder: t("authHome.form.inviteCodePlaceholder"),
          disabled: props.busy,
          onInput: props.onInviteCodeChange,
        })}
      `;
    case "login":
    case "platform-super-admin-login":
    case "platform-admin-login":
      return html`
        ${renderField({
          label: t("authHome.form.loginEmail"),
          value: props.email,
          type: "email",
          placeholder: "name@company.com",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("authHome.form.password"),
          value: props.password,
          type: "password",
          placeholder: t("authHome.form.passwordPlaceholder"),
          autocomplete: "current-password",
          disabled: props.busy,
          onInput: props.onPasswordChange,
        })}
        ${renderMembershipChoices(props)}
        ${
          mode === "platform-super-admin-login" || mode === "platform-admin-login"
            ? renderMfaSection(props)
            : nothing
        }
      `;
    case "forgot-password":
      return html`
        ${renderField({
          label: t("overview.platformAuth.email"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
      `;
    case "password-reset":
      return html`
        ${renderField({
          label: t("overview.platformAuth.email"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.code"),
          value: props.inviteCode,
          disabled: props.busy,
          onInput: props.onInviteCodeChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.newPassword"),
          value: props.password,
          type: "password",
          autocomplete: "new-password",
          disabled: props.busy,
          onInput: props.onPasswordChange,
        })}
      `;
    default:
      return nothing;
  }
}

function isSubmitDisabled(props: AuthHomeProps, mode: ControlUiPlatformAuthMode): boolean {
  if (props.busy) {
    return true;
  }
  switch (mode) {
    case "platform-bootstrap":
      return !props.displayName.trim() || !props.email.trim() || !props.password.trim();
    case "enterprise-create":
      return (
        !props.tenantName.trim() ||
        !props.email.trim() ||
        !props.expectedUsers.trim() ||
        (props.trialStep === 2 && (!props.displayName.trim() || !props.useCase.trim()))
      );
    case "employee-register":
      return (
        !props.displayName.trim() ||
        !props.email.trim() ||
        !props.inviteCode.trim() ||
        !props.password.trim()
      );
    case "enterprise-activate":
      return !props.email.trim() || !props.inviteCode.trim() || !props.password.trim();
    case "login":
      return !props.email.trim() || !props.password.trim();
    case "platform-super-admin-login":
    case "platform-admin-login": {
      const mfaPending = props.mfaStage === "code" || props.mfaStage === "enroll";
      return (
        !props.email.trim() ||
        !props.password.trim() ||
        (mfaPending && !(props.mfaCode ?? "").trim())
      );
    }
    case "forgot-password":
      return !props.email.trim();
    case "password-reset":
      return !props.email.trim() || !props.inviteCode.trim() || !props.password.trim();
    default:
      return true;
  }
}

function fallbackPublicModes(
  state: ControlUiPlatformAuthState,
  currentMode: ControlUiPlatformAuthMode | "enterpriseLogin" | "platformLogin",
) {
  if (state.canManagePlatform) {
    return ["platform-enterprise-create"] as ControlUiPlatformAuthMode[];
  }
  if (state.requiresPlatformBootstrap) {
    return ["platform-bootstrap"] as ControlUiPlatformAuthMode[];
  }
  if (state.session) {
    return [currentMode] as ControlUiPlatformAuthMode[];
  }
  return [
    "platform-super-admin-login",
    "platform-admin-login",
    "enterprise-create",
    "employee-register",
    "enterprise-activate",
    "login",
    "forgot-password",
    "password-reset",
  ] as ControlUiPlatformAuthMode[];
}

function resolvePublicAuthHomeMode(
  requestedMode: ControlUiPlatformAuthMode | "enterpriseLogin" | "platformLogin",
  state: ControlUiPlatformAuthState,
  inviteCode: string,
): ControlUiPlatformAuthMode {
  const linkPrefill = readAuthLinkPrefill();
  const effectiveInviteCode = inviteCode.trim() || linkPrefill.inviteCode;
  if (linkPrefill.authMode === "password-reset" || requestedMode === "password-reset") {
    return "password-reset";
  }
  if (linkPrefill.authMode === "forgot-password" || requestedMode === "forgot-password") {
    return "forgot-password";
  }
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("seatOffer")?.trim()) {
      return "login";
    }
  }
  if (linkPrefill.authMode === "enterprise-activate" && effectiveInviteCode) {
    return "enterprise-activate";
  }
  if (linkPrefill.authMode === "employee-register") {
    return "employee-register";
  }
  if (requestedMode === "enterpriseLogin") {
    return "login";
  }
  if (requestedMode === "platformLogin") {
    return "platform-admin-login";
  }
  if (requestedMode === "platform-admin-login" || requestedMode === "platform-super-admin-login") {
    return "login";
  }
  if (requestedMode === "enterprise-activate" && !state.pendingActivation && !effectiveInviteCode) {
    return "employee-register";
  }
  if (requestedMode === "enterprise-create") {
    return "enterprise-create";
  }
  if (requestedMode === "enterprise-activate" && (state.pendingActivation || effectiveInviteCode)) {
    return "enterprise-activate";
  }
  if (!isPublicAuthHomeMode(requestedMode)) {
    return "login";
  }
  return requestedMode;
}

function visibleAuthModes(activeMode: ControlUiPlatformAuthMode): ControlUiPlatformAuthMode[] {
  if (activeMode === "enterprise-create" || activeMode === "enterprise-activate") {
    return [];
  }
  if (activeMode === "platform-admin-login" || activeMode === "platform-super-admin-login") {
    return ["platform-super-admin-login", "platform-admin-login"];
  }
  if (activeMode === "forgot-password" || activeMode === "password-reset") {
    return ["employee-register", "login", activeMode];
  }
  return ["employee-register", "login"];
}

function resolveEntryVariant(
  props: AuthHomeProps,
  activeMode: ControlUiPlatformAuthMode | "enterpriseLogin" | "platformLogin",
): "public" | "enterprise" | "platform" {
  if (props.entryVariant) {
    return props.entryVariant;
  }
  if (props.mode === "platformLogin") {
    return "platform";
  }
  if (props.mode === "enterpriseLogin") {
    return "enterprise";
  }
  if (activeMode === "platform-admin-login" || activeMode === "platform-super-admin-login") {
    return "platform";
  }
  if (activeMode === "enterprise-activate") {
    return "enterprise";
  }
  return "public";
}

function readAuthLinkPrefill() {
  if (typeof window === "undefined") {
    return {
      authMode: "",
      email: "",
      displayName: "",
      inviteCode: "",
      adminInviteCode: "",
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    authMode:
      readPasswordResetAuthMode(window.location.search) || params.get("authMode")?.trim() || "",
    email: params.get("email")?.trim() ?? "",
    displayName: params.get("name")?.trim() ?? "",
    inviteCode: params.get("code")?.trim() ?? "",
    // Enterprise co-admin invite (「邀请管理员」email): sign in with the existing
    // employee password; the login accepts the invite.
    adminInviteCode: params.get("adminInvite")?.trim() ?? "",
  };
}

function renderAuxiliaryActions(props: AuthHomeProps, mode: ControlUiPlatformAuthMode) {
  if (mode === "enterprise-create" && props.trialStep === 1) {
    return nothing;
  }
  if (mode === "enterprise-create" && props.trialStep === 2) {
    return html`
      <div class="auth-home__trial-actions">
        <button
          class="auth-home__secondary-action"
          type="button"
          ?disabled=${props.busy}
          @click=${() => props.onTrialStepChange(1)}
        >
          ${trialText(props.currentLocale, "authHome.trialApply.backStep", "backStep")}
        </button>
        <div class="auth-home__trial-terms">
          ${renderTrialPrivacyTerms(props.basePath ?? "")}
        </div>
      </div>
    `;
  }
  if (mode === "employee-register") {
    return html`
      <div class="auth-home__auth-links">
        <span>${t("authHome.authLinks.hasAccount")}</span>
        <button
          class="auth-home__text-button"
          type="button"
          ?disabled=${props.busy}
          @click=${() => props.onModeChange("login")}
        >
          ${t("authHome.authLinks.goLogin")}
        </button>
      </div>
    `;
  }
  if (
    mode === "login" ||
    mode === "platform-super-admin-login" ||
    mode === "platform-admin-login"
  ) {
    return html`
      <div class="auth-home__auth-links">
        <button
          class="auth-home__text-button"
          type="button"
          ?disabled=${props.busy}
          @click=${() => props.onModeChange("forgot-password")}
        >
          ${t("authHome.authLinks.forgotPassword")}
        </button>
        <span class="auth-home__link-divider" aria-hidden="true">|</span>
        <button
          class="auth-home__text-button"
          type="button"
          ?disabled=${props.busy}
          @click=${() => props.onForgotAccountHelp()}
        >
          ${t("authHome.authLinks.forgotAccount")}
        </button>
      </div>
    `;
  }
  if (mode === "forgot-password") {
    return html`
      <div class="auth-home__auth-links">
        <button
          class="auth-home__text-button"
          type="button"
          ?disabled=${props.busy}
          @click=${() => props.onModeChange("login")}
        >
          ${t("authHome.authLinks.backToLogin")}
        </button>
      </div>
    `;
  }
  return nothing;
}

function renderNavGroup(params: {
  title: string;
  items: Array<{ label: string; href: string; download?: boolean }>;
}) {
  return html`
    <div class="auth-home__nav-group">
      <button class="auth-home__nav-trigger" type="button" aria-haspopup="true">
        ${params.title}
      </button>
      <div class="auth-home__nav-menu" role="menu">
        ${params.items.map((item) => {
          if (item.download) {
            // File downloads must use native navigation (not SPA history).
            return html`<a href=${item.href} role="menuitem" download>${item.label}</a>`;
          }
          return html`<a
            href=${item.href}
            role="menuitem"
            @click=${(event: MouseEvent) => {
              // Route entries (non-anchor hrefs) navigate via SPA history; in-page
              // anchors (e.g. "#features") keep native scroll behavior.
              if (!item.href.startsWith("#")) {
                navigateToRoute(event, item.href);
              }
            }}
            >${item.label}</a
          >`;
        })}
      </div>
    </div>
  `;
}

function renderTrialPrivacyTerms(basePath: string) {
  const privacyHref = pathForTab("privacy", basePath);
  return html`
    ${t("authHome.trialApply.termsBefore")}
    <a
      class="auth-home__inline-link"
      href=${privacyHref}
      @click=${(event: MouseEvent) => navigateToRoute(event, privacyHref)}
      >${t("authHome.trialApply.privacyLinkLabel")}</a
    >
    ${t("authHome.trialApply.termsAfter")}
  `;
}

function resolvePublicSitePaths(basePath = "") {
  const host = typeof window === "undefined" ? "" : window.location.host;
  const homeHref = resolveEmployeePublicHomeHref(host, basePath);
  const enterpriseLoginHref = resolvePortScopedLoginHref("enterprise", "enterpriseLogin", basePath);
  const featuresHref = pathForTab("features", basePath);
  const pricingHref = pathForTab("pricing", basePath);
  const skillMcpHref = pathForTab("skillMcp", basePath);
  const partnerEcosystemHref = pathForTab("partnerEcosystem", basePath);
  const privacyHref = pathForTab("privacy", basePath);
  const helpHref = pathForTab("help", basePath);
  return {
    homeHref,
    enterpriseLoginHref,
    featuresHref,
    pricingHref,
    skillMcpHref,
    partnerEcosystemHref,
    privacyHref,
    helpHref,
  };
}

/**
 * On OpenBot production hosts, login nav links jump straight to the canonical
 * port subdomain (biz / admin) instead of staying on www or the wrong console.
 */
function resolvePortScopedLoginHref(
  port: FrontendPort,
  tab: "enterpriseLogin" | "platformLogin",
  basePath = "",
): string {
  const path = pathForTab(tab, basePath);
  if (typeof window === "undefined") {
    return path;
  }
  const resolution = resolvePortFromSubdomain(window.location.host);
  if (!resolution.isOpenBotDomain) {
    return path;
  }
  const protocol = window.location.protocol === "http:" ? "http" : "https";
  return `${originForPort(port, protocol)}${path}`;
}

function renderPublicSiteHeader(params: {
  logoSrc: string;
  brandHref: string;
  homeHref: string;
  enterpriseLoginHref: string;
  featuresHref: string;
  pricingHref: string;
  skillMcpHref: string;
  partnerEcosystemHref: string;
  privacyHref: string;
  helpHref: string;
  currentLocale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  return html`
    <header class="auth-home__header">
      <a class="auth-home__brand" href=${params.brandHref} aria-label="OpenBot">
        <img class="auth-home__brand-logo" src=${params.logoSrc} alt="OpenBot" />
      </a>
      <div class="auth-home__header-actions">
        <nav class="auth-home__nav" aria-label="OpenBot">
          <a
            class="auth-home__nav-entry"
            href=${params.homeHref}
            @click=${(event: MouseEvent) => navigateToRoute(event, params.homeHref)}
          >
            ${t("authHome.nav.enterpriseCreate")}
          </a>
          <a
            class="auth-home__nav-entry"
            href=${params.enterpriseLoginHref}
            @click=${(event: MouseEvent) => navigateToRoute(event, params.enterpriseLoginHref)}
          >
            ${t("authHome.nav.enterpriseLogin")}
          </a>
          ${renderNavGroup({
            title: t("authHome.nav.product.title"),
            items: [
              { label: t("authHome.nav.product.features"), href: params.featuresHref },
              { label: t("authHome.nav.product.pricing"), href: params.pricingHref },
              {
                label: t("authHome.nav.product.downloadMac"),
                href: MAC_APP_DOWNLOAD_HREF,
                download: true,
              },
            ],
          })}
          ${renderNavGroup({
            title: t("authHome.nav.resources.title"),
            items: [
              { label: t("authHome.nav.resources.skillMcp"), href: params.skillMcpHref },
              {
                label: t("authHome.nav.resources.partnerEcosystem"),
                href: params.partnerEcosystemHref,
              },
            ],
          })}
          ${renderNavGroup({
            title: t("authHome.nav.legal.title"),
            items: [
              { label: t("authHome.nav.legal.privacySecurity"), href: params.privacyHref },
              { label: t("authHome.nav.legal.help"), href: params.helpHref },
            ],
          })}
        </nav>
        <button
          class="auth-home__ghost-button"
          type="button"
          @click=${() => params.onLocaleChange(nextLocale(params.currentLocale))}
          aria-label=${t("common.language")}
          title=${t("common.language")}
        >
          ${localeBadge(params.currentLocale)}
        </button>
      </div>
    </header>
  `;
}

function renderPublicSiteFooter() {
  // 隐私/帮助已在顶部导航「法律」下拉中，底部不再重复入口
  return html`
    <footer class="auth-home__footer" id="footer">
      <div class="auth-home__footer-meta">${t("authHome.footer.copyright")}</div>
    </footer>
  `;
}

const authHomeFeatureIcons = {
  askAutomate: html`
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5v3.5" />
      <path d="M12 17v3.5" />
      <path d="M4.5 12H8" />
      <path d="M16 12h3.5" />
      <path d="m6.9 6.9 2.5 2.5" />
      <path d="m14.6 14.6 2.5 2.5" />
      <path d="m17.1 6.9-2.5 2.5" />
      <path d="m9.4 14.6-2.5 2.5" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  `,
  knowledgeBase: html`
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5h8.5a3.5 3.5 0 0 1 3.5 3.5v11H9a3 3 0 0 0-3 3V7.5a3 3 0 0 1 3-3Z" />
      <path d="M9 4.5v14.5" />
      <path d="M12 9h4.5" />
      <path d="M12 12.5h4.5" />
    </svg>
  `,
  collaborateAi: html`
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="9" r="2.5" />
      <circle cx="15.5" cy="8" r="2.25" />
      <path d="M4.75 18a4.25 4.25 0 0 1 8.5 0" />
      <path d="M13.5 17.5a3.5 3.5 0 0 1 6.75-1.25" />
      <path d="M12.25 10.75 14 12.5l3-3.25" />
    </svg>
  `,
};

function renderFeature(params: {
  icon: unknown;
  iconClass: string;
  title: string;
  description: string;
}) {
  return html`
    <article class="auth-home__feature-card">
      <div class="auth-home__feature-head">
        <span class=${`auth-home__icon-chip ${params.iconClass}`}>${params.icon}</span>
        <h3>${params.title}</h3>
      </div>
      <p>${params.description}</p>
    </article>
  `;
}

export function renderTrialApplyPage(props: AuthHomeProps) {
  const logoSrc = props.brandLogoSrc || resolveBundledBrandWordmarkSrc(props.basePath ?? "");
  const homeHref = resolveEmployeePublicHomeHref(
    typeof window === "undefined" ? "" : window.location.host,
    props.basePath ?? "",
  );
  const screenshotSrc = props.basePath
    ? `${props.basePath}/trial-apply-product-ui.jpg`
    : "/trial-apply-product-ui.jpg";
  const showSuccess = props.mode === "enterprise-activate" && Boolean(props.notice) && !props.error;

  return html`
    <main class="trial-apply-page">
      <div class="trial-apply-page__backdrop"></div>
      <header class="trial-apply-page__header">
        <a
          class="trial-apply-page__brand"
          href=${homeHref}
          aria-label="OpenBot"
          @click=${(event: MouseEvent) => navigateToRoute(event, homeHref)}
        >
          <img class="trial-apply-page__brand-logo" src=${logoSrc} alt="OpenBot" />
        </a>
        <a
          class="trial-apply-page__back"
          href=${homeHref}
          @click=${(event: MouseEvent) => navigateToRoute(event, homeHref)}
        >
          ${trialText(props.currentLocale, "authHome.trialApply.backHome", "backHome")}
        </a>
      </header>

      <section class="trial-apply-page__shell">
        <div class="trial-apply-page__copy">
          ${renderTrialApplyVisual(props.currentLocale, screenshotSrc)}
        </div>

        <section class="trial-apply-page__card">
          ${
            showSuccess
              ? html`
                  <div class="trial-apply-page__result">
                    <div class="trial-apply-page__result-badge">
                      ${trialText(props.currentLocale, "authHome.trialApply.badge", "badge")}
                    </div>
                    <h2>
                      ${trialText(
                        props.currentLocale,
                        "authHome.trialApply.successTitle",
                        "successTitle",
                      )}
                    </h2>
                    <p>${props.notice}</p>
                    <div class="trial-apply-page__result-actions">
                      ${(() => {
                        const enterpriseLoginHref = resolvePortScopedLoginHref(
                          "enterprise",
                          "enterpriseLogin",
                          props.basePath ?? "",
                        );
                        return html`
                      <a
                        class="auth-home__secondary-link auth-home__secondary-link--large"
                        href=${enterpriseLoginHref}
                        @click=${(event: MouseEvent) => navigateToRoute(event, enterpriseLoginHref)}
                      >
                        ${trialText(props.currentLocale, "authHome.trialApply.backHome", "backHome")}
                      </a>
                      <a
                        class="auth-home__primary-button auth-home__primary-button--large"
                        href=${enterpriseLoginHref}
                        @click=${(event: MouseEvent) => {
                          props.onModeChange("login");
                          navigateToRoute(event, enterpriseLoginHref);
                        }}
                      >
                        ${trialText(props.currentLocale, "authHome.trialApply.goLogin", "goLogin")}
                      </a>
                        `;
                      })()}
                    </div>
                  </div>
                `
              : html`
                  <form
                    class="trial-apply-page__form"
                    @submit=${(event: Event) => {
                      event.preventDefault();
                      if (isSubmitDisabled(props, "enterprise-create")) {
                        return;
                      }
                      if (props.trialStep === 1) {
                        props.onTrialStepChange(2);
                        return;
                      }
                      props.onSubmit("enterprise-create");
                    }}
                  >
                    ${renderTrialApplyForm(props)}
                    ${
                      props.error
                        ? html`<div class="auth-home__callout auth-home__callout--danger" role="alert">
                            ${renderAuthErrorMessage(props.error)}
                          </div>`
                        : nothing
                    }
                    ${
                      props.notice
                        ? html`<div class="auth-home__callout auth-home__callout--success">${props.notice}</div>`
                        : nothing
                    }
                    <button
                      class="auth-home__submit"
                      type="submit"
                      ?disabled=${isSubmitDisabled(props, "enterprise-create")}
                    >
                      ${submitLabel("enterprise-create", props.busy, props.trialStep, props.currentLocale)}
                    </button>
                    ${renderAuxiliaryActions(props, "enterprise-create")}
                  </form>
                `
          }
        </section>
      </section>
    </main>
  `;
}

export function renderAuthHome(props: AuthHomeProps) {
  const logoSrc = props.brandLogoSrc || resolveBundledBrandWordmarkSrc(props.basePath ?? "");
  const trialApplyHref = pathForTab("trialApply", props.basePath ?? "");
  const platformLoginHref = resolvePortScopedLoginHref(
    "platform",
    "platformLogin",
    props.basePath ?? "",
  );
  const {
    homeHref,
    enterpriseLoginHref,
    featuresHref,
    pricingHref,
    skillMcpHref,
    partnerEcosystemHref,
    privacyHref,
    helpHref,
  } = resolvePublicSitePaths(props.basePath ?? "");
  const state = props.state;
  if (!state?.enabled) {
    const entryVariant = resolveEntryVariant(props, props.mode);
    const title =
      entryVariant === "platform"
        ? "平台登录尚未启用"
        : entryVariant === "enterprise"
          ? "企业登录尚未启用"
          : "认证入口尚未启用";
    const subtitle =
      entryVariant === "platform"
        ? "当前环境还没有启用平台管理员认证。请先完成平台认证配置，再通过独立平台登录页进入控制台。"
        : entryVariant === "enterprise"
          ? "当前环境还没有启用企业管理员认证。请先完成平台认证配置，或先回到首页继续试用申请与员工入口。"
          : "当前环境还没有启用统一认证入口。";
    return html`
      <main class="auth-home">
        <div class="auth-home__backdrop"></div>
        <div class="auth-home__grid"></div>
        <div class="auth-home__spark auth-home__spark--one"></div>
        <div class="auth-home__spark auth-home__spark--two"></div>
        <div class="auth-home__spark auth-home__spark--three"></div>

        <header class="auth-home__header">
          <a class="auth-home__brand" href="#top" aria-label="OpenBot">
            <img class="auth-home__brand-logo" src=${logoSrc} alt="OpenBot" />
          </a>
          <div class="auth-home__header-actions">
            <nav class="auth-home__nav" aria-label="OpenBot">
              <a class="auth-home__nav-entry" href=${homeHref} @click=${(event: MouseEvent) => navigateToRoute(event, homeHref)}>
                ${t("authHome.nav.enterpriseCreate")}
              </a>
              <a class="auth-home__nav-entry" href=${enterpriseLoginHref} @click=${(event: MouseEvent) => navigateToRoute(event, enterpriseLoginHref)}>
                ${t("authHome.nav.enterpriseLogin")}
              </a>
              <a class="auth-home__nav-entry" href=${platformLoginHref} @click=${(event: MouseEvent) => navigateToRoute(event, platformLoginHref)}>
                ${t("authHome.nav.platformLogin")}
              </a>
            </nav>
          </div>
        </header>

        <div class="auth-home__main">
          <section class="auth-home__hero" id="top">
            <div class="auth-home__hero-copy">
              <div class="auth-home__eyebrow">
                ${entryVariant === "platform" ? "Platform Console" : "Enterprise Console"}
              </div>
              <h1>${title}</h1>
              <p>${subtitle}</p>
              <div class="auth-home__hero-points">
                <span>独立登录入口</span>
                <span>显式未启用态</span>
                <span>避免空白页</span>
              </div>
              <div class="auth-home__hero-actions">
                <a class="auth-home__secondary-link auth-home__secondary-link--large" href=${homeHref} @click=${(event: MouseEvent) => navigateToRoute(event, homeHref)}>
                  返回首页
                </a>
                <a class="auth-home__primary-button auth-home__primary-button--large" href=${trialApplyHref} @click=${(event: MouseEvent) => navigateToRoute(event, trialApplyHref)}>
                  申请企业试用
                </a>
              </div>
            </div>

            <aside class="auth-home__auth-card" id="auth">
              <div class="auth-home__callout auth-home__callout--danger">
                ${
                  entryVariant === "platform"
                    ? "平台管理员认证尚未启用。请先完成平台认证配置后，再使用该页面登录。"
                    : "企业管理员认证尚未启用。请先完成平台认证配置，或先返回首页继续试用申请。"
                }
              </div>
              <div class="auth-home__auth-links">
                <a class="auth-home__text-button" href=${homeHref} @click=${(event: MouseEvent) => navigateToRoute(event, homeHref)}>
                  返回首页
                </a>
                <span class="auth-home__link-divider" aria-hidden="true">|</span>
                <a class="auth-home__text-button" href=${trialApplyHref} @click=${(event: MouseEvent) => navigateToRoute(event, trialApplyHref)}>
                  申请企业试用
                </a>
              </div>
            </aside>
          </section>
        </div>
      </main>
    `;
  }

  const authLinkPrefill = readAuthLinkPrefill();
  const requestedMode = resolvePublicAuthHomeMode(props.mode, state, props.inviteCode);
  const forcedEntryMode = (() => {
    if (requestedMode === "password-reset" || requestedMode === "forgot-password") {
      return requestedMode;
    }
    if (props.entryVariant === "platform" || props.mode === "platformLogin") {
      return state.requiresPlatformBootstrap ? "platform-bootstrap" : "platform-admin-login";
    }
    if (props.entryVariant === "enterprise" || props.mode === "enterpriseLogin") {
      const hasActivationCode =
        Boolean(state.pendingActivation) ||
        Boolean(props.inviteCode.trim()) ||
        Boolean(authLinkPrefill.inviteCode) ||
        authLinkPrefill.authMode === "enterprise-activate";
      return hasActivationCode ? "enterprise-activate" : "login";
    }
    return null;
  })();

  const availableModes = state.session
    ? state.availableModes && state.availableModes.length > 0
      ? state.availableModes
      : fallbackPublicModes(state, props.mode)
    : Array.from(
        new Set<ControlUiPlatformAuthMode>([
          ...(state.availableModes && state.availableModes.length > 0
            ? state.availableModes
            : fallbackPublicModes(state, props.mode)
          ).filter(isPublicAuthHomeMode),
          ...PUBLIC_AUTH_HOME_BASE_MODES,
        ]),
      );
  const initialActiveMode =
    forcedEntryMode ?? (availableModes.includes(requestedMode) ? requestedMode : availableModes[0]);
  const initialEntryVariant = resolveEntryVariant(props, initialActiveMode);
  const activeMode = (() => {
    if (forcedEntryMode) {
      return forcedEntryMode;
    }
    // Enterprise / platform login pages must never show the employee-register
    // mode. If the incoming requested mode resolves to employee-register but the
    // page variant is enterprise or platform, fall back to the route-appropriate
    // login mode so the tab strip and form match the design.
    if (initialEntryVariant !== "public" && initialActiveMode === "employee-register") {
      return initialEntryVariant === "platform" ? "platform-admin-login" : "login";
    }
    return initialActiveMode;
  })();
  const entryVariant = resolveEntryVariant(props, activeMode);
  const continueHref = props.continueHref?.trim() ?? "";
  const continueLabel =
    props.continueLabel?.trim() ||
    (entryVariant === "platform" ? "进入平台控制台" : "进入企业工作台");
  const recoveryMode = activeMode === "forgot-password" || activeMode === "password-reset";
  const visibleModes =
    entryVariant === "enterprise"
      ? activeMode === "enterprise-activate" || recoveryMode
        ? ([] as ControlUiPlatformAuthMode[])
        : (["login"] as ControlUiPlatformAuthMode[])
      : entryVariant === "platform"
        ? activeMode === "platform-bootstrap" || recoveryMode
          ? ([] as ControlUiPlatformAuthMode[])
          : (["platform-admin-login"] as ControlUiPlatformAuthMode[])
        : visibleAuthModes(activeMode);
  const adminInvitePending = activeMode === "login" && Boolean(authLinkPrefill.adminInviteCode);
  const effectiveProps =
    activeMode === "employee-register" ||
    activeMode === "enterprise-activate" ||
    activeMode === "password-reset"
      ? {
          ...props,
          email: props.email.trim() ? props.email : authLinkPrefill.email,
          displayName: props.displayName.trim() ? props.displayName : authLinkPrefill.displayName,
          inviteCode: props.inviteCode.trim() ? props.inviteCode : authLinkPrefill.inviteCode,
        }
      : adminInvitePending
        ? { ...props, email: props.email.trim() ? props.email : authLinkPrefill.email }
        : props;

  return html`
    <main class="auth-home">
      <div class="auth-home__backdrop"></div>
      <div class="auth-home__grid"></div>
      <div class="auth-home__spark auth-home__spark--one"></div>
      <div class="auth-home__spark auth-home__spark--two"></div>
      <div class="auth-home__spark auth-home__spark--three"></div>

      ${renderPublicSiteHeader({
        logoSrc,
        brandHref: homeHref.startsWith("https://") ? homeHref : "#top",
        homeHref,
        enterpriseLoginHref,
        featuresHref,
        pricingHref,
        skillMcpHref,
        partnerEcosystemHref,
        privacyHref,
        helpHref,
        currentLocale: props.currentLocale,
        onLocaleChange: props.onLocaleChange,
      })}

      <div class="auth-home__main">
        <section class="auth-home__hero" id="top">
          <div class="auth-home__hero-copy">
            <div class="auth-home__eyebrow">
              ${
                entryVariant === "enterprise"
                  ? "Enterprise Console"
                  : entryVariant === "platform"
                    ? "Platform Console"
                    : t("authHome.eyebrow")
              }
            </div>
            <h1>
              ${
                entryVariant === "enterprise"
                  ? "企业管理员登录"
                  : entryVariant === "platform"
                    ? "平台管理员登录"
                    : t("authHome.hero.title")
              }
            </h1>
            <p>
              ${
                entryVariant === "enterprise"
                  ? "企业试用开通后，请在这里完成管理员激活或登录企业控制台。"
                  : entryVariant === "platform"
                    ? "平台超级管理员和平台管理员通过这里进入平台控制台。"
                    : t("authHome.hero.subtitle")
              }
            </p>
            <div class="auth-home__hero-points">
              ${
                entryVariant === "public"
                  ? html`
                      <span>${t("authHome.hero.pills.assistants")}</span>
                      <span>${t("authHome.hero.pills.knowledge")}</span>
                      <span>${t("authHome.hero.pills.context")}</span>
                    `
                  : entryVariant === "enterprise"
                    ? html`
                        <span>企业管理员</span>
                        <span>企业控制台</span>
                        <span>多管理员治理</span>
                      `
                    : html`
                        <span>平台管理员</span>
                        <span>平台控制台</span>
                        <span>租户治理</span>
                      `
              }
            </div>
            <div class="auth-home__hero-actions">
              ${
                entryVariant === "public"
                  ? html`
                      <a
                        class="auth-home__primary-button auth-home__primary-button--large"
                        href=${MAC_APP_DOWNLOAD_HREF}
                        download
                      >
                        ${t("authHome.hero.downloadMac")}
                      </a>
                      <a
                        class="auth-home__secondary-link auth-home__secondary-link--large"
                        href=${trialApplyHref}
                        @click=${(event: MouseEvent) => navigateToRoute(event, trialApplyHref)}
                      >
                        ${t("authHome.hero.getStarted")}
                      </a>
                      <a
                        class="auth-home__secondary-link auth-home__secondary-link--large"
                        href=${featuresHref}
                        @click=${(event: MouseEvent) => navigateToRoute(event, featuresHref)}
                      >
                        ${t("authHome.hero.viewDemo")}
                      </a>
                    `
                  : nothing
              }
            </div>
          </div>

          <aside class="auth-home__auth-card" id="auth">
            ${
              visibleModes.length > 0
                ? html`
                    <div class="auth-home__mode-switch" role="tablist" aria-label="Auth mode">
                      ${visibleModes.map((mode) => {
                        const label =
                          entryVariant === "enterprise" && mode === "login"
                            ? "企业管理员"
                            : entryVariant === "platform" && mode === "platform-admin-login"
                              ? "平台管理员"
                              : authTabLabel(mode);
                        return html`
                          <button
                            class=${`auth-home__mode-button ${mode === activeMode ? "is-active" : ""}`}
                            type="button"
                            ?disabled=${props.busy}
                            @click=${() => props.onModeChange(mode)}
                          >
                            ${label}
                          </button>
                        `;
                      })}
                    </div>
                  `
                : nothing
            }
            ${
              activeMode === "forgot-password" ||
              activeMode === "password-reset" ||
              activeMode === "platform-enterprise-create" ||
              activeMode === "platform-bootstrap"
                ? html`
                    <div style="margin-top: 16px;">
                      <div class="card-title">${modeTitle(activeMode)}</div>
                      <div class="card-sub">${modeSubtitle(activeMode)}</div>
                    </div>
                  `
                : nothing
            }

            ${
              continueHref
                ? html`<a
                    class="auth-home__primary-button"
                    data-testid="confirmed-login-continue"
                    href=${continueHref}
                    @click=${(event: MouseEvent) => navigateToRoute(event, continueHref)}
                  >
                    ${continueLabel}
                  </a>`
                : html`<form
              class=${`auth-home__form ${activeMode === "login" ? "auth-home__form--login" : ""}`}
              @submit=${(event: Event) => {
                event.preventDefault();
                if (isSubmitDisabled(effectiveProps, activeMode)) {
                  return;
                }
                if (activeMode === "enterprise-create" && effectiveProps.trialStep === 1) {
                  props.onTrialStepChange(2);
                  return;
                }
                if (adminInvitePending && !props.email.trim() && effectiveProps.email.trim()) {
                  props.onEmailChange(effectiveProps.email);
                }
                if (activeMode === "employee-register" || activeMode === "enterprise-activate") {
                  if (!props.displayName.trim() && effectiveProps.displayName.trim()) {
                    props.onDisplayNameChange(effectiveProps.displayName);
                  }
                  if (!props.email.trim() && effectiveProps.email.trim()) {
                    props.onEmailChange(effectiveProps.email);
                  }
                  if (!props.inviteCode.trim() && effectiveProps.inviteCode.trim()) {
                    props.onInviteCodeChange(effectiveProps.inviteCode);
                  }
                }
                props.onSubmit(activeMode);
              }}
            >
              ${renderPendingCodes(state)}
              ${
                adminInvitePending
                  ? html`
                      <div class="auth-home__callout auth-home__callout--success" data-testid="auth-home-admin-invite">
                        你收到了企业管理员邀请。请使用现有的员工账号和密码登录，接受后该账号将同时拥有员工与企业管理员身份，密码保持不变。
                      </div>
                    `
                  : nothing
              }
              ${renderModeFields(effectiveProps, activeMode)}
              <button
                class="auth-home__submit"
                type="submit"
                ?disabled=${isSubmitDisabled(effectiveProps, activeMode)}
              >
                ${submitLabel(
                  activeMode,
                  effectiveProps.busy,
                  effectiveProps.trialStep,
                  effectiveProps.currentLocale,
                )}
              </button>
              ${renderAuxiliaryActions(effectiveProps, activeMode)}
            </form>`
            }

            ${renderAuthFormCallouts(props)}
          </aside>
        </section>

        <section class="auth-home__section" id="features">
          <div class="auth-home__feature-grid">
            ${renderFeature({
              icon: authHomeFeatureIcons.askAutomate,
              iconClass: "auth-home__icon-chip--sunset",
              title: t("authHome.features.askAutomate.title"),
              description: t("authHome.features.askAutomate.description"),
            })}
            ${renderFeature({
              icon: authHomeFeatureIcons.knowledgeBase,
              iconClass: "auth-home__icon-chip--mint",
              title: t("authHome.features.knowledgeBase.title"),
              description: t("authHome.features.knowledgeBase.description"),
            })}
            ${renderFeature({
              icon: authHomeFeatureIcons.collaborateAi,
              iconClass: "auth-home__icon-chip--peach",
              title: t("authHome.features.collaborateAi.title"),
              description: t("authHome.features.collaborateAi.description"),
            })}
          </div>
        </section>

      </div>

      ${renderPublicSiteFooter()}
    </main>
  `;
}
