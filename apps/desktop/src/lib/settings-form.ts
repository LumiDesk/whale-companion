/** 按 "llm.model" 这样的路径读写配置，保持不可变更新 */
export const getValueAt = (source: unknown, path: string): unknown => {
  let cursor: unknown = source;

  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
};

export const setValueAt = <T extends object>(
  source: T,
  path: string,
  value: unknown,
): T => {
  const parts = path.split(".");

  const walk = (current: unknown, index: number): unknown => {
    if (index >= parts.length) return value;

    const key = parts[index];
    const base =
      current && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};

    return {
      ...base,
      [key]: walk(base[key], index + 1),
    };
  };

  return walk(source, 0) as T;
};
