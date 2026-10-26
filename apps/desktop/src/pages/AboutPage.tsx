import type { IController } from "../hooks/useController";
import { formatDateTime } from "../lib/format";
import { formatBytes } from "../lib/update";
import type { IUpdateState } from "../lib/update";
import { APP_VERSION } from "../lib/version";
import { IconFolder } from "./Icons";
import Switch from "./Switch";

interface IProps {
  controller: IController;
}

const updateText = (update: IUpdateState): string => {
  switch (update.status) {
    case "checking":
      return "正在检查 GitHub…";
    case "up-to-date":
      return `已是最新版本 v${APP_VERSION}`;
    case "available":
      return `发现新版本 v${update.info?.version ?? "?"}（当前 v${APP_VERSION}）`;
    case "downloading":
      return `正在下载${update.progress !== null && update.progress !== undefined ? ` ${update.progress}%` : "…"}`;
    case "preparing":
      return "正在解压并准备更新…";
    case "ready":
      return "更新器已启动，应用即将退出并重启…";
    case "error":
      return update.error ?? "检查更新失败";
    default:
      return "还没有检查更新。";
  }
};

const AboutPage = ({ controller }: IProps) => {
  const update = controller.update;
  const busy =
    update.status === "checking" ||
    update.status === "downloading" ||
    update.status === "preparing" ||
    update.status === "ready";
  const available = update.status === "available";

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>关于</h1>
          <p>一只住在主人电脑里的小鲸鱼。</p>
        </div>
      </header>

      <div className="card about-card">
        <img className="about-logo" src="./icons/app.png" alt="小鲸鱼" />
        <div>
          <h2>小鲸鱼 · Bot 控制台</h2>
          <p className="muted">
            版本 {APP_VERSION}
            <br />
            Neutralino {window.NL_VERSION || "—"}
            <br />
            仅支持 Windows
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>版本与更新</h2>
          <span className="badge">
            {controller.packaged ? "便携版" : "开发模式"}
          </span>
        </div>
        <p className="muted card-desc">
          从 GitHub Releases 检查新版本；更新只替换程序文件，聊天数据仍保存在
          %APPDATA%。
        </p>

        <div className="toggle-row">
          <div className="toggle-text">
            <span className="toggle-label">接收预发布版本</span>
            <p className="field-help">
              测试版会先发成 pre-release；打开后检查更新才会看到它，关掉只收正式版。
            </p>
          </div>
          <Switch
            checked={controller.config.behavior.includePrerelease}
            label="接收预发布版本"
            onChange={(next) => void controller.setIncludePrerelease(next)}
          />
        </div>

        <div
          className={`update-status ${update.status === "error" ? "is-error" : ""}`}
        >
          <span>{updateText(update)}</span>
          {update.status === "downloading" && (
            <span className="update-progress-text">
              {update.progress ?? 0}%
            </span>
          )}
        </div>

        {update.status === "downloading" && (
          <div className="progress">
            <div
              className="progress-bar"
              style={{ width: `${update.progress ?? 0}%` }}
            />
          </div>
        )}

        {update.info?.body &&
          (available ||
            update.status === "downloading" ||
            update.status === "preparing" ||
            update.status === "ready") && (
            <pre className="release-notes">{update.info.body}</pre>
          )}

        <div className="update-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void controller.checkUpdate()}
          >
            {update.status === "idle" ? "检查更新" : "重新检查"}
          </button>

          {available && update.info?.asset && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!controller.packaged}
              onClick={() => void controller.installUpdate()}
            >
              下载并更新
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void controller.openReleasePage()}
          >
            打开发布页
          </button>
        </div>

        {available && update.info?.asset && (
          <p className="hint">
            安装包：{update.info.asset.name}（
            {formatBytes(update.info.asset.size)}）
          </p>
        )}

        {available && !update.info?.asset && (
          <p className="hint">这个版本没有提供 Windows 便携包。</p>
        )}

        {update.checkedAt && update.status !== "checking" && (
          <p className="hint">上次检查：{formatDateTime(update.checkedAt)}</p>
        )}

        {!controller.packaged && (
          <p className="hint">开发模式只能检查更新，自动安装需要打包版。</p>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>目录</h2>
        </div>
        <div className="path-row">
          <div>
            <div className="path-label">配置与数据</div>
            <div className="path-value">{controller.paths?.root ?? "—"}</div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => void controller.openDataDir()}
          >
            <IconFolder />
            打开
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>许可</h2>
        </div>
        <p className="muted">
          本项目以 AGPL-3.0-only
          发布。你可以修改、自用，但对外提供网络服务时需要同样开源。
        </p>
      </div>

      <p className="about-footer">🐋 好好聊天，别熬夜。</p>
    </section>
  );
};

export default AboutPage;
