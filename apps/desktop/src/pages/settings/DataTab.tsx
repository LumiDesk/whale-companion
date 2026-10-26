import { useEffect, useState } from "react";

import { IconFolder } from "../../components/ui/Icons";
import type { IController } from "../../hooks/useController";
import type { IAppConfig, IKnownUser, IStickerInfo } from "../../lib/types";

interface IProps {
  controller: IController;
  form: IAppConfig;
  patch: (path: string, value: unknown) => void;
  /** 导入备份后配置可能被重载，让设置页同步表单 */
  onConfigReload: () => void;
}

/**
 * 「数据」Tab：日志保留、文件位置、备份导出/导入、图库与用户数据维护。
 * 自己的列表数据自己加载，设置页只管保存配置。
 */
const DataTab = ({ controller, form, patch, onConfigReload }: IProps) => {
  const [dataBusy, setDataBusy] = useState(false);
  const [dataMessage, setDataMessage] = useState("");
  const [dataError, setDataError] = useState("");
  const [confirmImport, setConfirmImport] = useState(false);
  const [stickers, setStickers] = useState<IStickerInfo[]>([]);
  const [stickerBusy, setStickerBusy] = useState(false);
  const [stickerError, setStickerError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [users, setUsers] = useState<IKnownUser[]>([]);
  const [userBusy, setUserBusy] = useState(false);
  const [confirmUser, setConfirmUser] = useState("");

  const loadStickers = async () => {
    setStickerError("");
    try {
      setStickers(await controller.listStickers());
    } catch (e) {
      setStickerError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadUsers = async () => {
    try {
      setUsers(await controller.listUsers());
    } catch {
      setUsers([]);
    }
  };

  useEffect(() => {
    void loadStickers();
    void loadUsers();
    // 只在挂载时加载一次；删除/清理后会主动刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportData = async () => {
    setDataBusy(true);
    setDataError("");
    setDataMessage("");

    try {
      const path = await controller.exportData();
      if (path) setDataMessage(`已导出到 ${path}`);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : String(e));
    } finally {
      setDataBusy(false);
    }
  };

  const importData = async () => {
    if (!confirmImport) {
      setConfirmImport(true);
      setDataMessage(
        "再点一次「确认导入」会覆盖当前对话、记忆和表情包（先自动备份）",
      );
      return;
    }

    setDataBusy(true);
    setDataError("");
    setDataMessage("");

    try {
      const imported = await controller.importData();
      if (imported) {
        setDataMessage("导入完成；如果 Bot 之前在运行，会自动重启");
        onConfigReload();
        void loadStickers();
      }
    } catch (e) {
      setDataError(e instanceof Error ? e.message : String(e));
    } finally {
      setDataBusy(false);
      setConfirmImport(false);
    }
  };

  const deleteSticker = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }

    setStickerBusy(true);
    setStickerError("");

    try {
      await controller.deleteSticker(id);
      await loadStickers();
    } catch (e) {
      setStickerError(e instanceof Error ? e.message : String(e));
    } finally {
      setStickerBusy(false);
      setConfirmDelete(null);
    }
  };

  const retagStickers = async () => {
    setStickerBusy(true);
    setStickerError("");

    try {
      await controller.retagStickers();
      await loadStickers();
    } catch (e) {
      setStickerError(e instanceof Error ? e.message : String(e));
    } finally {
      setStickerBusy(false);
    }
  };

  const clearUser = async (
    userId: string,
    target: "history" | "memory",
  ) => {
    const key = `${userId}:${target}`;
    if (confirmUser !== key) {
      setConfirmUser(key);
      return;
    }

    setUserBusy(true);

    try {
      await controller.clearUserData(userId, target);
      setConfirmUser("");
      await loadUsers();
    } catch (e) {
      setDataError(e instanceof Error ? e.message : String(e));
    } finally {
      setUserBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>日志</h2>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>保留天数</span>
            <div className="input-with-unit">
              <input
                type="number"
                min={1}
                max={30}
                value={form.logs.keepDays}
                onChange={(event) =>
                  patch("logs.keepDays", Number(event.target.value))
                }
              />
              <span className="unit">天</span>
            </div>
          </label>
          <label className="field">
            <span>界面最多行数</span>
            <div className="input-with-unit">
              <input
                type="number"
                min={200}
                max={10_000}
                step={100}
                value={form.logs.maxLines}
                onChange={(event) =>
                  patch("logs.maxLines", Number(event.target.value))
                }
              />
              <span className="unit">行</span>
            </div>
          </label>
        </div>
        <p className="hint">日志保留在下次启动时清理。</p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>文件位置</h2>
        </div>
        <div className="path-row">
          <div>
            <div className="path-label">配置</div>
            <div className="path-value">
              {controller.paths?.configFile ?? "—"}
            </div>
          </div>
        </div>
        <div className="path-row">
          <div>
            <div className="path-label">数据</div>
            <div className="path-value">
              {controller.serverPaths?.dataDir ?? "—"}
            </div>
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
        <div className="path-row">
          <div>
            <div className="path-label">日志</div>
            <div className="path-value">
              {controller.paths?.logsDir ?? "—"}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => void controller.openLogsDir()}
          >
            <IconFolder />
            打开
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>备份与恢复</h2>
        </div>
        <p className="muted card-desc">
          导出包含对话、记忆、表情包和自定义人设，不含 config.json 里的密钥。
          导入前会先把当前数据备份到 updates 目录。
        </p>

        <div className="persona-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={dataBusy}
            onClick={() => void exportData()}
          >
            {dataBusy ? "处理中…" : "导出备份"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={dataBusy}
            onClick={() => void importData()}
          >
            {confirmImport ? "确认导入（覆盖当前）" : "导入备份"}
          </button>
        </div>

        {dataMessage && <p className="field-help">{dataMessage}</p>}
        {dataError && <p className="field-error">{dataError}</p>}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>表情包图库</h2>
          <span className="badge">{stickers.length} 张</span>
        </div>
        <p className="muted card-desc">
          删除会同时移除图片文件；「重新打标」只处理还没有标签的图，
          Bot 在运行时会先暂停再自动恢复。
        </p>

        <div className="persona-actions">
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={stickerBusy}
            onClick={() => void retagStickers()}
          >
            {stickerBusy ? "处理中…" : "重新打标无标签图"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={stickerBusy}
            onClick={() => void loadStickers()}
          >
            刷新
          </button>
        </div>

        {stickerError && <p className="field-error">{stickerError}</p>}

        {stickers.length === 0 ? (
          <div className="empty">图库还是空的。</div>
        ) : (
          <ul className="sticker-list">
            {stickers.slice(0, 100).map((sticker) => (
              <li key={sticker.id} className="sticker-item">
                <div>
                  <div className="sticker-tags">
                    {sticker.tags.length > 0
                      ? sticker.tags.join(" / ")
                      : "（未打标）"}
                  </div>
                  <div className="sticker-meta">
                    {sticker.id.slice(0, 8)} ·{" "}
                    {new Date(sticker.createdAt).toLocaleDateString("zh-CN")}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={stickerBusy}
                  onClick={() => void deleteSticker(sticker.id)}
                >
                  {confirmDelete === sticker.id ? "确认删除" : "删除"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {stickers.length > 100 && (
          <p className="hint">只展示最近 100 张，共 {stickers.length} 张。</p>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>用户数据</h2>
          <span className="badge">{users.length} 个</span>
        </div>
        <p className="muted card-desc">
          按 openid 列出聊过天的人；清理前会备份 history 与 memory 文件，Bot
          在运行时会先暂停。
        </p>

        {users.length === 0 ? (
          <div className="empty">还没有聊天记录。</div>
        ) : (
          <ul className="sticker-list">
            {users.slice(0, 30).map((user) => (
              <li key={user.userId} className="sticker-item">
                <div>
                  <div className="sticker-tags">
                    {user.userId.slice(0, 10)}…
                  </div>
                  <div className="sticker-meta">
                    最近：{new Date(user.lastSeen).toLocaleString("zh-CN")}
                  </div>
                </div>
                <div className="persona-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={userBusy}
                    onClick={() => void clearUser(user.userId, "history")}
                  >
                    {confirmUser === `${user.userId}:history`
                      ? "确认清对话"
                      : "清对话"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={userBusy}
                    onClick={() => void clearUser(user.userId, "memory")}
                  >
                    {confirmUser === `${user.userId}:memory`
                      ? "确认清记忆"
                      : "清记忆"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>说明</h2>
        </div>
        <p className="muted card-desc">
          所有清理都会先备份到原文件旁边（`*.bak-时间戳`）；导入/导出的说明见上方。
        </p>
      </div>
    </>
  );
};

export default DataTab;
