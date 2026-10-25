# apps/desktop

小鲸鱼的 Windows 桌面控制台：状态、设置、日志、托盘。

- 技术栈：Neutralino 6 + React 19 + Vite
- 只支持 Windows
- 不含安装包；`pack` 生成便携 zip

## 开发

```bash
# 先构建一次 Bot，桌面端开发模式会从 ../server/dist 启动
pnpm --filter @apps/server build

pnpm desktop:dev
```

`desktop:dev` 会先构建界面，然后同时跑 Vite watch 和 `neu run`。
Neutralino 的二进制和客户端库由 `neu update` 下载，已在 .gitignore 中。

## 打包

```bash
pnpm desktop:pack
```

产物：

```
apps/desktop/dist/whale-companion-<version>-win-x64.zip
```

zip 内是完整的便携目录：

```
WhaleCompanion/
  WhaleCompanion.exe
  resources.neu
  node.exe            ← 自带运行时，用户不用装 Node
  server/             ← Bot 本体 + persona.md
  LICENSE
  README.txt
```

## 关键约定

- **不要给 `Neutralino.os.spawnProcess` 传 `envs`**：Windows 上会替换环境块，
  丢失 `=C:`/`=D:` 这类隐藏盘符变量，`CreateProcess` 直接失败。
  配置写到 `%APPDATA%\whale-companion\bot.json`，用 `--config` 传给 Node。
- Bot 进程是 `cmd.exe /c node ...`，停止时用 `taskkill /PID <pid> /T /F` 杀进程树，
  不要只杀 cmd。
- 单实例：`app.lock` 存 PID + 心跳。先用 `tasklist` 查 PID；查不出来时看心跳（3 分钟内视为在运行）。
  第二个实例只显示一句提示然后退出，不抢 QQ 连接。
- 配置、日志、数据都在 `%APPDATA%\whale-companion`；开发模式的数据目录是
  `apps/server/data`，方便复用现有对话。
- `persona.md` 通过 `WHALE_PERSONA_FILE` 注入；打包版从 `server/persona.md` 读。
- 窗口关闭行为默认「最小化到托盘」；托盘菜单在 `useController` 的 `updateTray`。

## 测试

```bash
pnpm --filter @apps/desktop test
pnpm --filter @apps/desktop typecheck
```

纯函数（配置解析、路径、日志、锁、进程命令）有单测；Neutralino 窗口/托盘需要手动冒烟。
