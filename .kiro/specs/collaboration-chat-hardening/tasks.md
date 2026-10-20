# Collaboration Chat Hardening (post #1148)

## Agents

- cursor-composer · role: owner · scope: post-merge hardening for collaboration chat UX landed in #1148 · paths: src/gateway/collaboration-dispatch/**, ui/src/ui/chat/**, .kiro/specs/collaboration-chat-hardening/\*\* · since: 2026-09-16

## Status (2026-09-16)

| Item               | State                                               |
| ------------------ | --------------------------------------------------- |
| **#1148**          | ✅ Merged to `main` (`01c8e326a0`)                  |
| **主体机制**       | ✅ 已上线，方向合理                                 |
| **已知合并后风险** | 2× P1、2× P2（见下）                                |
| **后续动作**       | 独立 hardening PR，**不回滚 #1148**                 |
| **生产部署**       | hardening PR 合并前应谨慎；至少先确认两个 P1 已覆盖 |

## Priority backlog

### P1 — 引用文本触发 mention

- **#1148 已做（短期）**：UI `composeQuotedUserMessage()` 将引用 excerpt 内 ASCII `@` 转为全角 `＠`；`quote-draft.node.test.ts` 跨层调用 `collectMentionTokens` 验证。
- **Hardening（本 PR）**：Gateway `collectMentionTokens` 在扫描前剥离 `【引用】` 块，防御旧客户端或未转义路径。
- **后续（结构化）**：`chat.send` 携带 `composerQuote` metadata，mention 解析仅读 composer body（本 PR）。

### P1 — scope 二次 catalog miss

- **#1148 已做**：`resolveGroupDiscussionScope()` 在 `managedSpace === null` 时 `throw CollaborationSpacePermissionsError()`。
- **#1148 已测**：`chat.group-write-acl.test.ts` — scope re-list throw / catalog miss after write ACL。

### P2 — 发送失败恢复 quote

- **#1148 已做**：`previousQuoteDraft` + `app-chat.node.test.ts`。

### P2 — 长文本与真实附件混合粘贴

- **#1148 已做**：`text-attachment-and-files` plan + `paste-as-attachment.node.test.ts`（长文本 + image）。

### 工程门禁

- **fresh `origin/main`**：hardening PR 必须基于最新 trunk。
- **`app.ts` LOC**：合并后 `4341` ≤ 预算 `4347`（`lint:core:composition-root-loc`）；持续债务见 `ui-composition-root-loc-debt/tasks.md`。
- **完整 `pnpm check`**：合并前在 hardening PR 上跑通；`lint:ui:style-contract` / `no-raw-svg` / `style-colors` 已落地（本 PR）。

## Tasks

- [x] 记录合并后状态与本 backlog — cursor-composer
- [x] Gateway：引用块剥离 + mention-utils 回归测试 — cursor-composer
- [ ] CI Gate + scoped tests green on hardening PR — cursor-grok (lint unused import, protocol Swift, S02/S16 freeze, composerQuote takeover pin; in flight)
- [x] 结构化 quote metadata（`composerQuote` + UI/Gateway 接线）— cursor-composer
- [x] Trunk CI lint 脚本（style-contract / no-raw-svg / style-colors）— cursor-composer
