/** Small helpers for ArkTS-safe JSON field reads (no any/unknown). */

export type JsonMap = Record<string, Object>;

export function parseJsonMap(body: string): JsonMap {
  try {
    const parsed: Object = JSON.parse(body) as Object;
    return parsed as JsonMap;
  } catch {
    return {} as JsonMap;
  }
}

export function jsonString(map: JsonMap, key: string): string {
  const value: Object | undefined = map[key];
  if (value === undefined) {
    return '';
  }
  return `${value}`;
}

export function jsonBoolTrue(map: JsonMap, key: string): boolean {
  return jsonString(map, key) === 'true';
}

export function jsonObject(map: JsonMap, key: string): JsonMap | undefined {
  const value: Object | undefined = map[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'object') {
    return value as JsonMap;
  }
  return undefined;
}
