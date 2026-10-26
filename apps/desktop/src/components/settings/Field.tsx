import { useEffect, useRef, useState } from "react";

import type { ISettingOption, ISettingSpec } from "../../lib/settings";
import { IconEye, IconEyeOff } from "../Icons";
import Switch from "../Switch";

interface IProps {
  spec: ISettingSpec;
  value: unknown;
  onChange: (path: string, value: unknown) => void;
  disabled?: boolean;
  disabledHint?: string;
  /** 覆盖 select 的选项（例如 /models 返回的思考档位） */
  options?: readonly ISettingOption[];
}

const displayNumber = (spec: ISettingSpec, value: unknown): string => {
  if (value === null || value === undefined || value === "") return "";

  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "";

  const scale = spec.scale ?? 1;
  const shown = number * scale;
  return String(Number.isInteger(shown) ? shown : Number(shown.toFixed(2)));
};

const JsonField = ({
  spec,
  value,
  onChange,
}: Pick<IProps, "spec" | "value" | "onChange">) => {
  const [text, setText] = useState(() =>
    JSON.stringify(value ?? {}, null, 2),
  );
  const [error, setError] = useState("");
  const lastEmitted = useRef("");

  useEffect(() => {
    const next = JSON.stringify(value ?? {}, null, 2);
    // 用户正在输入的 JSON 会立刻回传成对象；不要每次按键都重新格式化光标
    if (next === lastEmitted.current) return;

    setText(next);
    setError("");
  }, [value]);

  const update = (next: string) => {
    setText(next);

    try {
      const parsed: unknown = JSON.parse(next);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("必须是 JSON 对象");
        return;
      }
      setError("");
      lastEmitted.current = JSON.stringify(parsed, null, 2);
      onChange(spec.path, parsed);
    } catch {
      setError("JSON 格式不对");
    }
  };

  return (
    <>
      <textarea
        className="json-input"
        value={text}
        spellCheck={false}
        rows={6}
        onChange={(event) => update(event.target.value)}
      />
      {error ? (
        <p className="field-error">{error}</p>
      ) : (
        <p className="field-help">留空或 {"{}"} 表示不加额外参数</p>
      )}
    </>
  );
};

const Field = ({
  spec,
  value,
  onChange,
  disabled = false,
  disabledHint,
  options,
}: IProps) => {
  const [revealed, setRevealed] = useState(false);

  // 布尔项单独排版：标题在左、开关在右，跟输入框那种「标签在上」的样式区分开
  if (spec.kind === "boolean") {
    const help = disabledHint ?? spec.help;

    return (
      <div className={`toggle-row ${disabled ? "is-disabled" : ""}`}>
        <div className="toggle-text">
          <span className="toggle-label">{spec.label}</span>
          {help && <p className="field-help">{help}</p>}
        </div>
        <Switch
          checked={value === true}
          disabled={disabled}
          label={spec.label}
          onChange={(next) => onChange(spec.path, next)}
        />
      </div>
    );
  }

  const control = (() => {
    if (spec.kind === "select") {
      const list = options ?? spec.options ?? [];

      // 设置项的单选一律用分段控件：一眼看全，不用展开
      return (
        <div className="segmented">
          {list.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`segment ${value === option.value ? "is-active" : ""}`}
              disabled={disabled}
              onClick={() => onChange(spec.path, option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      );
    }

    if (spec.kind === "number") {
      const scale = spec.scale ?? 1;

      return (
        <div className="input-with-unit">
          <input
            type="number"
            value={displayNumber(spec, value)}
            min={spec.min === undefined ? undefined : spec.min * scale}
            max={spec.max === undefined ? undefined : spec.max * scale}
            step={spec.step === undefined ? undefined : spec.step * scale}
            disabled={disabled}
            placeholder={spec.nullable ? "自动" : undefined}
            onChange={(event) => {
              const next = event.target.value;
              if (!next) {
                onChange(spec.path, spec.nullable ? null : Number.NaN);
                return;
              }
              onChange(spec.path, Number(next) / scale);
            }}
          />
          {spec.unit && <span className="unit">{spec.unit}</span>}
        </div>
      );
    }

    if (spec.kind === "json") {
      return <JsonField spec={spec} value={value} onChange={onChange} />;
    }

    if (spec.kind === "password") {
      return (
        <div className="input-with-action">
          <input
            type={revealed ? "text" : "password"}
            value={typeof value === "string" ? value : ""}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onChange(spec.path, event.target.value)}
          />
          <button
            type="button"
            className="icon-button"
            title={revealed ? "隐藏" : "显示"}
            onClick={() => setRevealed((current) => !current)}
          >
            {revealed ? <IconEyeOff /> : <IconEye />}
          </button>
        </div>
      );
    }

    return (
      <input
        type="text"
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(spec.path, event.target.value)}
      />
    );
  })();

  return (
    <div className={`field ${disabled ? "is-disabled" : ""}`}>
      <span>{spec.label}</span>
      {control}
      {spec.help && !disabledHint && <p className="field-help">{spec.help}</p>}
      {disabledHint && <p className="field-help">{disabledHint}</p>}
    </div>
  );
};

export default Field;
