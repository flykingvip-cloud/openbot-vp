# Tasks: Public Web Entry URL

## Agents

- kiro-public-web-entry · role: owner · scope: 固化 `www.openbot.love` 为用户可见的正式网页版入口，并保留 `gw` 兼容子域语义 · paths: `.kiro/specs/public-web-entry-url/**`, `AGENTS.md` · since: 2026-07-31

## 正式网页版入口规则

- [x] 核对 `www.openbot.love`、`gw.openbot.love` 与其他控制台子域的现有运行时语义和引用范围 — kiro-public-web-entry
- [x] 确认现有子域解析已将 `www` 识别为公共首页、将 `gw` 识别为员工兼容子域，无需修改运行时路由 — kiro-public-web-entry
- [x] 在仓库规则中固定用户可见的正式网页版入口，防止后续代理再次把 `gw` 推荐为首选入口 — kiro-public-web-entry
- [x] 通过独立语义审查识别并撤回未接入真实出站链接的无效 helper 改动，避免形成虚假修复或破坏 self-hosted 配置 — kiro-public-web-entry
- [x] 运行现有子域路由测试、格式检查和 Loom 归属校验；17 项路由测试通过，最终语义审查批准 — kiro-public-web-entry
