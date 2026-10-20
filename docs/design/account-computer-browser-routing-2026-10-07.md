# Account Computer browser routing

Status: draft wiring for a local tip. This is not a production cutover.

## What broke

The Computer tab can show a live Account Computer desktop while the agent
refuses to drive it. The user asks to open the cloud PC and log in (for
example JD). The model answers with `[[capability_gap:tool:browser-control]]`
and falls back to public-page scraping.

Three separate facts produce that reply:

1. Sandbox sessions start with `browser` on the default deny list
   (`src/agents/sandbox/constants.ts`). The tool never reaches the model.
2. The system prompt says `Host browser control: blocked.` and, when no
   sandbox bridge is attached, does not mention any other browser.
3. The Account Worker path publishes the noVNC preview
   (`publishAccountWorkerBrowserObserver`) and does not attach a browser
   control bridge. `SandboxContext.browser` stays empty, so
   `sandboxBrowserBridgeUrl` is unset. The preview and the control channel
   are different pipes. The desktop can be READY while the agent has nothing
   to call.

`web_search` / `web_fetch` stay available, so the model treats public scrape
as the only web path.

## Routing

| Intent                                                                     | Surface                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Public HTTP, search, structured pages that do not need this user's cookies | `web_search`, `web_fetch`                                                            |
| Open or operate 云电脑 / 云端电脑                                          | `browser` tool, `target="sandbox"`, Account Computer                                 |
| Login, cookies, authenticated sites, click/type in the desktop browser     | same `browser` tool                                                                  |
| Password and one-time-code fields                                          | `secure_form` (already present). The browser tool still refuses to type those fields |
| Host browser, Chrome extension relay, node browser proxy                   | blocked for this session                                                             |

One Account Computer per user (tenant + user). Agents share that desktop.
Host browser control stays false. This change does not add a credential vault.

An operator deny still wins: `tools.deny`, per-agent deny, group deny, or an
explicit `tools.sandbox.tools.deny` that lists `browser`. The grant only
overrides the sandbox default deny, and only after the worker browser bridge
is attached.

When the inbound depth router is enabled, "打开云电脑 / 登录某站" classifies
as `act`, so the chat lane does not drop tools before the browser call.
A clear public-page ask classifies as `retrieve` (`public_web_tool`), so the
read-only ceiling keeps `web_fetch` / `web_search` and drops `browser`.

## Why a public ask still missed web_fetch

`candidate_capabilities` is recorded before the profile and sandbox allow
filters. `web_fetch` and `web_search` are built, so they show up there. The
coding profile does not include them, and the sandbox default allow list does
not either. The first Account Computer grant put only `browser` back. The
model-visible set then had the desktop browser and not the public HTTP tools,
so a public-page turn could not select `web_fetch` or `web_search`.

The grant now puts `web_fetch` and `web_search` back onto that allow list and
re-inserts the constructed tools unless an operator deny lists them. A turn
that is clearly a public fetch or search also hides `browser` and adds a
one-turn instruction to call `web_fetch` (URL present) or `web_search` (no
URL). Login and "open the cloud PC" still keep `browser`.

Reproduce on a tip gateway, with the Computer tab showing the dock:

- Public: `抓取 https://example.com 公开首页标题，不要打开云电脑`
  Expect `selected_capability=web_fetch`. Do not expect `browser`.
- Login: `我需要你直接打开云端电脑，登录京东`
  Expect `selected_capability=browser`. Do not expect
  `capability_gap:tool:browser-control` while `browser` is listed.

## Control path

`OPENBOT_ACCOUNT_WORKER_DOCKER=1` publishes the browser container's CDP port
on loopback. `attachAccountWorkerBrowserControl` starts the existing
attach-only bridge against that port. It does not create a second desktop.
The bridge URL is `SandboxContext.browser.bridgeUrl`. The `browser` tool
defaults to `target="sandbox"`.

The memory driver (unit tests, docker flag off) does not invent a bridge.
Without a bridge the prompt does not claim Account Computer control, so the
model is not told to call a tool that cannot run.

## Live miss on a gateway that did not have this branch

A tip gateway at #416 (`79456cd6`, before this branch) still answered
“请尝试在云电脑打开京东网站” with `capability_gap:tool:browser-control`.
The browser container was up and CDP answered `/json/version`. The model
never received the `browser` tool (`policy_filtered_capabilities` stayed the
sandbox default allow). That grant is the earlier commit on this branch.
The same session also showed four prompt problems, closed here:

1. The attached prompt no longer contains the literal line
   `Host browser control: blocked.` It says the Mac host is blocked and that
   this does not limit the Account Computer.
2. A line tells the model that earlier replies claiming the cloud PC browser
   is blocked are outdated while `browser` is listed.
3. Opening or logging into 云电脑 uses the `browser` tool directly. The
   prompt says not to route that through `browser-scan-proxy` or
   `independent-work`, and not to ask for a QR scan unless the login page
   requires it.
4. After `browser` open, focus, or navigate on the Account Computer bridge,
   CDP `Browser.getWindowForTarget` + `Browser.setWindowBounds` places the
   window at left 0, top 0, 1280×800 (`windowState: normal`) and
   `Target.activateTarget` brings it forward. The work area is the single
   function `accountComputerWorkArea()`. While an app window is open the Dock
   shelf is unmapped (#421), so placement fills the framebuffer. This does
   not edit `scripts/sandbox-browser-*` or the image Dockerfile.
5. If the browser lease exists but the control bridge does not attach, the
   prompt says the Account Computer is starting or unavailable and to retry.
   It does not say host browser control is blocked, and it forbids
   `capability_gap:tool:browser-control`. The log line includes the session
   key, agent id, and container name.

Reply-tag leakage (Chinese chain-of-thought before the reply tag) is a
separate change and is not handled here.

Exec workdir fallback (`agents/<id>/workspace is unavailable; using
agents/main/workspace`) comes from `resolveSandboxWorkdir` when the requested
host path fails the sandbox path check. That is not a one-line fix and is
left as-is.

## Open, shopping, and snapshots

`open` on the sandbox bridge used to throw
`strict browser SSRF policy requires Playwright-backed redirect-hop inspection`
before creating a tab. The bridge leaves `ssrfPolicy` unset, so the policy is
strict, and a loopback CDP profile is not marked as persistent Playwright.
`navigate` already went through Playwright and succeeded. `open` now uses
`createPageViaPlaywright` whenever that strict check is required and Playwright
is loaded, including the loopback sandbox bridge. Private, loopback, and
metadata targets, including a redirect hop onto one, stay blocked. The only
extra non-network URL is `file:///usr/local/share/openbot/desktop/index.html`,
and only when `accountComputerWorkArea` is set. `routes/tabs.ts` still places
the opened page.

The Account Computer prompt and the browser tool description carry the shopping
playbook: choose the spec, add to cart, and go to checkout when the user asked
to buy; list the item, quantity, price, and address and get one explicit
confirmation before 提交订单; stop on the cashier page for the user to pay;
do not delete or empty the cart unless asked. A platform or policy error from
the browser tool is a 云电脑 fault: quote the one-line reason, offer to retry,
and if `open` failed retry once with `navigate`. Do not send the user to
another app or device for that shopping task. `navigate` on a fresh bridge
with zero tabs opens `about:blank` through the same Playwright path, and that
bootstrap URL stays allowed under the strict SSRF policy. Login starts with a snapshot.
An already signed-in site continues. A typed password or SMS code uses
`secure_form`. A QR code or slider is the user's takeover of 电脑. The model
does not ask permission before clicking 「你好，请登录」. After the page
changes, it snapshots again before using a ref. A public site does not get
`capability_gap:tool:browser-navigation-blocked-by-ssrf-policy`.

On a public-fetch turn the provenance `policy_filtered_capabilities` list is
the tool list after `browser` is removed.

Role snapshots honor `maxChars`. The Account Computer bridge defaults that
limit to 12,000 characters. A click covered by an overlay is reported as
covered, and an AI role snapshot prints each `[ref=eN]` once.

## Tip verification

Flags (already required for the Computer tab preview):

- managed tenant mode with Account Worker enabled
- `OPENBOT_ACCOUNT_WORKER_DOCKER=1`
- sandbox browser image built (`scripts/sandbox-browser-setup.sh`)

Then, on a tip gateway, with the Computer tab showing the dock:

1. Ask the agent to open the cloud PC and log in to a site.
2. The run should call `browser` (`action=open` / `snapshot` / `act`) against
   the sandbox bridge. It should not answer with
   `capability_gap:tool:browser-control` while that tool is listed.
3. Ask `抓取 https://example.com 公开首页标题，不要打开云电脑`.
   The run should select `web_fetch` (or `web_search` when the ask has no
   URL). It should not select `browser` for that turn.
4. Host browser control remains blocked (`target="host"` errors).

This document does not authorize a production cutover.
