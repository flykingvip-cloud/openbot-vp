import crypto from "node:crypto";
import {
  assertNoClientBrowserProfileOverride,
  isMultitenantManagedBrowser,
} from "../../browser/account-browser-namespace.js";
import {
  browserAct,
  browserArmDialog,
  browserArmFileChooser,
  browserNavigate,
  browserPdfSave,
  browserScreenshotAction,
} from "../../browser/client-actions.js";
import {
  browserCloseTab,
  browserFocusTab,
  browserOpenTab,
  browserProfiles,
  browserStart,
  browserStatus,
  browserStop,
} from "../../browser/client.js";
import { resolveBrowserConfig } from "../../browser/config.js";
import { DEFAULT_UPLOAD_DIR, resolveExistingPathsWithinRoot } from "../../browser/paths.js";
import { applyBrowserProxyPaths, persistBrowserProxyFiles } from "../../browser/proxy-files.js";
import {
  trackSessionBrowserTab,
  untrackSessionBrowserTab,
} from "../../browser/session-tab-registry.js";
import { loadConfig } from "../../config/config.js";
import { resolveDefaultAccountBrowserScopeKey } from "./account-browser-scope.js";
import { runWithAccountBrowserSerial } from "./browser-tool.account-serial.js";
import {
  executeActAction,
  executeConsoleAction,
  executePlanOnceAction,
  executeSnapshotAction,
  executeTabsAction,
} from "./browser-tool.actions.js";
import { BrowserToolSchema } from "./browser-tool.schema.js";
import { type AnyAgentTool, imageResultFromFile, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";
import {
  listNodes,
  resolveNodeIdFromList,
  selectDefaultNodeFromList,
  type NodeListNode,
} from "./nodes-utils.js";

function readOptionalTargetAndTimeout(params: Record<string, unknown>) {
  const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? params.timeoutMs
      : undefined;
  return { targetId, timeoutMs };
}

function readTargetUrlParam(params: Record<string, unknown>) {
  return (
    readStringParam(params, "targetUrl") ??
    readStringParam(params, "url", { required: true, label: "targetUrl" })
  );
}

const LEGACY_BROWSER_ACT_REQUEST_KEYS = [
  "targetId",
  "ref",
  "doubleClick",
  "button",
  "modifiers",
  "text",
  "submit",
  "slowly",
  "key",
  "delayMs",
  "startRef",
  "endRef",
  "values",
  "fields",
  "width",
  "height",
  "timeMs",
  "textGone",
  "selector",
  "url",
  "loadState",
  "fn",
  "timeoutMs",
] as const;

function rejectSecretActRequest(request: Record<string, unknown> | undefined): string | null {
  if (!request || typeof request !== "object") {
    return null;
  }
  const kind = typeof request.kind === "string" ? request.kind : "";
  if (kind !== "type" && kind !== "fill") {
    return null;
  }
  const text = typeof request.text === "string" ? request.text : "";
  // Heuristic: explicit password/otp markers in selector/ref/element-ish fields
  const hay = [
    typeof request.ref === "string" ? request.ref : "",
    typeof request.selector === "string" ? request.selector : "",
    typeof request.element === "string" ? request.element : "",
  ]
    .join(" ")
    .toLowerCase();
  if (
    hay.includes("password") ||
    hay.includes("otp") ||
    hay.includes("one-time") ||
    hay.includes("totp") ||
    hay.includes("passcode")
  ) {
    return "Use secure_form for password/otp fields; browser act type/fill is blocked for secrets.";
  }
  if (Array.isArray(request.fields)) {
    for (const field of request.fields) {
      if (!field || typeof field !== "object") {
        continue;
      }
      const f = field as Record<string, unknown>;
      const name = [
        typeof f.name === "string" ? f.name : "",
        typeof f.ref === "string" ? f.ref : "",
        typeof f.selector === "string" ? f.selector : "",
      ]
        .join(" ")
        .toLowerCase();
      if (
        name.includes("password") ||
        name.includes("otp") ||
        f.type === "password" ||
        f.kind === "password" ||
        f.kind === "otp"
      ) {
        return "Use secure_form for password/otp fields; browser act type/fill is blocked for secrets.";
      }
    }
  }
  // Refuse type into password-looking when slowly/submit with empty hay still risky: keep marker-based only.
  void text;
  return null;
}

function readActRequestParam(params: Record<string, unknown>) {
  const requestParam = params.request;
  if (requestParam && typeof requestParam === "object") {
    return requestParam as Parameters<typeof browserAct>[1];
  }

  const kind = readStringParam(params, "kind");
  if (!kind) {
    return undefined;
  }

  const request: Record<string, unknown> = { kind };
  for (const key of LEGACY_BROWSER_ACT_REQUEST_KEYS) {
    if (!Object.hasOwn(params, key)) {
      continue;
    }
    request[key] = params[key];
  }
  return request as Parameters<typeof browserAct>[1];
}

type BrowserProxyFile = {
  path: string;
  base64: string;
  mimeType?: string;
};

type BrowserProxyResult = {
  result: unknown;
  files?: BrowserProxyFile[];
};

const DEFAULT_BROWSER_PROXY_TIMEOUT_MS = 20_000;
const BROWSER_PROXY_GATEWAY_TIMEOUT_SLACK_MS = 5_000;

type BrowserNodeTarget = {
  nodeId: string;
  label?: string;
};

function isBrowserNode(node: NodeListNode) {
  const caps = Array.isArray(node.caps) ? node.caps : [];
  const commands = Array.isArray(node.commands) ? node.commands : [];
  return caps.includes("browser") || commands.includes("browser.proxy");
}

async function resolveBrowserNodeTarget(params: {
  requestedNode?: string;
  target?: "sandbox" | "host" | "node";
  sandboxBridgeUrl?: string;
}): Promise<BrowserNodeTarget | null> {
  const cfg = loadConfig();
  const policy = cfg.gateway?.nodes?.browser;
  const mode = policy?.mode ?? "auto";
  if (mode === "off") {
    if (params.target === "node" || params.requestedNode) {
      throw new Error("Node browser proxy is disabled (gateway.nodes.browser.mode=off).");
    }
    return null;
  }
  if (params.sandboxBridgeUrl?.trim() && params.target !== "node" && !params.requestedNode) {
    return null;
  }
  if (params.target && params.target !== "node") {
    return null;
  }
  if (mode === "manual" && params.target !== "node" && !params.requestedNode) {
    return null;
  }

  const nodes = await listNodes({});
  const browserNodes = nodes.filter((node) => node.connected && isBrowserNode(node));
  if (browserNodes.length === 0) {
    if (params.target === "node" || params.requestedNode) {
      throw new Error("No connected browser-capable nodes.");
    }
    return null;
  }

  const requested = params.requestedNode?.trim() || policy?.node?.trim();
  if (requested) {
    const nodeId = resolveNodeIdFromList(browserNodes, requested, false);
    const node = browserNodes.find((entry) => entry.nodeId === nodeId);
    return { nodeId, label: node?.displayName ?? node?.remoteIp ?? nodeId };
  }

  const selected = selectDefaultNodeFromList(browserNodes, {
    preferLocalMac: false,
    fallback: "none",
  });

  if (params.target === "node") {
    if (selected) {
      return {
        nodeId: selected.nodeId,
        label: selected.displayName ?? selected.remoteIp ?? selected.nodeId,
      };
    }
    throw new Error(
      `Multiple browser-capable nodes connected (${browserNodes.length}). Set gateway.nodes.browser.node or pass node=<id>.`,
    );
  }

  if (mode === "manual") {
    return null;
  }

  if (selected) {
    return {
      nodeId: selected.nodeId,
      label: selected.displayName ?? selected.remoteIp ?? selected.nodeId,
    };
  }
  return null;
}

async function callBrowserProxy(params: {
  nodeId: string;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  profile?: string;
}): Promise<BrowserProxyResult> {
  const proxyTimeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(1, Math.floor(params.timeoutMs))
      : DEFAULT_BROWSER_PROXY_TIMEOUT_MS;
  const gatewayTimeoutMs = proxyTimeoutMs + BROWSER_PROXY_GATEWAY_TIMEOUT_SLACK_MS;
  const payload = await callGatewayTool<{ payloadJSON?: string; payload?: string }>(
    "node.invoke",
    { timeoutMs: gatewayTimeoutMs },
    {
      nodeId: params.nodeId,
      command: "browser.proxy",
      params: {
        method: params.method,
        path: params.path,
        query: params.query,
        body: params.body,
        timeoutMs: proxyTimeoutMs,
        profile: params.profile,
      },
      idempotencyKey: crypto.randomUUID(),
    },
  );
  const parsed =
    payload?.payload ??
    (typeof payload?.payloadJSON === "string" && payload.payloadJSON
      ? (JSON.parse(payload.payloadJSON) as BrowserProxyResult)
      : null);
  if (!parsed || typeof parsed !== "object" || !("result" in parsed)) {
    throw new Error("browser proxy failed");
  }
  return parsed;
}

async function persistProxyFiles(files: BrowserProxyFile[] | undefined) {
  return await persistBrowserProxyFiles(files);
}

function applyProxyPaths(result: unknown, mapping: Map<string, string>) {
  applyBrowserProxyPaths(result, mapping);
}

function resolveBrowserBaseUrl(params: {
  target?: "sandbox" | "host";
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
}): string | undefined {
  const cfg = loadConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  const normalizedSandbox = params.sandboxBridgeUrl?.trim() ?? "";
  const target = params.target ?? (normalizedSandbox ? "sandbox" : "host");

  if (target === "sandbox") {
    if (!normalizedSandbox) {
      throw new Error(
        'Sandbox browser is unavailable. Enable agents.defaults.sandbox.browser.enabled or use target="host" if allowed.',
      );
    }
    return normalizedSandbox.replace(/\/$/, "");
  }

  if (params.allowHostControl === false) {
    throw new Error("Host browser control is disabled by sandbox policy.");
  }
  if (!resolved.enabled) {
    throw new Error(
      "Browser control is disabled. Set browser.enabled=true in ~/.openbot/openbot.json.",
    );
  }
  return undefined;
}

function browserToolDescription(opts?: {
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
  accountComputer?: boolean;
}): string {
  if (opts?.accountComputer) {
    return [
      "Drive the user's Account Computer (云电脑), the signed-in desktop browser shared by this user.",
      'Use target="sandbox" (the default) to open the cloud PC, navigate, click, type, and log in on that desktop.',
      "Use this tool for cookies, authenticated sites, and any request to operate the cloud PC.",
      "While this tool is available, do not answer with [[capability_gap:tool:browser-control]].",
      "Do not answer with [[capability_gap:tool:browser-navigation-blocked-by-ssrf-policy]] for a public site such as https://www.jd.com. Private, loopback, and metadata targets stay blocked.",
      "Public page fetches stay on web_fetch (web_search when there is no URL). If the user says not to open the cloud PC, do not call this tool.",
      "Host and node browser targets stay blocked. Password and one-time-code fields use secure_form.",
      "Login: snapshot first. If already signed in, continue and do not ask. If login is required, open the login page and do not ask permission before clicking 「你好，请登录」. Then call account_computer_login action=plan. Do not ask the user to type a password in chat. Do not guess a QR login when password fields are visible. Typed credentials and SMS codes use secure_form. QR, captcha, or passkey is a 电脑 takeover only when plan returns handoff.",
      "Shopping (购买/下单): choose the spec (选规格), add to cart (加入购物车), then checkout (去结算). Check the item, spec, quantity, price, and address (核对商品、规格、数量、价格、收货地址).",
      "Before clicking 提交订单, list 商品、数量、价格、地址 in the chat and get one explicit confirmation. That single confirmation is enough to submit.",
      "After submit, stop on the cashier or payment page (收银台/付款页). Ask the user to take over 电脑 to scan or pay. Never pay for the user (绝不代付).",
      "Decision pause (不确定就停): when price/SKU/spec/qty/address/payment is ambiguous or several candidates look plausible, STOP — ask the user to confirm or hand 电脑 (接管). Never click through a guess. Before 提交订单 / pay, summarize item+price+address and wait for confirm unless the user already said 直接下单/我来扫码 and the cashier QR is showing.",
      "Scan-to-pay (扫码支付 / 我来扫码 / 直接下单我来付): prefer 提交订单 then the native cashier QR (收银台 / pcashier.jd.com / 微信支付二维码). Never click 「立即支付」 or 「确认付款」 into 「密码支付」. Never type a payment password. If a 「密码支付」 overlay appears, click 「更多支付」 (or equivalent) until the QR/cashier page shows, then stop and hand 电脑 to the user. Do not batch-click every button matching /支付/.",
      "When the browser tool returns a platform or policy error, say it is a 云电脑 fault (云电脑故障), quote the one-line reason (引用这一行原因), and offer to retry. If open failed, retry once with navigate. Never redirect the user to another app or device for the shopping task (不要让用户改用京东 App 或其他设备).",
      "Do not delete, empty the cart, or cancel an order (不要删除、清空购物车或取消订单) unless the user explicitly asks.",
      "After the page changes, snapshot again before using a ref.",
      'Use snapshot then act. Pass targetId from the snapshot into later actions. Prefer refs="aria" for stable refs.',
      'For a multi-step browser subtask without per-step frontier calls, use action="plan_once" (or action="act" with steps[]): Shape B plan-once grounds each step in the latest legal DOM snapshot, settles, and returns status DONE|FAIL|NEEDS_INPUT|NEEDS_AGENT|BLOCKED. Only DONE may be treated as chat.final (M2). Never click 立即支付 / submit a payment password.',
      "REQUIRED for plan_once / act(steps[]): pass sessionPhase=INTERACTIVE and ownershipPhase (e.g. BACKGROUND_AGENT / INTERACTIVE). Account Computer may auto-inject these from live session state when a provider is registered; omitting both after inject BLOCKS the run (does not silently allow). FIRST_FRAME / streamUrl alone never unlocks automation; HUMAN_TAKEOVER / 接管 cancels.",
      "If plan_once returns NEEDS_* / BLOCKED / FAIL, pause and hand 电脑 (接管) or ask for the missing literal — do not emit a done final.",
    ].join(" ");
  }
  const targetDefault = opts?.sandboxBridgeUrl ? "sandbox" : "host";
  const hostHint =
    opts?.allowHostControl === false ? "Host target blocked by policy." : "Host target allowed.";
  return [
    "Control the browser via OpenBot's browser control server (status/start/stop/profiles/tabs/open/snapshot/screenshot/actions).",
    'Profiles: use profile="chrome" for Chrome extension relay takeover (your existing Chrome tabs). Use profile="openclaw" for the isolated openclaw-managed browser.',
    'If the user mentions the Chrome extension / Browser Relay / toolbar button / “attach tab”, ALWAYS use profile="chrome" (do not ask which profile).',
    'When a node-hosted browser proxy is available, the tool may auto-route to it. Pin a node with node=<id|name> or target="node".',
    "Chrome extension relay needs an attached tab: user must click the OpenBot Browser Relay toolbar icon on the tab (badge ON). If no tab is connected, ask them to attach it.",
    "When using refs from snapshot (e.g. e12), keep the same tab: prefer passing targetId from the snapshot response into subsequent actions (act/click/type/etc).",
    'For stable, self-resolving refs across calls, use snapshot with refs="aria" (Playwright aria-ref ids). Default refs="role" are role+name-based.',
    "Use snapshot+act for UI automation. Avoid act:wait by default; use only in exceptional cases when no reliable UI state exists.",
    `target selects browser location (sandbox|host|node). Default: ${targetDefault}.`,
    hostHint,
  ].join(" ");
}

export function createBrowserTool(opts?: {
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
  /** Account Computer desktop. Forces target=sandbox and keeps host control blocked. */
  accountComputer?: boolean;
  agentSessionKey?: string;
  /** Server-derived `account:<tenant>:<user>:browser` scope. Not a model parameter. */
  accountBrowserScopeKey?: string;
  /**
   * Trusted server account. When accountBrowserScopeKey is omitted, the tool
   * derives it from this account so the serial lock applies. Tool arguments
   * cannot supply either value.
   */
  serverAccount?: { tenantId?: string; userId?: string };
}): AnyAgentTool {
  const accountBrowserScopeKey = resolveDefaultAccountBrowserScopeKey({
    accountBrowserScopeKey: opts?.accountBrowserScopeKey,
    tenantId: opts?.serverAccount?.tenantId,
    userId: opts?.serverAccount?.userId,
  });
  return {
    label: "Browser",
    name: "browser",
    description: browserToolDescription(opts),
    parameters: BrowserToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const profile = readStringParam(params, "profile");
      assertNoClientBrowserProfileOverride({
        multitenantManaged: isMultitenantManagedBrowser(loadConfig()),
        profile,
        profilePath: readStringParam(params, "profilePath"),
        userDataDir: readStringParam(params, "userDataDir"),
      });
      const requestedNode = readStringParam(params, "node");
      let target = readStringParam(params, "target") as "sandbox" | "host" | "node" | undefined;

      if (requestedNode && target && target !== "node") {
        throw new Error('node is only supported with target="node".');
      }

      if (opts?.accountComputer && (target === "host" || target === "node" || requestedNode)) {
        throw new Error(
          'Account Computer browser control uses target="sandbox". Host and node targets stay blocked.',
        );
      }
      if (opts?.accountComputer) {
        target = target ?? "sandbox";
      } else if (!target && !requestedNode && profile === "chrome") {
        // Chrome extension relay takeover is a host Chrome feature; prefer host unless explicitly targeting a node.
        target = "host";
      }

      const nodeTarget = await resolveBrowserNodeTarget({
        requestedNode: requestedNode ?? undefined,
        target,
        sandboxBridgeUrl: opts?.sandboxBridgeUrl,
      });

      const resolvedTarget = target === "node" ? undefined : target;
      const baseUrl = nodeTarget
        ? undefined
        : resolveBrowserBaseUrl({
            target: resolvedTarget,
            sandboxBridgeUrl: opts?.sandboxBridgeUrl,
            allowHostControl: opts?.allowHostControl,
          });

      const proxyRequest = nodeTarget
        ? async (opts: {
            method: string;
            path: string;
            query?: Record<string, string | number | boolean | undefined>;
            body?: unknown;
            timeoutMs?: number;
            profile?: string;
          }) => {
            const proxy = await callBrowserProxy({
              nodeId: nodeTarget.nodeId,
              method: opts.method,
              path: opts.path,
              query: opts.query,
              body: opts.body,
              timeoutMs: opts.timeoutMs,
              profile: opts.profile,
            });
            const mapping = await persistProxyFiles(proxy.files);
            applyProxyPaths(proxy.result, mapping);
            return proxy.result;
          }
        : null;

      return await runWithAccountBrowserSerial({
        accountBrowserScopeKey,
        action,
        params,
        run: async () => {
          switch (action) {
            case "status":
              if (proxyRequest) {
                return jsonResult(
                  await proxyRequest({
                    method: "GET",
                    path: "/",
                    profile,
                  }),
                );
              }
              return jsonResult(await browserStatus(baseUrl, { profile }));
            case "start":
              if (proxyRequest) {
                await proxyRequest({
                  method: "POST",
                  path: "/start",
                  profile,
                });
                return jsonResult(
                  await proxyRequest({
                    method: "GET",
                    path: "/",
                    profile,
                  }),
                );
              }
              await browserStart(baseUrl, { profile });
              return jsonResult(await browserStatus(baseUrl, { profile }));
            case "stop":
              if (proxyRequest) {
                await proxyRequest({
                  method: "POST",
                  path: "/stop",
                  profile,
                });
                return jsonResult(
                  await proxyRequest({
                    method: "GET",
                    path: "/",
                    profile,
                  }),
                );
              }
              await browserStop(baseUrl, { profile });
              return jsonResult(await browserStatus(baseUrl, { profile }));
            case "profiles":
              if (proxyRequest) {
                const result = await proxyRequest({
                  method: "GET",
                  path: "/profiles",
                });
                return jsonResult(result);
              }
              return jsonResult({ profiles: await browserProfiles(baseUrl) });
            case "tabs":
              return await executeTabsAction({ baseUrl, profile, proxyRequest });
            case "open": {
              const targetUrl = readTargetUrlParam(params);
              if (proxyRequest) {
                const result = await proxyRequest({
                  method: "POST",
                  path: "/tabs/open",
                  profile,
                  body: { url: targetUrl },
                });
                return jsonResult(result);
              }
              const opened = await browserOpenTab(baseUrl, targetUrl, { profile });
              trackSessionBrowserTab({
                sessionKey: opts?.agentSessionKey,
                targetId: opened.targetId,
                baseUrl,
                profile,
              });
              return jsonResult(opened);
            }
            case "focus": {
              const targetId = readStringParam(params, "targetId", {
                required: true,
              });
              if (proxyRequest) {
                const result = await proxyRequest({
                  method: "POST",
                  path: "/tabs/focus",
                  profile,
                  body: { targetId },
                });
                return jsonResult(result);
              }
              await browserFocusTab(baseUrl, targetId, { profile });
              return jsonResult({ ok: true });
            }
            case "close": {
              const targetId = readStringParam(params, "targetId");
              if (proxyRequest) {
                const result = targetId
                  ? await proxyRequest({
                      method: "DELETE",
                      path: `/tabs/${encodeURIComponent(targetId)}`,
                      profile,
                    })
                  : await proxyRequest({
                      method: "POST",
                      path: "/act",
                      profile,
                      body: { kind: "close" },
                    });
                return jsonResult(result);
              }
              if (targetId) {
                await browserCloseTab(baseUrl, targetId, { profile });
                untrackSessionBrowserTab({
                  sessionKey: opts?.agentSessionKey,
                  targetId,
                  baseUrl,
                  profile,
                });
              } else {
                await browserAct(baseUrl, { kind: "close" }, { profile });
              }
              return jsonResult({ ok: true });
            }
            case "snapshot":
              return await executeSnapshotAction({
                input: params,
                baseUrl,
                profile,
                proxyRequest,
              });
            case "screenshot": {
              const targetId = readStringParam(params, "targetId");
              const fullPage = Boolean(params.fullPage);
              const ref = readStringParam(params, "ref");
              const element = readStringParam(params, "element");
              const type = params.type === "jpeg" ? "jpeg" : "png";
              const result = proxyRequest
                ? ((await proxyRequest({
                    method: "POST",
                    path: "/screenshot",
                    profile,
                    body: {
                      targetId,
                      fullPage,
                      ref,
                      element,
                      type,
                    },
                  })) as Awaited<ReturnType<typeof browserScreenshotAction>>)
                : await browserScreenshotAction(baseUrl, {
                    targetId,
                    fullPage,
                    ref,
                    element,
                    type,
                    profile,
                  });
              return await imageResultFromFile({
                label: "browser:screenshot",
                path: result.path,
                details: result,
              });
            }
            case "navigate": {
              const targetUrl = readTargetUrlParam(params);
              const targetId = readStringParam(params, "targetId");
              if (proxyRequest) {
                const result = await proxyRequest({
                  method: "POST",
                  path: "/navigate",
                  profile,
                  body: {
                    url: targetUrl,
                    targetId,
                  },
                });
                return jsonResult(result);
              }
              return jsonResult(
                await browserNavigate(baseUrl, {
                  url: targetUrl,
                  targetId,
                  profile,
                }),
              );
            }
            case "console":
              return await executeConsoleAction({
                input: params,
                baseUrl,
                profile,
                proxyRequest,
              });
            case "pdf": {
              const targetId =
                typeof params.targetId === "string" ? params.targetId.trim() : undefined;
              const result = proxyRequest
                ? ((await proxyRequest({
                    method: "POST",
                    path: "/pdf",
                    profile,
                    body: { targetId },
                  })) as Awaited<ReturnType<typeof browserPdfSave>>)
                : await browserPdfSave(baseUrl, { targetId, profile });
              return {
                content: [{ type: "text" as const, text: `FILE:${result.path}` }],
                details: result,
              };
            }
            case "upload": {
              const paths = Array.isArray(params.paths) ? params.paths.map((p) => String(p)) : [];
              if (paths.length === 0) {
                throw new Error("paths required");
              }
              const uploadPathsResult = await resolveExistingPathsWithinRoot({
                rootDir: DEFAULT_UPLOAD_DIR,
                requestedPaths: paths,
                scopeLabel: `uploads directory (${DEFAULT_UPLOAD_DIR})`,
              });
              if (!uploadPathsResult.ok) {
                throw new Error(uploadPathsResult.error);
              }
              const normalizedPaths = uploadPathsResult.paths;
              const ref = readStringParam(params, "ref");
              const inputRef = readStringParam(params, "inputRef");
              const element = readStringParam(params, "element");
              const { targetId, timeoutMs } = readOptionalTargetAndTimeout(params);
              if (proxyRequest) {
                const result = await proxyRequest({
                  method: "POST",
                  path: "/hooks/file-chooser",
                  profile,
                  body: {
                    paths: normalizedPaths,
                    ref,
                    inputRef,
                    element,
                    targetId,
                    timeoutMs,
                  },
                });
                return jsonResult(result);
              }
              return jsonResult(
                await browserArmFileChooser(baseUrl, {
                  paths: normalizedPaths,
                  ref,
                  inputRef,
                  element,
                  targetId,
                  timeoutMs,
                  profile,
                }),
              );
            }
            case "dialog": {
              const accept = Boolean(params.accept);
              const promptText =
                typeof params.promptText === "string" ? params.promptText : undefined;
              const { targetId, timeoutMs } = readOptionalTargetAndTimeout(params);
              if (proxyRequest) {
                const result = await proxyRequest({
                  method: "POST",
                  path: "/hooks/dialog",
                  profile,
                  body: {
                    accept,
                    promptText,
                    targetId,
                    timeoutMs,
                  },
                });
                return jsonResult(result);
              }
              return jsonResult(
                await browserArmDialog(baseUrl, {
                  accept,
                  promptText,
                  targetId,
                  timeoutMs,
                  profile,
                }),
              );
            }
            case "plan_once": {
              return await executePlanOnceAction({
                input: params,
                baseUrl,
                profile,
                proxyRequest,
                accountComputer: opts?.accountComputer === true,
                agentSessionKey: opts?.agentSessionKey,
                accountBrowserScopeKey,
              });
            }
            case "act": {
              // Shape B: act(steps[]) → plan-once on the shared Chromium (no per-step frontier).
              if (Array.isArray(params.steps) && params.steps.length > 0) {
                return await executePlanOnceAction({
                  input: params,
                  baseUrl,
                  profile,
                  proxyRequest,
                  accountComputer: opts?.accountComputer === true,
                  agentSessionKey: opts?.agentSessionKey,
                  accountBrowserScopeKey,
                });
              }
              const request = readActRequestParam(params);
              if (!request) {
                throw new Error("request required");
              }
              const secretBlock = rejectSecretActRequest(request as Record<string, unknown>);
              if (secretBlock) {
                throw new Error(secretBlock);
              }
              return await executeActAction({
                request,
                baseUrl,
                profile,
                proxyRequest,
              });
            }
            default:
              throw new Error(`Unknown action: ${action}`);
          }
        },
      });
    },
  };
}
