import type { ReactNode } from "react";

import Switch from "../../components/ui/Switch";
import type { IController } from "../../hooks/useController";
import {
  SETTINGS,
  type ISettingOption,
  type ISettingSpec,
} from "../../lib/settings";
import { getValueAt } from "../../lib/settings-form";
import type {
  CloseAction,
  IAppConfig,
  IModelInfo,
  ThemeMode,
} from "../../lib/types";
import ModelPicker from "./ModelPicker";
import SelfCheck from "./SelfCheck";
import { specsOf } from "./specs";

type IRenderFields = (
  specs: ISettingSpec[],
  overrides?: Record<
    string,
    {
      disabled?: boolean;
      disabledHint?: string;
      options?: readonly ISettingOption[];
    }
  >,
) => ReactNode;

interface ITabProps {
  controller: IController;
  form: IAppConfig;
  patch: (path: string, value: unknown) => void;
  renderFields: IRenderFields;
}

interface IBasicTabProps extends ITabProps {
  basicLlm: ISettingSpec[];
  thinkingOptions?: readonly ISettingOption[];
  onPickModel: (model: IModelInfo) => void;
  setTheme: (theme: ThemeMode) => void;
}

export const BasicTab = ({
  controller,
  form,
  patch,
  renderFields,
  basicLlm,
  thinkingOptions,
  onPickModel,
  setTheme,
}: IBasicTabProps) => (
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
        {controller.config.appearance.theme === "system" ? "（跟随系统）" : ""}
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
);

export const ChatTab = ({
  controller,
  form,
  patch,
  renderFields,
}: ITabProps) => (
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
        <h2>对话引擎</h2>
        <span className="badge">保存后生效</span>
      </div>
      <p className="muted card-desc">
        模型会自己决定发几条、要不要等、要不要沉默；行为风格在「人格」页切换。
      </p>
      {renderFields(
        specsOf("agent", false).filter((spec) => spec.path !== "agent.style"),
      )}
      <h3 className="subhead">高级</h3>
      {renderFields(specsOf("agent", true))}
    </div>

    <div className="card">
      <div className="card-head">
        <h2>图片</h2>
      </div>
      {renderFields([
        ...specsOf("media", true),
        ...SETTINGS.filter(
          (spec) =>
            spec.path === "llm.maxImages" || spec.path === "llm.maxImageBytes",
        ),
      ])}
    </div>
  </>
);

export const ProactiveTab = ({
  controller,
  form,
  patch,
  renderFields,
}: ITabProps) => (
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
);

export const StickerTab = ({
  controller,
  form,
  patch,
  renderFields,
}: ITabProps) => (
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
);

export const AdvancedTab = ({
  controller,
  form,
  patch,
  renderFields,
}: ITabProps) => (
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
            spec.path !== "llm.maxImages" && spec.path !== "llm.maxImageBytes",
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
);
