# Account Computer — pointer after 接管 + preview chrome declutter

Landing: `DESKTOP_POINTER_AFTER_TAKEOVER_M1`  
Date: 2026-10-08

## Problem

1. After 接管, **all mouse clicks** in the cloud desktop look dead (omnibox, new tab, arbitrary UI) even when the picture is live and chrome shows 交还. Soft-typing / keyboard-only remint (#469) is not enough if the pointer path is broken.
2. Preview panes (成果 + 电脑) show multiple nested borders / padding ("镶套") and the stream sits inside a padded gray frame instead of filling the red-highlighted preview region.

## Root cause (P0 dead clicks)

Observer bootstrap historically **stole** `mousedown` with capture + `stopPropagation`, then re-sent RFB pointer bytes via a custom map (`armPreviewPointer` + `installPreviewPointerMap` overriding `Display.absX/absY`).

That path was written for a **stretched** full-bleed canvas. After `scaleViewport` (uniform fit), stock noVNC already maps canvas-relative CSS → framebuffer correctly. The steal path:

- Prevents stock RFB mouse handlers from running
- Overrides `absX/absY` with letterbox math that assumed a different layout
- Silently no-ops if `RFB.messages.pointerEvent` / sock state misaligns

Result: picture paints, keyboard can still work once the iframe is focused, but **clicks never land** on remote Chromium.

Not a revert of #438/#439/#469. Iron gates (`controlsDesktop` + `INTERACTIVE` + ownership) remain; this tip fixes the **in-iframe pointer sender**.

## Fix (P0)

- Stop overriding `absX` / `absY`
- Stop capture `stopPropagation` on the screen
- Wrap `_sendMouse` only to inject move (mask 0) before button-down (x11vnc dock click quirk)
- Keep `viewOnly = false` on the client; relay still filters on grant.input

## Fix (P1 declutter + fill)

- `sidebar-content` padding → `0` when 电脑 or 成果 shell is shown
- Flatten artifact primary card chrome (no double border around doc/article)
- Stage / letterbox: `border-radius: 0`, no inset takeover outline; letterbox still width-first 1280×800 centered in the pane

## Iron rules unchanged

- `streamUrl ≠ FIRST_FRAME ≠ INTERACTIVE`
- No `location.reload` recovery
- Ownership FSM / takeControl remint semantics from #469 unchanged
- Right-dock default; no floating modal

## Accept probes

1. 接管 → `data-input-pointer=true`, iframe not inert, **real click** focuses remote omnibox / opens new tab
2. reloadCount=0; input remint still adopts new streamUrl
3. Docked 电脑: stream fills pane width (no 16px gray gutter); 成果 doc has a single surface, not gray→white nested cards
