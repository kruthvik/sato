@echo off
setlocal
echo [Learn Settings] Starting Settings ^& Integration Hub...
bun scripts/settings-server.ts
set "SETTINGS_EXIT_CODE=%errorlevel%"
endlocal & exit /b %SETTINGS_EXIT_CODE%
