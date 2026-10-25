import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

/**
 * neu build 需要 resources/js/neutralino.js 存在。
 * 页面本身用 npm 包初始化，但这个文件仍要跟着资源一起打包。
 */
const neutralinoClient = (): Plugin => ({
  name: "whale-neutralino-client",
  closeBundle() {
    const from = resolve(
      appRoot,
      "node_modules/@neutralinojs/lib/dist/neutralino.js",
    );
    const to = resolve(appRoot, "resources/js/neutralino.js");

    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  },
});

export default defineConfig({
  plugins: [react(), neutralinoClient()],
  // Neutralino 从 resources/ 提供页面，相对路径最稳
  base: "./",
  build: {
    outDir: "resources",
    emptyOutDir: true,
    target: "chrome110",
  },
});
