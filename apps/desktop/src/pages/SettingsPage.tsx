import { useEffect, useState } from "react";

import type { IController } from "../hooks/useController";
import { validateConfig } from "../lib/config";
import {
  SETTINGS,
  type ISettingOption,
  type ISettingSpec,
} from "../lib/settings";
import { getValueAt, setValueAt } from "../lib/settings-form";
import type { IAppConfig, IModelInfo, ThemeMode } from "../lib/types";
import DataTab from "./settings/DataTab";
import Field from "./settings/Field";
import PersonaEditor from "./settings/PersonaEditor";
import { specsOf } from "./settings/specs";
import {
  AdvancedTab,
  BasicTab,
  ChatTab,
  ProactiveTab,
  StickerTab,
} from "./settings/TabPanels";

interface IProps {
  controller: IController;
  /** 切 Tab 时让内容区回到顶部（由 App 传入） */
  onTabChange?: () => void;
}

type TabId =
  "basic" | "persona" | "chat" | "proactive" | "sticker" | "advanced" | "data";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "basic", label: "基础" },
  { id: "persona", label: "人格" },
  { id: "chat", label: "对话" },
  { id: "proactive", label: "主动" },
  { id: "sticker", label: "表情包" },
  { id: "advanced", label: "高级" },
  { id: "data", label: "数据" },
];

const SettingsPage = ({ controller, onTabChange }: IProps) => {
  const [form, setForm] = useState<IAppConfig>(controller.config);
  const [tab, setTab] = useState<TabId>("basic");
  const [saving, setSaving] = useState(false);
  const [effortLevels, setEffortLevels] = useState<string[] | null>(null);

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
      {
        disabled?: boolean;
        disabledHint?: string;
        options?: readonly ISettingOption[];
      }
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
    if (errors.length > 0) {
      controller.notify("error", `还有几项没填好：${errors.join("；")}`);
      return;
    }

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
    }
  };

  const changeTab = (next: TabId) => {
    if (next === tab) return;
    onTabChange?.();
    setTab(next);
  };

  const setTheme = (theme: ThemeMode) => {
    void controller.setTheme(theme);
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
            onClick={() => changeTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "basic" && (
        <BasicTab
          controller={controller}
          form={form}
          patch={patch}
          renderFields={renderFields}
          basicLlm={basicLlm}
          thinkingOptions={thinkingOptions}
          onPickModel={onPickModel}
          setTheme={setTheme}
        />
      )}

      {tab === "persona" && (
        <PersonaEditor
          controller={controller}
          style={form.agent.style}
          onStyleChange={(next) => patch("agent.style", next)}
        />
      )}

      {tab === "chat" && (
        <ChatTab
          controller={controller}
          form={form}
          patch={patch}
          renderFields={renderFields}
        />
      )}

      {tab === "proactive" && (
        <ProactiveTab
          controller={controller}
          form={form}
          patch={patch}
          renderFields={renderFields}
        />
      )}

      {tab === "sticker" && (
        <StickerTab
          controller={controller}
          form={form}
          patch={patch}
          renderFields={renderFields}
        />
      )}

      {tab === "advanced" && (
        <AdvancedTab
          controller={controller}
          form={form}
          patch={patch}
          renderFields={renderFields}
        />
      )}

      {tab === "data" && (
        <DataTab
          controller={controller}
          form={form}
          patch={patch}
          onConfigReload={() => setForm(controller.config)}
        />
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
