---
name: canvas
description: Build and present OpenBot HTML visuals — dashboards, charts, comparison panels, architecture diagrams, and office-style HTML reports — via canvas.present on paired Nodes, or as workspace HTML deliverables when no Node is available. Use the materials library under {baseDir}/materials for chart/diagram templates. NOT for Cursor IDE .canvas.tsx (cursor-canvas), Obsidian mind maps (json-canvas), or PPTX decks (cyber-ppt).
metadata: { "openclaw": { "emoji": "🖼️" } }
---

# Canvas Skill

OpenBot’s **HTML visualization suite**: materials (charts/diagrams) + delivery (`canvas.present` or HTML deliverable).

> Not Cursor IDE `.canvas.tsx` — that is skill `cursor-canvas`.

## OGUI routing (chat vs Canvas)

Simple `ogui-form` / `ogui-choice` stay **chat-inline** (skill `ogui-form`). Do **not**
force binary choices into `canvas.present` / A2UI. Canvas remains the HTML visual
workspace (charts, diagrams, materials). A2UI stays v0.8 — no `createSurface` v0.9.

Adapter (policy + optional `sendUserAction` mapping):
`src/gateway/protocol/ogui-canvas-adapter.ts` · design
`docs/design/ogui-p3-canvas-adapter-2026-10-13.md`.

## Skill routing (avoid overlap)

| User need                                                  | Skill                     | Deliverable                                                           |
| ---------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| Dashboard / chart / architecture HTML / office HTML report | **`canvas` (this skill)** | Node WebView or `<<DELIVERABLE file="….html">>`                       |
| Cursor IDE analytical artifact beside chat                 | `cursor-canvas`           | `.canvas.tsx` (Cursor runtime only)                                   |
| Mind map / node-edge canvas (Obsidian JSON Canvas)         | `json-canvas`             | `.canvas` JSON                                                        |
| Consulting PPTX slides                                     | `cyber-ppt`               | `.pptx`                                                               |
| Mermaid flowchart in Markdown                              | (no extra skill)          | Mermaid fenced block in chat/docs; HTML render via `canvas` if needed |

Do **not** invent a second HTML viz skill. Chart templates live under `{baseDir}/materials/`.

## When to use

- Dashboards, KPI boards, trend/comparison charts
- Architecture / sequence / tree / Gantt diagrams
- Compact decision cards and funnel/sankey visuals embedded in HTML
- Self-contained HTML pages for office review (report-style HTML, not PPTX)

## When NOT to use

- Cursor IDE session → `cursor-canvas`
- Pure mind-map / Obsidian canvas → `json-canvas`
- Editable PowerPoint → `cyber-ppt`
- Platform ops (create KB, cron, identity) → `openbot-platform-ops`

## Materials library

```
{baseDir}/
├── SKILL.md
├── adapters/wrap-widget-shell.html
└── materials/
    ├── tokens/visual-tokens.md
    ├── scenes/          # intent → chart/diagram guidance
    └── templates/       # 16 ready chart/diagram materials
        ├── manifest.json
        └── <id>/{template.md,widget-code.html,fixture.json}
```

### How to use materials

1. Match intent via `materials/scenes/*.md` or `materials/templates/manifest.json`.
2. Read `materials/templates/<id>/template.md`, adapt `widget-code.html` + `fixture.json`.
3. Read `materials/tokens/visual-tokens.md` for CSS tokens (keep light/dark readable).
4. Wrap fragment with `adapters/wrap-widget-shell.html` (`{{TITLE}}`, `{{WIDGET_BODY}}`).
5. Deliver via Node present **or** workspace HTML deliverable (below).

Ready template ids: `line-trend`, `bar-chart-multiple`, `scatter-chart`, `gantt-chart`, `funnel-bar-chart`, `sankey-chart`, `heatmap-chart`, `pie-donut-text`, `bar-stacked-legend`, `pie-chart-label-list`, `radar-chart-legend`, `radar-chart-lines-only`, `comparison-cards`, `sequence-diagram`, `tree-flow`, `architecture-elements`.

Fragment rules: `<style>` → content → optional `<script>`; root `data-dynamic-ui-widget` + `data-template`; Chart.js only from `cdn.jsdelivr.net` with static SVG/HTML fallback (Employee artifact sidebar may not run JS).

## Delivery paths

| Priority | Path             | When                                                                                        |
| -------- | ---------------- | ------------------------------------------------------------------------------------------- |
| 1        | `canvas present` | Online paired Node (Mac/iOS/Android) + reachable `canvasHostUrl`                            |
| 2        | HTML deliverable | Employee Web / headless: write HTML + `<<DELIVERABLE title="…" file="output/….html">>`      |
| 3        | `json-canvas`    | Only when user wants mind-map/node graph, or present unavailable **and** HTML is unsuitable |
| 4        | `browser`        | Optional; needs Chromium on gateway host                                                    |

### HTML deliverable (Employee Web default fallback)

```text
<<DELIVERABLE title="Q3 funnel" file="output/viz-funnel.html">>
```

Keep analysis in chat; HTML is the visual artifact. Prefer static-readable fallbacks.

## Architecture (canvas host)

Assets are served by the Gateway HTTP server under:

```text
/__openbot__/canvas/
```

```text
Node app  --WSS-->  nginx/Caddy  -->  127.0.0.1:18789 Gateway
Node WebView --HTTPS-->  same public origin + /__openbot__/canvas/...
```

Keep `gateway.bind: "loopback"` in production; terminate TLS on nginx/Caddy. No separate requirement to expose port `18793`.

### Headless cloud Gateway (trusted-proxy)

- `canvas.present` fails without a paired Node — use **HTML deliverable** (preferred) or `json-canvas` for mind maps.
- Do not bind `0.0.0.0` only to “fix” present.

### Cloud / VPS config

```json
{
  "gateway": { "bind": "loopback", "port": 18789 },
  "canvasHost": {
    "enabled": true,
    "baseUrl": "https://gw.example.com",
    "liveReload": false
  }
}
```

### Reverse proxy checklist

1. Proxy WebSocket + HTTP to `127.0.0.1:18789`
2. Forward `Host`, `X-Forwarded-Proto`, `X-Forwarded-For` / `X-Real-IP`
3. Allow `/__openbot__/canvas/` (and `/__openbot__/cap/...` if used)
4. Public **443** only — not raw `18789` / `18793` unless intentional LAN mode
5. Restart gateway after config change

### What NOT to do

- Bind `gateway.bind` to `lan` / `0.0.0.0` only to fix canvas on public cloud
- Open security group to `18789` without auth review
- Advertise `http://127.0.0.1:...` to remote nodes

## Actions

| Action     | Description                          |
| ---------- | ------------------------------------ |
| `present`  | Show canvas with optional target URL |
| `hide`     | Hide the canvas                      |
| `navigate` | Navigate to a new URL                |
| `eval`     | Execute JavaScript in the canvas     |
| `snapshot` | Capture screenshot of the canvas     |

## Workflow (Node present)

### 1. Create HTML

Default root: `~/.openbot/workspace/canvas` (or `canvasHost.root`). Prefer materials templates for charts.

```bash
# Write self-contained HTML under canvas root, e.g. dashboard.html
```

### 2. Confirm public URL

```bash
openclaw config get canvasHost.baseUrl
# https://<public-host>/__openbot__/canvas/dashboard.html
```

### 3. List nodes

```bash
openclaw nodes list
```

Need an online node with canvas capability.

### 4. Present

```text
canvas action:present node:<node-id> target:https://gw.example.com/__openbot__/canvas/dashboard.html
```

### 5. Fallbacks

No Node → HTML `<<DELIVERABLE>>`. Mind-map request → `json-canvas`. Optional `browser` if Chromium is on the host.

## Debugging

| Symptom            | Likely cause                                 | Fix                                 |
| ------------------ | -------------------------------------------- | ----------------------------------- |
| Blank WebView      | `http://127.0.0.1` advertised to remote node | Set `canvasHost.baseUrl`, restart   |
| Pairing stuck      | Auth / allowlist / network                   | `openclaw nodes list`               |
| 404 on canvas path | Proxy missing `/__openbot__/canvas/`         | Update nginx                        |
| browser tool fails | No Chromium                                  | Install or skip to HTML deliverable |

```bash
curl -I "https://gw.example.com/__openbot__/canvas/"
```

## Tips

- Keep HTML self-contained (inline CSS/JS)
- Disable `liveReload` in production
- Prefer `baseUrl` + loopback over opening the gateway on all interfaces
- Reuse `materials/` before hand-rolling charts
