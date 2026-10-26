import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appRoot, "..", "..");
const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`命令失败：${command} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
};

console.log("1/5 构建 Bot（server）…");
run("pnpm", ["--filter", "@apps/server", "build"], repoRoot);

console.log("2/5 构建界面…");
run("pnpm", ["exec", "vite", "build"], appRoot);

console.log("3/5 打包 Neutralino…");
if (!existsSync(join(appRoot, "bin", "neutralino-win_x64.exe"))) {
  run("pnpm", ["exec", "neu", "update"], appRoot);
}
run("pnpm", ["exec", "neu", "build"], appRoot);

console.log("4/5 组装便携目录…");
const dist = join(appRoot, "dist");
const neuConfig = JSON.parse(
  readFileSync(join(appRoot, "neutralino.config.json"), "utf8"),
);
const binaryName = neuConfig.cli?.binaryName ?? "whale-companion";
const buildDir = join(dist, binaryName);
const staging = join(dist, "portable", "WhaleCompanion");

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

const builtExe = readdirSync(buildDir).find((name) =>
  /win_x64\.exe$/i.test(name),
);
if (!builtExe) {
  console.error(`neu build 没有产出 Windows exe：${buildDir}`);
  process.exit(1);
}

cpSync(join(buildDir, builtExe), join(staging, "WhaleCompanion.exe"));
cpSync(join(buildDir, "resources.neu"), join(staging, "resources.neu"));

// 带上 Node 运行时，用户不用自己装
cpSync(process.execPath, join(staging, "node.exe"));

// Bot 本体
const serverDir = join(staging, "server");
cpSync(join(repoRoot, "apps", "server", "dist"), serverDir, {
  recursive: true,
});
cpSync(
  join(repoRoot, "apps", "server", "personas"),
  join(serverDir, "personas"),
  { recursive: true },
);
cpSync(
  join(repoRoot, "apps", "server", "prompts"),
  join(serverDir, "prompts"),
  { recursive: true },
);
cpSync(
  join(repoRoot, "apps", "server", "package.json"),
  join(serverDir, "package.json"),
);
cpSync(join(repoRoot, "LICENSE"), join(staging, "LICENSE"));

writeFileSync(
  join(staging, "README.txt"),
  [
    "小鲸鱼 Bot 控制台",
    "",
    "1. 双击 WhaleCompanion.exe 启动。",
    "2. 首次启动会打开设置页，填写 QQ Bot 的 AppID / AppSecret 和 DeepSeek API Key。",
    "3. 保存后 Bot 会自动启动；关闭窗口默认最小化到托盘。",
    "4. 右键托盘图标可以暂停、重启或退出。",
    "",
    "配置、日志和聊天数据保存在：",
    "%APPDATA%\\whale-companion",
    "",
    "本程序自带 Node 运行时，不需要额外安装。",
    "许可证：AGPL-3.0-only（见 LICENSE）。",
    "",
  ].join("\r\n"),
  "utf8",
);

// 给 exe 换图标和版本信息（失败不影响运行）
const rcedit = join(
  appRoot,
  "node_modules",
  "rcedit",
  "bin",
  `rcedit-${process.arch === "arm64" ? "arm64" : "x64"}.exe`,
);
if (existsSync(rcedit)) {
  const target = join(staging, "WhaleCompanion.exe");
  const icon = join(appRoot, "public", "icons", "app.ico");
  const edit = spawnSync(
    rcedit,
    [
      target,
      "--set-icon",
      icon,
      "--set-file-version",
      pkg.version,
      "--set-product-version",
      pkg.version,
      "--set-version-string",
      "ProductName",
      "小鲸鱼",
      "--set-version-string",
      "FileDescription",
      "小鲸鱼 Bot 控制台",
      "--set-version-string",
      "CompanyName",
      "Talyra42",
    ],
    { stdio: "inherit" },
  );

  if (edit.status !== 0) {
    console.warn("rcedit 修改图标失败，继续使用默认 exe 图标");
  }
} else {
  console.warn(`没有找到 rcedit：${rcedit}`);
}

// 可选 Authenticode 签名：配置了证书就签，没配置就产出未签名包
const signPfx = process.env.WHALE_SIGN_PFX;
if (signPfx) {
  console.log("4.5/5 签名 WhaleCompanion.exe…");
  const signScript = join(appRoot, "scripts", "sign-windows.ps1");
  if (!existsSync(signScript)) {
    console.error(`找不到签名脚本：${signScript}`);
    process.exit(1);
  }

  const sign = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      signScript,
      "-FilePath",
      join(staging, "WhaleCompanion.exe"),
      "-PfxPath",
      signPfx,
    ],
    { stdio: "inherit", env: process.env },
  );

  if (sign.status !== 0) {
    console.error("代码签名失败，停止打包");
    process.exit(sign.status ?? 1);
  }
} else {
  console.warn(
    "未配置 WHALE_SIGN_PFX，生成未签名便携包（CI 里用 WINDOWS_SIGN_PFX_BASE64 配置）",
  );
}

console.log("5/5 压缩便携包…");
const zip = join(dist, `whale-companion-${pkg.version}-win-x64.zip`);
rmSync(zip, { force: true });
run(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${staging}' -DestinationPath '${zip}' -Force`,
  ],
  appRoot,
);

console.log(`完成：${zip}`);
