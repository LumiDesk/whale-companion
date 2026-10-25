import { init } from "@neutralinojs/lib";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles.css";

// 在 Neutralino 里初始化原生 API；普通浏览器里不执行
if (typeof window !== "undefined" && typeof window.NL_PORT === "number") {
  init();
}

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root");

createRoot(container).render(<App />);
