type KeyList<TSource extends object> = readonly (keyof TSource)[];

export function createPortStateLens<
  TSource extends object,
  const TKeys extends KeyList<TSource>,
  TExtras extends object,
>(source: TSource, keys: TKeys, extras: TExtras): Pick<TSource, TKeys[number]> & TExtras {
  const target = { ...extras };
  for (const key of keys) {
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get() {
        const value = Reflect.get(source, key as PropertyKey);
        return typeof value === "function" ? value.bind(source) : value;
      },
      set(next) {
        Reflect.set(source, key as PropertyKey, next);
      },
    });
  }
  return target as Pick<TSource, TKeys[number]> & TExtras;
}
