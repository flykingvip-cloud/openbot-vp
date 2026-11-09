/** Fixed run teardown: every owned resource is released even if an earlier release fails. */
export async function cleanupEmbeddedRun(ports: {
  disposeContext: () => Promise<void> | undefined;
  stopCredentialRefresh: () => void;
  restoreWorkingDirectory: () => void;
}): Promise<void> {
  try {
    await ports.disposeContext();
  } finally {
    try {
      ports.stopCredentialRefresh();
    } finally {
      ports.restoreWorkingDirectory();
    }
  }
}
