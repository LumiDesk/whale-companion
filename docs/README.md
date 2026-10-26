# docs

README 用到的静态素材，以及它们的来源。文字文档都在仓库根目录：
[`README.md`](../README.md)、[`AGENTS.md`](../AGENTS.md)、[`CHANGELOG.md`](../CHANGELOG.md)。

## 目录

```
screenshots/   桌面控制台截图（README「截图」一节用的）
assets/
  logo.png            README 顶部图标（与 apps/desktop/public/icons/app.png 相同）
  architecture.png    架构图成品（README「它怎么工作」）
  architecture.svg    架构图源文件，改图改这个
  social-preview.png  GitHub 社交预览图（1280×640）
```

## 截图是怎么来的

截图用的是**真实组件 + 演示数据**，不是手绘的效果图：

- 页面：`apps/desktop/src/components/` 里的 StatusPage / SettingsPage / LogsPage
- 视口：1080×760（和桌面端默认窗口同量级），DPR 2 → 2160×1520 的 PNG
- 浏览器：Edge headless（`--headless=new --screenshot --force-device-scale-factor=2`）
- 动画：加 `--virtual-time-budget=2000`，等 `page-in` 动画结束再截，否则整页会半透明

重新生成的做法：临时在 `apps/desktop/preview/` 放一个 `index.html` + `main.tsx`，
用一个假的 `IController`（状态 running、QQ online、几条像样的日志）渲染上面的组件，
用 `?page=status|settings|logs` 切页；然后

```bash
pnpm --filter @apps/desktop exec vite --host 127.0.0.1 --port 5199
# 另一个终端：Edge 截图，产物覆盖 docs/screenshots/*.png
```

**生成完把预览工程删掉**，仓库里只留 PNG。截图里的路径、AppID、密钥都是演示数据；
改过界面之后记得一起换图，否则截图会和 UI 对不上。

## 架构图

`architecture.svg` 是手写的（不是 Mermaid 导出），改结构直接改里面的坐标和文字；
`architecture.png` 是它 2 倍渲染后裁掉白边的成品：

```
Edge headless 渲染 SVG（--force-device-scale-factor=2）
→ 用 PIL 按非白像素裁边 + 32px 留白
→ docs/assets/architecture.png
```

用图片而不是 Mermaid，是因为 GitHub 的 Mermaid 渲染在 README 页面偶发失败
（同一段代码在 blob 页面又能正常画出来），README 是门面，不适合赌这个。

## 社交预览图

`social-preview.png` 是 1280×640、用于仓库 Settings → Social preview 的图。
GitHub 没有开放设置它的 API，只能网页上传；改完文案或配色后重新导出覆盖即可。
