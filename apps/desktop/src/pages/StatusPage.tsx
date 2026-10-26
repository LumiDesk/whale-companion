import { useEffect, useState } from "react";

import type { IController } from "../hooks/useController";
import { validateConfig } from "../lib/config";
import { formatDateTime, formatDuration } from "../lib/format";
import type { BotState, QQState } from "../lib/types";
import {
  IconFolder,
  IconPause,
  IconPlay,
  IconRestart,
} from "../components/ui/Icons";

const botLabel = (state: BotState): string => {
  if (state === "running") return "运行中";
  if (state === "starting") return "启动中";
  if (state === "stopping") return "停止中";
  if (state === "crashed") return "异常退出";
  return "已停止";
};

const qqLabel = (state: QQState): string => {
  if (state === "online") return "QQ 在线";
  if (state === "connecting") return "连接中";
  if (state === "closed") return "已断开";
  if (state === "error") return "连接异常";
  if (state === "stopped") return "已停止";
  return "未连接";
};

const tone = (state: BotState): string => {
  if (state === "running") return "good";
  if (state === "starting" || state === "stopping") return "warn";
  if (state === "crashed") return "bad";
  return "idle";
};

const qqTone = (state: QQState): string => {
  if (state === "online") return "good";
  if (state === "connecting") return "warn";
  if (state === "closed" || state === "error") return "bad";
  return "idle";
};

const sourceLabel = (source: "bot" | "gui" | "error"): string => {
  if (source === "bot") return "Bot";
  if (source === "gui") return "界面";
  return "错误";
};

interface IProps {
  controller: IController;
}

const StatusPage = ({ controller }: IProps) => {
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const running =
    controller.botState === "running" || controller.botState === "starting";
  const configErrors = validateConfig(controller.config);
  const uptime =
    controller.startedAt !== null
      ? formatDuration(now - controller.startedAt)
      : "—";

  const act = async (fn: () => Promise<unknown>) => {
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  };

  const recent = controller.logs.slice(-6);

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>状态</h1>
          <p>看看小鲸鱼现在在不在线。</p>
        </div>
      </header>

      <div className={`hero-card tone-${tone(controller.botState)}`}>
        <div className="hero-main">
          <span className={`status-dot tone-${tone(controller.botState)}`} />
          <div>
            <div className="hero-title">{botLabel(controller.botState)}</div>
            <div className="hero-sub">
              {controller.botState === "crashed"
                ? `进程异常退出${controller.exitCode !== null ? `（code ${controller.exitCode}）` : ""}`
                : running
                  ? `已运行 ${uptime}${controller.botPid ? ` · PID ${controller.botPid}` : ""}`
                  : configErrors.length > 0
                    ? "先补全 QQ 和模型配置，再启动 Bot"
                    : "启动后会在后台保持 QQ 连接"}
            </div>
          </div>
        </div>

        <div className="hero-actions">
          {running ? (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pending || controller.botState === "stopping"}
                onClick={() => act(controller.stopBot)}
              >
                <IconPause />
                暂停 Bot
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pending}
                onClick={() => act(controller.restartBot)}
              >
                <IconRestart />
                重启
              </button>
            </>
          ) : configErrors.length > 0 ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => controller.setPage("settings")}
            >
              去填写配置
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() => act(controller.startBot)}
            >
              <IconPlay />
              启动 Bot
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card stat-card">
          <div className="stat-label">QQ 连接</div>
          <div className={`stat-value tone-text-${qqTone(controller.qqState)}`}>
            <span className={`dot tone-${qqTone(controller.qqState)}`} />
            {qqLabel(controller.qqState)}
          </div>
          <div className="stat-hint">断线后会自动重连；同一 AppID 不能双开</div>
        </div>

        <div className="card stat-card">
          <div className="stat-label">最近消息</div>
          <div className="stat-value stat-value-small">
            {formatDateTime(controller.lastActivityAt)}
          </div>
          <div className="stat-hint">主人发来的最近一批消息时间</div>
        </div>

        <div className="card stat-card">
          <div className="stat-label">运行时长</div>
          <div className="stat-value stat-value-small">
            {controller.startedAt ? uptime : "—"}
          </div>
          <div className="stat-hint">
            {controller.serverPaths
              ? `数据目录：${controller.serverPaths.dataDir}`
              : "正在读取运行环境…"}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>最近的日志</h2>
          <button
            type="button"
            className="link-button"
            onClick={() => controller.setPage("logs")}
          >
            查看全部
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="empty">还没有日志，启动 Bot 后这里会出现。</div>
        ) : (
          <ul className="mini-logs">
            {recent.map((line) => (
              <li key={line.id} className={`mini-log source-${line.source}`}>
                <span className="mini-log-time">
                  {formatDateTime(line.ts).slice(11)}
                </span>
                <span className="mini-log-source">
                  {sourceLabel(line.source)}
                </span>
                <span className="mini-log-text">{line.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card row-card">
        <div>
          <h2>运行环境</h2>
          <p className="muted">
            程序目录：{controller.serverPaths?.serverDir ?? "—"}
            <br />
            Node：{controller.nodePath || "未找到"}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void controller.openDataDir()}
        >
          <IconFolder />
          打开数据目录
        </button>
      </div>
    </section>
  );
};

export default StatusPage;
