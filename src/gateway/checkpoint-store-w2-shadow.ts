import {
  runItem7W2DarkDualReadShadow,
  type Item7W2SiteId,
} from "../memory/item7-w2-dark-dual-read-shadow.js";

function scheduleShadow(input: {
  siteId: Item7W2SiteId;
  legacyLocator: string | null;
  replacementLocator: string | null;
}): void {
  runItem7W2DarkDualReadShadow(input);
}

/** S07: after resolveAgentWorkspaceDirForClient; must not shift the watch line above. */
export function scheduleCheckpointStoreS07Shadow(input: {
  legacyLocator: string | null;
  replacementLocator: string | null;
}): void {
  scheduleShadow({
    siteId: "S07-checkpoint-store-client",
    legacyLocator: input.legacyLocator,
    replacementLocator: input.replacementLocator,
  });
}

/** S05/S06: after workspaceDirs fully resolved; does not touch sync resolver watch lines. */
export function scheduleCheckpointStoreS05S06Shadow(input: {
  workspaceDirs: string[];
  employeeOwner: string | null;
}): void {
  const hostLegacy = input.workspaceDirs[0] ?? null;
  scheduleShadow({
    siteId: "S05-checkpoint-store-host",
    legacyLocator: hostLegacy,
    replacementLocator: null,
  });
  if (!input.employeeOwner) {
    return;
  }
  const stewardLegacy =
    input.workspaceDirs.find((dir) => dir.includes(input.employeeOwner!)) ?? null;
  if (!stewardLegacy) {
    return;
  }
  scheduleShadow({
    siteId: "S06-checkpoint-store-steward",
    legacyLocator: stewardLegacy,
    replacementLocator: hostLegacy,
  });
  void import("./workspace-resolver/item7-w4-shadow.js").then(
    ({ scheduleItem7W4StewardHelperShadow }) =>
      scheduleItem7W4StewardHelperShadow({
        ledgerId: "S06",
        catalogResourceId: null,
      }),
  );
}
