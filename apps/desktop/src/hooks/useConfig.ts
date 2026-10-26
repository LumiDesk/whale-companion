import { useEffect, useRef, useState, type RefObject } from "react";

import { DEFAULT_CONFIG, normalizeConfig } from "../lib/config";
import { errText } from "../lib/format";
import {
  applyTheme,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
} from "../lib/theme";
import type {
  IAppConfig,
  IAppPaths,
  ILogLine,
  ResolvedTheme,
  ThemeMode,
} from "../lib/types";

interface IMessage {
  kind: "ok" | "error" | "info";
  text: string;
}

interface IDeps {
  configRef: RefObject<IAppConfig>;
  pathsRef: RefObject<IAppPaths | null>;
  addLog: (source: ILogLine["source"], text: string, ts?: number) => void;
  setMessage: (message: IMessage | null) => void;
  /** 写 config.json 的底层实现（由组合根注入，避免这里碰文件系统） */
  writeConfig: (file: string, config: IAppConfig) => Promise<void>;
}

const themeLabel = (theme: ThemeMode): string => {
  if (theme === "light") return "浅色";
  if (theme === "dark") return "深色";
  return "跟随系统";
};

/**
 * 配置与外观：config 状态、串行落盘、主题切换（含跟随系统）。
 * 是否重启 Bot 由调用方决定，这里只负责把配置写对。
 */
export const useConfig = (deps: IDeps) => {
  const {
    configRef,
    pathsRef,
    addLog,
    setMessage,
    writeConfig: writeConfigFile,
  } = deps;

  const [config, setConfig] = useState<IAppConfig>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme("system", systemPrefersDark()),
  );

  const configWriteRef = useRef<Promise<void>>(Promise.resolve());

  /** 主题和设置页可能同时写 config.json，串起来避免后写被先写覆盖 */
  const persistConfig = (
    file: string,
    config: IAppConfig,
  ): Promise<void> => {
    const next = configWriteRef.current.then(() =>
      writeConfigFile(file, config),
    );
    configWriteRef.current = next.catch(() => {});
    return next;
  };

  const setTheme = async (theme: ThemeMode): Promise<void> => {
    const previous = configRef.current;
    if (previous.appearance.theme === theme) return;

    const next = normalizeConfig({
      ...previous,
      appearance: { theme },
    });

    configRef.current = next;
    setConfig(next);

    const currentPaths = pathsRef.current;
    if (!currentPaths) return;

    try {
      await persistConfig(currentPaths.configFile, next);
      addLog("gui", `外观已切换为${themeLabel(theme)}`);
    } catch (error) {
      // 用户可能已经又切了别的主题；不要用旧失败覆盖新选择
      if (configRef.current.appearance.theme !== theme) return;

      configRef.current = previous;
      setConfig(previous);
      addLog("error", `保存外观设置失败：${errText(error)}`);
      setMessage({
        kind: "error",
        text: `外观设置没有保存成功：${errText(error)}`,
      });
    }
  };

  useEffect(() => {
    // 把配置里的主题落到 DOM；跟随系统时还要监听系统切换
    const mode = config.appearance.theme;

    const sync = () => {
      const resolved = resolveTheme(mode, systemPrefersDark());
      applyTheme(resolved);
      setResolvedTheme(resolved);
    };

    sync();
    if (mode !== "system") return;

    return watchSystemTheme(sync);
  }, [config.appearance.theme]);

  return {
    config,
    setConfig,
    configLoaded,
    setConfigLoaded,
    resolvedTheme,
    persistConfig,
    setTheme,
  };
};
