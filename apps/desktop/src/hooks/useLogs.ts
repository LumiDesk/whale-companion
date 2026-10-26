import { useRef, useState, type RefObject } from "react";

import { appendLogLine, formatLogLine, logFileName } from "../lib/logs";
import { joinPath } from "../lib/paths";
import { appendText } from "../lib/platform";
import type { IAppPaths, ILogLine } from "../lib/types";

interface IOptions {
  pathsRef: RefObject<IAppPaths | null>;
  /** 界面最多保留多少行；设置里可改，所以用 getter */
  maxLines: () => number;
}

/**
 * 界面日志 + 按天落盘的 bot-YYYY-MM-DD.log。
 * 写文件串行排队，写失败不影响主流程。
 */
export const useLogs = ({ pathsRef, maxLines }: IOptions) => {
  const [logs, setLogs] = useState<ILogLine[]>([]);
  const logsRef = useRef<ILogLine[]>([]);
  const idRef = useRef(0);
  const fileQueueRef = useRef<Promise<void>>(Promise.resolve());

  const addLog = (
    source: ILogLine["source"],
    text: string,
    ts = Date.now(),
  ): void => {
    const line: ILogLine = {
      id: (idRef.current += 1),
      ts,
      source,
      text,
    };

    logsRef.current = appendLogLine(logsRef.current, line, maxLines());
    setLogs(logsRef.current);

    const currentPaths = pathsRef.current;
    if (!currentPaths) return;

    fileQueueRef.current = fileQueueRef.current
      .then(() =>
        appendText(
          joinPath(currentPaths.logsDir, logFileName(new Date(line.ts))),
          `${formatLogLine(line)}\r\n`,
        ),
      )
      .catch(() => {
        // 日志文件写不进去不能影响主流程
      });
  };

  const clearLogs = (): void => {
    logsRef.current = [];
    setLogs([]);
  };

  return { logs, logsRef, addLog, clearLogs };
};
