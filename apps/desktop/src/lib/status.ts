import type { IStatusEvent } from "./types";

export const STATUS_PREFIX = "@@WHALE ";

/** 解析机器人 stdout 里的状态行；不是状态行或格式不对就返回 null */
export const parseStatusLine = (line: string): IStatusEvent | null => {
  if (!line.startsWith(STATUS_PREFIX)) return null;

  try {
    const parsed = JSON.parse(line.slice(STATUS_PREFIX.length)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const event = parsed as Record<string, unknown>;
    if (event.v !== 1 || typeof event.type !== "string") return null;

    return parsed as IStatusEvent;
  } catch {
    return null;
  }
};

/** 子进程输出是流式的，按行切开并保留跨 chunk 的半行 */
export class LineBuffer {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;

    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop() ?? "";

    return parts;
  }

  flush(): string[] {
    const rest = this.buffer;
    this.buffer = "";
    return rest.length > 0 ? [rest] : [];
  }
}
