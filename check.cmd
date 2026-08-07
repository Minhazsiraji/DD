@echo off
REM Doctor's Diary - run the quality gates (lint, typecheck, production build).
set "NODE_DIR=E:\Minhaz Siraji\Claude\tools\node-v22.16.0-win-x64"
if not exist "%NODE_DIR%\node.exe" (
  echo ERROR: portable Node not found at %NODE_DIR%
  pause
  exit /b 1
)
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0"
echo === LINT ===      && call npm run lint      || goto :fail
echo === TYPECHECK === && call npm run typecheck || goto :fail
echo === BUILD ===     && call npm run build     || goto :fail
echo.
echo   All gates passed.
pause
exit /b 0
:fail
echo.
echo   FAILED - see output above.
pause
exit /b 1
