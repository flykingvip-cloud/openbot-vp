# OpenBot / Grok Delivery

## Write to disk

1. Create an output dir under the writable workspace (e.g. visualize-out/)
2. Write title.html (and optional title.png)
3. Keep the absolute path for attach/reopen

## Hand to the user

| Env                     | How                                                               |
| ----------------------- | ----------------------------------------------------------------- |
| OpenBot chat            | Attach HTML/PNG; or platform artifact/deliverable if supported    |
| Grok Bot / Cursor agent | Report path; optional local preview via scripts/render.py --serve |
| User machine            | Open via file URL or local http                                   |

Do not:

- Emit Codex inline visualize tokens
- Claim public hosting unless user runs a separate hosting flow
- Require Codex widgets

## Static PNG

When the user asks for PNG: screenshot the rendered page with available browser/tools, save beside the HTML, attach it.

## With canvas

Explore here first; promote stable HTML to canvas materials / canvas.present when asked for a board. Do not ship conflicting deliverables silently.
