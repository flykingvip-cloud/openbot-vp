# ATTRIBUTION

## Origin

This OpenBot visualize skill is inspired by concepts from the OpenAI Codex
visualize plugin (in-conversation interactive HTML explorers, fragment wrapping,
theme-aware charts). The skill text, delivery model, and templates here were
rewritten for OpenBot / Grok Bot and are not a verbatim copy of proprietary
Codex skill prose.

## No affiliation

This package is not affiliated with, endorsed by, or sponsored by OpenAI.
Do not present it as an official OpenAI or Codex plugin.

## Assets and scripts

- scripts/render.py — adapted utility: wraps an HTML fragment with a local
  template and optional localhost preview. Logic simplified for OpenBot.
- assets/template.css / assets/template.html — rewritten minimal theme and
  helpers. Prefer these over copying any upstream proprietary stylesheet, SVG
  branding, or host chrome.
- Branding SVGs / plugin.json / openai.yaml from upstream packages are
  intentionally omitted.

## Redistribution

Before redistributing any file that was copied or substantially derived from a
third-party package, the redistributor must confirm they have the necessary
rights under that package license and applicable terms. When in doubt, keep
only the rewritten OpenBot documents and newly authored templates in this tree.
