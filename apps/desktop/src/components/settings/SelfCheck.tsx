import { useState } from "react";

import type { IController } from "../../hooks/useController";
import type { IAppConfig, ICheckResult } from "../../lib/types";

interface IProps {
  controller: IController;
  config: IAppConfig;
}

const labels: Record<string, string> = {
  config: "配置",
  data: "数据目录",
  persona: "人设",
  stickers: "表情包图库",
  qq: "QQ Token",
  llm: "模型接口",
};

const SelfCheck = ({ controller, config }: IProps) => {
  const [results, setResults] = useState<ICheckResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setLoading(true);
    setError("");
    setResults([]);

    try {
      setResults(await controller.runSelfCheck(config));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>连接自检</h2>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={loading}
          onClick={() => void run()}
        >
          {loading ? "检查中…" : "测试连接"}
        </button>
      </div>

      <p className="muted card-desc">
        用当前表单里的配置检查 QQ token、模型接口、数据目录、人设与图库；
        不会建立 QQ 长连接，也不会写聊天记录。
      </p>

      {error && <p className="field-error">{error}</p>}

      {results.length > 0 && (
        <ul className="check-list">
          {results.map((result) => (
            <li key={result.name} className="check-item">
              <span className={`check-dot ${result.ok ? "is-ok" : "is-bad"}`} />
              <strong>{labels[result.name] ?? result.name}</strong>
              <span className="check-detail">
                {result.ok ? "通过" : "失败"}
                {result.detail ? ` · ${result.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SelfCheck;
