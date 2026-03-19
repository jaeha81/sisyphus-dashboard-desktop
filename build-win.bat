@echo off
chcp 65001 > nul
title Sisyphus Dashboard - Build
color 0E

echo.
echo  Sisyphus Dashboard - Windows Installer Build
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] Node.js required - https://nodejs.org
  pause & exit /b 1
)

cd /d "%~dp0"

if not exist "node_modules" (
  echo  [1/3] Installing dependencies...
  call npm install
  if %ERRORLEVEL% NEQ 0 ( echo  [ERROR] npm install failed & pause & exit /b 1 )
) else (
  echo  [1/3] Dependencies OK
)

echo  [2/3] Building Windows installer...
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] Build failed
  pause & exit /b 1
)

echo.
echo  Build complete! Check dist\ folder
echo.
explorer "%~dp0dist"
pause
