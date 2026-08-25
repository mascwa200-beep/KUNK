@echo off
REM Double-click this. It runs the PowerShell installer next to it.
REM -ExecutionPolicy Bypass is scoped to this one process and changes nothing
REM about your machine's policy.
setlocal
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%Install-FPCamera.ps1"
if errorlevel 1 (
  echo.
  echo The installer reported a problem. See the messages above.
  pause
)
endlocal
