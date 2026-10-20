/**
 * 分页工具函数（企业能力中心）
 *
 * 实现 design.md 中 Property 14: Pagination slice correctness
 * - 任意 total N、page size S ∈ {10, 20, 50}、page P，
 *   切片应包含 min(S, N - (P-1)*S) 个元素，起始索引 (P-1)*S
 * - 当 page size 变更导致 P 超出 ceil(N/S) 时，自动修正到 ceil(N/S)
 *
 * Validates: Requirements 3.6, 17.2, 17.4
 *
 * 所有函数均为纯函数：不修改输入，仅返回新值。
 */

/** 支持的每页条数 */
export type PageSize = 10 | 20 | 50;

/**
 * 计算给定 totalItems 与 pageSize 下的总页数。
 *
 * - `totalItems === 0` → 返回 1（UI 至少保留第 1 页占位）
 * - 其他情况 → `Math.ceil(totalItems / size)`
 */
export function totalPagesFor(totalItems: number, size: PageSize): number {
  if (totalItems <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(totalItems / size));
}

/**
 * Property 14: 自动修正越界页码。
 *
 * - `totalItems === 0` → 返回 1
 * - `page` 超过 totalPages → 返回 totalPages
 * - `page < 1` → 返回 1
 * - 在合法范围内 → 原样返回 `page`
 */
export function autoCorrectPage(page: number, totalItems: number, size: PageSize): number {
  const totalPages = totalPagesFor(totalItems, size);
  return Math.max(1, Math.min(page, totalPages));
}

/**
 * Property 14: 切片返回当前页的元素。
 *
 * - 返回 `items.slice((page-1)*size, (page-1)*size + size)`
 * - 至多包含 `size` 个元素，最后一页可能少于 `size` 个
 * - `page < 1` 视为第 1 页
 * - `page > totalPages` 时返回空数组（调用方应先用 autoCorrectPage 修正）
 * - 纯函数：不修改输入数组
 */
export function sliceForPage<T>(items: T[], page: number, size: PageSize): T[] {
  const safePage = page < 1 ? 1 : page;
  const start = (safePage - 1) * size;
  if (start >= items.length) {
    return [];
  }
  return items.slice(start, start + size);
}
