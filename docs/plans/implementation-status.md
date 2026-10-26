# v0.2.0 实施状态

对应方案：[2026-10 可配置化与 Code Review](2026-10-customization-and-code-review.md)。

- 基线：`667981a` → 当前 `main`（本地提交，未 push）
- 验证：`pnpm typecheck` 通过；`pnpm test` **134 个用例全绿**（server 77 + desktop 57）
- 打包：`pnpm desktop:pack` 生成 `whale-companion-0.2.0-win-x64.zip`
- 运行：便携版已启动，QQ 在线；`bot.json` 在 Bot 读取后已删除

## 审查项状态

| ID | 状态 | 落点 / 说明 |
|---|---|---|
| CR-01 摘要竞态 | ✅ | `historyEpoch` + 写回前检查；并发/`/forget` 用例 |
| CR-02 切分死循环 | ✅ | `splitReply` 夹取 + 进度保护；0/负数/NaN/emoji 用例 |
| CR-03 多图预算 | ✅ | `selectImagesForModel` + `LLM_MAX_IMAGES/BYTES` |
| CR-04 更新回滚 | ✅ | 更新脚本备份 exe/resources.neu/server，失败还原；单测 |
| CR-05 网络超时 | ✅ | QQ send/token/gateway/media 全部 `AbortSignal.timeout` |
| CR-06 配置范围 | ✅ | `settings.ts` schema + 服务端启动校验 + 桌面端校验 |
| CR-07 暂停被启动 | ✅ | `saveConfig` 记录 `wasRunning`，暂停态只保存不启动 |
| CR-08 网关假死 | ✅ | op 7/9、握手超时、心跳 ACK 看门狗、onerror 关闭 |
| CR-09 打标队列 | ✅ | 延迟读文件、可配并发、队列上限、关闭看图/收图时跳过 |
| CR-10 隐私声明 | ✅ | AGENTS/README 改正；`VISION_ENABLED` / `STICKER_AUTO_INGEST` |
| CR-11 白名单 | ➖ | 按产品决策取消；QQ 平台侧控制准入 |
| CR-12 命令/token 错误 | ✅ | token 获取与命令发送包进 try，失败给人话兜底 |
| CR-13 图库索引回滚 | ✅ | 索引写失败删图；图片先临时文件再 rename；webp 扩展名 |
| CR-14 原子写短写 | ✅ | 循环 `writeSync` 直到写完 |
| CR-15 摘要上限 | ✅ | transcript 24k 字、摘要 300 字上限 |
| CR-16 全量解析 | ✅ | history / stickers 按 mtime+size 缓存 |
| CR-17 图片缓冲 | ✅ | 流式读取，超限立即 cancel |
| CR-18 人设读取失败 | ✅ | 覆盖 → 默认 → 最小兜底，只告警一次 |
| CR-19 users 全量重写 | ✅ | 内存缓存 + 5 秒节流；主动消息立即 flush |
| CR-20 更新缓存/磁盘 | ✅ | 过期 updates 清理 + 下载前剩余空间检查（查不到则继续） |
| CR-21 退出 | ✅ | SIGINT/SIGTERM 简单退出；WS 优雅关闭仍无 |
| CR-22 默认值分叉 | ✅ | `settings.ts` 单一契约 + 往返测试 |
| CR-23 网关字段校验 | ✅ | payload 对象校验、心跳间隔范围；仍用局部 `any` |
| CR-24 帮助/哨兵 | ✅ | `/help` 由命令表生成；哨兵改为 `{action}` 对象 |
| CR-25 日志级别 | ✅ | `LOG_LEVEL` + `setLogLevel`；带 Error 的日志自动归 error |
| CR-26 CI | ✅ | `.github/workflows/ci.yml`：typecheck/test/build |
| CR-27 测试缺口 | 🧪 | 核心/配置/摘要/LLM/模型/发送/token/存储已补；handler/useController 仍靠手测 |
| CR-28 托盘失败 | ✅ | 托盘失败时关窗不隐藏，给出提示 |
| CR-29 自启编码 | ✅ | `.reg` 写 UTF-16LE + BOM |
| CR-30 token 并发/401 | ✅ | in-flight 合并；发送遇 401 强制刷新一次 |
| CR-31 兼容 content 数组 | ✅ | 字符串/分段数组都拼；finish_reason/usage 进 debug 日志 |
| CR-32 webp 扩展名 | ✅ | `image/webp` → `.webp` |
| CR-33 锁 pid0/时机 | ✅ | pid=0 不写假锁；先拿锁再消费更新结果 |
| CR-34 ErrorBoundary | ✅ | 页面异常显示可重新加载的兜底页 |
| CR-35 备份/日志保留 | ✅ | 历史迁移备份保留最近 5 份；桌面日志天数可配 |
| CR-36 emoji 切分 | ✅ | 避免切开代理对 |
| CR-37 明确要图冷却 | ✅ | 明确要图仍保留 10 秒最小间隔 |
| CR-38 bot.json 密钥 | ✅ | Bot 读完配置后删除派生文件；config.json 仍为明文（文档写明） |
| CR-39 签名/安装包 | ⚠️ | 需要证书与安装器工程，保留为已知限制 |

## 可配置化状态

- ✅ 40+ 设置项、7 个 Tab、config v2 迁移
- ✅ DeepSeek 思考强度 Off/Low/High/Max（官方文档参数）
- ✅ 模型获取按钮 + `/models` 元数据
- ✅ 人设编辑、称呼、默认/覆盖双文件
- ✅ 连接自检、导出/导入备份、图库删除/重打标、按用户清理
- ✅ 启动自动启动、崩溃重启、启动最小化、日志保留
- ⏳ 内容层自定义（自定义斜杠命令、心情列表）与图库缩略图留到下一阶段

## 本轮提交

```
4914602 docs: 补充可配置化方案、代码审查与思考强度设计
811dfb9 fix: 修复记忆摘要竞态、回复切分死循环与图片体积失控
e3df44a feat: 配置契约 v2，桌面端全量映射并支持思考强度
9eea6e8 feat: 设置页重构，支持思考强度、模型列表与人设编辑
54cf6e7 feat: 连接自检、隐私说明与稳定性加固
d30b08f feat: 数据备份、图库维护与桌面健壮性
c9f840c feat: 按用户清理数据并更新 v0.2.0 文档
9c205c9 fix: 额外参数输入时不再重置光标
1361393 fix: 补齐审查项：索引回滚、用户节流、日志级别与更新清理
672079b perf: 缓存历史与图库索引，补 token 刷新和用量日志
612bb65 test: 补发送重试与 token 缓存用例
```

## 已知限制

- CR-39 未做代码签名/安装包；便携 zip 仍可能触发 SmartScreen。
- 自动更新的真实失败注入（锁文件导致复制失败）没有在打包版上实跑，只做了脚本单测与备份/还原代码审查。
- `handler` 编排、Neutralino 托盘/窗口仍无自动化测试，需要手动冒烟。
- 自定义命令/心情列表、图库缩略图未做。
- 服务端只做简单信号退出，不做 WS 优雅关闭。
