import { useEffect, useState } from "react";

import type { IController } from "../hooks/useController";
import { validateConfig } from "../lib/config";
import type { CloseAction, IAppConfig, ThemeMode } from "../lib/types";
import { IconEye, IconEyeOff, IconFolder } from "./Icons";

interface IProps {
  controller: IController;
}

const SettingsPage = ({ controller }: IProps) => {
  const [form, setForm] = useState<IAppConfig>(controller.config);
  const [showSecret, setShowSecret] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  // 主题是即时保存的，只同步这一小块，别把其他未保存的输入覆盖掉
  useEffect(() => {
    setForm((previous) => ({
      ...previous,
      appearance: controller.config.appearance,
    }));
  }, [controller.config.appearance]);

  const errors = validateConfig(form);

  const patchQQ = (patch: Partial<IAppConfig["qq"]>) =>
    setForm({ ...form, qq: { ...form.qq, ...patch } });

  const patchLlm = (patch: Partial<IAppConfig["llm"]>) =>
    setForm({ ...form, llm: { ...form.llm, ...patch } });

  const patchBehavior = (patch: Partial<IAppConfig["behavior"]>) =>
    setForm({ ...form, behavior: { ...form.behavior, ...patch } });

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
    if (imported) setForm(imported);
  };

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

      {attempted && errors.length > 0 && (
        <div className="callout callout-error">
          <div>
            <strong>还有几项没填好</strong>
            <span>{errors.join("；")}</span>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>外观</h2>
          <span className="badge">即时生效</span>
        </div>
        <p className="muted card-desc">
          默认跟随 Windows 的深浅色设置，也可以固定成浅色或深色。
        </p>

        <div className="radio-row">
          {(
            [
              ["system", "跟随系统"],
              ["light", "浅色"],
              ["dark", "深色"],
            ] as Array<[ThemeMode, string]>
          ).map(([value, label]) => (
            <label key={value} className="radio-item">
              <input
                type="radio"
                name="theme"
                checked={controller.config.appearance.theme === value}
                onChange={() => void controller.setTheme(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="hint">
          当前显示：{controller.resolvedTheme === "dark" ? "深色" : "浅色"}
          {controller.config.appearance.theme === "system"
            ? "（跟随系统）"
            : ""}
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>QQ 机器人</h2>
          <span className="badge">必填</span>
        </div>
        <p className="muted card-desc">
          在 q.qq.com 的「开发设置」里可以找到 AppID 和 AppSecret。
        </p>

        <div className="form-grid">
          <label className="field">
            <span>AppID</span>
            <input
              value={form.qq.appId}
              placeholder="例如 102xxxxxx"
              spellCheck={false}
              onChange={(event) => patchQQ({ appId: event.target.value })}
            />
          </label>

          <label className="field">
            <span>AppSecret</span>
            <div className="input-with-action">
              <input
                type={showSecret ? "text" : "password"}
                value={form.qq.appSecret}
                placeholder="AppSecret"
                spellCheck={false}
                onChange={(event) =>
                  patchQQ({ appSecret: event.target.value })
                }
              />
              <button
                type="button"
                className="icon-button"
                title={showSecret ? "隐藏" : "显示"}
                onClick={() => setShowSecret((value) => !value)}
              >
                {showSecret ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>DeepSeek</h2>
          <span className="badge">必填</span>
        </div>
        <p className="muted card-desc">
          模型调用需要 API Key。默认使用 deepseek-flash。
        </p>

        <label className="field">
          <span>API Key</span>
          <div className="input-with-action">
            <input
              type={showKey ? "text" : "password"}
              value={form.llm.apiKey}
              placeholder="sk-..."
              spellCheck={false}
              onChange={(event) => patchLlm({ apiKey: event.target.value })}
            />
            <button
              type="button"
              className="icon-button"
              title={showKey ? "隐藏" : "显示"}
              onClick={() => setShowKey((value) => !value)}
            >
              {showKey ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>
        </label>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>行为</h2>
        </div>

        <div className="field">
          <span>关闭窗口时</span>
          <div className="radio-row">
            {(
              [
                ["tray", "最小化到托盘"],
                ["exit", "退出程序"],
              ] as Array<[CloseAction, string]>
            ).map(([value, label]) => (
              <label key={value} className="radio-item">
                <input
                  type="radio"
                  name="closeAction"
                  checked={form.behavior.closeAction === value}
                  onChange={() => patchBehavior({ closeAction: value })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p className="hint">
            选「最小化到托盘」时，右键托盘图标可以暂停、重启或退出。
          </p>
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={form.behavior.launchAtLogin}
            disabled={!controller.packaged}
            onChange={(event) =>
              patchBehavior({ launchAtLogin: event.target.checked })
            }
          />
          <span>
            开机自动启动
            {!controller.packaged && (
              <em className="hint-inline">（打包版可用）</em>
            )}
          </span>
        </label>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>文件位置</h2>
        </div>
        <div className="path-row">
          <div>
            <div className="path-label">配置</div>
            <div className="path-value">{controller.paths?.configFile ?? "—"}</div>
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
            <div className="path-value">{controller.paths?.logsDir ?? "—"}</div>
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

      <div className="form-footer">
        <span className="hint">
          Key 与 Secret 以明文保存在当前 Windows 用户目录下。
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存并重启 Bot"}
        </button>
      </div>
    </section>
  );
};

export default SettingsPage;
