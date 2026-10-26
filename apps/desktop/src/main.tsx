import { init } from "@neutralinojs/lib";
import { createRoot } from "react-dom/client";

import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import ToastHost from "./components/ToastHost";
import { applyTheme, resolveTheme, systemPrefersDark } from "./lib/theme";
import "./styles.css";

// 先按系统偏好上一身颜色，避免启动瞬间闪烁；
// 读到 config.json 后，useController 会换成用户保存的主题。
applyTheme(resolveTheme("system", systemPrefersDark()));

// 在 Neutralino 里初始化原生 API；普通浏览器里不执行
if (typeof window !== "undefined" && typeof window.NL_PORT === "number") {
  init();
}

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root");

createRoot(container).render(
  <>
    <ToastHost />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </>,
);
