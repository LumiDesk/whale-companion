param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][string]$PfxPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $FilePath)) {
  throw "找不到要签名的文件：$FilePath"
}
if (-not (Test-Path -LiteralPath $PfxPath)) {
  throw "找不到签名证书：$PfxPath"
}

$password = $env:WHALE_SIGN_PFX_PASSWORD
if ([string]::IsNullOrEmpty($password)) {
  throw "缺少 WHALE_SIGN_PFX_PASSWORD"
}

$signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
if (-not $signtool) {
  $roots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "$env:ProgramFiles\Windows Kits\10\bin"
  )

  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $candidate = Get-ChildItem -LiteralPath $root -Directory |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Select-Object -First 1

    if ($candidate) {
      $signtool = $candidate
      break
    }
  }
}

if (-not $signtool) {
  throw "找不到 signtool.exe（安装 Windows SDK，或把 signtool 加入 PATH）"
}

& $signtool sign /fd SHA256 /f $PfxPath /p $password /tr http://timestamp.digicert.com /td SHA256 $FilePath
if ($LASTEXITCODE -ne 0) {
  throw "signtool sign 退出码 $LASTEXITCODE"
}

& $signtool verify /pa /v $FilePath
if ($LASTEXITCODE -ne 0) {
  throw "签名校验失败，退出码 $LASTEXITCODE"
}

Write-Host "签名完成：$FilePath"
