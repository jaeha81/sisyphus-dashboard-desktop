#Requires -Version 5.0
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   SISYPHUS DASHBOARD DESKTOP — SETUP    ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$root = $PSScriptRoot

function Check-Requirement($name, $cmd) {
  try {
    $v = Invoke-Expression "$cmd --version 2>&1" | Select-Object -First 1
    Write-Host "  [OK] $name : $v" -ForegroundColor Green
    return $true
  } catch {
    Write-Host "  [!!] $name : NOT FOUND" -ForegroundColor Red
    return $false
  }
}

Write-Host "  Requirements:" -ForegroundColor DarkGray
$nodeOk = Check-Requirement "Node.js" "node"
$wslOk  = Check-Requirement "WSL2  " "wsl"

if (-not $nodeOk) {
  Write-Host ""
  Write-Host "  Node.js 가 필요합니다. https://nodejs.org 에서 설치하세요." -ForegroundColor Yellow
  Read-Host "  Press Enter to exit"
  exit 1
}

if (-not $wslOk) {
  Write-Host ""
  Write-Host "  WSL2 가 필요합니다. PowerShell 관리자로: wsl --install" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  [1/3] 의존성 설치 중..." -ForegroundColor DarkGray
Set-Location $root
npm install --prefer-offline 2>&1 | Where-Object { $_ -match "(added|error|warn)" } | ForEach-Object { Write-Host "        $_" }

if ($LASTEXITCODE -ne 0) {
  Write-Host "  npm install 실패" -ForegroundColor Red
  Read-Host "  Press Enter"
  exit 1
}

Write-Host "  [2/3] .env.local 설정 확인..." -ForegroundColor DarkGray
$envFile = Join-Path $root ".env.local"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root ".env.local.example") $envFile
  Write-Host "        .env.local 생성됨 — GitHub Token을 설정하세요" -ForegroundColor Yellow
} else {
  Write-Host "        .env.local 이미 존재" -ForegroundColor Green
}

Write-Host "  [3/3] 완료!" -ForegroundColor Green
Write-Host ""
Write-Host "  ┌─────────────────────────────────────────┐"
Write-Host "  │  npm start     개발 모드 실행            │"
Write-Host "  │  npm run build Windows 인스톨러 빌드     │"
Write-Host "  └─────────────────────────────────────────┘"
Write-Host ""

$launch = Read-Host "  지금 앱을 실행하시겠습니까? (y/n)"
if ($launch -eq 'y' -or $launch -eq 'Y') {
  npm start -- --dev
}
