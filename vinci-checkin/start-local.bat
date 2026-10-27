@echo off
cd /d "%~dp0"
title VINCI 2026 check-in - local trial

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed yet.
  echo   Please install Node.js 20 LTS first, then double-click this file again:
  echo     https://nodejs.org/
  echo     China mirror: https://npmmirror.com/mirrors/node/
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   First run: installing packages. This takes a few minutes...
  echo.
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo.
    echo   Install failed. Check the network and double-click this file again.
    pause
    exit /b 1
  )
)

echo.
echo   Building and starting. The browser will open by itself in about a minute...
echo.
call npm run local
pause
