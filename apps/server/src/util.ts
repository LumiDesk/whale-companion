export type LogLevel = "debug" | "info" | "warn" | "error";

const rank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let minLevel: LogLevel = "info";

/** 由组合根在配置加载后调用；非法值回退 info */
export const setLogLevel = (level: string): void => {
  minLevel = level in rank ? (level as LogLevel) : "info";
};

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const write = (level: LogLevel, args: unknown[]): void => {
  if (rank[level] < rank[minLevel]) return;
  console.log(`[${stamp()}]`, ...args);
};

/** 普通日志；参数里带 Error 时自动按 error 级别处理 */
export const slog = (...args: unknown[]): void => {
  const level = args.some((arg) => arg instanceof Error) ? "error" : "info";
  write(level, args);
};

export const slogWarn = (...args: unknown[]): void => write("warn", args);

export const slogError = (...args: unknown[]): void => write("error", args);

export const slogDebug = (...args: unknown[]): void => write("debug", args);
