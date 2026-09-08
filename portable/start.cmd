@echo off
"%~dp0runtime\node.exe" "%~dp0runtime\launcher.mjs" start %*
if errorlevel 1 (
  echo.
  echo Startup failed. See the user guide or runtime\server.log.
  pause
)
