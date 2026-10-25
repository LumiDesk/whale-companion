import type { ResolvedTheme, ThemeMode } from "./types";

/** 依照模式与系统偏好，算出真正要显示的主题 */
export const resolveTheme = (
  mode: ThemeMode,
  prefersDark: boolean,
): ResolvedTheme => {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
};

/** 当前系统是不是深色；非浏览器环境（单测）按浅色处理 */
export const systemPrefersDark = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

/**
 * 把主题写到 <html data-theme> 上，CSS 变量全部挂在这个属性下。
 * 同时设置 color-scheme，让原生控件、滚动条也跟着变。
 */
export const applyTheme = (theme: ResolvedTheme): void => {
  if (typeof document === "undefined") return;

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
};

/** 监听系统深浅色变化；返回取消订阅函数 */
export const watchSystemTheme = (
  onChange: (prefersDark: boolean) => void,
): (() => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);

  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
