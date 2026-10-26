import { useEffect, useState } from "react";

import type { IController } from "../../hooks/useController";
import { IconFolder, IconRestart, IconTrash } from "../../components/ui/Icons";
import type {
  AgentStyle,
  IPersonaCard,
  IPersonaSummary,
} from "../../lib/types";

interface IProps {
  controller: IController;
  style: AgentStyle;
  onStyleChange: (style: AgentStyle) => void;
}

const STYLES: Array<{ value: AgentStyle; label: string }> = [
  { value: "standard", label: "标准" },
  { value: "restrained", label: "克制" },
  { value: "chatty", label: "话痨" },
];

const PersonaEditor = ({ controller, style, onStyleChange }: IProps) => {
  const [cards, setCards] = useState<IPersonaSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [selected, setSelected] = useState<IPersonaCard | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadList = async (selectId?: string) => {
    const [list, active] = await Promise.all([
      controller.listPersonas(),
      controller.getActivePersonaId(),
    ]);

    setCards(list);
    setActiveId(active);

    const nextId =
      selectId ??
      (list.some((card) => card.id === active)
        ? active
        : (list[0]?.id ?? ""));

    if (!nextId) {
      setSelected(null);
      setText("");
      return;
    }

    const card = await controller.readPersonaCard(nextId);
    setSelected(card);
    setText(card.text);
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      await loadList();
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

  const selectCard = async (id: string) => {
    setError("");
    setSaved("");
    setConfirmDelete(false);
    try {
      const card = await controller.readPersonaCard(id);
      setSelected(card);
      setText(card.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const useCard = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await controller.setActivePersona(selected.id);
      setActiveId(selected.id);
      setSaved("已切换，下一条消息生效");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selected || selected.source !== "user") return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await controller.savePersonaCard(selected.id, text);
      await loadList(selected.id);
      setSaved("已保存，下一条消息生效");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const id = await controller.createPersona("自定义人格");
      await loadList(id);
      setSaved("已新建人格，改个标题和内容吧");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const id = await controller.createPersona(selected.name);
      await controller.savePersonaCard(id, selected.text);
      await loadList(id);
      setSaved("已复制为自定义人格");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || selected.source !== "user") return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setBusy(true);
    setError("");
    setSaved("");
    try {
      await controller.deletePersona(selected.id);
      await loadList();
      setConfirmDelete(false);
      setSaved("已删除人格");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importCards = async () => {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const ids = await controller.importPersonas();
      if (ids.length > 0) {
        await loadList(ids[0]);
        setSaved(`已导入 ${ids.length} 张人格卡`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await controller.setActivePersona("deepseek-whale");
      await loadList("deepseek-whale");
      setSaved("已恢复默认人格");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chars = text.length;
  const editable = selected?.source === "user";

  return (
    <div className="card">
      <div className="card-head">
        <h2>人格</h2>
        <div className="persona-head-actions">
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={busy}
            onClick={() => void importCards()}
          >
            导入角色卡
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={busy}
            onClick={() => void create()}
          >
            新建
          </button>
        </div>
      </div>

      <p className="muted card-desc">
        人格卡决定她是谁、怎么说话；内置卡随软件更新，自定义卡保存在用户目录。
        改完不需要重启，下一条消息生效。
      </p>

      {loading ? (
        <div className="empty">正在读取人格卡…</div>
      ) : (
        <>
          <div className="persona-list">
            {cards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={`persona-item ${
                  selected?.id === card.id ? "is-selected" : ""
                }`}
                onClick={() => void selectCard(card.id)}
              >
                <span className="persona-item-name">{card.name}</span>
                <span className="persona-item-meta">
                  {card.source === "builtin" ? "内置" : "自定义"} ·{" "}
                  {card.chars} 字
                  {activeId === card.id ? " · 当前" : ""}
                </span>
              </button>
            ))}
          </div>

          <div className="field">
            <span>行为风格</span>
            <div className="segmented">
              {STYLES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`segment ${style === item.value ? "is-active" : ""}`}
                  onClick={() => onStyleChange(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="field-help">
              影响一次发几条、等多久、多主动；不影响人格内容。
            </p>
          </div>

          {selected && (
            <>
              <div className="persona-editor-head">
                <div>
                  <strong>{selected.name}</strong>
                  <span className="muted">
                    {selected.source === "builtin" ? " · 内置" : " · 自定义"}
                  </span>
                </div>
                <span className={chars > 20_000 ? "field-error" : "hint"}>
                  {chars} / 20000 字 · 约 {Math.ceil(chars / 1.5)} token
                </span>
              </div>

              <textarea
                className="persona-input"
                value={text}
                spellCheck={false}
                rows={18}
                disabled={!editable || busy}
                onChange={(event) => {
                  setText(event.target.value);
                  setSaved("");
                  setConfirmDelete(false);
                }}
              />

              <div className="persona-footer">
                <div className="persona-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => void controller.openPersonaDir()}
                  >
                    <IconFolder />
                    打开目录
                  </button>

                  {selected.source === "builtin" && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      disabled={busy}
                      onClick={() => void copy()}
                    >
                      复制为自定义
                    </button>
                  )}

                  {selected.source === "user" && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      disabled={busy}
                      onClick={() => void remove()}
                    >
                      <IconTrash />
                      {confirmDelete ? "再点一次确认删除" : "删除"}
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={busy}
                    onClick={() => void reset()}
                  >
                    <IconRestart />
                    恢复默认
                  </button>

                  {editable && (
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={busy || !text.trim() || chars > 20_000}
                      onClick={() => void save()}
                    >
                      {busy ? "处理中…" : "保存"}
                    </button>
                  )}

                  {activeId !== selected.id && (
                    <button
                      type="button"
                      className={`btn btn-small ${
                        editable ? "btn-ghost" : "btn-primary"
                      }`}
                      disabled={busy}
                      onClick={() => void useCard()}
                    >
                      使用这个
                    </button>
                  )}
                </div>
              </div>

              {error && <p className="field-error">{error}</p>}
              {saved && <p className="field-help">{saved}</p>}

              <div className="path-row">
                <div>
                  <div className="path-label">当前文件</div>
                  <div className="path-value">{selected.path || "—"}</div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default PersonaEditor;
