# Account Computer — post-takeover input + session stream bind + vertical center

Landing: `DESKTOP_POST_TAKEOVER_INPUT_M1`  
Date: 2026-10-08

## Problem

1. After 接管, omnibox typing can stay dead when openPlan status-skips on a stale/view-only grant, or when chrome sessionKey diverges from workbench selection.
2. Switching bots while 电脑 is open never mints a per-session `streamUrl` → Skill孵化 forever 「正在连接…」 while a sibling paints.
3. Header 「交还」 used connection-wide `userTakeover`, so a sibling chat falsely showed handback without `controlsDesktop`.
4. Letterbox inline `position:relative` overrode CSS `position:absolute; top:50%; transform` → stream stuck at bottom of the docked pane.

## Fix

- Takeover clears `inputGrantLive` + `issuedMode` so next open remints `takeControl`.
- `grantLive` requires `issuedMode === "input"`.
- `syncComputerPreviewAfterSessionSwitch` on employee/shell session switch when computer dock open.
- `showHandBack = controlsDesktop` only.
- `refreshAccountComputerPreview` aligns to `resolveWorkbenchChatSessionKey`.
- Remove letterbox inline position (keep right-dock; vertical center only).

## Iron rules unchanged

- `streamUrl ≠ FIRST_FRAME ≠ INTERACTIVE`
- No `location.reload` recovery
- Shared Account Computer (#423) one desktop; tokens still per sessionKey
