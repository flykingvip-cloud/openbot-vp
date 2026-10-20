---
name: finance-research
description: Financial research and reporting for OpenBot. Use when the user wants stock/index quotes, market+news deep research into an auditable Markdown report, or PDF financial table extraction with deterministic metric calculations. Produces workspace deliverables; does not execute trades or give personalized investment advice. Prefer web_fetch, write, nano-pdf, and canvas chart materials — not AI-First sidecars.
metadata: { "openclaw": { "emoji": "📈" } }
---

# Finance Research

Merged from AI-First packs: `deep-research-finance`, `stock-market-retrieval`, `financial-analyst`. Workflow knowledge only — no Aegis capability runtime or local finance sidecar.

## Hard boundaries

- **Not** investment advice or trade execution.
- Label estimates and third-party quotes clearly.
- Confirm medium/high-risk writes (overwrite reports, PDF export) with the user.
- Prefer public quote endpoints or user-provided data files over unofficial scrapers.

## Playbook A — Market quote

**Trigger:** “查一下股价 / 指数 / 汇率”

1. Parse symbols (A-share / HK / US) and intent (price, change %, PE if available).
2. Fetch via allowed HTTP sources (examples — verify availability at runtime):
   - Sina / Tencent finance public quote endpoints (CN)
   - Yahoo Finance chart/quote JSON (US/global) when reachable
3. On timeout: fallback to alternate source once, then report failure with last error.
4. Format Markdown table: symbol, price, change, currency, source, timestamp (UTC).
5. Optional chart: skill `canvas` + `materials/templates/line-trend` when user wants a visual.

## Playbook B — Deep research report

**Trigger:** “对某标的做深度研究 / 出研究报告”

Pipeline (adapt paths to workspace):

1. **Collect market snapshot** → `output/finance/<symbol>/market.json`
2. **Collect news/search hits** → `output/finance/<symbol>/news.json` (web search / web_fetch)
3. **Deterministic metrics** (growth, margins, simple ratios) from structured numbers — use Python/pandas in shell when needed; show formulas
4. **Write Markdown report** → `output/finance/<symbol>/report.md`
5. **Manifest** with run id + SHA256 of artifacts → `output/finance/<symbol>/manifest.json`
6. Declare deliverable:

```text
<<DELIVERABLE title="Research: SYMBOL" type="document" file="output/finance/SYMBOL/report.md">>
```

Report skeleton:

```markdown
# Research Report: SYMBOL

## Market snapshot

## News / filings (with URLs)

## Computed metrics (formulas)

## Risks and unknowns

## Sources & timestamp
```

Optional PDF: only if user asks and a safe converter is available; otherwise keep Markdown + offer `cyber-ppt` for slide form.

**Do not** call AI-First mock sidecar `127.0.0.1:8787`.

## Playbook C — PDF financial tables

**Trigger:** “从这份财报 PDF 抽表并算指标”

1. Locate PDF in workspace.
2. Extract tables via `nano-pdf` / available PDF tools / Python libraries present on host.
3. Compute requested metrics (sum/mean/derived columns) with explicit formulas.
4. Write `output/finance/pdf-analysis/<name>.md` and declare `<<DELIVERABLE>>`.
5. If parse fails: stop with extraction error — do not invent numbers.

## Confirm policy

| Action                              | Risk                                  |
| ----------------------------------- | ------------------------------------- |
| Quote lookup                        | Low — proceed                         |
| Write research report               | Medium — confirm symbol + output path |
| Overwrite prior report / export PDF | High — second confirm                 |

## Related skills

- Charts/HTML boards → `canvas`
- Slide decks → `cyber-ppt`
- PDF editing → `nano-pdf`
- Internet fetch mechanics → `agent-reach` / `summarize`

## Provenance

Source: AI-First `deep-research-finance`, `stock-market-retrieval`, `financial-analyst` workflow YAML. Sidecar URLs and Aegis capability IDs removed; OpenBot tools substituted.
