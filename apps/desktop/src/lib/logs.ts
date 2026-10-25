import type { ILogLine } from "./types";

export const MAX_LOG_LINES = 2000;

const pad = (n: number): string => String(n).padStart(2, "0");

export const formatClock = (date: Date): string =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

export const formatDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const logFileName = (date: Date): string => `bot-${formatDate(date)}.log`;

export const formatLogLine = (line: ILogLine): string => {
  const clock = formatClock(new Date(line.ts));
  return `[${clock}] [${line.source}] ${line.text}`;
};

const SERVER_TIME =
  /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\]\s?([\s\S]*)$/;

/** Bot 的 slog 自带时间戳；取出来，避免界面再叠一层 */
export const splitServerTimestamp = (
  line: string,
): { ts: number; text: string } | null => {
  const match = SERVER_TIME.exec(line);
  if (!match) return null;

  const [, year, month, day, hour, minute, second, text] = match;
  const ts = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime();

  if (!Number.isFinite(ts)) return null;
  return { ts, text };
};

/** 保留最近 N 行，避免界面长时间运行后内存一直涨 */
export const appendLogLine = (
  lines: ILogLine[],
  line: ILogLine,
  max = MAX_LOG_LINES,
): ILogLine[] => {
  const next = lines.length >= max ? lines.slice(lines.length - max + 1) : lines.slice();
  next.push(line);
  return next;
};

/** 按日期只保留最近 N 个日志文件，返回需要删除的文件名 */
export const pickOldLogs = (names: string[], keep = 7): string[] => {
  const logs = names
    .filter((name) => /^bot-\d{4}-\d{2}-\d{2}\.log$/.test(name))
    .sort();

  return logs.slice(0, Math.max(0, logs.length - keep));
};
