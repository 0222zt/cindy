# Cindy Local: 启动桌面端（开发模式,独立数据沙箱,不碰正式 Cindy 数据）
# 用法: powershell -ExecutionPolicy Bypass -File .\fork-local\start-dev.ps1
# 本脚本假定它位于仓库根目录下的 fork-local/ 里;若放在别处,改 $root 指向源码树即可。
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'apps/desktop'))) {
  throw "找不到源码树: $root (脚本应放在仓库根目录的 fork-local/ 下)"
}

# 便携 Node:优先用 PATH 里的 node;没有时设 $env:PORTABLE_NODE 指向 node.exe
if ($env:PORTABLE_NODE -and (Test-Path $env:PORTABLE_NODE)) {
  $env:PATH = "$(Split-Path -Parent $env:PORTABLE_NODE);" + $env:PATH
}

$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:COREPACK_ENABLE = '0'
$env:CI = '1'

Set-Location $root
Write-Host "[cindy-local] 启动 dev（CDP 9222,隔离沙箱 cindy-local）..." -ForegroundColor Cyan
pnpm --filter desktop dev -- --remote-debugging-port=9222 --isolated=cindy-local
