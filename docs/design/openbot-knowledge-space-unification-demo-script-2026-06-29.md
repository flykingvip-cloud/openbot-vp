# 知识空间统一化 — 联调录屏脚本（W9）

> 用途：按顺序操作并录屏，作为 SOP §A–E 的人工验收证据。  
> 预计时长：12–15 分钟。

## 准备

1. 本地 gateway + 员工端 UI 已启动。
2. 测试账号具备 enterprise seat（用于 team/enterprise 空间）。
3. 浏览器开发者工具可选打开 Network，便于展示 RPC 请求体含 `knowledgeBaseId`。

## 场景 1 — 创建个人空间并导入文件（≈2 min）

1. 知识工作台 → **创建知识空间**（唯一入口）。
2. 选择 **个人**，填写名称，提交。
3. 进入该空间 → **来源** Tab。
4. 点击 **新建/导入** → 上传一个小文件。
5. **录屏要点**：Network 中 `knowledge.personal.upload` 请求体含 `knowledgeBaseId`；来源表出现新条目。

## 场景 2 — 团队空间 + editor 导入网页（≈3 min）

1. 创建 **团队** 空间（需 tenant 上下文）。
2. 邀请另一账号为 **editor**（或切换 editor 测试账号）。
3. editor 登录 → 选中团队空间 → 网页收藏/import web。
4. **录屏要点**：editor 导入成功；viewer 账号尝试导入应失败（可选对比镜头）。

## 场景 3 — 企业空间 + active capability 绑定（≈2 min）

1. 创建 **企业** 空间。
2. 绑定 active source（api / external / capability 之一）。
3. 打开空间 **来源** Tab → 平面过滤 **主动供给**。
4. **录屏要点**：binding 出现在 active 列表；响应/详情中 visibility 与企业空间一致。

## 场景 4 — 列表三段分组（≈2 min）

1. 打开知识空间侧栏 / 首页库列表。
2. 展示 **个人 / 团队 / 企业** 三个分组（含 pinned/favorites 若已设置）。
3. 打开供给页，展示 personal / enterprise 区块数据来自同一空间列表。

## 场景 5 — 空间详情 passive / active 聚合（≈2 min）

1. 进入含文件 + active binding 的空间。
2. **来源** Tab：切换 **全部 → 被动收录 → 主动供给**。
3. 可选展开 web / datasets / agent 细粒度 Tab，说明其为 drill-down。

## 场景 6 — 兼容 warning（≈2 min）

1. 用 curl/CLI 调用 legacy 导入（不传 `knowledgeBaseId`）。
2. 展示响应 `compatWarnings` 含 `implicit_personal_inbox`。
3. 调用 `knowledge.compat.status`，展示 `warningStats` 计数增加。

## 场景 7 — Phase 3 强拒绝（≈2 min）

1. 设置 `OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID=1`，**重启 gateway**。
2. 再次 legacy 导入（无 kbId）→ 应 400。
3. 设置 `OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY=1`，**再次重启 gateway**。
4. `source.bind` 带 `visibility` 字段 → 应 400。

## 归档

- 文件名建议：`knowledge-space-unification-demo-2026-06-29.mp4`
- 与 `openbot-knowledge-space-unification-acceptance-report-2026-06-29.md` 一并提交。
