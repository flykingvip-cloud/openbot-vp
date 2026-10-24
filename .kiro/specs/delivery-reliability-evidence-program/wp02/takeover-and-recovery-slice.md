# WP-02 精确接管清单与修复切片：交接恢复接线

状态：WIRED (local) — loom `--via verified` 已追加精确路径；启动接线 + boot 测已落地，**未宣称 G2-H / ACCEPTED**  
拍板约束：不整片接管 `collaboration-dispatch/**` 或 `attempt.ts`；保持 handoff 开关与权限边界现状。`handoff-contract.ts` **未改**。

## 缺口实证（E0）

- `recoverPendingHandoffTxns` 定义于 `src/gateway/collaboration-dispatch/handoff-contract.ts`（约 L606+）。
- 非测试调用方：**无**。Gateway 启动仅接线 `recoverPendingDeliveries`（`server.impl.ts` ~L754），同文件未见 handoff recover。
- 行为：若 `cfg` 缺失或 `collaboration.task.handoffContract` 未启用 → 直接 `{ rolledForward: [] }`（安全空操作）。
- 启用时：扫描 `handoffsDir` 下 `*.txn`，`withRoundLock` + `rollForwardTask`。
- 已有单测：`handoff-invariant.test.ts` 覆盖 recover；缺「生产启动路径」集成与崩溃夹具证据包。

## 精确接管表（提议）

| 文件 | 当前 owner 信号 | 工作区 WIP？ | 接管依据 | 提议唯一 lander |
| --- | --- | --- | --- | --- |
| `src/gateway/server.impl.ts` | 多任务宣称（conversation-task-activate、development-supervisor、conversation-lifecycle、data-governance-v2-p0、diskgrant、宽泛 `src/**` 等） | 否（对照 git status 干净） | 唯一已知启动恢复挂点旁；需插入 handoff recover 调用 | grokbot-verifiable-delivery（**待 verify-then-take 确认**） |
| `src/gateway/collaboration-dispatch/handoff-contract.ts` | 主要为 `pi-sdk-family-migration-v3:cursor` 的 `src/**` 宽泛宣称；无更细 active 精确行 | 否 | 一般**不必改**（函数已存在）；仅当导出/签名不够用时再纳 | 默认不接管；保持现状 |
| `src/gateway/collaboration-dispatch/task-runtime.ts` | 同上宽泛宣称 | 否 | 只读依赖 `isCollabTaskHandoffContractEnabled`；**不改** | 不接管 |
| `src/gateway/collaboration-learning/handoff-contract-entry.ts` | tenant-context-propagation + `src/**` | 否 | 入口 API 不负责启动恢复；**不改** | 不接管 |
| 新测试文件（建议）`src/gateway/collaboration-dispatch/handoff-recovery.gateway-hook.test.ts` 或扩展既有 invariant 测 | 无 | n/a | 崩溃/重复恢复证据 | 随 server.impl 切片 lander |

**不在本切片：** `attempt.ts`、整个 `collaboration-dispatch/**`、权限/flag 默认值、OGUI 投影逻辑。

## 拟议修复（接管成立后）

1. 在 `server.impl.ts` 既有 delivery recovery 邻近，增加 fail-closed 的 `recoverPendingHandoffTxns` 调用：
   - 需要可用的 `RuntimeAuthority` / `handoffsDir` 解析路径（复用现有 authority 构造，不新建子系统）。
   - 传入 `cfgAtStart`；flag off 时保持空操作。
   - 错误记录日志，不阻断 Gateway 启动（与 delivery recovery 相同风格）。
2. 不改变 `collaboration.task.handoffContract` 默认 false；不放宽 bot-to-bot / 审批。
3. 测试夹具：
   - **失败复现：** 事实已持久化（txn/log），任务投影未更新时进程崩溃。
   - **修复后：** 重启后投影收敛；重复调用 recover **无二次副作用**。

## 接管仪式清单（执行前必做）

1. 通知 `server.impl.ts` 相关宣称方（至少 conversation-task / development-supervisor / data-governance / diskgrant 路径 owner）。
2. `pnpm loom register ... --via verified` 仅追加本切片精确路径（或 accept 精确 glob），保留历史 sessions。
3. 再次 `bun scripts/agent-attribution.ts`：切片文件无未协商 CONFLICT。
4. 小步 `scripts/committer`，Task/Agent trailers。

## 验收证据目标（G2-H 子集，未宣称达到）

- 启动路径存在对 `recoverPendingHandoffTxns` 的真实调用（非仅单测直接调用）。
- 崩溃夹具：投影收敛。
- 重复 recover：无二次 apply 效果。
- flag off：行为与今日一致（无写）。

## 落地记录（2026-10-24，Asia/Shanghai）

- Loom：`delivery-reliability-evidence-program:grokbot-verifiable-delivery` 追加 paths：
  `src/gateway/server.impl.ts`、`src/gateway/handoff-recovery-boot.ts`、`src/gateway/handoff-recovery-boot.test.ts`（`--via verified`）。
- 实现：新建 `handoff-recovery-boot.ts`（发现 pending `*.txn` → 构造 recovery authority → `recoverPendingHandoffTxns`）；`server.impl.ts` 在 delivery recovery 旁挂 fail-closed 异步调用；flag 默认仍 false。
- 测试：`pnpm exec vitest run src/gateway/handoff-recovery-boot.test.ts` — 2 passed（flag-off no-op；crash roll-forward + 幂等再跑）。
- `.loom/registry.yaml` 仍由 kiro-loom land；本切片代码 commit **不含** registry。
