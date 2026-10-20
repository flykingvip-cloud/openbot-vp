# 工具约定

供应商无关。映射到 OpenBot `web_search` / `web_fetch`，或本技能 `scripts/run_research.py`。

`web_search` 与 `web_fetch` 二选一即可。未配置搜索 key 时跳过 Search，只用 Fetch 读官方站、文档、GitHub 或用户给出的 URL。不要把缺搜索 key 当成无法抓页。

## Search

输入：

```json
{ "query": "string", "recency_days": 30, "domains": ["example.com"] }
```

输出：

```json
{
  "results": [
    {
      "title": "string",
      "url": "https://example.com",
      "snippet": "string",
      "published_at": "2026-01-01"
    }
  ]
}
```

## Fetch

输入：

```json
{ "url": "https://example.com" }
```

输出：

```json
{ "url": "https://example.com", "title": "string", "text": "string", "published_at": null }
```

## Report

至少包含：`summary`、`methodology`、`findings`、`claims`、`limitations`、`sources`。
