import { useEffect, useState } from "react";

import type { IController } from "../hooks/useController";
import { validateConfig } from "../lib/config";
import {
  SETTINGS,
  type ISettingOption,
  type ISettingSpec,
} from "../lib/settings";
import { getValueAt, setValueAt } from "../lib/settings-form";
import type {
  CloseAction,
  IAppConfig,
  IKnownUser,
  IModelInfo,
  IStickerInfo,
  ThemeMode,
} from "../lib/types";
import { IconFolder } from "../components/ui/Icons";
import Switch from "../components/ui/Switch";
import Field from "./settings/Field";
import ModelPicker from "./settings/ModelPicker";
import PersonaEditor from "./settings/PersonaEditor";
import SelfCheck from "./settings/SelfCheck";

interface IProps {
  controller: IController;
}

type TabId =
  | "basic"
  | "persona"
  | "chat"
  | "proactive"
  | "sticker"
  | "advanced"
  | "data";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "basic", label: "基础" },
  { id: "persona", label: "人设" },
  { id: "chat", label: "对话" },
  { id: "proactive", label: "主动" },
  { id: "sticker", label: "表情包" },
  { id: "advanced", label: "高级" },
  { id: "data", label: "数据" },
];

const specsOf = (
  group: ISettingSpec["group"],
  advanced: boolean,
): ISettingSpec[] =>
  SETTINGS.filter((spec) => spec.group === group && Boolean(spec.advanced) === advanced);

const SettingsPage = ({ controller }: IProps) => {
  const [form, setForm] = useState<IAppConfig>(controller.config);
  const [tab, setTab] = useState<TabId>("basic");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [effortLevels, setEffortLevels] = useState<string[] | null>(null);
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

  // 主题是即时保存的，只同步这一小块，别把其他未保存的输入覆盖掉
  useEffect(() => {
    setForm((previous) => ({
      ...previous,
      appearance: controller.config.appearance,
    }));
  }, [controller.config.appearance]);

  const errors = validateConfig(form);
  const running =
    controller.botState === "running" || controller.botState === "starting";

  const patch = (path: string, value: unknown) => {
    setForm((previous) => setValueAt(previous, path, value));
  };

  const valueOf = (path: string): unknown => getValueAt(form, path);

  const renderFields = (
    specs: ISettingSpec[],
    overrides: Record<
      string,
      { disabled?: boolean; disabledHint?: string; options?: readonly ISettingOption[] }
    > = {},
  ) => (
    <div className="form-grid">
      {specs.map((spec) => {
        const override = overrides[spec.path] ?? {};
        return (
          <Field
            key={spec.path}
            spec={spec}
            value={valueOf(spec.path)}
            onChange={patch}
            disabled={override.disabled}
            disabledHint={override.disabledHint}
            options={override.options}
          />
        );
      })}
    </div>
  );

  const thinkingOptions = (() => {
    if (!effortLevels || effortLevels.length === 0) return undefined;

    const spec = SETTINGS.find((item) => item.path === "llm.thinkingEffort");
    return (spec?.options ?? []).filter(
      (option) => option.value === "off" || effortLevels.includes(option.value),
    );
  })();

  const onPickModel = (model: IModelInfo) => {
    const levels = model.effortLevels ?? null;
    setEffortLevels(levels);

    if (!levels || levels.length === 0) return;
    if (form.llm.thinkingEffort === "off") return;
    if (levels.includes(form.llm.thinkingEffort)) return;

    const fallback =
      model.defaultEffort && levels.includes(model.defaultEffort)
        ? model.defaultEffort
        : levels[0];
    patch("llm.thinkingEffort", fallback);
  };

  const save = async () => {
    setAttempted(true);
    if (errors.length > 0) return;

    setSaving(true);
    try {
      await controller.saveConfig(form);
    } finally {
      setSaving(false);
    }
  };

  const importEnv = async () => {
    const imported = await controller.importEnv();
    if (imported) {
      setForm(imported);
      setAttempted(false);
    }
  };

  const setTheme = (theme: ThemeMode) => {
    void controller.setTheme(theme);
  };

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
      setDataMessage("再点一次「确认导入」会覆盖当前对话、记忆和表情包（先自动备份）");
      return;
    }

    setDataBusy(true);
    setDataError("");
    setDataMessage("");

    try {
      const imported = await controller.importData();
      if (imported) {
        setDataMessage("导入完成；如果 Bot 之前在运行，会自动重启");
        setForm(controller.config);
        void loadStickers();
      }
    } catch (e) {
      setDataError(e instanceof Error ? e.message : String(e));
    } finally {
      setDataBusy(false);
      setConfirmImport(false);
    }
  };

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
    if (tab === "data") {
      void loadStickers();
      void loadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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

  const basicLlm = specsOf("llm", false).filter(
    (spec) => spec.path !== "llm.model",
  );

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>设置</h1>
          <p>这些信息只保存在本机的用户目录里。</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void importEnv()}
        >
          从 .env 导入
        </button>
      </header>

      <div className="settings-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-tab ${tab === item.id ? "is-active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {attempted && errors.length > 0 && (
        <div className="callout callout-error">
          <div>
            <strong>还有几项没填好</strong>
            <span>{errors.join("；")}</span>
          </div>
        </div>
      )}

      {tab === "basic" && (
        <>
          <div className="card">
            <div className="card-head">
              <h2>QQ 机器人</h2>
              <span className="badge">必填</span>
            </div>
            <p className="muted card-desc">
              在 q.qq.com 的「开发设置」里可以找到 AppID 和 AppSecret。
            </p>
            {renderFields(specsOf("qq", false))}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>模型</h2>
              <span className="badge">必填</span>
            </div>
            <p className="muted card-desc">
              默认使用 deepseek-flash；也可以换成别的 OpenAI 兼容接口。
            </p>

            <div className="field">
              <span>模型名称</span>
              <ModelPicker
                value={form.llm.model}
                config={form}
                onChange={patch}
                fetchModels={controller.fetchModels}
                onPickModel={onPickModel}
              />
            </div>

            {renderFields(basicLlm, {
              "llm.temperature": {
                disabled: form.llm.thinkingEffort !== "off",
                disabledHint:
                  form.llm.thinkingEffort !== "off"
                    ? "思考模式下 temperature 不生效；把思考强度设为「关闭」后可调。"
                    : undefined,
              },
              "llm.thinkingEffort": { options: thinkingOptions },
            })}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>外观</h2>
              <span className="badge">即时生效</span>
            </div>
            <p className="muted card-desc">
              默认跟随 Windows 的深浅色设置，也可以固定成浅色或深色。
            </p>

            <div className="segmented">
              {(
                [
                  ["system", "跟随系统"],
                  ["light", "浅色"],
                  ["dark", "深色"],
                ] as Array<[ThemeMode, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`segment ${
                    controller.config.appearance.theme === value ? "is-active" : ""
                  }`}
                  onClick={() => setTheme(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="hint">
              当前显示：
              {controller.resolvedTheme === "dark" ? "深色" : "浅色"}
              {controller.config.appearance.theme === "system"
                ? "（跟随系统）"
                : ""}
            </p>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>行为</h2>
            </div>

            <div className="field">
              <span>关闭窗口时</span>
              <div className="segmented">
                {(
                  [
                    ["tray", "最小化到托盘"],
                    ["exit", "退出程序"],
                  ] as Array<[CloseAction, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`segment ${
                      form.behavior.closeAction === value ? "is-active" : ""
                    }`}
                    onClick={() => patch("behavior.closeAction", value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(
              [
                {
                  path: "behavior.launchAtLogin",
                  label: "开机自动启动",
                  hint: controller.packaged ? undefined : "仅打包版可用",
                  disabled: !controller.packaged,
                },
                {
                  path: "behavior.autoStartBot",
                  label: "启动控制台时自动启动 Bot",
                },
                {
                  path: "behavior.checkUpdateOnStartup",
                  label: "启动时静默检查更新",
                },
                {
                  path: "behavior.startMinimized",
                  label: "启动时最小化到托盘",
                },
                {
                  path: "behavior.autoRestartOnCrash",
                  label: "崩溃后自动重启",
                  hint: "最多 3 次 / 10 分钟",
                },
              ] as Array<{
                path: string;
                label: string;
                hint?: string;
                disabled?: boolean;
              }>
            ).map((item) => (
              <div
                key={item.path}
                className={`toggle-row ${item.disabled ? "is-disabled" : ""}`}
              >
                <div className="toggle-text">
                  <span className="toggle-label">{item.label}</span>
                  {item.hint && <p className="field-help">{item.hint}</p>}
                </div>
                <Switch
                  checked={getValueAt(form, item.path) === true}
                  disabled={item.disabled}
                  label={item.label}
                  onChange={(next) => patch(item.path, next)}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "persona" && <PersonaEditor controller={controller} />}

      {tab === "chat" && (
        <>
          <div className="card">
            <div className="card-head">
              <h2>对话与记忆</h2>
            </div>
            <p className="muted card-desc">
              历史窗口越大，她记得越久，但每轮请求也越贵。
            </p>
            {renderFields([
              ...specsOf("conversation", false),
              ...specsOf("conversation", true),
            ])}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>消息节奏</h2>
            </div>
            <p className="muted card-desc">
              你连发多条时，她等「停口」后合并回复；一直发也不会超过最长等待。
            </p>
            {renderFields(specsOf("batching", true))}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>图片</h2>
            </div>
            {renderFields([
              ...specsOf("media", true),
              ...SETTINGS.filter(
                (spec) =>
                  spec.path === "llm.maxImages" ||
                  spec.path === "llm.maxImageBytes",
              ),
            ])}
          </div>
        </>
      )}

      {tab === "proactive" && (
        <div className="card">
          <div className="card-head">
            <h2>主动消息</h2>
            <span className="badge">受平台额度限制</span>
          </div>
          <p className="muted card-desc">
            无人说话一段时间后，她可以自己开口；免打扰时段内不会打扰。
          </p>
          {renderFields(specsOf("proactive", false))}
          <h3 className="subhead">高级</h3>
          {renderFields(specsOf("proactive", true))}
        </div>
      )}

      {tab === "sticker" && (
        <div className="card">
          <div className="card-head">
            <h2>表情包</h2>
          </div>
          <p className="muted card-desc">
            收图会自动入库并在后台打标；模型要图时只发语义命中的，
            你明确要图时才允许随机。
          </p>
          {renderFields(specsOf("stickers", false))}
          <h3 className="subhead">高级</h3>
          {renderFields(specsOf("stickers", true))}
        </div>
      )}

      {tab === "advanced" && (
        <>
          <div className="callout callout-warn">
            <div>
              <strong>高级设置</strong>
              <span>这里的数值会影响费用、延迟和稳定性，不确定就保持默认。</span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>模型请求</h2>
            </div>
            {renderFields(
              specsOf("llm", true).filter(
                (spec) =>
                  spec.path !== "llm.maxImages" &&
                  spec.path !== "llm.maxImageBytes",
              ),
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>日志</h2>
            </div>
            {renderFields(specsOf("logs", true))}
          </div>

          <SelfCheck controller={controller} config={form} />
        </>
      )}

      {tab === "data" && (
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
              按 openid 列出聊过天的人；清理前会备份 history 与 memory 文件，Bot 在运行时会先暂停。
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
      )}

      <div className="form-footer">
        <span className="hint">
          {running
            ? "服务端设置保存后会重启 Bot；主题与人设不需要重启。"
            : "Bot 当前未运行，保存后下次启动生效。"}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : running ? "保存并重启 Bot" : "保存"}
        </button>
      </div>
    </section>
  );
};

export default SettingsPage;
