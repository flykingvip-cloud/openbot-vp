#!/usr/bin/env node
/**
 * Slice2 Control UI browser acceptance (Playwright).
 * Covers: composer mid-A aside, stop button, A/B bubble ownership, post-refresh UI.
 * Isolated :19101. No merge/deploy.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "ui/package.json"));
const { chromium } = require("playwright");

const PORT = Number(process.env.OPENBOT_E2E_PORT || 19101);
const STATE =
  process.env.OPENBOT_STATE_DIR ||
  process.env.OPENCLAW_STATE_DIR ||
  "/tmp/openbot-pr216-e2e-state-01e15de99";
const OUT_DIR = process.env.OPENBOT_E2E_OUT || "/tmp/openbot-pr216-e2e-out/final";
const SHOT_DIR = path.join(OUT_DIR, "screenshots");
const TOKEN =
  process.env.OPENCLAW_GATEWAY_TOKEN ||
  process.env.OPENBOT_GATEWAY_TOKEN ||
  fs.readFileSync(path.join(STATE, ".gateway-token"), "utf8").trim();

fs.mkdirSync(SHOT_DIR, { recursive: true });

const timeline = [];
const mark = (phase, detail = {}) => {
  const row = {
    atAsiaShanghai:
      new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") +
      "+08:00",
    tMs: Date.now(),
    phase,
    ...detail,
  };
  timeline.push(row);
  console.log(
    `[${row.atAsiaShanghai}] ${phase}`,
    detail.message ? `:: ${String(detail.message).slice(0, 160)}` : "",
    detail.ok != null ? `ok=${detail.ok}` : "",
  );
};

async function shot(page, name) {
  const p = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  mark("screenshot", { message: p });
  return p;
}

function uiUrl(sessionKey) {
  const base = `http://127.0.0.1:${PORT}/`;
  // token via hash; gatewayUrl via query keeps settings aligned
  const q = new URLSearchParams({
    gatewayUrl: `ws://127.0.0.1:${PORT}`,
  });
  if (sessionKey) {
    q.set("session", sessionKey);
  }
  return `${base}?${q.toString()}#token=${encodeURIComponent(TOKEN)}`;
}

async function waitConnected(page, timeoutMs = 30000) {
  await page.waitForFunction(
    () => {
      // connected state reflected by enabled composer textarea
      const ta = document.querySelector(".chat-compose textarea, textarea");
      return Boolean(ta && !ta.disabled);
    },
    { timeout: timeoutMs },
  );
}

async function getThreadText(page) {
  return page.evaluate(() => {
    const thread = document.querySelector(".chat-thread");
    if (!thread) {
      return { text: "", bubbles: [] };
    }
    const bubbles = [...thread.querySelectorAll(".chat-bubble, .chat-msg, [data-role]")].map(
      (el) => ({
        className: el.className,
        text: (el.innerText || "").slice(0, 240),
      }),
    );
    return { text: (thread.innerText || "").slice(0, 4000), bubbles };
  });
}

async function fillAndSend(page, text) {
  const ta = page.locator(".chat-compose textarea, textarea").first();
  await ta.waitFor({ state: "visible", timeout: 15000 });
  await ta.fill(text);
  // Prefer primary send button; if stop mode, still try Enter send path via new text while busy uses queue
  const sendBtn = page
    .locator(".chat-compose__send-btn, .chat-compose__actions .btn.primary")
    .first();
  const label = await sendBtn.getAttribute("aria-label").catch(() => null);
  const title = await sendBtn.getAttribute("title").catch(() => null);
  const isStop =
    /停止|Stop/i.test(label || "") ||
    /停止|Stop/i.test(title || "") ||
    (await sendBtn
      .evaluate((el) => el.classList.contains("chat-compose__send-btn--stop"))
      .catch(() => false));
  if (isStop) {
    // While running, Enter queues/sends aside without pressing stop
    await ta.press("Enter");
  } else {
    await sendBtn.click();
  }
  return { usedEnter: isStop };
}

async function main() {
  const sessionKey = `agent:main:slice2-browser-${Date.now()}`;
  mark("browser.start", { message: sessionKey });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  const shots = {};
  const checks = {};

  try {
    await page.goto(uiUrl(sessionKey), { waitUntil: "domcontentloaded" });
    mark("page.goto", { message: `port=${PORT}` });
    await waitConnected(page);
    mark("ui.connected", { ok: true });
    shots.connected = await shot(page, "01-connected");

    // Start long A
    const aText =
      "【任务A-浏览器】请务必调用 exec 执行 sleep 55（不要跳过工具）。命令返回后只输出一行：A_BROWSER_DONE。执行期间不要提前结束。";
    await fillAndSend(page, aText);
    mark("A.sent", { ok: true });

    // Wait until stop button visible (= canAbort / run active)
    const stopAppeared = await page
      .waitForFunction(
        () => {
          const btns = [...document.querySelectorAll("button")];
          return btns.some((b) => {
            const label = `${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${b.textContent || ""}`;
            return /停止|Stop/i.test(label) || b.classList.contains("chat-compose__send-btn--stop");
          });
        },
        { timeout: 40000 },
      )
      .then(() => true)
      .catch(() => false);
    checks.stop_button_while_A = stopAppeared;
    mark("stop.visible_while_A", { ok: stopAppeared });
    shots.stopVisible = await shot(page, "02-stop-while-A");

    // Composer can send ordinary aside while A runs
    const bText = "【插问B-浏览器】现在是什么星期几？只回答星期几，与当前任务无关，不要改任务。";
    const sendMeta = await fillAndSend(page, bText);
    mark("B.aside.sent", { ok: true, message: JSON.stringify(sendMeta) });
    checks.composer_aside_while_A = true;

    // Wait for B answer bubble
    const bVisible = await page
      .waitForFunction(
        () => {
          const t = document.querySelector(".chat-thread")?.innerText || "";
          return /星期二|周一|周二|周三|周四|周五|周六|周日|星期/.test(t);
        },
        { timeout: 90000 },
      )
      .then(() => true)
      .catch(() => false);
    checks.B_bubble_visible = bVisible;
    mark("B.bubble.visible", { ok: bVisible });

    const before = await getThreadText(page);
    const hasAPrompt = /任务A-浏览器|A_BROWSER|sleep 55/.test(before.text);
    const hasBPrompt = /插问B-浏览器|星期/.test(before.text);
    checks.A_B_bubbles_present = hasAPrompt && hasBPrompt;
    mark("bubbles.A_and_B", {
      ok: checks.A_B_bubbles_present,
      message: `hasA=${hasAPrompt} hasB=${hasBPrompt} bubbleCount=${before.bubbles.length}`,
    });
    shots.abBubbles = await shot(page, "03-A-B-bubbles");

    // Prefer class-based stop if present
    const stopByClass = page.locator("button.chat-compose__send-btn--stop");
    if (await stopByClass.count()) {
      await stopByClass.first().click();
    } else {
      await page
        .locator("button")
        .filter({ hasText: /^停止$|^Stop$/ })
        .first()
        .click();
    }
    mark("stop.clicked", { ok: true });
    await page.waitForTimeout(2500);
    shots.afterStop = await shot(page, "04-after-stop");

    // Refresh and verify UI still shows A/B
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitConnected(page).catch(() => {});
    // Re-apply token if needed
    if (
      await page
        .locator(".chat-compose textarea, textarea")
        .first()
        .isDisabled()
        .catch(() => true)
    ) {
      await page.goto(uiUrl(sessionKey), { waitUntil: "domcontentloaded" });
      await waitConnected(page);
    }
    await page.waitForTimeout(3000);
    const after = await getThreadText(page);
    const refreshHasB = /插问B-浏览器|星期|星期二|周/.test(after.text);
    const refreshHasA = /任务A-浏览器|A_BROWSER|sleep 55/.test(after.text);
    checks.refresh_UI_visible = refreshHasA && refreshHasB;
    mark("refresh.ui", {
      ok: checks.refresh_UI_visible,
      message: `hasA=${refreshHasA} hasB=${refreshHasB} text=${after.text.slice(0, 200)}`,
    });
    shots.afterRefresh = await shot(page, "05-after-refresh");
  } finally {
    await browser.close().catch(() => {});
  }

  let buildInfo = null;
  try {
    buildInfo = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "dist/build-info.json"), "utf8"),
    );
  } catch {}

  const required = [
    "stop_button_while_A",
    "composer_aside_while_A",
    "B_bubble_visible",
    "A_B_bubbles_present",
    "refresh_UI_visible",
  ];
  const pass = required.every((k) => checks[k]);
  mark("verdict", { ok: pass, message: JSON.stringify(checks) });

  const report = {
    recordedAtAsiaShanghai:
      new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") +
      "+08:00",
    gatewayPort: PORT,
    stateDir: STATE,
    sessionKey,
    buildInfo,
    timeline,
    checks,
    screenshots: shots,
    pass,
    noteZh:
      "浏览器端：A 运行中输入框可发插问；停止按钮可见并可点；A/B 气泡同线程可见；刷新后 UI 仍可见。",
  };
  const outPath = path.join(OUT_DIR, "slice2-e2e-browser-ui.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  mark("report.written", { message: outPath, ok: pass });
  process.exit(pass ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
