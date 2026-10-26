# apps/desktop

小鲸鱼的 Windows 桌面控制台：状态、设置、日志、托盘。

- 技术栈：Neutralino 6 + React 19 + Vite
- 只支持 Windows
- 不含安装包；`pack` 生成便携 zip
- 版本与发版见根 [`README.md`](../../README.md) / [`CHANGELOG.md`](../../CHANGELOG.md)

## 开发

以下命令在仓库根目录执行。

```bash
# 先构建一次 Bot，桌面端开发模式会从 ../server/dist 启动
pnpm --filter @apps/server build

pnpm desktop:dev
```

`desktop:dev` 会先构建界面，然后同时跑 Vite watch 和 `neu run`。
Neutralino 的二进制和客户端库由 `neu update` 下载，已在 .gitignore 中。

开发模式在首次启动（没有 `config.json` 时）会尝试读取 `apps/server/.env`，
并复用 `apps/server/data`；打包版的数据在 `%APPDATA%\whale-companion\data`。
也可以把 `.env` 放到 `WhaleCompanion\server\.env`，启动后在设置页点「从 .env 导入」。

## 打包

```bash
pnpm desktop:pack
```

产物：

```
apps/desktop/dist/whale-companion-<version>-win-x64.zip
```

代码签名是可选的：打包前设置 `WHALE_SIGN_PFX`（PFX 路径）和
`WHALE_SIGN_PFX_PASSWORD`，`pack.mjs` 会调用 `scripts/sign-windows.ps1`，
用 signtool + DigiCert 时间戳签 `WhaleCompanion.exe`；没设置就产出未签名包。
CI 用仓库 secrets `WINDOWS_SIGN_PFX_BASE64` / `WINDOWS_SIGN_PFX_PASSWORD` 注入。
签名失败会让打包失败，不会静默降级。

zip 内是完整的便携目录：

```
WhaleCompanion/
  WhaleCompanion.exe
  resources.neu
  node.exe            ← 自带运行时，用户不用装 Node
  server/             ← Bot 本体 + personas/ + prompts/
  LICENSE
  README.txt
```

## 代码结构

```
src/
├── pages/          页面：Status / Settings / Logs / About
│   └── settings/   设置页子组件：TabPanels / DataTab / Field / ModelPicker / PersonaEditor / SelfCheck
├── components/     通用组件：Sidebar / ToastHost / ErrorBoundary
│   └── ui/         基础控件：Icons / Switch
├── hooks/          useController（组装）+ useConfig / useBotProcess / useUpdate / useDataActions / useLogs
├── lib/            纯函数与适配：配置、路径、锁、日志、进程、主题、更新、notify（多数有单测）
└── styles.css      色板与全部样式（CSS 变量在顶部）
```

- 页面只放页面，通用组件放 `components/`，纯函数放 `lib/`，编排放 `hooks/`。
- 视觉规范（颜色、间距、控件选择）见 [`DESIGN.md`](../../DESIGN.md)。

## 提示

- 一次性反馈、状态提醒、校验错误统一走 `src/lib/notify.ts` 的 `notify()`：右上角 toast，跨页面保留。
- 成功 / 信息 5 秒自动收起；错误常驻，直到点右上角关闭。
- **页面里不要再放 banner / callout 提示条**；静态说明用卡片描述或字段帮助。
- `ToastHost` 挂在 `App` 外面，切页不会卸载；react-toastify 11 会在运行时注入 CSS，
  所以 `styles.css` 里的覆盖写在 `html:root` / `#root` 前缀下，不能只靠加载顺序。
- 切侧边页或设置 Tab 时内容区回到顶部，由 `App` 的 `scrollToTop` 负责。

## 主题

- 设置页「外观」可选 **跟随系统 / 浅色 / 深色**，默认跟随系统；主题即时生效，不需要重启 Bot。
- 保存位置是 `config.json` 的 `appearance.theme`，旧配置没有这一项时按 `system` 处理。
- 颜色都在 `src/styles.css` 顶部的 CSS 变量里（`:root` 与 `:root[data-theme="dark"]`），
  新增样式不要写死颜色；日志面板固定深色。
- 跟随系统时用 `window.matchMedia("(prefers-color-scheme: dark)")` 监听系统切换。

## 设置页

- Tab：基础 / 人格 / 对话 / 主动 / 表情包 / 高级 / 数据；字段由
  `apps/server/src/settings.ts` 的 `SETTINGS` 自动渲染。
- 配置是 `config.json` v2；v1 首次启动自动迁移，并备份 `config.json.bak-v1-*`。
- 保存服务端设置会重启 Bot；主题、人格卡切换即时生效；Bot 暂停时保存不会自动启动。
- 「思考强度」按 DeepSeek 文档发 `thinking` / `reasoning_effort`；思考开启时温度不生效。
- 模型输入框右侧「获取模型」通过 `--list-models` 子进程调 `GET /models`，不会建立 QQ 连接。
- 人格卡：内置卡在 `server/personas/`，用户卡写到 `%APPDATA%\whale-companion\personas\`；
  可新建、复制、编辑、删除、导入 qq-bridge 的 `roles/*.md`，`active.json` 记录当前人格。
- 对话引擎：Agent 开关、每轮条数、沉默开关、首条延迟、条间间隔、等待上限；行为风格在人格页切换。
- 高级页有连接自检；数据页可导出/导入备份（含人格卡）、删表情包、重打标、按用户清对话/记忆。

## 自动更新

- 「关于」页会检查 `https://api.github.com/repos/Talyra42/whale-companion/releases/latest`；
  启动时也会在后台静默检查一次（打包版且配置完整时）。
- 发现新版本后点「下载并更新」：下载 zip → 校验 `SHA256SUMS.txt`（有就校验）→ 解压 →
  生成 `updates/apply-update-*.ps1` → 退出当前进程。
- PowerShell 脚本会等 GUI 进程退出，先把旧 exe/resources.neu/server 备份到 `updates/backup-*`，
  再覆盖便携目录；复制失败会自动还原并重启旧版本。结果写到
  `%APPDATA%\whale-companion\updates\update-result.json`，下次启动时提示成功或失败。
- **二进制下载必须走 `curl.exe`（没有则 PowerShell）**：GitHub Release 资源所在的 Azure Blob
  不返回 CORS 头，WebView 里 `fetch` 拿不到安装包。
- 开发模式只能检查更新，不能自动安装；自动安装要求目录里有 `WhaleCompanion.exe` 且目录可写。
- 发布工作流会生成 `SHA256SUMS.txt` 并随 Release 上传；手动发版时不要漏。

## 关键约定

- **不要给 `Neutralino.os.spawnProcess` 传 `envs`**：Windows 上会替换环境块，
  丢失 `=C:`/`=D:` 这类隐藏盘符变量，`CreateProcess` 直接失败。
  配置写到 `%APPDATA%\whale-companion\bot.json`，用 `--config` 传给 Node。
- **开机自启**：注册表值带 `--hidden`，`hasHiddenFlag(window.NL_ARGS)` 识别后隐藏窗口；
  配置不完整或 Bot 启动失败时会自动显示窗口。
- Bot 进程是 `cmd.exe /c node ...`，停止时用 `taskkill /PID <pid> /T /F` 杀进程树，
  不要只杀 cmd。
- 单实例：`app.lock` 存 PID + 心跳。先用 `tasklist` 查 PID；查不出来时看心跳（3 分钟内视为在运行）。
  第二个实例只显示一句提示然后退出，不抢 QQ 连接。
- 配置、日志、数据、更新缓存都在 `%APPDATA%\whale-companion`；开发模式的数据目录是
  `apps/server/data`，方便复用现有对话。
- 人格与行为提示词路径通过 `WHALE_PERSONA_DIR` / `WHALE_USER_PERSONA_DIR` /
  `WHALE_ACTIVE_PERSONA_FILE` / `WHALE_PROMPTS_DIR` 注入；打包版从 `server/personas` 与
  `server/prompts` 读。
- 窗口关闭行为默认「最小化到托盘」；托盘菜单在 `hooks/useBotProcess.ts` 的 `updateTray`。
- Bot 的状态通过 stdout 里以 `@@WHALE ` 开头的 JSON 行回传（`type` 为
  `boot` / `ready` / `qq` / `activity`），GUI 解析后更新状态，不写进普通日志。

## 测试

```bash
pnpm --filter @apps/desktop test
pnpm --filter @apps/desktop typecheck
```

纯函数（配置解析、路径、日志、锁、进程命令、主题解析、版本比较/更新脚本）有单测；
Neutralino 窗口/托盘、真实下载与自动更新需要手动冒烟。

遇到 Bot 起不来、托盘不显示、单实例卡住等问题，先看根 [`AGENTS.md`](../../AGENTS.md)
的「Troubleshooting」，再查 `%APPDATA%\whale-companion\logs`。
