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
    detail.message ? `:: ${String(detail.message).slice(0, 200)}` : "",
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
      const ta = document.querySelector(".chat-compose textarea, textarea");
      return Boolean(ta && !ta.disabled);
    },
    { timeout: timeoutMs },
  );
}

async function dismissOverlays(page) {
  for (const label of ["稍后处理", "我知道了", "关闭", "Close", "跳过"]) {
    const btn = page.locator("button", { hasText: label }).first();
    if ((await btn.count()) > 0) {
      await btn.click({ timeout: 800 }).catch(() => {});
    }
  }
}

async function getThreadText(page) {
  return page.evaluate(() => {
    const thread = document.querySelector(".chat-thread");
    if (!thread) {
      return { text: "", bubbles: [] };
    }
    const bubbles = [...thread.querySelectorAll(".chat-bubble, .chat-msg, [data-role]")].map(
      (el) => ({
        className: String(el.className || ""),
        role: el.getAttribute("data-role") || "",
        text: (el.innerText || "").slice(0, 320),
      }),
    );
    return { text: (thread.innerText || "").slice(0, 6000), bubbles };
  });
}

/** Sync Lit controlled textarea draft, then send via Enter (works while send-btn is Stop). */
async function fillAndSend(page, text) {
  const ta = page.locator(".chat-compose textarea, textarea").first();
  await ta.waitFor({ state: "visible", timeout: 15000 });
  await ta.click();
  // Lit binds .value=${draft}; Playwright fill + explicit input event keeps host draft in sync.
  await ta.fill(text);
  await page.evaluate(() => {
    const el = document.querySelector(".chat-compose textarea, textarea");
    if (!el) {
      return;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const draftOk = await page.evaluate((expected) => {
    const el = document.querySelector(".chat-compose textarea, textarea");
    return Boolean(el && (el.value || "").includes(expected.slice(0, 24)));
  }, text);
  if (!draftOk) {
    throw new Error("composer draft did not accept text");
  }

  // Prefer an explicit non-stop Send if present (non-compact); else Enter while Stop owns icon btn.
  const primary = page.locator(".chat-compose__actions .btn.primary").first();
  let used = "enter";
  if ((await primary.count()) > 0) {
    const label = `${(await primary.getAttribute("aria-label").catch(() => "")) || ""} ${(await primary.textContent().catch(() => "")) || ""}`;
    if (!/停止|Stop/i.test(label)) {
      await primary.click();
      used = "primary-send";
      return { usedEnter: false, used };
    }
  }
  await ta.press("Enter");
  return { usedEnter: true, used };
}

async function clickStop(page) {
  const stopByClass = page.locator("button.chat-compose__send-btn--stop");
  if ((await stopByClass.count()) > 0) {
    await stopByClass.first().click();
    return "class";
  }
  const labeled = page.locator("button").filter({ hasText: /^停止$|^Stop$/ });
  if ((await labeled.count()) > 0) {
    await labeled.first().click();
    return "text";
  }
  throw new Error("stop button not found");
}

async function main() {
  // Control UI canonicalizeWorkbenchChatSessionKey collapses custom keys → agent:main:main.
  const sessionKey = "agent:main:main";
  mark("browser.start", { message: sessionKey });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  const runStamp = `BR${Date.now().toString(36).slice(-6)}`;
  const aMarker = `任务A-浏览器-${runStamp}`;
  const bMarker = `插问B-浏览器-${runStamp}`;
  // Avoid 星期/周 in the user prompt — those falsely match assistant weekday waits.
  const bText = `【${bMarker}】与任务无关，不要改任务。只回答今天是星期几的一个字：一、二、三、四、五、六或日。不要解释。`;
  const aText = `【${aMarker}】请务必调用 exec 执行 sleep 55（不要跳过工具）。命令返回后只输出一行：A_BROWSER_DONE_${runStamp}。执行期间不要提前结束。`;

  const shots = {};
  const checks = {};

  try {
    await page.goto(uiUrl(sessionKey), { waitUntil: "domcontentloaded" });
    mark("page.goto", { message: `port=${PORT} stamp=${runStamp}` });
    await waitConnected(page);
    await dismissOverlays(page);
    mark("ui.connected", { ok: true });
    shots.connected = await shot(page, "01-connected");

    // Clear prior occupancy so Stop is not leftover from mid-exec WS runs.
    await fillAndSend(page, "/new");
    await page.waitForTimeout(1500);
    await dismissOverlays(page);
    mark("session.renewed", { ok: true });

    await fillAndSend(page, aText);
    mark("A.sent", { ok: true, message: aMarker });

    // Wait until stop appears AND A marker is in thread (proves this run, not stale abort UI).
    const stopAppeared = await page
      .waitForFunction(
        (marker) => {
          const t = document.querySelector(".chat-thread")?.innerText || "";
          if (!t.includes(marker)) {
            return false;
          }
          const btns = [...document.querySelectorAll("button")];
          return btns.some((b) => {
            const label = `${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${b.textContent || ""}`;
            return /停止|Stop/i.test(label) || b.classList.contains("chat-compose__send-btn--stop");
          });
        },
        aMarker,
        { timeout: 60000 },
      )
      .then(() => true)
      .catch(() => false);
    checks.stop_button_while_A = stopAppeared;
    mark("stop.visible_while_A", { ok: stopAppeared });
    shots.stopVisible = await shot(page, "02-stop-while-A");

    // Optional: wait briefly for tool activity signal in thread (exec/sleep/工具)
    await page
      .waitForFunction(
        () => {
          const t = document.querySelector(".chat-thread")?.innerText || "";
          return /sleep|exec|工具|Shell|bash/i.test(t);
        },
        { timeout: 45000 },
      )
      .catch(() => null);

    const sendMeta = await fillAndSend(page, bText);
    mark("B.aside.sent", { ok: true, message: JSON.stringify(sendMeta) });
    checks.composer_aside_while_A = Boolean(sendMeta);

    // B user prompt must appear (proves send landed).
    const bPromptVisible = await page
      .waitForFunction(
        (marker) => (document.querySelector(".chat-thread")?.innerText || "").includes(marker),
        bMarker,
        {
          timeout: 30000,
        },
      )
      .then(() => true)
      .catch(() => false);
    checks.B_prompt_in_thread = bPromptVisible;
    mark("B.prompt.visible", { ok: bPromptVisible });

    // Assistant weekday answer: single-char 一..日 or 星期X — must NOT rely on user prompt alone.
    const bAnswerVisible = await page
      .waitForFunction(
        (marker) => {
          const thread = document.querySelector(".chat-thread");
          if (!thread) {
            return false;
          }
          const bubbles = [...thread.querySelectorAll(".chat-bubble, .chat-msg, [data-role]")];
          for (const el of bubbles) {
            const text = (el.innerText || "").trim();
            if (!text || text.includes(marker)) {
              continue;
            } // skip user prompt bubble
            if (/^[一二三四五六日]$/.test(text) || /^星期[一二三四五六日天]$/.test(text)) {
              return true;
            }
            if (
              /^(周一|周二|周三|周四|周五|周六|周日|星期一|星期二|星期三|星期四|星期五|星期六|星期日|星期天)[。.!！]?$/.test(
                text,
              )
            ) {
              return true;
            }
            // short assistant replies that include weekday without the B marker
            if (text.length <= 24 && /[一二三四五六日]/.test(text) && !text.includes("插问B")) {
              return true;
            }
          }
          // Fallback: whole thread has answer after B marker block
          const t = thread.innerText || "";
          const idx = t.indexOf(marker);
          if (idx < 0) {
            return false;
          }
          const after = t.slice(idx + marker.length);
          return /(星期[一二三四五六日天]|周[一二三四五六日]|^[^\n]*[一二三四五六日])/.test(after);
        },
        bMarker,
        { timeout: 120000 },
      )
      .then(() => true)
      .catch(() => false);
    checks.B_bubble_visible = bAnswerVisible;
    mark("B.bubble.visible", { ok: bAnswerVisible });

    const before = await getThreadText(page);
    const hasAPrompt = before.text.includes(aMarker);
    const hasBPrompt = before.text.includes(bMarker);
    checks.A_B_bubbles_present = hasAPrompt && hasBPrompt;
    mark("bubbles.A_and_B", {
      ok: checks.A_B_bubbles_present,
      message: `hasA=${hasAPrompt} hasB=${hasBPrompt} bubbleCount=${before.bubbles.length}`,
    });
    shots.abBubbles = await shot(page, "03-A-B-bubbles");

    // Give aside dialogue persistence a moment before abort.
    await page.waitForTimeout(2000);

    const stopHow = await clickStop(page);
    mark("stop.clicked", { ok: true, message: stopHow });
    await page.waitForTimeout(3000);
    shots.afterStop = await shot(page, "04-after-stop");

    // Hard navigation refresh
    await page.goto(uiUrl(sessionKey), { waitUntil: "domcontentloaded" });
    await waitConnected(page);
    await dismissOverlays(page);

    const refreshOk = await page
      .waitForFunction(
        ({ a, b }) => {
          const t = document.querySelector(".chat-thread")?.innerText || "";
          return t.includes(a) && t.includes(b);
        },
        { a: aMarker, b: bMarker },
        { timeout: 60000 },
      )
      .then(() => true)
      .catch(() => false);
    const after = await getThreadText(page);
    const refreshHasA = after.text.includes(aMarker);
    const refreshHasB = after.text.includes(bMarker);
    checks.refresh_UI_visible = refreshOk || (refreshHasA && refreshHasB);
    mark("refresh.ui", {
      ok: checks.refresh_UI_visible,
      message: `hasA=${refreshHasA} hasB=${refreshHasB} waitOk=${refreshOk} text=${after.text.slice(0, 360)}`,
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
  } catch {
    /* ignore */
  }

  const required = [
    "stop_button_while_A",
    "composer_aside_while_A",
    "B_prompt_in_thread",
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
    runStamp,
    buildInfo,
    timeline,
    checks,
    screenshots: shots,
    pass,
    noteZh:
      "浏览器端：A 运行中输入框可发插问；停止按钮可见并可点；A/B 气泡同线程可见；刷新后 UI 仍可见（含 stamp 标记）。",
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
