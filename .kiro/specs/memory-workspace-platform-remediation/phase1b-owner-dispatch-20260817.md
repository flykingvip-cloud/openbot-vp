# Phase 1B Owner Dispatch

Date: 2026-08-17  
From: `cursor-memory-platform`  
Baseline: `origin/main` `c7c5fa7961` (#449). Evidence PR: https://github.com/gmood2008/openbot/pull/450  
Unlock: **not issued**. `phase1bExecutionBlocked=true`. `deployAuthorized=false`.

转交时把对应指令全文发给该 owner。不要合并成一条“大家一起做”。

| 发给谁                         | 指令                                              | 现在要做                                                       |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------------------------- |
| `flykingvip-cloud`             | 下面「审 #450」一节                               | Approve / 合入 #450                                            |
| `codex-workspace-architecture` | `phase1b-instruction-architecture-20260817.md`    | 接受 item 2 Stage A 规则                                       |
| `cursor-data-governance`       | `phase1b-instruction-data-governance-20260817.md` | Stage A dump →（接受后）Stage B；item 3 接受包；item 5；item 7 |
| `cursor-memory-wsc`            | `phase1b-instruction-memory-wsc-20260817.md`      | item 4 同发布单元准备；item 6 SRE 半边                         |
| `cursor-fable`                 | `phase1b-instruction-fable-20260817.md`           | item 6 drill（既有 cutover）                                   |

全体共同禁止：LIVE、`deployAuthorized=true`、翻 `phase1bExecutionBlocked`、把 Phase 0 inventory 写成 Catalog、把 #448/#449/#450 当成 unlock。

## 审 #450（转给 `flykingvip-cloud`）

#450 是 2–7 的只读计量，不是写路径授权。合入后 2–7 仍全部 `not-met`。

请确认：无 `src/memory/**` / `src/gateway/workspace-resolver/**` 生产改动；`phase1bExecutionBlocked` 仍为 true；然后 Approve。
