/**
 * Vite hashed chunks plus an HTML cache-bust query (`index-xxx.js?v=…`) create
 * two ESM identities for the same entry. The second graph re-runs Lit
 * `@customElement` and throws NotSupportedError, which aborts the employee
 * workbench lazy load (`cli-credential-self-panel` is the first collision).
 *
 * Call once before any component module evaluates.
 */
let installed = false;

export function installIdempotentCustomElementDefine(): void {
  if (installed || typeof customElements === "undefined") {
    return;
  }
  const proto = CustomElementRegistry.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "define");
  const original = descriptor?.value as typeof proto.define | undefined;
  if (typeof original !== "function") {
    return;
  }
  proto.define = function patched(
    this: CustomElementRegistry,
    name: string,
    constructor: CustomElementConstructor,
    options?: ElementDefinitionOptions,
  ): void {
    if (this.get(name)) {
      return;
    }
    original.call(this, name, constructor, options);
  };
  installed = true;
}
