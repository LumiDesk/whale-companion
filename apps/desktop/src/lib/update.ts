import { quoteArg } from "./process";

/** 更新源：只查正式 Release，不包含 pre-release */
export const UPDATE_OWNER = "Talyra42";
export const UPDATE_REPO = "whale-companion";
export const RELEASES_API = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;
/** 允许预发布时改用列表接口，自己按语义化版本挑（/releases/latest 永远不含 pre-release） */
export const RELEASES_LIST_API = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases?per_page=30`;
export const RELEASES_PAGE = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases`;

/** 按设置选择检查更新的接口 */
export const releasesApiUrl = (includePrerelease: boolean): string =>
  includePrerelease ? RELEASES_LIST_API : RELEASES_API;

export const UPDATE_ASSET_PATTERN = /^whale-companion-.+-win-x64\.zip$/i;
export const CHECKSUM_ASSET_NAME = "SHA256SUMS.txt";

export interface IGithubAsset {
  name: string;
  size: number;
  browserDownloadUrl: string;
}

export interface IReleaseInfo {
  tag: string;
  version: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
  asset: IGithubAsset | null;
  checksumAsset: IGithubAsset | null;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "preparing"
  | "ready"
  | "error";

export interface IUpdateState {
  status: UpdateStatus;
  info?: IReleaseInfo;
  /** 0-100；null 表示总大小未知 */
  progress?: number | null;
  error?: string;
  checkedAt?: number;
}

export interface IUpdateResult {
  ok: boolean;
  version: string;
  error?: string;
  finishedAt?: string;
}

const toAsset = (raw: unknown): IGithubAsset | null => {
  if (!raw || typeof raw !== "object") return null;

  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name : "";
  const url =
    typeof value.browser_download_url === "string"
      ? value.browser_download_url
      : "";

  if (!name || !url) return null;

  return {
    name,
    size: Number(value.size) > 0 ? Number(value.size) : 0,
    browserDownloadUrl: url,
  };
};

/** 去掉 tag 的 v 前缀，保留 x.y.z 与预发布后缀 */
export const normalizeVersion = (raw: string): string =>
  raw.trim().replace(/^v/i, "");

interface IParsedVersion {
  core: number[];
  prerelease: string[];
}

const parseVersion = (raw: string): IParsedVersion | null => {
  const value = normalizeVersion(raw).split("+")[0];
  if (!value) return null;

  const dash = value.indexOf("-");
  const coreText = dash >= 0 ? value.slice(0, dash) : value;
  const prerelease = dash >= 0 ? value.slice(dash + 1) : "";

  const core = coreText.split(".").map((part) => Number(part));
  if (
    core.length !== 3 ||
    core.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return null;
  }

  return { core, prerelease: prerelease ? prerelease.split(".") : [] };
};

const sign = (value: number): number => (value < 0 ? -1 : value > 0 ? 1 : 0);

/** 语义化比较；无法解析时返回 0，让调用方按"没有更新"处理 */
export const compareVersions = (left: string, right: string): number => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;

  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return sign(a.core[i] - b.core[i]);
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const leftPart = a.prerelease[i];
    const rightPart = b.prerelease[i];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;

    if (leftNumber !== null && rightNumber !== null) {
      if (leftNumber !== rightNumber) return sign(leftNumber - rightNumber);
    } else {
      const compared = leftPart.localeCompare(rightPart);
      if (compared !== 0) return sign(compared);
    }
  }

  return 0;
};

export const isNewerVersion = (candidate: string, current: string): boolean =>
  compareVersions(candidate, current) > 0;

/** 带 -rc.1 / -beta 后缀的版本算预发布 */
export const isPrereleaseVersion = (version: string): boolean =>
  (parseVersion(version)?.prerelease.length ?? 0) > 0;

export const pickUpdateAsset = (assets: IGithubAsset[]): IGithubAsset | null =>
  assets.find((asset) => UPDATE_ASSET_PATTERN.test(asset.name)) ?? null;

/** 把 GitHub /releases/latest 的响应收敛成内部结构 */
export const parseRelease = (raw: unknown): IReleaseInfo => {
  if (!raw || typeof raw !== "object") {
    throw new Error("GitHub 返回的版本信息不完整");
  }

  const value = raw as Record<string, unknown>;
  const tag = typeof value.tag_name === "string" ? value.tag_name : "";
  if (!tag) throw new Error("GitHub 返回的版本信息不完整");

  const assets = (Array.isArray(value.assets) ? value.assets : [])
    .map(toAsset)
    .filter((asset): asset is IGithubAsset => asset !== null);

  const version = normalizeVersion(tag);
  if (!parseVersion(version)) {
    throw new Error(`无法识别的版本号：${tag}`);
  }

  return {
    tag,
    version,
    name: typeof value.name === "string" && value.name ? value.name : tag,
    body: typeof value.body === "string" ? value.body : "",
    htmlUrl:
      typeof value.html_url === "string" && value.html_url
        ? value.html_url
        : RELEASES_PAGE,
    publishedAt:
      typeof value.published_at === "string" ? value.published_at : "",
    asset: pickUpdateAsset(assets),
    checksumAsset:
      assets.find(
        (asset) =>
          asset.name.toLowerCase() === CHECKSUM_ASSET_NAME.toLowerCase(),
      ) ?? null,
  };
};

/**
 * 从 `/releases` 列表里挑一个「比当前版本新」的发布。
 * - 跳过草稿；不允许预发布时再跳过 pre-release（GitHub 标记或 -rc 后缀）
 * - 优先挑带 Windows 便携包的版本，避免「有新版本却没有安装包」
 */
export const pickBestRelease = (
  raw: unknown,
  current: string,
  includePrerelease: boolean,
): IReleaseInfo | null => {
  if (!Array.isArray(raw)) return null;

  const candidates: IReleaseInfo[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;
    if (record.draft === true) continue;
    if (!includePrerelease && record.prerelease === true) continue;

    try {
      const info = parseRelease(record);
      if (!includePrerelease && isPrereleaseVersion(info.version)) continue;
      candidates.push(info);
    } catch {
      // tag 不是版本号的条目直接跳过
    }
  }

  const newer = candidates
    .filter((info) => isNewerVersion(info.version, current))
    .sort((a, b) => compareVersions(b.version, a.version));

  return newer.find((info) => info.asset) ?? newer[0] ?? null;
};

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

/** 只允许 GitHub 的 HTTPS 下载地址，避免 API 响应被篡改后把请求引到别处 */
export const validateDownloadUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
};

/** PowerShell 单引号字符串：内部的 ' 用两个 ' 转义 */
export const psLiteral = (value: string): string =>
  `'${value.replace(/'/g, "''")}'`;

/**
 * 下载走 curl.exe 而不是 WebView 的 fetch：
 * GitHub Release 资源所在的 Azure Blob 不返回 CORS 头，浏览器里 fetch 会被拦。
 */
export const buildDownloadCommand = (
  url: string,
  destination: string,
): string => {
  if (!validateDownloadUrl(url)) {
    throw new Error("下载地址不是允许的 GitHub 域名");
  }

  return [
    "curl.exe",
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--connect-timeout",
    "20",
    "--max-time",
    "900",
    "--retry",
    "2",
    "--retry-delay",
    "2",
    "--output",
    quoteArg(destination),
    quoteArg(url),
  ].join(" ");
};

/** 没有 curl 时的兜底下载方式 */
export const buildPowerShellDownloadCommand = (
  url: string,
  destination: string,
): string => {
  if (!validateDownloadUrl(url)) {
    throw new Error("下载地址不是允许的 GitHub 域名");
  }

  return (
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command " +
    "\"$ProgressPreference='SilentlyContinue'; " +
    `Invoke-WebRequest -Uri ${psLiteral(url)} -OutFile ${psLiteral(
      destination,
    )} -UseBasicParsing"`
  );
};

export const buildExtractCommand = (
  zipFile: string,
  destination: string,
): string =>
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command " +
  `"Expand-Archive -LiteralPath ${psLiteral(zipFile)} ` +
  `-DestinationPath ${psLiteral(destination)} -Force"`;

export const buildHashCommand = (file: string): string =>
  "powershell.exe -NoProfile -Command " +
  `"(Get-FileHash -LiteralPath ${psLiteral(file)} -Algorithm SHA256).Hash"`;

/** 查询目标盘剩余空间（MB）；只接受单个盘符，避免命令注入 */
export const buildFreeSpaceCommand = (drive: string): string => {
  if (!/^[A-Za-z]$/.test(drive)) {
    throw new Error("盘符不合法");
  }

  return (
    "powershell.exe -NoProfile -Command " +
    `"[math]::Floor((Get-PSDrive -Name '${drive}').Free / 1MB)"`
  );
};

export const buildApplyCommand = (scriptPath: string): string =>
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${quoteArg(
    scriptPath,
  )}`;

/** 从 SHA256SUMS.txt 里找目标文件的哈希；格式为 `<hash>  <name>` */
export const parseChecksumFile = (
  text: string,
  fileName: string,
): string | null => {
  const wanted = fileName.toLowerCase();

  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (!match) continue;

    const name = match[2].replace(/^\.\//, "").toLowerCase();
    if (name === wanted) return match[1].toLowerCase();
  }

  return null;
};

export const parseHashOutput = (stdout: string): string | null => {
  const match = /\b([a-fA-F0-9]{64})\b/.exec(stdout);
  return match ? match[1].toLowerCase() : null;
};

export const parseUpdateResult = (
  raw: string | null | undefined,
): IUpdateResult | null => {
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!value || typeof value !== "object") return null;

    const record = value as Record<string, unknown>;
    if (typeof record.ok !== "boolean") return null;

    return {
      ok: record.ok,
      version: typeof record.version === "string" ? record.version : "",
      error: typeof record.error === "string" ? record.error : undefined,
      finishedAt:
        typeof record.finishedAt === "string" ? record.finishedAt : undefined,
    };
  } catch {
    return null;
  }
};

export interface IUpdateScriptOptions {
  parentPid: number;
  sourceDir: string;
  targetDir: string;
  /** 覆盖前把旧 exe / resources.neu / server 备份到这里，失败可还原 */
  backupDir: string;
  resultFile: string;
  logFile: string;
  version: string;
}

/**
 * 生成"等旧进程退出 → 备份 → 覆盖文件 → 失败还原 → 写结果 → 重启"的脚本。
 * 脚本由旧进程 spawn 出去，所以必须自己等 PID 消失后再动 exe。
 */
export const buildUpdateScript = (options: IUpdateScriptOptions): string => {
  const {
    parentPid,
    sourceDir,
    targetDir,
    backupDir,
    resultFile,
    logFile,
    version,
  } = options;

  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    throw new Error("更新脚本需要有效的父进程 PID");
  }

  return [
    "$ErrorActionPreference = 'Stop'",
    `$log = ${psLiteral(logFile)}`,
    `$source = ${psLiteral(sourceDir)}`,
    `$target = ${psLiteral(targetDir)}`,
    `$backup = ${psLiteral(backupDir)}`,
    "$backupReady = $false",
    "function Write-UpdateLog([string]$message) {",
    '  $line = "$(Get-Date -Format o) $message"',
    "  Add-Content -LiteralPath $log -Value $line -Encoding UTF8",
    "}",
    "function Restore-OldVersion {",
    "  if (-not $backupReady) { return }",
    "  Write-UpdateLog '开始还原旧版本'",
    "  foreach ($name in @('WhaleCompanion.exe', 'resources.neu', 'server')) {",
    "    $from = Join-Path $backup $name",
    "    if (-not (Test-Path -LiteralPath $from)) { continue }",
    "    if ($name -eq 'server') {",
    "      $serverPath = Join-Path $target 'server'",
    "      if (Test-Path -LiteralPath $serverPath) {",
    "        Remove-Item -LiteralPath $serverPath -Recurse -Force",
    "      }",
    "    }",
    "    Copy-Item -LiteralPath $from -Destination $target -Recurse -Force",
    "  }",
    "}",
    "try {",
    `  Write-UpdateLog '等待旧进程退出（PID ${parentPid}）'`,
    "  $deadline = (Get-Date).AddSeconds(90)",
    `  while ((Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 300 }`,
    `  if (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) { throw '旧进程在 90 秒内没有退出' }`,
    "  Start-Sleep -Milliseconds 800",
    "  Write-UpdateLog '备份当前版本'",
    "  New-Item -ItemType Directory -Path $backup -Force | Out-Null",
    "  foreach ($name in @('WhaleCompanion.exe', 'resources.neu', 'server')) {",
    "    $item = Join-Path $target $name",
    "    if (Test-Path -LiteralPath $item) {",
    "      Copy-Item -LiteralPath $item -Destination $backup -Recurse -Force",
    "    }",
    "  }",
    "  $backupReady = $true",
    "  Write-UpdateLog '清理旧版本文件'",
    "  $hasServer = Test-Path -LiteralPath (Join-Path $source 'server')",
    "  Write-UpdateLog '复制新版本文件'",
    "  $copied = $false",
    "  for ($attempt = 1; $attempt -le 10; $attempt++) {",
    "    try {",
    "      if ($hasServer) {",
    "        $serverPath = Join-Path $target 'server'",
    "        if (Test-Path -LiteralPath $serverPath) {",
    "          Remove-Item -LiteralPath $serverPath -Recurse -Force",
    "        }",
    "      }",
    "      Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $target -Recurse -Force",
    "      $copied = $true",
    "      break",
    "    } catch {",
    "      Start-Sleep -Seconds 1",
    "    }",
    "  }",
    "  if (-not $copied) { throw '复制文件失败，可能有文件仍被占用' }",
    "  $exe = Join-Path $target 'WhaleCompanion.exe'",
    "  if (-not (Test-Path -LiteralPath $exe)) { throw '更新后找不到 WhaleCompanion.exe' }",
    `  @{ ok = $true; version = ${psLiteral(version)}; finishedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress | Set-Content -LiteralPath ${psLiteral(resultFile)} -Encoding UTF8`,
    "  Write-UpdateLog '更新完成，正在重启'",
    "  try {",
    "    Start-Process -FilePath $exe -WorkingDirectory $target",
    "  } catch {",
    '    Write-UpdateLog "重启失败：$($_.Exception.Message)"',
    "  }",
    "} catch {",
    "  $message = $_.Exception.Message",
    '  Write-UpdateLog "更新失败：$message"',
    '  try { Restore-OldVersion } catch { Write-UpdateLog "还原失败：$($_.Exception.Message)" }',
    `  @{ ok = $false; version = ${psLiteral(version)}; error = $message; finishedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress | Set-Content -LiteralPath ${psLiteral(resultFile)} -Encoding UTF8`,
    "  $exe = Join-Path $target 'WhaleCompanion.exe'",
    "  if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe -WorkingDirectory $target }",
    "}",
    "",
  ].join("\r\n");
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未知大小";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

export const progressPercent = (
  received: number,
  total: number,
): number | null => {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.min(99, Math.max(0, Math.round((received / total) * 100)));
};
