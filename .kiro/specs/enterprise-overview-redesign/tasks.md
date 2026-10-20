# 企业总览页信息架构重构（enterprise-overview-redesign）

## Agents

- cursor-fable · role: owner · scope: 企业总览页去重与分层重构、enterpriseChannels i18n 修复 · paths: ui/src/ui/ports/enterprise/views/enterprise-overview-surface.ts, ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts, ui/src/styles/components.css, ui/src/i18n/locales/zh-CN.ts, ui/src/i18n/locales/en.ts, ui/src/ui/navigation.ts, ui/src/ui/navigation.test.ts · since: 2026-06-12

## 背景

产品验收发现企业总览页三个区域互相重复：顶部状态条 4 个徽章与右栏「系统状态」同源重复（企业数据/模型配置），
「Runtime」在顶栏（机器人在线数）与右栏（presenceCount 网关节点数）同名不同源、同屏矛盾；
「机器人在线」「成本归因」两个事实各出现 3 次；侧边导航泄漏裸 i18n key `tabs.enterpriseChannels`。

## 信息架构（重构后）

告警层（仅异常时渲染单条横幅）→ 指标层（KPI 快照，唯一指标出现位置，可下钻）→
行动层（优先处理 = P0 阻断卡片 + 治理队列积压行）→ 参考层（系统状态 / 快捷入口）。

## Tasks

- [x] 1. 重构 `enterprise-overview-surface.ts`：删除顶栏 statusItems；告警条只渲染最严重一条、无异常不渲染；KPI 可下钻并带警示色；治理概览并入优先处理为「治理队列」行；侧栏 Runtime 改名「运行节点」；成本归因口径统一为 max(missingCostEntries, unattributedCostCount)；删除「进入优先处理」按钮与重复 CTA — cursor-fable
- [x] 2. `components.css`：新增 alert / queue / KPI warn 样式，移除 rail、governance-card、总览 dead header 样式 — cursor-fable
- [x] 3. i18n：zh-CN / en 补 `tabs|nav.items|subtitles.enterpriseChannels`（渠道治理 / Channel Governance）；`navigation.ts` 补 TAB_PATHS 与 navItemDescriptionForTab 分支；`navigation.test.ts` 增加防裸 key 回归断言 — cursor-fable
- [x] 4. 更新 `enterprise-surfaces.browser.test.ts`：command center 断言改为治理队列结构，新增「每个事实只出现一层」防回归用例；目标三个测试文件 121 用例通过 — cursor-fable
