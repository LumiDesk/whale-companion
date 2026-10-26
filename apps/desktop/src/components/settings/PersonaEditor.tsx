import { useEffect, useState } from "react";

import type { IController } from "../../hooks/useController";
import { IconFolder, IconRestart } from "../Icons";

interface IProps {
  controller: IController;
}

const PersonaEditor = ({ controller }: IProps) => {
  const [text, setText] = useState("");
  const [source, setSource] = useState<"custom" | "default">("default");
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const result = await controller.readPersona();
      setText(result.text);
      setSource(result.source);
      setPath(result.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved("");

    try {
      await controller.savePersona(text);
      await load();
      setSaved("已保存，下一条消息生效");
      setConfirmReset(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }

    setSaving(true);
    setError("");
    setSaved("");

    try {
      await controller.resetPersona();
      await load();
      setSaved("已恢复默认人设");
      setConfirmReset(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>人设</h2>
        <span className={`badge ${source === "custom" ? "badge-accent" : ""}`}>
          {source === "custom" ? "自定义" : "默认"}
        </span>
      </div>

      <p className="muted card-desc">
        默认人设随软件更新；你保存后会写到用户目录，之后一直以你的版本为准。
        改完不需要重启，下一条消息生效。
      </p>

      {loading ? (
        <div className="empty">正在读取人设…</div>
      ) : (
        <>
          <textarea
            className="persona-input"
            value={text}
            spellCheck={false}
            rows={18}
            onChange={(event) => {
              setText(event.target.value);
              setSaved("");
              setConfirmReset(false);
            }}
          />

          <div className="persona-footer">
            <span className={text.length > 20_000 ? "field-error" : "hint"}>
              {text.length} / 20000 字
            </span>

            <div className="persona-actions">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => void controller.openPersonaDir()}
              >
                <IconFolder />
                打开目录
              </button>

              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={saving || source === "default"}
                onClick={() => void reset()}
              >
                <IconRestart />
                {confirmReset ? "再点一次确认恢复" : "恢复默认"}
              </button>

              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={saving || !text.trim() || text.length > 20_000}
                onClick={() => void save()}
              >
                {saving ? "保存中…" : "保存人设"}
              </button>
            </div>
          </div>

          {error && <p className="field-error">{error}</p>}
          {saved && <p className="field-help">{saved}</p>}

          <div className="path-row">
            <div>
              <div className="path-label">当前文件</div>
              <div className="path-value">{path || "—"}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PersonaEditor;
