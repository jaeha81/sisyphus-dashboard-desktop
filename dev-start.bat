@echo off
chcp 65001 > nul
title Sisyphus Dashboard - Dev Mode

echo  ┌─────────────────────────────────────────┐
echo  │  SISYPHUS DASHBOARD  Development Mode   │
echo  └─────────────────────────────────────────┘
echo.
echo  WSL2가 실행 중인지 확인하세요.
echo  ttyd와 opencode가 WSL2에 설치되어 있어야 합니다.
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Node.js 미설치
  pause & exit /b 1
)

if not exist "node_modules" (
  echo [INFO] 의존성 설치 중...
  call npm install
)

echo [INFO] 앱 시작...
npm start -- --dev
