/**
 * Validate that an action input is a single read-only statement. Shared by the
 * relational database adapters (PostgreSQL, MySQL, …) so the guard lives in one
 * place. This is defense-in-depth; the authoritative protection is granting the
 * connector a read-only database role. Returns a normalized single statement
 * (trailing semicolon stripped) or throws on a disallowed/multi statement.
 */
export function resolveReadOnlyQuery(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    return "SELECT 1 AS ok";
  }
  const sql = raw.trim().replace(/;\s*$/, "");
  if (sql.includes(";")) {
    throw new Error("仅支持单条只读查询（不允许多语句）。");
  }
  if (!/^(select|with)\b/i.test(sql)) {
    throw new Error("仅允许 SELECT / WITH 只读查询。");
  }
  return sql;
}
