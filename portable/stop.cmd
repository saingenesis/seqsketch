@echo off
"%~dp0runtime\node.exe" "%~dp0runtime\launcher.mjs" stop
if errorlevel 1 (
  echo.
  echo Could not stop the server. See the user guide.
  pause
)
