/**
 * Gateway composition root for placement authority.
 * Production install has no parameters: it binds resolveStateDir() once.
 * Runtime rebind by stateDir lives only in the test harness.
 */
import { resolveStateDir } from "../../config/paths.js";
import {
  getPlacementAuthorityBindings,
  tryBindPlacementAuthorityOnce,
} from "./placement-platform-bindings.js";

export { getPlacementAuthorityBindings };

/**
 * Production entry. No arguments. Binds resolveStateDir() once.
 * A second call is a no-op and does not switch directories.
 */
export function installPlacementPlatformAuthority(): {
  ok: true;
  stateDir: string;
  alreadyBound: boolean;
} {
  if (arguments.length > 0) {
    throw new Error("placement authority production install does not accept arguments");
  }
  return tryBindPlacementAuthorityOnce(resolveStateDir());
}
