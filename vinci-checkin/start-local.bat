@echo off
chcp 65001 >nul
cd /d "%~dp0"
title VINCI 2026 签到 · 本地试用

if not exist "package.json" (
  echo.
  echo   找不到程序文件。请先在压缩包上点右键「全部解压缩」，再双击解压出来的 start-local.bat。
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   这台电脑还没有装 Node.js。
  echo   请先安装 Node.js，选 LTS 版本，装完再双击这个文件：
  echo     官网：https://nodejs.org/
  echo     国内更快：https://npmmirror.com/mirrors/node/
  echo.
  pause
  exit /b 1
)

set "READY=1"
if not exist "node_modules\next\package.json" set "READY=0"
if not exist "node_modules\@electric-sql\pglite\package.json" set "READY=0"
if "%READY%"=="0" (
  echo.
  echo   第一次运行：正在安装需要的组件，大约几分钟，请不要关掉这个窗口……
  echo.
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo.
    echo   安装失败了。请检查网络后再双击一次；还不行就把这个窗口截图发过来。
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   正在启动，大约一分钟后浏览器会自动打开……
echo.
call npm run local
echo.
echo   程序已经停止。如果上面有报错，请把这个窗口截图发过来。
echo.
pause
