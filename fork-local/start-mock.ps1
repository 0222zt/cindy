# Cindy Local: 启动离线 Mock LLM（零依赖,仅监听 127.0.0.1）
# 用法: powershell -ExecutionPolicy Bypass -File .\fork-local\start-mock.ps1
$ErrorActionPreference = 'Stop'

$node = if ($env:PORTABLE_NODE) { $env:PORTABLE_NODE } else { (Get-Command node -ErrorAction Stop).Source }
$server = Join-Path $PSScriptRoot 'mock\mock-openai-server.mjs'
Write-Host "[cindy-local] Mock LLM → http://127.0.0.1:11435" -ForegroundColor Cyan
Write-Host "[cindy-local] 请求日志 → $(Join-Path $PSScriptRoot 'mock\mock-requests.jsonl')" -ForegroundColor DarkGray
& $node $server --port 11435
