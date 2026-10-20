---
name: cursor-canvas
description: "Create Cursor IDE .canvas.tsx analytical artifacts beside chat. ONLY for Cursor IDE runtime. On OpenBot cloud/headless robots do NOT call canvas.present for this skill — use json-canvas (.canvas files) as the deliverable instead."
homepage: https://cursor.com/docs/skills
metadata: { "openclaw": { "emoji": "🖼️", "always": true } }
---

# Cursor Canvas

Teach the agent to author Cursor IDE **Canvas** artifacts (`.canvas.tsx`) that open beside chat. Runtime is Cursor’s `cursor/canvas` module — this skill does not replace OpenBot’s node HTML canvas (`skills/canvas`).

Package version: 1.0.1 · Derived from Cursor builtin `~/.cursor/skills-cursor/canvas/`.

Use `{baseDir}/references/sdk/index.d.ts` (and sibling `.d.ts` files) for component/prop types.

## OpenBot cloud / headless robots (critical)

If you are running **inside OpenBot Gateway** (employee chat, cloud Linux, no Cursor IDE):

| Path                                 | Use?                                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write `.canvas.tsx` for Cursor       | ❌ No Cursor runtime                                                                                                                                     |
| `canvas.present` / skill `canvas`    | ❌ Needs paired Mac/iOS/Android **Node** + reachable canvas host; often fails with `trusted proxy user header missing` on headless trusted-proxy deploys |
| skill `json-canvas` → `.canvas` file | ✅ **Default deliverable** for cloud robots                                                                                                              |
| `browser` interactive dashboard      | ❌ Needs desktop Chromium on the host                                                                                                                    |

**Do not mark the skill as failed** when only `canvas.present` is unavailable — ship the `json-canvas` artifact and state that present requires a paired node client.

## When to use (Cursor IDE)

**Use when producing standalone analytical output:**

- Quantitative analyses and metrics breakdowns
- Billing or account investigations with structured findings
- Security audits or architecture reviews with categorized findings
- Cross-system data analyses and overlap reports
- MCP tool results where the data IS the deliverable
- Tables with more than a handful of rows the user asked to see

**Do NOT use when:**

- User wants a dashboard in another product (Datadog, etc.)
- Specific deliverable is a PR, reply draft, or code fix
- Targeted debugging / active development inside an existing artifact
- Short factual answers or one-off file edits
- OpenBot node WebView HTML canvas / `canvas.present` → skill `canvas` (paired Node required)
- OpenBot cloud robot visualization → skill `json-canvas`

## Workflow

### 1. Decide

Trigger is **user intent**: would the user benefit from a standalone artifact beside chat? If the output is a means to an end, skip the canvas.

### 2. Write the canvas

**Location (Cursor IDE):** `/Users/<user>/.cursor/projects/<workspace>/canvases/<name>.canvas.tsx`

- Write the file directly to that path; do not mkdir the managed directory.
- Descriptive kebab-case name ending in `.canvas.tsx`.

**File rules:**

- Exactly one `.canvas.tsx` per canvas; no helper/style modules.
- Import **only** from `cursor/canvas`.
- Default-export the top-level component.
- Embed all data inline. No `fetch()` / network calls.
- Never render empty states — omit empty sections; if no data, do not create a canvas.

**Charts/tables must be self-describing:** specific metric title, axis labels with units, legend when multi-series, source + time range caption.

**Component discovery:** prefer SDK components. Read `{baseDir}/references/sdk/index.d.ts` before inventing APIs. Also valid: `~/.cursor/skills-cursor/canvas/sdk/index.d.ts`.

### 3. Design

Flat, minimal, purposeful. Colors only from `useHostTheme()` tokens — no hardcoded hex.

**Forbidden (2+ = redesign):** gradients; emoji decoration; box-shadow; wall of identical cards; rainbow coloring; giant text; decorative borders.

**Pre-delivery self-check:**

1. Clear visual hierarchy (one primary focal point)
2. Composition variety (not one column of identical blocks)
3. Slop check against forbidden patterns
4. Honor `Canvas TypeScript check` from the write tool — common fixes: `CardHeader` uses `children` not `title=`; `CalloutTone` is `info|success|warning|danger|neutral`; prefer `Table` rows over mapping `Card` with `key` if typings reject it

### 4. Introduce to the user

Always link the `.canvas.tsx` when mentioning it. First canvas in a workspace: one sentence what a canvas is. Unsolicited canvas: one sentence why not plain text.

## Troubleshooting

Blank/missing canvas → wrong path (must be under that workspace’s `canvases/`). Treat `Canvas TypeScript check` as authoritative diagnostics.
