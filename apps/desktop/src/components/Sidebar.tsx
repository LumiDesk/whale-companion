import type { ReactElement } from "react";

import type { BotState, PageId } from "../lib/types";
import { APP_VERSION } from "../lib/version";
import {
  IconInfo,
  IconLogs,
  IconSettings,
  IconStatus,
} from "./ui/Icons";

interface IProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  botState: BotState;
  hasUpdate: boolean;
}

const items: Array<{
  id: PageId;
  label: string;
  icon: () => ReactElement;
}> = [
  { id: "status", label: "状态", icon: IconStatus },
  { id: "settings", label: "设置", icon: IconSettings },
  { id: "logs", label: "日志", icon: IconLogs },
  { id: "about", label: "关于", icon: IconInfo },
];

const dotClass = (state: BotState): string => {
  if (state === "running") return "dot dot-green";
  if (state === "starting" || state === "stopping") return "dot dot-amber";
  if (state === "crashed") return "dot dot-red";
  return "dot dot-gray";
};

const stateText = (state: BotState): string => {
  if (state === "running") return "运行中";
  if (state === "starting") return "启动中";
  if (state === "stopping") return "停止中";
  if (state === "crashed") return "异常退出";
  return "已停止";
};

const Sidebar = ({ page, onNavigate, botState, hasUpdate }: IProps) => (
  <aside className="sidebar">
    <div className="brand">
      <img className="brand-logo" src="./icons/logo.png" alt="" />
      <div>
        <div className="brand-name">小鲸鱼</div>
        <div className="brand-sub">Bot 控制台</div>
      </div>
    </div>

    <nav className="nav">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${page === item.id ? "is-active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <Icon />
            <span>{item.label}</span>
            {item.id === "about" && hasUpdate && (
              <span className="nav-dot" title="有新版本" />
            )}
          </button>
        );
      })}
    </nav>

    <div className="sidebar-footer">
      <div className="sidebar-state">
        <span className={dotClass(botState)} />
        <span>{stateText(botState)}</span>
      </div>
      <div className="sidebar-version">v{APP_VERSION}</div>
    </div>
  </aside>
);

export default Sidebar;
