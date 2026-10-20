/**
 * Append-only 账本助手。
 *
 * 计费账本类记录（Bill / CostSnapshot / seat_history / plan_version / 状态历史 /
 * 预算历史 / 事件日志）必须**只追加、不可改删**，以保证可追溯性（R11.1 / R11.5 /
 * Property 5）。本模块提供唯一插入路径：重复 id 的写入被拒绝并抛错。
 *
 * 纯函数（无 IO），可被属性测试覆盖。
 */

/** 违反账本不可变约束（尝试覆盖既有记录）。 */
export class LedgerImmutabilityError extends Error {
  constructor(public readonly recordId: string) {
    super(`append-only ledger: record "${recordId}" already exists and cannot be overwritten`);
    this.name = "LedgerImmutabilityError";
  }
}

/**
 * 向 append-only 集合追加一条记录，返回新集合（不修改入参）。
 * 若 id 已存在则抛 {@link LedgerImmutabilityError}（拒绝覆盖既有记录）。
 *
 * 不变量（Property 5）：
 * - 返回集合长度 = 原长度 + 1（单调不减）。
 * - 既有记录的字段值保持不变。
 * - 既有 id 重复写入被拒绝。
 */
export function appendLedgerRecord<T extends { id: string }>(
  collection: readonly T[],
  record: T,
): T[] {
  if (collection.some((existing) => existing.id === record.id)) {
    throw new LedgerImmutabilityError(record.id);
  }
  return [...collection, record];
}

/**
 * 断言对账本的「下一个状态」是合法的只追加演进：
 * - 长度单调不减；
 * - 既有记录按 id 一一对应且字段未被修改。
 * 用于在 store 持久化前做防御性校验，违例抛 {@link LedgerImmutabilityError}。
 */
export function assertAppendOnly<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
): void {
  if (next.length < previous.length) {
    throw new LedgerImmutabilityError("<length-decreased>");
  }
  const nextById = new Map(next.map((r) => [r.id, r] as const));
  for (const prev of previous) {
    const found = nextById.get(prev.id);
    if (found === undefined) {
      // 既有记录被删除。
      throw new LedgerImmutabilityError(prev.id);
    }
    if (JSON.stringify(found) !== JSON.stringify(prev)) {
      // 既有记录字段被修改。
      throw new LedgerImmutabilityError(prev.id);
    }
  }
}
