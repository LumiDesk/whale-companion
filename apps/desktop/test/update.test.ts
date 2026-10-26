import assert from "node:assert/strict";
import test from "node:test";

const {
  buildDownloadCommand,
  buildExtractCommand,
  buildFreeSpaceCommand,
  buildHashCommand,
  buildPowerShellDownloadCommand,
  buildUpdateScript,
  compareVersions,
  formatBytes,
  isNewerVersion,
  parseChecksumFile,
  parseHashOutput,
  parseRelease,
  parseUpdateResult,
  progressPercent,
  RELEASES_API,
  validateDownloadUrl,
} = await import("../src/lib/update");

const hash = "a".repeat(64);
const zipName = "whale-companion-0.2.0-win-x64.zip";
const zipUrl =
  "https://github.com/Talyra42/whale-companion/releases/download/v0.2.0/whale-companion-0.2.0-win-x64.zip";

test("更新检查只查正式 Release", () => {
  assert.ok(RELEASES_API.endsWith("/releases/latest"));
});

test("版本号比较：数字段、v 前缀、预发布", () => {
  assert.equal(compareVersions("0.1.1", "0.1.2"), -1);
  assert.equal(compareVersions("v0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("0.1.1", "v0.1.1"), 0);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
  assert.equal(compareVersions("not-a-version", "0.1.1"), 0);
});

test("判断是否有新版本", () => {
  assert.equal(isNewerVersion("0.2.0", "0.1.1"), true);
  assert.equal(isNewerVersion("0.1.1", "0.1.1"), false);
  assert.equal(isNewerVersion("0.1.0", "0.1.1"), false);
});

test("解析 GitHub Release：挑出便携包和校验文件", () => {
  const release = parseRelease({
    tag_name: "v0.2.0",
    name: "小鲸鱼 v0.2.0",
    body: "更新内容",
    html_url: "https://github.com/Talyra42/whale-companion/releases/tag/v0.2.0",
    published_at: "2026-10-25T00:00:00Z",
    assets: [
      {
        name: zipName,
        size: 123456,
        browser_download_url: zipUrl,
      },
      {
        name: "SHA256SUMS.txt",
        size: 80,
        browser_download_url:
          "https://github.com/Talyra42/whale-companion/releases/download/v0.2.0/SHA256SUMS.txt",
      },
      {
        name: "source.tar.gz",
        size: 10,
        browser_download_url: "https://github.com/example/source.tar.gz",
      },
    ],
  });

  assert.equal(release.version, "0.2.0");
  assert.equal(release.asset?.name, zipName);
  assert.equal(release.asset?.size, 123456);
  assert.equal(release.checksumAsset?.name, "SHA256SUMS.txt");
});

test("Release 里没有 Windows 包时 asset 为 null", () => {
  const release = parseRelease({
    tag_name: "v0.3.0",
    assets: [],
  });

  assert.equal(release.version, "0.3.0");
  assert.equal(release.asset, null);
  assert.equal(release.checksumAsset, null);
});

test("无效的 Release 响应会抛错", () => {
  assert.throws(() => parseRelease({}), /版本信息不完整/);
  assert.throws(() => parseRelease({ tag_name: "nightly" }), /版本号/);
});

test("下载地址只允许 GitHub HTTPS", () => {
  assert.equal(validateDownloadUrl(zipUrl), true);
  assert.equal(
    validateDownloadUrl("https://release-assets.githubusercontent.com/a.zip"),
    true,
  );
  assert.equal(validateDownloadUrl("http://github.com/a.zip"), false);
  assert.equal(validateDownloadUrl("https://evil.example/a.zip"), false);
  assert.equal(validateDownloadUrl("not a url"), false);
});

test("下载命令使用 curl，并拒绝非 GitHub 地址", () => {
  const command = buildDownloadCommand(zipUrl, "C:\\更新 缓存\\a.zip");

  assert.ok(command.startsWith("curl.exe "));
  assert.ok(command.includes("--fail"));
  assert.ok(command.includes(zipUrl));
  assert.ok(command.includes('"C:\\更新 缓存\\a.zip"'));

  assert.throws(
    () => buildDownloadCommand("https://evil.example/a.zip", "a.zip"),
    /GitHub/,
  );
});

test("PowerShell 兜底下载命令包含 Invoke-WebRequest", () => {
  const command = buildPowerShellDownloadCommand(zipUrl, "C:\\a b\\a.zip");

  assert.ok(command.includes("Invoke-WebRequest"));
  assert.ok(command.includes("'C:\\a b\\a.zip'"));
});

test("解压与哈希命令包含正确的 PowerShell 参数", () => {
  const extract = buildExtractCommand("C:\\a b\\a.zip", "C:\\out dir");
  assert.ok(extract.includes("Expand-Archive"));
  assert.ok(extract.includes("-LiteralPath 'C:\\a b\\a.zip'"));
  assert.ok(extract.includes("-DestinationPath 'C:\\out dir'"));

  const hashCommand = buildHashCommand("C:\\a b\\a.zip");
  assert.ok(hashCommand.includes("Get-FileHash"));
  assert.ok(hashCommand.includes("-LiteralPath 'C:\\a b\\a.zip'"));
});

test("校验文件按文件名匹配哈希", () => {
  const text = [
    `${"b".repeat(64)}  other.zip`,
    `${hash.toUpperCase()}  *${zipName}`,
  ].join("\r\n");

  assert.equal(parseChecksumFile(text, zipName), hash);
  assert.equal(parseChecksumFile(text, "missing.zip"), null);
  assert.equal(parseChecksumFile("not a checksum", zipName), null);
});

test("解析 Get-FileHash 输出", () => {
  assert.equal(parseHashOutput(`  ${hash.toUpperCase()}\r\n`), hash);
  assert.equal(parseHashOutput("no hash here"), null);
});

test("磁盘空间命令只接受单个盘符", () => {
  assert.ok(buildFreeSpaceCommand("D").includes("Get-PSDrive -Name 'D'"));
  assert.throws(() => buildFreeSpaceCommand("D:\\"), /盘符/);
  assert.throws(() => buildFreeSpaceCommand("C; rm"), /盘符/);
});

test("更新脚本：等 PID、备份、复制文件、失败还原、写结果、重启", () => {
  const script = buildUpdateScript({
    parentPid: 4321,
    sourceDir: "C:\\A B\\new",
    targetDir: "C:\\O'Brien\\WhaleCompanion",
    backupDir: "C:\\temp\\backup",
    resultFile: "C:\\temp\\result.json",
    logFile: "C:\\temp\\update.log",
    version: "0.2.0",
  });

  assert.ok(script.includes("Get-Process -Id 4321"));
  assert.ok(script.includes("备份当前版本"));
  assert.ok(script.includes("Restore-OldVersion"));
  assert.ok(script.includes("Copy-Item"));
  assert.ok(script.includes("'C:\\A B\\new'"));
  assert.ok(script.includes("'C:\\O''Brien\\WhaleCompanion'"));
  assert.ok(script.includes("'C:\\temp\\backup'"));
  assert.ok(script.includes("Start-Process"));
  assert.ok(script.includes("'0.2.0'"));

  assert.throws(
    () =>
      buildUpdateScript({
        parentPid: 0,
        sourceDir: "a",
        targetDir: "b",
        backupDir: "c",
        resultFile: "d",
        logFile: "e",
        version: "0.2.0",
      }),
    /PID/,
  );
});

test("解析更新结果，兼容 BOM 和失败信息", () => {
  assert.deepEqual(
    parseUpdateResult(
      `\uFEFF{"ok":true,"version":"0.2.0","finishedAt":"2026-10-25T00:00:00.000Z"}`,
    ),
    {
      ok: true,
      version: "0.2.0",
      error: undefined,
      finishedAt: "2026-10-25T00:00:00.000Z",
    },
  );

  assert.deepEqual(parseUpdateResult('{"ok":false,"version":"0.2.0","error":"文件被占用"}'), {
    ok: false,
    version: "0.2.0",
    error: "文件被占用",
    finishedAt: undefined,
  });

  assert.equal(parseUpdateResult("not json"), null);
  assert.equal(parseUpdateResult("{}"), null);
});

test("大小与进度格式化", () => {
  assert.equal(formatBytes(0), "未知大小");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MB");
  assert.equal(progressPercent(50, 100), 50);
  assert.equal(progressPercent(100, 100), 99);
  assert.equal(progressPercent(200, 100), 99);
  assert.equal(progressPercent(1, 0), null);
});
