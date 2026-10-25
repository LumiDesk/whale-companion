import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Neutralino 从 resources/ 提供页面，相对路径最稳
  base: "./",
  build: {
    outDir: "resources",
    emptyOutDir: true,
    target: "chrome110",
  },
});
