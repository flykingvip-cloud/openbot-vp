# 切片 2：旁路历史信任边界／去重身份／模块拆分

时区：Asia/Shanghai。PR [#216](https://github.com/flykingvip-cloud/openbot-vp/pull/216)。  
工作树：`/Users/daniel/AI VP/openbot-pr216-slice2`。对照树未改。  
**不合并、不生产部署。**

## 绑定

- **行为 tip**：`c533c4d79f33861379922534a1341a66f9fcd42b`
- 上一轮（merge-then-bound）：`08d1f319849d819c1ae609fe40ab5104603f9fbf`
- 祖先门禁：推送前 `git fetch origin && git merge-base --is-ancestor origin/main HEAD`

## 三项改法

1. **信任边界**：旁路 Q&A 不再进入 `extraSystemPrompt`。`chat.history` 仍按 user/assistant 原角色展示；A 结束后普通回复把旁路记录经 `wrapUntrustedPromptDataBlock` + `appendUntrustedContext` 注入 commandBody，并标明不可信、不构成新指令／授权／当前事实；字符预算 `ASIDE_NORMAL_REPLY_CONTEXT_MAX_CHARS=4000`（24 条 turn cap 之上再裁）。
2. **去重身份**：`stableDialogueMessageIdentity` 只认共享稳定 `messageId`（`mid:…`）。缺身份或 `aside:` 合成 id 返回 `null`，保留重复短问（「为什么」「继续」）。
3. **模块边界**：纯历史读／格式／合并／预算落到 `mid-task-aside-dialogue-history.ts`（无 `pi-embedded`）；`get-reply-run`／`chat.ts` 静态引用；lane 模块保留执行与 re-export。

未返工：先合并再裁剪；正常回复可读 B 的接线。

## 测试

```
pnpm exec vitest run \
  …（见 slice2-reply-lane-joint-verification.md 联合清单，含 get-reply-run.aside-dialogue-context）
```

**23 files / 268 passed**。

## 诚实缺口

- A/B 仍不共址 jsonl（有意；统一可见／可追问／有界／不重复已满足）。
