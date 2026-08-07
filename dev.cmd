@echo off
REM Doctor's Diary — start the dev server.
REM Node is not installed system-wide on this machine; it lives in the portable
REM toolchain below. This script puts it on PATH for this window only.

set "NODE_DIR=E:\Minhaz Siraji\Claude\tools\node-v22.16.0-win-x64"

if not exist "%NODE_DIR%\node.exe" (
  echo.
  echo   ERROR: portable Node not found at:
  echo   %NODE_DIR%
  echo.
  echo   Edit NODE_DIR at the top of dev.cmd to point at your Node folder.
  echo.
  pause
  exit /b 1
)

set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0"

echo.
echo   Doctor's Diary  -  http://localhost:3000
echo   Press Ctrl+C to stop.
echo.

call npm run dev %*
