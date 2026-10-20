# 协作组成果治理与预览区交互 — 执行方案（v2.1）

> **状态**：完整验收通过（P0–P4 + D1–D5 + 余量项）  
> **修订**：v2 用户反馈 + v2.1 预览区状态 chip（已收录/已沉淀）

## 1. 背景与目标

| #   | 问题                            | 目标                                  |
| --- | ------------------------------- | ------------------------------------- |
| P1  | 协作组产物散落在 bot 私有工作区 | 组内产物统一落在 **组 workspace**     |
| P2  | 多版本/多副本冗余               | **logicalId 一行成果** + 用户一键定版 |
| P3  | 预览打不开组内文件              | 按 **groupId** 读组 workspace         |
| P4  | 多 bot 头像均显示「大」         | assistant 头像优先 `senderLabel`      |
| P5  | Stage 顶栏整理按钮与预览区重叠  | **预览区为唯一治理入口**              |
| P6  | 能力孵化入口常驻                | **检测驱动 + 创建即入 Skill 通道**    |

## 2. UX 裁定

### 2.1 预览区 Command Bar

```
[保存]  [编辑]  [分享]
```

- **保存**：一键三功能（持久化组 workspace + 设为正式版 + 沉淀知识库）
- **编辑 / 分享**：保留
- **移除**：下载、版本历史、丢弃 draft、独立「设为正式版」「沉淀到知识库」
- **Stage 顶栏**：移除「整理为草稿」「整理本次能力」

### 2.2 预览区状态 chip（v2.1）

打开预览时展示 **只读状态**（非按钮）：

| 状态            | 文案                          | 保存按钮                     |
| --------------- | ----------------------------- | ---------------------------- |
| 仅可预览        | `未保存`                      | 启用「保存」                 |
| 已 auto-capture | `已收录成果中心 · 待保存`     | 启用「保存」                 |
| 三合一成功      | `已保存 · 已沉淀至「{KB名}」` | 禁用（有未保存编辑时再启用） |
| KB 沉淀失败     | `已保存 · 知识库沉淀失败`     | 「保存」重试步骤 ③           |

Toast 与 chip 文案一致；chip 在再次打开预览时持久可见。

### 2.3 能力孵化

- L2–L4：**预览区底部**条件提醒（非 Stage 顶栏）
- 创建能力 ≠ 成果保存；确认创建 → `saveSkill` → 全生命周期通道

## 3. 后端

### 3.1 组 workspace

```
{groupWorkspace}/
├── drafts/{logicalId}/
├── deliverables/
├── .manifest.json
└── memory/
```

### 3.2 Capture

- Identity：`groupId::logicalId`（协作组）或 `ownerId::logicalId`（单聊）
- `drafts/` **不 capture**
- 协作组默认 `on-deliverable-envelope`

### 3.3 API

- `workbench.group-file.read` — 组 workspace 读文件（预览）
- `knowledge.deliverables.saveAndArchive` — 保存一键三功能

## 4. 实施阶段

| 阶段 | 内容                                                                        |
| ---- | --------------------------------------------------------------------------- | --- |
| P0   | group-file RPC、capture group identity、draft 排除、头像、预览 groupId 透传 |
| P1   | Command Bar + 状态 chip、Save API、移除 Stage 整理按钮                      |
| P2   | logicalId + drafts/deliverables 目录 + manifest                             | ✅  |
| P3   | L2–L4 能力提醒                                                              | ✅  |
| P4   | draft TTL、组 checkpoint                                                    | ✅  |

## 5. 验收

1. 组内文件预览 100% 从组路径读取
2. 同 logicalId 成果中心一行
3. 预览区仅 保存/编辑/分享 + 状态 chip
4. 保存一次完成 workspace + 正式版 + KB
5. Stage 无整理类按钮
