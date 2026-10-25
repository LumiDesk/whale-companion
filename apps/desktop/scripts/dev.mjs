import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const run = (args) => {
  const result = spawnSync("pnpm", args, {
    cwd: appRoot,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (!existsSync(join(appRoot, "bin", "neutralino-win_x64.exe"))) {
  run(["exec", "neu", "update"]);
}

// 先构建一次，避免 neu 启动时看到空白页面
run(["exec", "vite", "build"]);

const vite = spawn("pnpm", ["exec", "vite", "build", "--watch"], {
  cwd: appRoot,
  stdio: "inherit",
  shell: true,
});

const neu = spawn("pnpm", ["exec", "neu", "run"], {
  cwd: appRoot,
  stdio: "inherit",
  shell: true,
});

const stop = () => {
  vite.kill();
  neu.kill();
};

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
