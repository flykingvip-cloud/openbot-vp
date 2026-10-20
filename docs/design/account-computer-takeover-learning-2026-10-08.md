# Account Computer · M5 Takeover Learning（接管学习）

> **状态：MVP 设计 + 可验证垂直切片** | 日期：2026-10-08 | Landing：`DESKTOP_TAKEOVER_LEARNING_M5`
>
> **触发：** ROADMAP v3 在 session / stall / ownership / agent-action / takeover 因果链已齐后，要求把**人接管桌面**的回合沉淀为 **per-site skill draft**，供后续策展；**不**重建 collaboration-learning。
>
> **关联：** #439 Interaction Ownership；Desktop Session Runtime（M1b）；Clipboard（#445，正交）；Artifact Grant（#442，正交）。

---

## 0. 一句话结论

| 输入（已有） | 本片产出 | 明确不做 |
| --- | --- | --- |
| `DesktopSessionPhase` + stall | 回合开始时的 session 上下文 | 视频演示管线 |
| Ownership `HUMAN_TAKEOVER` → `GRACE` → hand-back | Episode 因果记录 | 改 Ownership FSM 语义 |
| 短 agent-action 摘要（可红acted） | `SiteSkillDraft`（resolved 且有 siteHost） | 自动批准 / 自动发布 skill |
| 人驱桌面再交还 | 策展钩子（纯函数 + 内存 store） | 整包 collaboration-capsule 晋级 |

**接管学习 = 观察 Ownership 边界事件 → 记 episode → 仅在 resolved 时起草站点课。**

---

## 1. 因果输入

```text
sessionPhase ──┐
stall path    ─┼──► beginTakeoverEpisode (on → HUMAN_TAKEOVER)
ownership     ─┤         │
agentAction*  ─┘         ▼
                   active TakeoverEpisode
                         │
         HUMAN_HAND_BACK / GRACE_ELAPSE
                         ▼
              complete(outcome=resolved)
                         │
                         ▼
              deriveSiteSkillDraft?  (resolved ∧ siteHost)
```

\* `agentActionSummary`：短字符串；**禁止** token / 完整 URL（hostname + path 可保留）。`normalizeSiteHost` 剥 credentials / query / fragment。

`triggerReason`（MVP 枚举）：`uncertain_decision` | `user_preempt` | `stall_recover` | `other`。观察器可从「先前 INTERACTIVE」推断 `user_preempt`，从 `STREAM_STALLED` / `RECONNECTING` 推断 `stall_recover`。

---

## 2. Episode 与 Draft

**TakeoverEpisode（要点）：** `episodeId`、`accountKey`、`siteHost`、`sessionPhase`、`ownershipBefore/During/After`、`triggerReason`、`agentActionSummary`、`outcome`、`timestamps`。

**SiteSkillDraft：** `{ siteHost, title, lesson, capabilities[] }`  
- 仅 `outcome === "resolved"` 且 `siteHost` 非空时生成。  
- `capabilities` 最小集：`desktop.takeover`、`desktop.hand_back`；stall 时可加 `desktop.stall_recover`。

Store：默认进程内 / 会话内 Map；可注入；gateway 后续可 `list()` 收口。不做本片强持久化契约。

---

## 3. 接线原则

1. **Ownership FSM 仍是权威**（`reduceInteractionOwnership` 不变）。
2. `observeOwnershipTransitionForLearning(prev, next, ctx)` 只观察：  
   - → `HUMAN_TAKEOVER` → `begin`  
   - `HUMAN_TAKEOVER` → `GRACE` → `complete(resolved)`  
   - 非 GRACE 离开 takeover → `abandon`  
   - `GRACE` → `BACKGROUND_AGENT`：若 episode 仍活跃则补 `complete`
3. Preview：`takeoverComputerPreview` / `handBackComputerPreview` / grace tick 后调用观察器，并传入 `pageUrl`（来自 `connection.remotePageUrl` 或可选 override）。`noteComputerRemotePageUrl` / `applyServerComputerPreview({ pageUrl })` 写入 sanitized 原始 URL（非仅 host）。DOM：`data-takeover-learning=active|idle` + `data-takeover-site-host`（有 host 时）。不堆 M1 chrome。
4. Draft：`complete` → `deriveSiteSkillDraft` → 内存 `completedDrafts` + 可选 `host.onTakeoverSkillDraft`；gateway 侧 `persistTakeoverSiteSkillDraft` 仅写 `lifecycle: "draft"`（`autoInstallEnabled: false`）。

---

## 4. 铁律（继承 Account Computer）

- 无 `location.reload`；无 DPR 改动；`streamUrl` 只到 `STREAM_ATTACHED`。
- 不改 Clipboard / Artifact Grant / 代付。
- 摘要与 draft **无 token、无完整 http(s) URL**。

---

## 5. 延期（Deferred）→ 现已部分落地

| 项 | 状态 |
| --- | --- |
| **siteHost 接线**（`remotePageUrl` / `noteComputerRemotePageUrl` → observe） | **Now** — `DESKTOP_TAKEOVER_SITEHOST_SKILL_M1` |
| **Draft skill 持久化**（`persistTakeoverSiteSkillDraft` → `lifecycle: "draft"`） | **Now** — 仅 draft；UI 侧 `list/consumeTakeoverSkillDrafts` + `host.onTakeoverSkillDraft` |
| 自动发布 / 自动批准 skill | **仍延期** — 需策展与租户策略 |
| 演示视频 / 逐帧动作 ingest | 仍延期 — learn-from-demonstration 大管线 |
| collaboration-capsule 晋级 | 仍延期 — 避免重写 `packages/collaboration-core` |
| 多会话 greenfield | #423 仍是一用户一桌面 |
| 跨设备同步 draft | 仍延期；本片进程内 buffer + 可选 host 钩子写盘 |

---

## 6. 验收要点

1. Vitest：begin / complete / abandon；siteHost 规范化；红action；draft 仅 resolved；观察器不破坏 ownership 单测。  
2. 云电脑体验审核 REVIEW_PASS + 本机验收 PASS 后由父代理 squash；accept bot **不** merge。  
3. siteHost follow-up：验收关注 `data-takeover-learning` + 在已 note URL 时 `data-takeover-site-host`；skill 仅允许 `lifecycle=draft`（勿按 auto-approve 硬卡）。
