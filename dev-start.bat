@echo off
chcp 65001 > nul
title Sisyphus Dashboard
color 0B

echo.
echo  Sisyphus Dashboard - Starting...
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] Node.js required - https://nodejs.org
  pause & exit /b 1
)

set "APPDIR=%~dp0"
if "%APPDIR:~-1%"=="\" set "APPDIR=%APPDIR:~0,-1%"

if not exist "%APPDIR%\node_modules" (
  echo  [INFO] Installing dependencies...
  cd /d "%APPDIR%"
  call npm install
  if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] npm install failed
    pause & exit /b 1
  )
)

if not exist "%APPDIR%\.env.local" (
  copy "%APPDIR%\.env.local.example" "%APPDIR%\.env.local" > nul
  echo  [INFO] .env.local created - set your GitHub Token
)

set "SHORTCUT=%USERPROFILE%\Desktop\Sisyphus Dashboard.lnk"
if not exist "%SHORTCUT%" (
  echo  [INFO] Creating desktop shortcut...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$WS=New-Object -ComObject WScript.Shell;$SC=$WS.CreateShortcut('%SHORTCUT%');$SC.TargetPath='cmd.exe';$SC.Arguments='/c \""%APPDIR%\dev-start.bat\"\"';$SC.WorkingDirectory='%APPDIR%';$SC.WindowStyle=1;$SC.Description='Sisyphus Dashboard';$Ei='%APPDIR%\node_modules\electron\dist\electron.exe';if(Test-Path $Ei){$SC.IconLocation=$Ei+',0'};$SC.Save()" > nul 2>&1
  if exist "%SHORTCUT%" (
    echo  [INFO] Desktop shortcut created!
  )
)

cd /d "%APPDIR%"
echo  [INFO] Launching app...
echo.
npm start -- --dev
