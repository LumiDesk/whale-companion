import { useEffect, useMemo, useRef, useState } from "react";

import type { IController } from "../hooks/useController";
import { formatClock } from "../lib/logs";
import { IconFolder, IconTrash } from "./Icons";

type SourceFilter = "all" | "bot" | "gui" | "error";

interface IProps {
  controller: IController;
}

const sourceLabel = (source: "bot" | "gui" | "error"): string => {
  if (source === "bot") return "Bot";
  if (source === "gui") return "界面";
  return "错误";
};

const LogsPage = ({ controller }: IProps) => {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return controller.logs.filter((line) => {
      if (source !== "all" && line.source !== source) return false;
      if (!keyword) return true;
      return line.text.toLowerCase().includes(keyword);
    });
  }, [controller.logs, query, source]);

  useEffect(() => {
    if (!autoScroll) return;
    const element = listRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [filtered, autoScroll]);

  const onScroll = () => {
    const element = listRef.current;
    if (!element) return;
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  return (
    <section className="page page-logs">
      <header className="page-head">
        <div>
          <h1>日志</h1>
          <p>Bot 的输出和界面操作都会记在这里，最多保留最近 2000 行。</p>
        </div>
      </header>

      <div className="log-toolbar">
        <input
          className="search"
          value={query}
          placeholder="搜索日志…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="select"
          value={source}
          onChange={(event) => setSource(event.target.value as SourceFilter)}
        >
          <option value="all">全部</option>
          <option value="bot">Bot</option>
          <option value="gui">界面</option>
          <option value="error">错误</option>
        </select>
        <label className="check-inline">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => setAutoScroll(event.target.checked)}
          />
          自动滚动
        </label>
        <span className="log-count">{filtered.length} 行</span>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => controller.clearLogs()}
        >
          <IconTrash />
          清空视图
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => void controller.openLogsDir()}
        >
          <IconFolder />
          打开目录
        </button>
      </div>

      <div className="log-panel" ref={listRef} onScroll={onScroll}>
        {filtered.length === 0 ? (
          <div className="empty">没有匹配的日志。</div>
        ) : (
          filtered.map((line) => (
            <div key={line.id} className={`log-line source-${line.source}`}>
              <span className="log-time">{formatClock(new Date(line.ts))}</span>
              <span className={`log-source source-${line.source}`}>
                {sourceLabel(line.source)}
              </span>
              <span className="log-text">{line.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default LogsPage;
