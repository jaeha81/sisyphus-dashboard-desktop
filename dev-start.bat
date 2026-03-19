@echo off
chcp 65001 > nul
title Sisyphus Dashboard - Dev Mode
color 0B

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   SISYPHUS DASHBOARD  Dev Mode          ║
echo  ╚══════════════════════════════════════════╝
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] Node.js 미설치 - https://nodejs.org
  pause & exit /b 1
)

where wsl >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo  [WARN] WSL2 미설치 - 터미널 패널 기능 불가
) else (
  wsl --status > nul 2>&1 || echo  [WARN] WSL2 실행 필요
)

if not exist "%~dp0node_modules" (
  echo  [INFO] 의존성 설치 중...
  cd /d "%~dp0"
  call npm install
  if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] npm install 실패
    pause & exit /b 1
  )
)

if not exist "%~dp0.env.local" (
  copy "%~dp0.env.local.example" "%~dp0.env.local" > nul
  echo  [INFO] .env.local 생성됨 - GitHub Token 설정 필요
)

cd /d "%~dp0"
echo  [INFO] 앱 시작 중...
echo.
npm start -- --dev
