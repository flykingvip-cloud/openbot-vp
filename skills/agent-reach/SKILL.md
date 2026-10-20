---
name: agent-reach
description: Multi-platform internet reach playbook for OpenBot agents. Use when the user wants to read or search the open web, X/Twitter, YouTube, Bilibili, Douyin, Xiaohongshu, Reddit, GitHub, LinkedIn, Boss Zhipin, or RSS. Prefer built-in OpenBot tools and existing skills (github, xurl, summarize, browser) before installing third-party CLIs. Not for site-wide scraping farms or login automation that bypasses safety policy.
metadata: { "openclaw": { "emoji": "🌐" } }
---

# Agent Reach (OpenBot)

Adapted from AI-First `agent-reach` pack. Knowledge only — no AI-First capability runtime.

## Tool priority (OpenBot-first)

| Need                                | Prefer first                           | Fallback                                 |
| ----------------------------------- | -------------------------------------- | ---------------------------------------- |
| Generic URL → readable text         | `web_fetch` / WebFetch, or `summarize` | Jina `https://r.jina.ai/<URL>` via shell |
| GitHub repos/issues/PRs             | skill `github` (`gh`)                  | —                                        |
| X/Twitter API (authenticated)       | skill `xurl`                           | —                                        |
| Interactive / login-gated page      | OpenBot `browser` tool                 | —                                        |
| YouTube / Bilibili metadata or subs | `yt-dlp` if on PATH                    | Ask user to install                      |
| Full-web search                     | OpenBot web search / Exa if configured | Browser search                           |

Never invent MCP server RPCs. Do not require Docker MCP stacks unless the user already runs them.

## Quick recipes

### Web page

```bash
# Prefer agent web_fetch / summarize tools when available.
curl -fsSL "https://r.jina.ai/https://example.com/article"
```

### GitHub

Use skill `github`. Examples: `gh repo view owner/repo`, `gh search repos "…"`, `gh issue list --repo owner/repo`.

### X / Twitter

Use skill `xurl` when authenticated API access is required. Do not scrape behind login without user-provided credentials and policy approval.

### YouTube / Bilibili

```bash
yt-dlp --dump-json "VIDEO_URL"
yt-dlp --write-auto-sub --skip-download --sub-lang en,zh-Hans "VIDEO_URL"
```

### Reddit

Prefer search APIs or browser. Direct `reddit.com/...json` often needs proxy on servers and may be blocked.

### RSS

```bash
# Python if feedparser available; otherwise fetch XML and summarize
python - <<'PY'
import urllib.request
print(urllib.request.urlopen("https://example.com/feed.xml", timeout=30).read()[:4000].decode("utf-8", "replace"))
PY
```

## Platform matrix

| Platform                        | OpenBot path                             | Extra config                                                                       |
| ------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Web                             | web_fetch / summarize / Jina             | None                                                                               |
| GitHub                          | `github` skill                           | `gh auth login` optional                                                           |
| X/Twitter                       | `xurl` skill                             | API auth                                                                           |
| YouTube / B站                   | `yt-dlp`                                 | Optional cookies/proxy                                                             |
| Reddit                          | browser / search                         | Proxy may be required                                                              |
| 小红书 / 抖音 / LinkedIn / Boss | Only if user already has a local MCP/CLI | Cookie/QR — guide via `user-guidance-protocol`, never store secrets in skill files |

## Safety

1. Prefer official CLIs and OpenBot tools over unofficial scrapers.
2. Cookie/token auth: store in approved secret stores; never echo full cookies into chat.
3. Respect platform ToS and rate limits; refuse large-scale scrapes (use policy escalation).
4. For marketing content ops on CN platforms, prefer existing role skills (`xiaohongshu-marketing`, `douyin-marketing`, …) for strategy; use this skill only for fetch/search mechanics.

## Scenario routing

1. **"打开/总结这个链接"** → detect host → web_fetch / yt-dlp / github / xurl
2. **"搜一下网上关于 X"** → web search skill/tool → summarize top sources
3. **"这个视频讲了什么"** → yt-dlp subs → summarize
4. **"GitHub 上某某项目"** → `github` skill

## Related skills

- `github`, `xurl`, `summarize`, `blogwatcher`
- CN content roles: `xiaohongshu-marketing`, `douyin-marketing`, `bilibili-content-strategy`
- Platform ops / binding UI: `openbot-platform-ops`, `user-guidance-protocol`

## Provenance

Source pack: AI-First `skill_packs/agent-reach` (CLI recipes). Rewritten for OpenBot AgentSkills; Aegis capability YAML / Docker MCP installers were not migrated.
