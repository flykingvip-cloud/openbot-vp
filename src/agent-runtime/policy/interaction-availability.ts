/** Narrow local I/O degradation only. Auth, quota, cancellation and unknown errors escape. */
export function isRecoverableInteractionSourceError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? error.code : undefined;
  return (
    typeof code === "string" &&
    ["EACCES", "EPERM", "EIO", "ENOSPC", "EROFS", "ENOENT", "ENOTDIR"].includes(code)
  );
}
