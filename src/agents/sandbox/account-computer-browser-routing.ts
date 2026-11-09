/**
 * Account Computer vs public-web routing.
 *
 * Tools (`web_search`, `web_fetch`) cover public HTTP, search, and pages that
 * do not need the user's logged-in session.
 * The `browser` tool covers the user's Account Computer: navigate, click,
 * type, login, and any site that needs that desktop's cookies.
 *
 * The sandbox default deny list includes `browser`. That deny is what makes a
 * ready cloud PC look uncontrollable. Granting the tool here does not enable
 * host browser control. An operator deny (global, agent, group, or an
 * explicit sandbox deny) still wins.
 */
import { isToolAllowed } from "./tool-policy.js";
import type { SandboxToolPolicy, SandboxToolPolicyResolved } from "./types.js";

const BROWSER_TOOL = "browser";
const WEB_FETCH_TOOL = "web_fetch";
const WEB_SEARCH_TOOL = "web_search";

const NEGATED_COMPUTER_RE =
  /(?:不要|别打开|别用|不用|无需|禁止打开|禁止使用|勿|do not|don't|without).{0,12}(?:打开|使用|用)?(?:云端电脑|云电脑|account computer|cloud pc)/iu;
const OPERATE_COMPUTER_RE =
  /打开(?:云端)?电脑|打开云端电脑|云端电脑|云电脑|account computer|cloud pc|在浏览器(?:里|中)?(?:打开|登录)|登录|登入|sign[\s-]?in|log[\s-]?in/iu;
const PUBLIC_FETCH_RE =
  /抓取|爬取|采集|公开(?:网页|页面|首页)|首页标题|web[_ ]?fetch|scrape|fetch (?:the )?(?:public )?(?:page|url|homepage)|public (?:page|homepage|url)/iu;
const PUBLIC_SEARCH_RE = /网上搜|搜一下|搜索一下|web[_ ]?search|search the web/iu;
const URL_RE = /https?:\/\/[^\s)）]+/iu;

export type AccountComputerWebRoute =
  | "public_fetch"
  | "public_search"
  | "account_computer"
  | "unspecified";

/**
 * Split a user turn into public HTTP tools vs the Account Computer browser.
 * Negated cloud-PC phrases ("不要打开云电脑") do not count as a request to
 * operate the desktop. Login and an explicit open still do.
 */
export function resolveAccountComputerWebRoute(text: string): AccountComputerWebRoute {
  const raw = text.trim();
  if (!raw) {
    return "unspecified";
  }
  const withoutNegation = raw.replace(new RegExp(NEGATED_COMPUTER_RE.source, "giu"), " ");
  if (OPERATE_COMPUTER_RE.test(withoutNegation)) {
    return "account_computer";
  }
  const hasUrl = URL_RE.test(raw);
  const wantsPublicPage = PUBLIC_FETCH_RE.test(raw) || (hasUrl && NEGATED_COMPUTER_RE.test(raw));
  if (wantsPublicPage) {
    return hasUrl ? "public_fetch" : "public_search";
  }
  if (PUBLIC_SEARCH_RE.test(raw)) {
    return "public_search";
  }
  return "unspecified";
}

export function accountComputerTurnPrompt(route: AccountComputerWebRoute): string | undefined {
  if (route === "public_fetch") {
    return [
      "This turn is a public page fetch.",
      "Call web_fetch on the URL and answer from that result.",
      "Do not call browser. Do not open the cloud PC (云电脑 / 云端电脑).",
    ].join(" ");
  }
  if (route === "public_search") {
    return [
      "This turn is a public web search.",
      "Call web_search and answer from that result.",
      "Do not call browser. Do not open the cloud PC (云电脑 / 云端电脑).",
    ].join(" ");
  }
  if (route === "account_computer") {
    return [
      'Call the browser tool now with target="sandbox". Do not ask permission before clicking a login entry such as 「你好，请登录」.',
      "Snapshot first. If the site is already logged in, continue and do not ask. Then call account_computer_login action=plan with host and signals. Do not ask the user to type a password in chat. Do not guess a QR login when password fields are visible. Typed passwords and SMS codes use secure_form. QR, captcha, slider, or passkey is a 电脑 takeover only when plan returns handoff.",
      "When the user asked to buy or place an order: choose the spec, 加入购物车, then 去结算. Before 提交订单, list 商品、数量、价格、地址 in the chat and wait for one explicit confirmation. That confirmation is enough to submit.",
      "Cart selection: prefer snapshot refs / click by visible SKU+size+price text; never blind-toggle anonymous checkbox indices. On「只要最新挑选的这一双」, match the newly added line (e.g. size+price), uncheck others, re-read 合计 before 去结算.",
      "When the browser tool returns a platform or policy error, say it is a 云电脑 fault (云电脑故障), quote the one-line reason (引用这一行原因), and offer to retry. If open failed, retry once with navigate. If the browser tool says 云电脑还在启动, say that sentence and stop. Do not retry and do not call it a 云电脑故障. Never redirect the user to another app or device for the shopping task (不要让用户改用京东 App 或其他设备).",
      "After submit, stop on the cashier page and ask the user to take over 电脑 to scan or pay. Never pay. Do not delete or empty the cart unless the user asked.",
      "Decision pause (不确定就停): when price/SKU/spec/qty/address/payment is ambiguous or several candidates look plausible, STOP — ask the user to confirm or hand 电脑 (接管). Never click through a guess. Before 提交订单 / pay, summarize item+price+address and wait for confirm unless the user already said 直接下单/我来扫码 and the cashier QR is showing.",
      "Scan-to-pay (扫码支付 / 我来扫码 / 直接下单我来付): prefer 提交订单 then the native cashier QR (收银台 / pcashier.jd.com / 微信支付二维码). Never click 「立即支付」 or 「确认付款」 into 「密码支付」. Never type a payment password. If a 「密码支付」 overlay appears, click 「更多支付」 (or equivalent) until the QR/cashier page shows, then stop and hand 电脑 to the user. Do not batch-click every button matching /支付/.",
      "After the page changes, snapshot again before using a ref.",
    ].join(" ");
  }
  return undefined;
}

/** Hide the desktop browser on a turn that must use public HTTP tools. */
export function applyAccountComputerTurnRoute<T extends { name: string }>(
  tools: T[],
  text: string,
): { tools: T[]; route: AccountComputerWebRoute; turnPrompt?: string } {
  const route = resolveAccountComputerWebRoute(text);
  const turnPrompt = accountComputerTurnPrompt(route);
  if (route !== "public_fetch" && route !== "public_search") {
    return {
      tools,
      route,
      ...(turnPrompt ? { turnPrompt } : {}),
    };
  }
  return {
    tools: tools.filter((tool) => tool.name !== BROWSER_TOOL),
    route,
    ...(turnPrompt ? { turnPrompt } : {}),
  };
}

export function shouldGrantAccountComputerBrowserTool(
  resolved: Pick<SandboxToolPolicyResolved, "deny" | "sources">,
): boolean {
  const deniedBySandbox = !isToolAllowed({ allow: [], deny: resolved.deny }, BROWSER_TOOL);
  if (!deniedBySandbox) {
    return true;
  }
  // Default deny is the cloud-PC gap. An explicit sandbox deny stays in force.
  return resolved.sources.deny.source === "default";
}

export function grantAccountComputerBrowserTool(policy: SandboxToolPolicy): SandboxToolPolicy {
  const deny = (policy.deny ?? []).filter((name) => name.trim().toLowerCase() !== BROWSER_TOOL);
  const denied = new Set(deny.map((name) => name.trim().toLowerCase()));
  const allow = [...(policy.allow ?? [])];
  const allowNames = new Set(allow.map((name) => name.trim().toLowerCase()));
  const grant = (name: string) => {
    if (denied.has(name)) {
      return;
    }
    if (allow.length > 0 && !allowNames.has(name) && !allowNames.has("*")) {
      allow.push(name);
      allowNames.add(name);
    }
  };
  // browser is lifted off the default deny above. web_fetch / web_search are
  // not on that deny, but a non-empty sandbox allow still hides them. Put
  // them back so a public-page turn can select them.
  grant(BROWSER_TOOL);
  grant(WEB_FETCH_TOOL);
  grant(WEB_SEARCH_TOOL);
  return { allow, deny };
}

export function policyExplicitlyDeniesTool(
  policy: SandboxToolPolicy | undefined,
  toolName: string,
): boolean {
  const deny = policy?.deny;
  if (!deny || deny.length === 0) {
    return false;
  }
  return !isToolAllowed({ allow: [], deny }, toolName);
}

export function ensureAccountComputerControlTools<T extends { name: string }>(params: {
  tools: T[];
  browserTool?: T;
  secureFormTool?: T;
  loginTool?: T;
  webFetchTool?: T;
  webSearchTool?: T;
  explicitDeny?: {
    browser?: boolean;
    secureForm?: boolean;
    login?: boolean;
    webFetch?: boolean;
    webSearch?: boolean;
  };
}): T[] {
  const next = [...params.tools];
  const add = (tool: T | undefined, denied: boolean | undefined) => {
    if (!tool || denied) {
      return;
    }
    if (next.some((entry) => entry.name === tool.name)) {
      return;
    }
    next.push(tool);
  };
  add(params.webFetchTool, params.explicitDeny?.webFetch);
  add(params.webSearchTool, params.explicitDeny?.webSearch);
  add(params.browserTool, params.explicitDeny?.browser);
  add(params.secureFormTool, params.explicitDeny?.secureForm);
  add(params.loginTool, params.explicitDeny?.login);
  return next;
}

/**
 * A browser container lease exists, but the control bridge is not attached yet.
 * The desktop picture can already be on screen. Do not ask the model to retry.
 */
export {
  buildAccountComputerBrowserRoutingLines,
  buildAccountComputerBrowserPendingLines,
} from "../../agent-runtime/context/sources/browser-routing.js";
