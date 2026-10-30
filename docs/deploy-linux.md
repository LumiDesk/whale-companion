# Linux 服务器部署

本文介绍把「小鲸鱼」跑在 Linux 服务器上的最小方案：`git` 拉代码 + Node 22 + systemd。
适合 VPS、能装 Node 22 的 NAS、家里常开的小主机；**不需要 Windows，也不需要 Docker**。

> **这是无桌面控制台的部署方式。** 聊天、记忆、人格、表情包、主动消息都在；
> 但改人格、管理图库要直接改文件，没有桌面端那种可视化页面。
> 本文不提供 Docker 镜像、一键脚本或 Web 控制台。

## 给 AI 部署者的约束

- 不要运行 `pnpm dev` 作为生产进程（它是 watch 模式，会反复重启）。
- 不要修改 `pnpm-lock.yaml`；安装统一用 `--frozen-lockfile`。
- 不要把 `.env` 和数据目录提交到 git，也不要打进公开备份。
- 不要开放任何入站端口；这个 Bot 只主动连出去。
- 同一个 QQ AppID 只能有一个 WebSocket 连接；先把 Windows 桌面版的 Bot 停掉。
- root/sudo 只用于装 Node、建用户、systemd、权限/备份；Bot 本身用 `whale` 用户跑。

## 0. 准备

| 项   | 要求                                                                              |
| ---- | --------------------------------------------------------------------------------- |
| 系统 | Linux x64 / arm64；本文以 Debian / Ubuntu + systemd 为例                          |
| Node | 22 或更高                                                                         |
| pnpm | 12.x（仓库的 `packageManager` 是 12.15.0）                                        |
| 内存 | 构建建议 1GB+；运行 512MB+                                                        |
| 磁盘 | 代码 + 依赖约几百 MB；表情包另算，会持续增长                                      |
| 网络 | 出站 443 到 `bots.qq.com`、`api.sgroup.qq.com`、QQ 附件域名、模型接口；不需要入站 |
| QQ   | q.qq.com 建机器人；事件订阅选 WebSocket；把自己加进体验号                         |

QQ 平台侧的两步（事件订阅、体验号）见
[README 的「QQ 端要做的两件事」](../README.md#qq-端要做的两件事)。
机器人只支持私聊，没有群聊。

> 时区：主动消息的免打扰时段、提示词里的时间、日志都用服务器本地时间。
> 国内用户建议 `TZ=Asia/Shanghai`；否则服务器默认 UTC 会把 23:00–9:00 变成 7:00–17:00。

## 1. 安装 Node 22 和 pnpm

```bash
node -v   # 需要 v22+
git --version

# 没有 Node 22 时（NodeSource，Debian / Ubuntu）
# 没有 curl 先：sudo apt-get update && sudo apt-get install -y curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get update
sudo apt-get install -y nodejs git unzip

# pnpm 12
sudo npm install -g pnpm@12.15.0
pnpm -v
```

其他发行版用各自的包管理器；只要保证 `node -v` ≥ 22、`pnpm -v` 是 12.x。
systemd 里必须写 Node 的绝对路径（`command -v node`），不要依赖 nvm 的 shell 初始化。

## 2. 建专用用户并拉代码

```bash
sudo useradd --system --user-group --create-home \
  --home-dir /var/lib/whale-companion \
  --shell /bin/bash whale

sudo git clone https://github.com/LumiDesk/whale-companion.git /opt/whale-companion
sudo chown -R whale:whale /opt/whale-companion

# 数据目录和代码分开；其他本机用户不应该读得到聊天记录
sudo install -d -o whale -g whale -m 700 /var/lib/whale-companion
```

如果服务器访问 GitHub 慢，可以先在本地 clone 再上传；不要改仓库里的文件。

## 3. 安装依赖并构建

```bash
sudo -u whale -H bash -lc '
  cd /opt/whale-companion &&
  pnpm install --filter @apps/server... --frozen-lockfile &&
  pnpm build
'
```

- `--filter @apps/server...` 只装服务端依赖，不会把桌面端的 React / Neutralino
  依赖带到服务器上。
- 如果 filter 安装失败，退回完整安装：`pnpm install --frozen-lockfile`，再 `pnpm build`。
- 构建产物：`/opt/whale-companion/apps/server/dist`。
- 构建失败先看 Node 版本和 `pnpm -v`；不要用 `--no-frozen-lockfile` 绕过。

## 4. 配置 `.env`

```bash
sudo -u whale cp \
  /opt/whale-companion/apps/server/.env.example \
  /opt/whale-companion/apps/server/.env
sudo -u whale nano /opt/whale-companion/apps/server/.env
sudo chmod 600 /opt/whale-companion/apps/server/.env
```

最少填这三项：

```ini
DEEPSEEK_API_KEY=sk-...
QQBOT_APPID=你的AppID
QQBOT_SECRET=你的AppSecret
```

建议同时加上：

```ini
OWNER_NAME=主人
TZ=Asia/Shanghai

# 数据放在代码目录外，git pull / pnpm build 不会碰它
WHALE_DATA_DIR=/var/lib/whale-companion/data
WHALE_USER_PERSONA_DIR=/var/lib/whale-companion/personas
WHALE_ACTIVE_PERSONA_FILE=/var/lib/whale-companion/personas/active.json
```

然后建目录：

```bash
sudo -u whale mkdir -p \
  /var/lib/whale-companion/data \
  /var/lib/whale-companion/personas
```

说明：

- `.env` 用 UTF-8、**无 BOM** 保存；带 BOM 时 Node 可能读不到第一行。
- `WHALE_*` 不是必填；不写时数据默认在 `apps/server/data/`，用户人格在
  `apps/server/data/personas/`。推荐写，升级、备份、迁移都更干净。
- `TZ` 会通过 `--env-file` 生效；如果 systemd 里也设了 `Environment=TZ`，以 systemd 为准。
- 其余字段（模型、历史、主动消息、表情包）在 `.env.example` 里都有注释；不改就用默认值。
- 默认开启「看图」和表情包打标，图片会发给你配置的模型服务商；不想发就设
  `VISION_ENABLED=false`（聊天图片和打标都会停）。
- 改完 `.env` 需要 `sudo systemctl restart whale-companion` 才生效。
- 不要把 `.env` 提交到 git；它包含 QQ 和模型密钥。

## 5. 先在前台跑一次

```bash
sudo -u whale -H bash -lc '
  cd /opt/whale-companion/apps/server &&
  node --env-file=.env dist/index.js
'
```

看到这行就说明 QQ 连上了：

```
QQ 已上线 bot=...
```

然后按 `Ctrl+C` 停掉，交给 systemd。如果服务已经由 systemd 启动过，先
`sudo systemctl stop whale-companion` 再前台测试，避免两个实例抢同一个 AppID。

如果没上线，先跑自检：

```bash
sudo -u whale -H bash -lc '
  cd /opt/whale-companion/apps/server &&
  node --env-file=.env dist/index.js --self-check
'
```

`--self-check` 不会建立 QQ 长连接；每行是一个 `@@WHALE` JSON，找里面的
`"ok":false` 就是问题项。`--list-models` 可以验证模型 Key 和接口地址；
`--retag` 给未打标的表情包补标签（可选，会调用模型）。

## 6. 交给 systemd

新建 `/etc/systemd/system/whale-companion.service`：

```ini
[Unit]
Description=Whale Companion QQ Bot
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=whale
Group=whale
WorkingDirectory=/opt/whale-companion/apps/server
ExecStart=/usr/bin/node --env-file=.env dist/index.js
Restart=on-failure
RestartSec=5

# 可选加固
NoNewPrivileges=true
PrivateTmp=true

# 按你的时区改；这一行会覆盖 .env 里的 TZ
Environment=TZ=Asia/Shanghai

[Install]
WantedBy=multi-user.target
```

- `ExecStart` 里的 `/usr/bin/node` 用 `command -v node` 的结果替换；
  nvm 的路径在 systemd 里通常不可用。
- 用 `--env-file=.env` + `WorkingDirectory`，所以不需要 `EnvironmentFile=`。
- 时区默认 `Asia/Shanghai`；不在这个时区就改这一行（它会覆盖 `.env` 的 `TZ`）。
- `Restart=on-failure` 避免配置错误时无限重启；想无条件拉起可以改 `always`。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now whale-companion
sudo systemctl status whale-companion
sudo journalctl -u whale-companion -f
```

日志直接进 journald，没有应用日志文件。`LOG_LEVEL=debug` 会很多，排查完改回 `info`。

## 7. 验证清单

- [ ] `systemctl is-active whale-companion` 是 `active`
- [ ] `journalctl` 里出现 `QQ 已上线 bot=...`
- [ ] 手机私聊机器人，能收到回复
- [ ] 发 `/status`，能看到对话、记忆、图库计数
- [ ] `--self-check` 的每一项 `ok` 都是 `true`
- [ ] 重启服务器后服务自动起来（可选）
- [ ] 备份命令能跑通（见第 9 节）

## 8. 升级与回滚

```bash
sudo -u whale -H bash -lc '
  cd /opt/whale-companion &&
  git pull --ff-only &&
  pnpm install --filter @apps/server... --frozen-lockfile &&
  pnpm build
'
sudo systemctl restart whale-companion
```

- 数据目录和 `.env` 不在 git 里，升级不会动。
- 内置人格卡/提示词在 `apps/server/personas`、`apps/server/prompts`，会随 git 更新。
- 回滚：`git checkout <tag>`（例如 `v1.0.4`），重新 install/build，再 restart；
  数据目录不受影响。
- 升级前先备份；如果新版本要求更高 Node，按 Release 说明先升级 Node。

## 9. 备份与恢复

```bash
sudo mkdir -p /var/backups
sudo tar czf /var/backups/whale-$(date +%F).tar.gz \
  -C /var/lib/whale-companion data personas

# .env 含密钥，单独存、权限 600
sudo install -m 600 /opt/whale-companion/apps/server/.env \
  /var/backups/whale-$(date +%F).env
```

恢复：

```bash
sudo systemctl stop whale-companion
sudo tar xzf /var/backups/whale-YYYY-MM-DD.tar.gz \
  -C /var/lib/whale-companion

# 如果 .env 也备份了，放回原处
sudo install -m 600 /var/backups/whale-YYYY-MM-DD.env \
  /opt/whale-companion/apps/server/.env

sudo chown -R whale:whale /var/lib/whale-companion
sudo systemctl start whale-companion
```

- `data/` 和 `personas/` 里有 `history.json`、`memory/`、`users.json`、`stickers/`、
  用户人格卡。
- 图库没有自动清理；用 `du -sh /var/lib/whale-companion/data/stickers` 看大小。
  不想再收新图可以设 `STICKER_AUTO_INGEST=false`，彻底关掉设 `STICKER_ENABLED=false`。
- 备份文件里可能包含聊天记录和图片，放本地或加密后再传到别处。

## 10. 从 Windows 桌面版迁移

Windows 桌面版的「设置 → 数据 → 导出备份」会生成一个 zip，根目录是
`data/` 和 `personas/`（不含 `config.json` 里的密钥）。

1. 先在 Windows 上把 Bot 停掉（同一个 AppID 只能一个连接）。
2. 如果服务器上已经有数据，先把 `data/` 和 `personas/` 备份或移走，避免解压覆盖。
3. 把 zip 传到服务器，解压到数据目录：

   ```bash
   sudo unzip whale-backup-*.zip -d /var/lib/whale-companion
   sudo chown -R whale:whale /var/lib/whale-companion
   ls /var/lib/whale-companion   # 应看到 data/ 和 personas/（manifest.json 可忽略）
   ```

4. 在服务器的 `.env` 里重新填 QQ / DeepSeek 密钥，并按需补 `OWNER_NAME` 等配置；
   桌面端的 `config.json` 不会导出，其他设置会回到默认值。
5. 启动并验证：`/status`、`/memory` 能看到旧数据；表情包数量对得上。

如果 zip 里多套了一层目录，先 `unzip -l` 看清楚，再把 `data/` 和 `personas/`
放到 `/var/lib/whale-companion/` 下。

## 11. 没有桌面控制台时怎么改人格

- 内置卡：`/opt/whale-companion/apps/server/personas/*.md`，随 git 更新，**不要直接改**。
- 自定义卡：`/var/lib/whale-companion/personas/<id>.md`；文件名就是人格 ID。
- 当前人格：`/var/lib/whale-companion/personas/active.json`：

```json
{ "id": "catgirl" }
```

改完下一条消息生效，不用重启。`id` 找不到时会回退到默认人格。

想改内置卡又不想被更新覆盖，复制一份再改：

```bash
sudo -u whale cp \
  /opt/whale-companion/apps/server/personas/deepseek-whale.md \
  /var/lib/whale-companion/personas/my-whale.md
# 编辑 my-whale.md，然后把 active.json 的 id 改成 my-whale
```

`OWNER_NAME` 在 `.env` 里，改完要重启服务才生效。

图库没有服务器端管理界面：建议在桌面端管理，服务器上只做整目录备份/恢复。
不要手改 `/var/lib/whale-companion/data/stickers/index.json` 而不动文件，容易对不上。

## 12. 常见问题

| 症状                                 | 先看                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| systemd 里 `node: command not found` | `ExecStart` 用 `command -v node` 的绝对路径；nvm 的 PATH 在 systemd 里不生效 |
| 启动就报 `配置不合法`                | `.env` 位置、三个必填项、UTF-8 无 BOM                                        |
| `--env-file` 找不到文件              | 在 `apps/server/` 下执行；systemd 靠 `WorkingDirectory`                      |
| `code=4009` 反复出现                 | 同一 AppID 还有另一个实例；先停掉 Windows 桌面版 / 另一个容器                |
| `QQ 连接无法恢复`                    | 4014/4914/4915 等权限、下架、封禁；去 q.qq.com 检查事件订阅，修好后 restart  |
| 收不到 `QQ 已上线`                   | 出站 443、AppID/Secret；跑 `--self-check`                                    |
| 收不到图片 / 表情包                  | 出站 443 到 QQ 附件域名；看日志里的「图片下载失败」                          |
| 时间不对 / 免打扰时段不对            | `.env` 的 `TZ` 或 systemd 的 `Environment=TZ`                                |
| `EACCES` / 权限错误                  | 数据目录、`.env` 的属主是不是 `whale`                                        |
| 模型 401 / 429 / 余额不足            | Key、base URL、账户余额；`--list-models`                                     |
| 磁盘满了                             | `du -sh .../data/stickers`；关自动收图或清理图库                             |
| 服务反复重启                         | `journalctl -u whale-companion -n 100`；看配置、权限、Node 路径              |
| `pnpm: command not found`（sudo 后） | 用 `sudo -u whale -H bash -lc 'pnpm -v'` 检查                                |
| `git pull` 冲突                      | 不要在服务器上改仓库文件；备份 `.env` 后再重新 clone                         |

更多排障见 [`AGENTS.md`](../AGENTS.md) 的「Troubleshooting」和
[`README.md`](../README.md) 的「常见问题」。

## 13. 这个方案不包含什么

- 不提供 Docker 镜像 / compose（容器用户可自行把 `dist`、`personas`、`prompts` 打进镜像）。
- 不提供一键安装脚本、Web 控制台、自动更新。
- 服务器端没有单实例锁；同一个 AppID 只跑一个进程，交给 systemd 管。
- 不支持群聊；只有 QQ 私聊。
- 没有服务器端的表情包管理界面；图库维护建议在桌面端做。

如果后面确实需要容器或面板，再单独做，不在本文范围内。
