/**
 * Daibai Action Catalog — 大白可代办动作的目录契约（类型层）。
 *
 * 设计要点（见 .kiro/specs/daibai-super-steward）：
 * - 目录驱动 execute：大白不再硬编码 if/else，而是查目录 → scope 校验 → 委派。
 * - **类型层禁止 ADMIN**：`requiredScope` 联合类型只含 read/write，编译期挡住越权目录项
 *   （与 `src/gateway/method-scopes.ts` 的 READ_SCOPE/WRITE_SCOPE 对齐，ADMIN_SCOPE 永不入目录）。
 * - 决策 E：`delegateTarget.mode` 区分「抽服务层(service)」与「网关内部 dispatch(internal-dispatch)」。
 * - 决策 F：`secondaryPermission` **仅作 UI 说明/预检提示**，不承担鉴权（鉴权由目标 service 自校验）。
 * - 决策 G：`requiresUserConfirmation` 的动作走确认票据（见 daibai-types 的 confirmation envelope）。
 * - 决策 H：robot-skills 等需目标范围约束的动作通过 `requiresOwnershipCheck` 标记，执行前做 ownership 预检。
 */

/**
 * 目录项允许的 operator scope —— **只含 read/write，刻意排除 `operator.admin`**。
 * 这是编译期护栏：任何尝试登记 ADMIN 动作的目录项都会类型不匹配。
 * 字面量与 `src/gateway/method-scopes.ts` 的 `READ_SCOPE` / `WRITE_SCOPE` 保持一致。
 */
export type DaibaiActionScope = "operator.read" | "operator.write";

/** 委派目标：按决策 E 二选一。 */
export type DaibaiDelegateTarget =
  | {
      /** E1：复用抽出的 service 函数。`ref` 为 service 标识（文档/注册用）。 */
      mode: "service";
      ref: string;
    }
  | {
      /** E2：受控网关内部 dispatch。`ref` 为目标 RPC method。 */
      mode: "internal-dispatch";
      ref: string;
    };

/** 动作成熟度：stub 实现标 experimental，UI 据此提示「实验性」。 */
export type DaibaiActionMaturity = "stable" | "experimental";

/** 构造委派参数的上下文（execute 运行期注入）。 */
export type DaibaiActionParamContext = {
  userId: string;
  tenantId?: string;
  sessionKey?: string;
  /** execute 透传的原始 payload。 */
  payload: Record<string, unknown>;
  /** 决策 H：经 ownership 预检后服务端解析出的、当前用户可管的目标 agentId（如适用）。 */
  resolvedAgentId?: string;
};

/** 目录项描述符。 */
export type DaibaiActionDescriptor = {
  /** 动作唯一标识（如 `support.case.create`）。 */
  actionId: string;
  /** UI 展示标题。 */
  title: string;
  /** 读/写语义。 */
  kind: "read" | "write";
  /** 所需 operator scope（编译期禁 ADMIN）。 */
  requiredScope: DaibaiActionScope;
  /** 委派目标（决策 E）。 */
  delegateTarget: DaibaiDelegateTarget;
  /**
   * 二级权限标识（如 `usage:budget`）。**仅用于 UI 说明/预检提示**，不承担鉴权（决策 F）。
   * 真正的二级权限校验由目标 service/方法自身现场解析完成。
   */
  secondaryPermission?: string;
  /** 成熟度；缺省视为 stable。 */
  maturity?: DaibaiActionMaturity;
  /**
   * 决策 H：是否需要目标机器人 ownership 预检（robot-skills.* 等）。
   * 为 true 时，execute 必须先用 `resolveManageableAgentIds` 校验目标 agentId 归属。
   */
  requiresOwnershipCheck?: boolean;
  /** 是否需要用户二次确认（决策 G：走确认票据）。 */
  requiresUserConfirmation: boolean;
  /** 确认卡片展示用：动作影响范围简述（如「改变该机器人的技能开关」）。 */
  impact?: string;
  /** 确认卡片展示用：是否为不可逆/破坏性动作（如卸载）。 */
  irreversible?: boolean;
  /** 由上下文构造最终委派参数。 */
  buildParams: (ctx: DaibaiActionParamContext) => Record<string, unknown>;
};
