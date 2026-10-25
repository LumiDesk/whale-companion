import type { IController } from "../hooks/useController";
import { APP_VERSION } from "../lib/version";
import { IconFolder } from "./Icons";

interface IProps {
  controller: IController;
}

const AboutPage = ({ controller }: IProps) => (
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
        本项目以 AGPL-3.0-only 发布。你可以修改、自用，但对外提供网络服务时需要同样开源。
      </p>
    </div>

    <p className="about-footer">🐋 好好聊天，别熬夜。</p>
  </section>
);

export default AboutPage;
