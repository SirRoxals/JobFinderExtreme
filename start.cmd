@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer from https://nodejs.org and try again.
  pause
  exit /b 1
)
node --input-type=module -e "await import('ts-jobspy')" >nul 2>nul
if errorlevel 1 (
  echo Installing the job search library for the first launch...
  call npm ci --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    echo Installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
node server.mjs --open
pause
