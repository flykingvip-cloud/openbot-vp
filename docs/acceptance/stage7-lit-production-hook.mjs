/**
 * Redirect Lit package entry points to the production node builds.
 * Vitest selects the `development` export, and that build rejects the
 * production templates when they are rendered with linkedom.
 */
import { pathToFileURL } from "node:url";

const redirects = new Map();

export function initialize(data) {
  if (data && typeof data === "object") {
    const record = data;
    if (typeof record.litHtml === "string") {
      redirects.set("lit-html", record.litHtml);
    }
    if (typeof record.reactive === "string") {
      redirects.set("@lit/reactive-element", record.reactive);
    }
  }
}

export async function resolve(specifier, context, nextResolve) {
  const file = redirects.get(specifier);
  if (file) {
    return {
      url: pathToFileURL(file).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
