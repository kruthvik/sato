@echo off
REM Compatibility shim. The canonical launcher is learn.ps1.
where pwsh.exe >nul 2>&1
if errorlevel 1 goto windows_powershell

pwsh.exe -NoLogo -NoProfile -File "%~dp0learn.ps1" %*
exit /b %errorlevel%

:windows_powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0learn.ps1" %*
exit /b %errorlevel%
