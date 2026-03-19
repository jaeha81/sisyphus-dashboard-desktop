@echo off
chcp 65001 > nul
title Sisyphus Dashboard - Windows Build

echo.
echo  ═══════════════════════════════════════════
echo   SISYPHUS DASHBOARD  Windows Build Script
echo  ═══════════════════════════════════════════
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Node.js가 설치되어 있지 않습니다.
  echo         https://nodejs.org 에서 설치하세요.
  pause & exit /b 1
)

echo [1/4] 의존성 설치 중...
call npm install --prefer-offline
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] npm install 실패
  pause & exit /b 1
)

echo.
echo [2/4] 아이콘 파일 확인...
if not exist "assets\icon.ico" (
  echo       icon.ico 없음, 기본값 사용
)

echo.
echo [3/4] Windows 인스톨러 빌드 중...
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] 빌드 실패
  pause & exit /b 1
)

echo.
echo [4/4] 완료!
echo.
echo  ┌─────────────────────────────────────────┐
echo  │  dist\ 폴더에 빌드 결과물이 생성되었습니다  │
echo  │  SisyphusDashboard Setup *.exe          │
echo  └─────────────────────────────────────────┘
echo.
explorer dist
pause
