/**
 * Browser-scan-proxy auto-route: user scans, agent drives the isolated browser.
 * Do not treat generic "open a page" / public-web research as this skill.
 */

export type BrowserScanProxyIntent =
  | "scan_login"
  | "restart_scan"
  | "scan_done"
  | "auth_expired"
  | "console_without_key"
  | "guidance"
  | "public_web"
  | "none";

export type BrowserScanProxyRouteDecision = {
  trigger: boolean;
  intent: BrowserScanProxyIntent;
  reason: string;
};

const SCAN_LOGIN =
  /扫码登录|扫码登陆|我来扫码|帮你扫码|你打开网页.{0,12}扫|打开网页.{0,12}我(来|帮你)扫|扫这个码|扫二维码登录/i;
const RESTART_SCAN =
  /重新启动.{0,8}浏览器|再(开|启).{0,8}(浏览器|扫码)|换一(张|扇).{0,8}(码|登录)/i;
const SCAN_DONE = /已经扫码|我扫过了|扫码完毕|扫完了|手机(上)?(已)?(点)?确认/i;
const AUTH_EXPIRED = /授权过期|二次扫码|重新扫码|会话失效|登录过期|登录失效/i;
const CONSOLE_WITHOUT_KEY =
  /(没有|缺|无).{0,12}(access\s*key|ak|cli|密钥).{0,24}(控制台|阿里云|后台|dns|解析)|控制台.{0,12}(扫码|代操作|你来点)/i;
const GUIDANCE = /找不到按钮|带我点|怎么配|我不会操作|一步步教我/i;
const PUBLIC_WEB = /调研|研究|提取正文|阅读.{0,8}(网页|链接)|web_fetch|网页调研/i;
const WECHAT_OR_MAIL = /个人微信|wechat\.personal|公众号|授权码|imap|smtp|邮箱网页/i;

export function assessBrowserScanProxyRoute(text: string): BrowserScanProxyRouteDecision {
  const raw = text.trim();
  if (!raw) {
    return { trigger: false, intent: "none", reason: "empty" };
  }
  if (WECHAT_OR_MAIL.test(raw) && !SCAN_LOGIN.test(raw) && !RESTART_SCAN.test(raw)) {
    return { trigger: false, intent: "none", reason: "owned-by-other-skill" };
  }
  if (GUIDANCE.test(raw) && !SCAN_LOGIN.test(raw) && !AUTH_EXPIRED.test(raw)) {
    return { trigger: false, intent: "guidance", reason: "user-guidance-protocol" };
  }
  if (PUBLIC_WEB.test(raw) && !SCAN_LOGIN.test(raw) && !AUTH_EXPIRED.test(raw)) {
    return { trigger: false, intent: "public_web", reason: "public-web-not-console-login" };
  }
  if (RESTART_SCAN.test(raw)) {
    return { trigger: true, intent: "restart_scan", reason: "user-asked-restart" };
  }
  if (SCAN_DONE.test(raw)) {
    return { trigger: true, intent: "scan_done", reason: "user-said-scanned" };
  }
  if (AUTH_EXPIRED.test(raw)) {
    return { trigger: true, intent: "auth_expired", reason: "reauth-loop" };
  }
  if (SCAN_LOGIN.test(raw)) {
    return { trigger: true, intent: "scan_login", reason: "explicit-scan" };
  }
  if (CONSOLE_WITHOUT_KEY.test(raw)) {
    return { trigger: true, intent: "console_without_key", reason: "console-without-cli" };
  }
  return { trigger: false, intent: "none", reason: "no-scan-intent" };
}
