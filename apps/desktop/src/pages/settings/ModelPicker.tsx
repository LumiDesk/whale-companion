import { useState } from "react";

import { errText } from "../../lib/format";
import { notify } from "../../lib/notify";
import type { IAppConfig, IModelInfo } from "../../lib/types";

interface IProps {
  value: string;
  config: IAppConfig;
  onChange: (path: string, value: unknown) => void;
  fetchModels: (config: IAppConfig) => Promise<IModelInfo[]>;
  onPickModel?: (model: IModelInfo) => void;
}

const formatWindow = (tokens: number | undefined): string | null => {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1000)}K`;
};

const ModelPicker = ({
  value,
  config,
  onChange,
  fetchModels,
  onPickModel,
}: IProps) => {
  const [models, setModels] = useState<IModelInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);

    try {
      const list = await fetchModels(config);
      setModels(list);
      setOpen(true);
    } catch (e) {
      notify("error", errText(e));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="model-picker">
      <div className="model-input-row">
        <input
          type="text"
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange("llm.model", event.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "获取中…" : "获取模型"}
        </button>
      </div>

      {open && models.length > 0 && (
        <div className="model-menu">
          {models.map((model) => {
            const window = formatWindow(model.contextWindow);
            return (
              <button
                key={model.id}
                type="button"
                className={`model-item ${model.id === value ? "is-active" : ""}`}
                onClick={() => {
                  onChange("llm.model", model.id);
                  onPickModel?.(model);
                  setOpen(false);
                }}
              >
                <span className="model-name">{model.name ?? model.id}</span>
                <span className="model-meta">
                  {model.id}
                  {window ? ` · 上下文 ${window}` : ""}
                  {model.effortLevels?.length
                    ? ` · 思考 ${model.effortLevels.join("/")}`
                    : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ModelPicker;
