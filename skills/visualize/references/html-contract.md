# HTML Contract (OpenBot)

## File

- lowercase-hyphen.html
- Prefer full standalone page

## Content

- Focus on the visual; explain in chat
- Literal markup on disk
- Root: div#viz-root via getElementById
- Keep under 1MB

## Network

Allowed CDN hosts listed in SKILL.md.
Prefer inlined data.

## Theme classes (assets/template.css)

Colors: --background --foreground --card --border --primary --muted-foreground --viz-series-1..6
Layout: .card .viz-row .viz-grid .viz-controls .viz-stat
Controls: .btn .btn-primary .form-label .form-control .form-range
Text: .text-muted .text-small .tabular-nums .sr-only
Keep chart area transparent. Mockups must not rely on these utility classes.

## A11y

- Semantic HTML + native keyboardable controls
- Dynamic results: aria-live=polite; validation: role=alert
- Every SVG/canvas needs a short accessible name
- Touch targets ~44px; essential actions without hover
- Honor prefers-reduced-motion

## Pre-reply checklist

- [ ] Opens locally; primary interaction updates the visual
- [ ] No undefined JS identifiers; queried nodes exist
- [ ] Readable in light and dark
- [ ] No Codex / OpenAI host APIs
